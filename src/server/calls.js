import { readdir } from 'node:fs/promises';
import { reduceEvents } from '../monitor/readEvents.js';
import { safePath } from './paths.js';

export async function readCall(root, directory, callId) {
  const dir = await safePath(root, directory);
  let files;
  try { files = await readdir(dir); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const events = [];
  for (const name of files.filter((name) => /^\d{4}-\d{2}-\d{2}(?:\.[\w-]+)?\.jsonl$/.test(name)).sort()) {
    await reduceEvents(await safePath(root, `${directory}/${name}`), (result, event) => {
      if (event.callId === callId) result.push(event);
      return result;
    }, events);
  }
  return events.length ? { callId, events: events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)) } : null;
}
