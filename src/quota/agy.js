import { spawn } from 'node:child_process';
import { loadQuotaConfig } from '../config.js';
import { remainingPct, unknown } from './common.js';

export function parseAgyUsage(text, now = Date.now(), config = loadQuotaConfig()) {
  const windows = [];
  for (const line of text.split(/\r?\n/)) {
    const [group, description, percent, reset] = line.split('\t').map((value) => value.trim());
    if (!Object.hasOwn(config.agyGroups, group)) continue;
    const label = Object.entries(config.agyWindows).find(([name]) => description?.toLowerCase().includes(name.toLowerCase()))?.[1];
    if (!label) continue;
    const match = /^(\d+(?:\.\d+)?)%$/.exec(percent ?? '');
    const date = Date.parse(reset);
    if (!match || Number(match[1]) > 100 || !Number.isFinite(date)) continue;
    const window = { label, remainingPct: Number(match[1]), resetsAt: new Date(date).toISOString() };
    if (config.agyGroups[group]) window.scope = config.agyGroups[group];
    window.remainingPct = remainingPct(window, now);
    windows.push(window);
  }
  if (!windows.length) return unknown('Aucun quota Gemini reconnu');
  return { status: 'ok', windows, measuredAt: new Date(now).toISOString() };
}

function killProcess(child) {
  if (child.pid === undefined) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') child.kill('SIGKILL');
  }
}

export async function readAgy(config, bin = 'agy') {
  return new Promise((resolve) => {
    const child = spawn(bin, ['-p', '/usage', '--print-timeout', `${config.agyUsageTimeoutSec}s`],
      { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let failure;
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { failure = error.message; });
    const timer = setTimeout(() => { failure = 'délai dépassé'; killProcess(child); }, config.agyUsageTimeoutSec * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failure || code !== 0) resolve(unknown(`Lecture agy impossible : ${failure ?? (stderr.trim() || code)}`));
      else resolve(parseAgyUsage(stdout, Date.now(), config));
    });
  });
}
