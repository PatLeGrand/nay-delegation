import { readdir, open, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { remainingPct, unknown } from './common.js';

async function sessionFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    try {
      if (entry.isDirectory()) return await sessionFiles(path);
      if (entry.isFile() && entry.name.endsWith('.jsonl')) return [{ path, mtime: (await stat(path)).mtimeMs }];
    } catch { return []; }
    return [];
  }));
  return files.flat();
}

function parseWindow(window, now) {
  if (!window || !Number.isFinite(window.used_percent) || window.used_percent < 0 || window.used_percent > 100 ||
      !Number.isFinite(window.window_minutes) || window.window_minutes <= 0 || !Number.isFinite(window.resets_at)) return null;
  const date = new Date(window.resets_at * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  const minutes = window.window_minutes;
  const label = minutes % 10080 === 0 ? `${minutes / 10080 * 7}j` :
    minutes % 1440 === 0 ? `${minutes / 1440}j` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}min`;
  const result = { label, remainingPct: 100 - window.used_percent, resetsAt: date.toISOString() };
  result.remainingPct = remainingPct(result, now);
  return result;
}

function findRateLimits(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (Object.hasOwn(value, 'rate_limits')) return value.rate_limits;
  for (const child of Object.values(value)) {
    const limits = findRateLimits(child);
    if (limits !== undefined) return limits;
  }
}

export function parseCodexEntry(entry, staleAfterMin, now = Date.now()) {
  const measured = Date.parse(entry?.timestamp);
  const limits = findRateLimits(entry);
  if (!limits || !Number.isFinite(measured)) return unknown('Relevé Codex invalide');
  const present = [limits.primary, limits.secondary].filter((window) => window != null);
  const windows = present.map((window) => parseWindow(window, now));
  if (!windows.length || windows.some((window) => !window)) return unknown('Fenêtres Codex invalides');
  return { status: 'ok', windows, measuredAt: new Date(measured).toISOString(), stale: now - measured > staleAfterMin * 60000 };
}

async function readLatest(file, config, now, openFile) {
  const handle = await openFile(file, 'r');
  try {
    const size = (await handle.stat()).size;
    let position = size;
    let pending = Buffer.alloc(0);
    let read = 0;
    while (position > 0 && read < config.codexMaxReadBytes) {
      const length = Math.min(config.codexReadBlockBytes, config.codexMaxReadBytes - read, position);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position - length);
      if (bytesRead !== length) break;
      position -= length;
      read += length;
      const parts = Buffer.concat([buffer, pending]).toString('binary').split('\n');
      pending = Buffer.from(parts.shift(), 'binary');
      if (position === 0) { parts.unshift(pending.toString('binary')); pending = Buffer.alloc(0); }
      for (const line of parts.reverse()) {
        let entry;
        try { entry = JSON.parse(Buffer.from(line, 'binary').toString('utf8')); } catch { continue; }
        const result = parseCodexEntry(entry, config.codexStaleAfterMin, now);
        if (result.status === 'ok') return result;
      }
    }
  } finally { await handle.close(); }
}

export async function readCodex(config, now = Date.now(), openFile = open) {
  try {
    const dir = config.codexSessionsDir.replace(/^~(?=\/|$)/, homedir());
    const files = (await sessionFiles(dir)).sort((a, b) => b.mtime - a.mtime).slice(0, config.codexMaxSessionFiles);
    let latest;
    for (const file of files) {
      try {
        const result = await readLatest(file.path, config, now, openFile);
        if (result && (!latest || Date.parse(result.measuredAt) > Date.parse(latest.measuredAt))) latest = result;
      } catch { continue; }
    }
    return latest ?? unknown('Aucun relevé Codex trouvé');
  } catch (error) {
    return unknown(`Lecture Codex impossible : ${error.message}`);
  }
}
