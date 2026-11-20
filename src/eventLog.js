import { appendFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const queues = new Map();

export function truncateEvent(event, config) {
  const result = { ...event };
  for (const field of ['output', 'text']) {
    if (typeof result[field] === 'string') {
      result[field] = result[field].split('\n').slice(0, config.maxOutputLines).join('\n').slice(0, config.maxOutputChars);
    }
  }
  return result;
}

let archiveSequence = 0;

// Nom unique et triable : deux processus qui archivent en même temps ne s'écrasent jamais.
function archiveName(path) {
  archiveSequence += 1;
  return `${path}.${Date.now()}-${String(archiveSequence).padStart(6, '0')}-${randomUUID().slice(0, 8)}.jsonl`;
}

async function pruneArchives(path, config) {
  const directory = dirname(path);
  const prefix = `${basename(path)}.`;
  const current = `${basename(path)}.jsonl`;
  const archives = (await readdir(directory))
    .filter((name) => name.startsWith(prefix) && name.endsWith('.jsonl') && name !== current)
    .sort();
  for (const name of archives.slice(0, Math.max(0, archives.length - config.maxRotatedFiles))) {
    await rm(join(directory, name), { force: true });
  }
}

// Rotation sans verrou : le renommage est atomique ; au pire, deux processus simultanés
// archivent chacun un fichier, sans perte de ligne puisque chaque ajout rouvre le fichier courant.
async function rotate(path, config) {
  if (config.maxRotatedFiles === 0) return;
  let size;
  try { size = (await stat(`${path}.jsonl`)).size; } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (size <= config.maxFileBytes) return;
  try { await rename(`${path}.jsonl`, archiveName(path)); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await pruneArchives(path, config);
}

export function appendEvent(event, directory, config) {
  const path = join(directory, event.ts.slice(0, 10));
  const previous = queues.get(path) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(async () => {
    await mkdir(directory, { recursive: true });
    await rotate(path, config);
    await appendFile(`${path}.jsonl`, `${JSON.stringify(event)}\n`, 'utf8');
  });
  queues.set(path, pending);
  pending.finally(() => { if (queues.get(path) === pending) queues.delete(path); }).catch(() => {});
  return pending;
}

export function maskSecrets(value, config) {
  return typeof value === 'string' ? config.secretPatterns.reduce(
    (text, rule) => text.replace(new RegExp(rule.pattern, rule.flags), rule.replacement), value) : value;
}

// `error` porte le stderr des CLI : il peut contenir des secrets comme les sorties d'outils.
export function maskEvent(event, config) {
  const mask = (value) => maskSecrets(value, config);
  return { ...event,
    ...(event.tool ? { tool: { ...event.tool, target: mask(event.tool.target) } } : {}),
    // `detail` et les verdicts sautés d'une story reprennent le stderr de git ou d'un CLI.
    ...(Array.isArray(event.reviews) ? { reviews: event.reviews.map((review) => ({ ...review, verdict: mask(review.verdict) })) } : {}),
    ...(Array.isArray(event.roles) ? { roles: event.roles.map((role) => ({ ...role, verdict: mask(role.verdict) })) } : {}),
    ...Object.fromEntries(['text', 'output', 'error', 'detail'].filter((key) => key in event).map((key) => [key, mask(event[key])])) };
}

function matchTool(tools, tool) {
  const hasId = tool.id != null && tool.id !== 'undefined';
  return tools.findIndex((open) => hasId ? open.id === tool.id :
    open.kind === tool.kind && open.target === tool.target);
}

export function createEventSink(metadata, directory, config, onEvent) {
  const common = { v: 1, callId: randomUUID(), ...metadata };
  let pending = Promise.resolve();
  const tools = [];
  function emit(raw) {
    if (raw.kind === 'tool_start') tools.push(raw.tool);
    if (raw.kind === 'tool_end') {
      const index = matchTool(tools, raw.tool);
      if (index !== -1) raw = { ...raw, tool: tools.splice(index, 1)[0] };
    }
    const event = truncateEvent(maskEvent({ ...raw, ...common, ts: new Date().toISOString() }, config), config);
    try { Promise.resolve(onEvent?.(event)).catch(() => {}); } catch { /* Un observateur ne doit pas arrêter le travail. */ }
    pending = pending.then(() => appendEvent(event, directory, config)).catch(() => {});
  }
  return { emit, flush: () => pending };
}

// Événements hors appel (story_start / story_end) : mêmes masquage, troncature et fichier du jour.
export function createJournal(directory, config) {
  let pending = Promise.resolve();
  function emit(raw) {
    const event = truncateEvent(maskEvent({ v: 1, ...raw, ts: new Date().toISOString() }, config), config);
    pending = pending.then(() => appendEvent(event, directory, config)).catch(() => {});
  }
  return { emit, flush: () => pending };
}
