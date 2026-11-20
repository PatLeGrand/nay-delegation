// `nay wait` : bloque jusqu'à ce qu'un appel ou une story atteigne un état utile (docs/cycle-de-vie.md).
import { open, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { StringDecoder } from 'node:string_decoder';
import { repositoryRoot } from './config.js';
import { loadMonitorConfig } from './monitor/config.js';
import { formatDuration } from './monitor/format.js';
import {
  STATES, TERMINAL, applyJobEvent, emptyJobs, featureJobs, jobStatus, loadLifecycleConfig,
} from './lifecycle.js';

export const WAIT_EXIT = { reached: 0, error: 1, timeout: 2 };
const DAY_MS = 86_400_000;
const READ_CHUNK = 1 << 20;
const EVENTS_FILE = /^(\d{4}-\d{2}-\d{2})\..*jsonl$/;
const CURRENT_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

// Fichiers du journal depuis le jour `since` (AAAA-MM-JJ). Archives d'un jour avant son fichier
// courant : l'ordre d'écriture est à peu près respecté.
export function journalFiles(names, since) {
  const order = (name) => [EVENTS_FILE.exec(name)[1], CURRENT_FILE.test(name) ? 1 : 0, name];
  return names.filter((name) => EVENTS_FILE.exec(name)?.[1] >= since)
    .map(order).sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1] || a[2].localeCompare(b[2]))
    .map(([, , name]) => name);
}

// Lecture incrémentale du journal : chaque fichier est suivi par inode, si bien qu'une rotation
// (renommage du fichier du jour en archive) ne fait ni relire ni perdre de lignes.
export function createEventTail(directory, { since }) {
  const files = new Map();
  let jobs = emptyJobs();

  function ingest(file, text) {
    const lines = (file.pending + file.decoder.write(text)).split('\n');
    file.pending = lines.pop();
    for (const line of lines) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event && typeof event === 'object' && !Array.isArray(event)) jobs = applyJobEvent(jobs, event);
    }
  }

  async function readFile(path) {
    let handle;
    try { handle = await open(path, 'r'); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    try {
      const { ino, size } = await handle.stat();
      const file = files.get(ino) ?? { offset: 0, pending: '', decoder: new StringDecoder('utf8') };
      files.set(ino, file);
      while (file.offset < size) {
        const buffer = Buffer.alloc(Math.min(READ_CHUNK, size - file.offset));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, file.offset);
        if (!bytesRead) break;
        file.offset += bytesRead;
        ingest(file, buffer.subarray(0, bytesRead));
      }
    } finally {
      await handle.close();
    }
  }

  return {
    async poll() {
      let names;
      try { names = await readdir(directory); } catch (error) {
        if (error.code === 'ENOENT') return jobs;
        throw error;
      }
      for (const name of journalFiles(names, since)) await readFile(join(directory, name));
      return jobs;
    },
  };
}

const SINCE_UNITS = { s: 1000, m: 60_000, min: 60_000, h: 3_600_000 };

// `--since 10m` (durée avant maintenant) ou une date ISO.
export function parseSince(value, now) {
  const relative = /^(\d+(?:\.\d+)?)(s|min|m|h)$/.exec(value);
  const at = relative ? now - Number(relative[1]) * SINCE_UNITS[relative[2]] : Date.parse(value);
  if (!Number.isFinite(at)) throw new Error('--since : durée (30s, 10m, 2h) ou date ISO');
  return at;
}

function parseWaitArgs(args, config, now) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    until: { type: 'string' }, all: { type: 'boolean', default: false },
    timeout: { type: 'string' }, feature: { type: 'string', multiple: true }, since: { type: 'string' },
  } });
  const features = values.feature ?? [];
  if ((positionals.length > 0) === (features.length > 0)) {
    throw new Error('nay wait : donner des identifiants ou --feature <nom>, pas les deux');
  }
  if (values.since !== undefined && !features.length) throw new Error('--since va avec --feature');
  const sinceMs = values.since === undefined ? null : parseSince(values.since, now);
  const until = values.until === undefined ? config.defaultUntil
    : values.until.split(',').map((state) => state.trim()).filter(Boolean);
  const unknown = until.filter((state) => !STATES.includes(state));
  if (!until.length || unknown.length) throw new Error(`--until : états possibles ${STATES.join(', ')}`);
  const timeoutMin = values.timeout === undefined ? config.defaultTimeoutMin : Number(values.timeout);
  if (!Number.isFinite(timeoutMin) || timeoutMin <= 0) throw new Error('--timeout : minutes > 0');
  return { ids: positionals, features, sinceMs, until, all: values.all, timeoutMin };
}

function describe(status, now) {
  const { kind, id, job, state, cause, via } = status;
  const ended = TERMINAL.includes(state);
  const duration = formatDuration((ended ? job.lastEventAt : now) - job.startedAt);
  const head = `${kind === 'story' ? 'story' : 'appel'} ${id} · ${state}${cause ? ` (${cause})` : ''}`;
  const parts = [head];
  if (kind === 'call') parts.push(job.agent ?? '?');
  if (job.feature) parts.push(`feature ${job.feature}`);
  if (kind === 'story' && job.end?.dev) parts.push(`dev ${job.end.dev}`);
  const review = kind === 'story' ? job.end?.reviews?.at(-1) : null;
  if (review) parts.push(`revue ${review.agent} ${review.verdict}`);
  if (via) parts.push(`reprise ${via}`);
  parts.push(duration);
  return parts.join(' · ');
}

function pendingLine(id) {
  return `${id} · inconnu (absent du journal)`;
}

// Les travaux déjà terminés au lancement sont ignorés (sinon `nay story & nay wait --feature f`
// rendrait la main sur l'ancienne story de f), sauf ceux commencés depuis `--since`.
function featureTargets(jobs, { features, sinceMs }, baseline, now, config) {
  const all = [...new Set(features.flatMap((feature) => featureJobs(jobs, feature)))];
  if (!baseline.ids) {
    baseline.ids = new Set(all);
    baseline.kept = all.filter((id) => {
      const status = jobStatus(jobs, id, now, config);
      return !TERMINAL.includes(status.state) || (sinceMs !== null && status.job.startedAt >= sinceMs);
    });
  }
  return [...baseline.kept, ...all.filter((id) => !baseline.ids.has(id))];
}

export async function waitCommand(args, { output = process.stdout, errorOutput = process.stderr,
  now = Date.now, lifecycleConfig = loadLifecycleConfig(), monitorConfig = loadMonitorConfig(),
  directory = resolve(repositoryRoot(), monitorConfig.eventsDir), pause = sleep } = {}) {
  let options;
  const started = now();
  try { options = parseWaitArgs(args, lifecycleConfig, started); } catch (error) {
    errorOutput.write(`${error.message}\n`);
    return WAIT_EXIT.error;
  }
  const config = { ...lifecycleConfig, silenceSec: monitorConfig.silenceSec };
  // La veille aussi : une story lancée avant minuit se termine dans le fichier du lendemain.
  const firstDay = Math.min(started - DAY_MS, options.sinceMs ?? Infinity);
  const tail = createEventTail(directory, { since: new Date(firstDay).toISOString().slice(0, 10) });
  const baseline = {};
  const deadline = started + options.timeoutMin * 60_000;
  for (;;) {
    const jobs = await tail.poll();
    const current = now();
    const ids = options.features.length ? featureTargets(jobs, options, baseline, current, config) : options.ids;
    const statuses = ids.map((id) => jobStatus(jobs, id, current, config));
    const missing = ids.filter((_, index) => !statuses[index]);
    const known = statuses.filter(Boolean);
    const reached = known.filter((status) => options.until.includes(status.state));
    const lines = () => [...known.map((status) => describe(status, current)), ...missing.map(pendingLine)];
    const graceOver = current - started > config.appearGraceSec * 1000;
    if (graceOver && (missing.length || !ids.length)) {
      errorOutput.write(ids.length ? `Inconnu dans le journal : ${missing.join(', ')}\n`
        : `Aucun travail en cours ou nouveau pour : ${options.features.join(', ')}\n`);
      return WAIT_EXIT.error;
    }
    const done = ids.length > 0 && (options.all ? reached.length === ids.length : reached.length > 0);
    if (done) {
      output.write(`${lines().join('\n')}\n`);
      return WAIT_EXIT.reached;
    }
    if (current >= deadline) {
      if (ids.length) output.write(`${lines().join('\n')}\n`);
      errorOutput.write(`Délai dépassé (${options.timeoutMin} min) sans état ${options.until.join(', ')}\n`);
      return WAIT_EXIT.timeout;
    }
    await pause(Math.min(config.pollMs, Math.max(0, deadline - current)));
  }
}
