// Contrôles (tests, lint…) lancés par Nay lui-même : le résultat ne dépend pas de ce que
// l'agent affirme, et l'exécution ne coûte aucun jeton.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readConfig } from './config.js';

export function loadChecksConfig() {
  const config = readConfig('checks');
  const positive = ['defaultTimeoutSec', 'maxOutputChars'];
  if (typeof config.projectFile !== 'string' || !config.projectFile
    || !positive.every((key) => Number.isFinite(config[key]) && config[key] > 0)
    || (config.env !== undefined && (typeof config.env !== 'object' || config.env === null))) {
    throw new Error('config/checks.json invalide');
  }
  return config;
}

// Lit les contrôles déclarés par le projet ; null si le projet n'en déclare pas.
// Un fichier présent mais invalide est une erreur : l'ignorer ferait croire que tout va bien.
export async function loadChecks(cwd, config = loadChecksConfig()) {
  const file = join(cwd, config.projectFile);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    throw new Error(`${config.projectFile} : JSON invalide (${cause.message})`, { cause });
  }
  const checks = data?.checks;
  if (!Array.isArray(checks) || !checks.length) {
    throw new Error(`${config.projectFile} : « checks » doit être une liste non vide`);
  }
  return checks.map((check, index) => {
    const where = `${config.projectFile} : contrôle n° ${index + 1}`;
    if (typeof check?.command !== 'string' || !check.command.trim()) throw new Error(`${where} sans « command »`);
    if (check.name !== undefined && (typeof check.name !== 'string' || !check.name.trim())) {
      throw new Error(`${where} : « name » invalide`);
    }
    if (check.timeoutSec !== undefined && !(Number.isFinite(check.timeoutSec) && check.timeoutSec > 0)) {
      throw new Error(`${where} : « timeoutSec » doit être un nombre positif`);
    }
    return { name: check.name ?? check.command, command: check.command,
      timeoutSec: check.timeoutSec ?? config.defaultTimeoutSec };
  });
}

function killGroup(child) {
  if (child.pid === undefined) return;
  try {
    // Le groupe inclut les processus lancés par la commande (ex. workers de pytest).
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') child.kill('SIGKILL');
  }
}

// Sortie entremêlée stdout/stderr, dont on ne garde que la fin : c'est là que sont les échecs.
function runOne(check, { cwd, env, maxOutputChars, spawnFn }) {
  return new Promise((resolveRun) => {
    const started = Date.now();
    let output = '';
    let timedOut = false;
    const keep = (chunk) => {
      output += chunk;
      if (output.length > maxOutputChars * 2) output = output.slice(-maxOutputChars);
    };
    let child;
    try {
      child = spawnFn(check.command, { cwd, shell: true, env: { ...process.env, ...env },
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolveRun({ ...check, ok: false, code: null, timedOut, durationMs: 0, output: error.message });
      return;
    }
    child.stdout?.setEncoding('utf8').on('data', keep);
    child.stderr?.setEncoding('utf8').on('data', keep);
    let spawnError;
    child.on('error', (error) => { spawnError = error; });
    const timer = setTimeout(() => { timedOut = true; killGroup(child); }, check.timeoutSec * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = spawnError ? `${output}\n${spawnError.message}` : output;
      resolveRun({ ...check, ok: code === 0 && !timedOut && !spawnError, code, timedOut,
        durationMs: Date.now() - started, output: text.slice(-maxOutputChars) });
    });
  });
}

// Tous les contrôles sont lancés, même après un échec : le dev voit tout ce qui est à corriger.
export async function runChecks(checks, { cwd, config = loadChecksConfig(), spawnFn = spawn } = {}) {
  const results = [];
  for (const check of checks) {
    results.push(await runOne(check, { cwd, env: config.env ?? {}, maxOutputChars: config.maxOutputChars, spawnFn }));
  }
  return results;
}

function seconds(ms) {
  return `${Math.round(ms / 1000)} s`;
}

export function formatChecks(results) {
  return results.map((r) => {
    if (r.ok) return `${r.name} ok (${seconds(r.durationMs)})`;
    if (r.timedOut) return `${r.name} ÉCHEC (délai de ${r.timeoutSec} s dépassé)`;
    return `${r.name} ÉCHEC (code ${r.code ?? 'inconnu'})`;
  }).join(' · ');
}

// Texte envoyé au dev pour corriger : commande et fin de sortie de chaque contrôle en échec.
export function checksFailures(results) {
  return results.filter((r) => !r.ok).map((r) => {
    const why = r.timedOut ? `délai de ${r.timeoutSec} s dépassé` : `code ${r.code ?? 'inconnu'}`;
    return `### ${r.name} — ${why}\nCommande : ${r.command}\n\`\`\`\n${r.output.trim()}\n\`\`\``;
  }).join('\n\n');
}

export function checksNotice(checks) {
  const list = checks.map(({ command }) => `\`${command}\``).join(', ');
  return `\n\nAprès ton travail, Nay lancera lui-même ces contrôles : ${list}. `
    + 'Tu peux les lancer en cours de route si c’est utile ; inutile d’en rapporter le résultat.';
}
