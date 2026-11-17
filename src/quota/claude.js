import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadQuotaConfig, repositoryRoot } from '../config.js';
import { unknown } from './common.js';

export async function writeClaudeQuota(event, config = loadQuotaConfig(), root = repositoryRoot()) {
  const windows = event?.rate_limit_info?.unifiedWindows;
  if (event?.type !== 'rate_limit_event' || !validWindows(windows, config)) return;
  const path = resolve(root, config.claudeQuotaPath);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, JSON.stringify({ measuredAt: new Date().toISOString(), windows }), 'utf8');
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

function validWindows(windows, config) {
  return Object.keys(config.claudeWindows).every((key) => {
    const window = windows?.[key];
    return window && Number.isFinite(window.utilization) && window.utilization >= 0 && window.utilization <= 1 &&
      Number.isFinite(window.resetsAt) && Number.isFinite(new Date(window.resetsAt * 1000).getTime());
  });
}

export async function readClaude(config = loadQuotaConfig(), now = Date.now(), root = repositoryRoot()) {
  try {
    const data = JSON.parse(await readFile(resolve(root, config.claudeQuotaPath), 'utf8'));
    if (!validWindows(data.windows, config) || !Number.isFinite(Date.parse(data.measuredAt))) return unknown('Relevé Claude invalide');
    const windows = Object.entries(config.claudeWindows).map(([key, label]) => ({ label,
      remainingPct: Math.round((1 - data.windows[key].utilization) * 1000) / 10,
      resetsAt: new Date(data.windows[key].resetsAt * 1000).toISOString() }));
    return { status: 'ok', windows, measuredAt: data.measuredAt,
      stale: now - Date.parse(data.measuredAt) > config.claudeStaleAfterMin * 60000 };
  } catch (error) { return unknown(`Aucun relevé Claude lisible : ${error.message}`); }
}
