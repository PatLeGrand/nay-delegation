import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function readConfig(name) {
  const file = new URL(`../config/${name}.json`, import.meta.url);
  const text = readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new SyntaxError(`JSON invalide dans ${file.pathname} : ${cause.message}`, { cause });
  }
}

export function loadEventConfig() {
  const config = readConfig('events');
  const limits = ['maxOutputLines', 'maxOutputChars', 'maxFileBytes', 'maxRotatedFiles'];
  if (!config || typeof config.directory !== 'string' || !config.directory ||
      !limits.every((key) => Number.isSafeInteger(config[key]) && config[key] >= 0) ||
      !config.tools || typeof config.tools !== 'object' || !Array.isArray(config.secretPatterns)) {
    throw new Error('Configuration events invalide');
  }
  for (const rule of config.secretPatterns) {
    if (typeof rule?.pattern !== 'string' || typeof rule.replacement !== 'string' ||
        typeof rule.flags !== 'string') {
      throw new Error('Motif de masquage events invalide');
    }
    new RegExp(rule.pattern, rule.flags);
  }
  return config;
}

export function loadEngineConfig(env = process.env) {
  const config = readConfig('engine');
  for (const cli of ['codex', 'agy', 'claude']) {
    config[`${cli}Bin`] = env[`${cli.toUpperCase()}_BIN`] || config[`${cli}Bin`];
  }
  return config;
}

export function loadQuotaConfig() {
  return readConfig('quotas');
}

export function loadAgents() {
  return readConfig('agents');
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh'];

// `effort` remplace le niveau configuré (ex. benchmark à niveau égal entre agents).
export function getAgent(name, { effort } = {}) {
  const agents = loadAgents();
  if (!Object.hasOwn(agents, name)) throw new Error(`Agent inconnu : ${name}`);
  if (effort !== undefined && !EFFORTS.includes(effort)) throw new Error(`Effort inconnu : ${effort}`);
  const agent = { ...agents[name], ...(effort ? { effort } : {}) };
  return { ...agent, model: agent.model.replaceAll('{effort}', agent.effort) };
}

export function repositoryRoot() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    const marker = readFileSync(resolve(root, '.git'), 'utf8').trim();
    const gitDir = resolve(root, marker.replace(/^gitdir: /, ''));
    const common = readFileSync(resolve(gitDir, 'commondir'), 'utf8').trim();
    return dirname(resolve(gitDir, common));
  } catch {
    return root;
  }
}
