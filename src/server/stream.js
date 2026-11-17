import { open, stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

function emitLine(line, response, feature) {
  let event;
  try { event = JSON.parse(line); } catch { return; }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return;
  if (feature !== undefined && event.feature !== feature) return;
  // Un client qui ne consomme plus le flux se reconnectera sans saturer la mémoire du serveur.
  if (!response.write(`event: agent\ndata: ${JSON.stringify(event)}\n\n`)) response.destroy();
}

export async function startStream(request, response, { fileForToday, config, feature }) {
  let handle, identity, position = 0, pending = '', decoder = new StringDecoder('utf8');
  let stopped = false, polling = false;
  const reset = () => { position = 0; pending = ''; decoder = new StringDecoder('utf8'); };
  async function drain() {
    if (!handle) return;
    const size = (await handle.stat()).size;
    if (size < position) reset();
    while (!stopped && position < size) {
      const buffer = Buffer.alloc(Math.min(config.maxBodyBytes, size - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      pending += decoder.write(buffer.subarray(0, bytesRead));
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) emitLine(line, response, feature);
    }
  }
  async function poll(initial = false) {
    const file = await fileForToday();
    let info;
    try { info = await stat(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const next = info ? `${file}:${info.dev}:${info.ino}` : null;
    await drain();
    if (next !== identity && next !== null) {
      let opened;
      try {
        const candidate = await open(file, 'r');
        opened = await candidate.stat().catch(async (error) => { await candidate.close(); throw error; });
        await handle?.close();
        handle = candidate;
      } catch (error) {
        // Fichier renommé par une rotation entre stat et open : on réessaie au prochain tick.
        if (error.code === 'ENOENT') return;
        throw error;
      }
      identity = `${file}:${opened.dev}:${opened.ino}`;
      reset();
      if (initial) position = opened.size;
      else await drain();
    }
  }
  async function close() {
    stopped = true;
    clearInterval(timer);
    clearInterval(heartbeat);
    if (!polling) await handle?.close().catch(() => {});
  }
  let timer, heartbeat;
  response.on('close', () => { void close(); });
  try { await poll(true); } catch (error) { await close(); throw error; }
  if (stopped) { await handle?.close(); return; }
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  response.flushHeaders();
  heartbeat = setInterval(() => {
    if (!response.write(': ping\n\n')) response.destroy();
  }, config.sseHeartbeatSec * 1000);
  timer = setInterval(async () => {
    if (polling || stopped) return;
    polling = true;
    try { await poll(); } catch { response.destroy(); }
    finally {
      polling = false;
      if (stopped) await handle?.close().catch(() => {});
    }
  }, config.sseFilePollMs);
}
