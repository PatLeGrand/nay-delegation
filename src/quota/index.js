import { loadEngineConfig, loadQuotaConfig, loadAgents } from '../config.js';
import { readCodex } from './codex.js';
import { readAgy } from './agy.js';
import { readClaude } from './claude.js';
import { remainingPct, unknown } from './common.js';

let cache;
let pending;

function refreshStale(value, config, now) {
  const result = { ...value };
  for (const provider of ['codex', 'claude']) {
    if (value[provider].status === 'ok') result[provider] = { ...value[provider],
      stale: now - Date.parse(value[provider].measuredAt) > config[`${provider}StaleAfterMin`] * 60000 };
  }
  return result;
}

export async function readQuotas({ loadConfig = loadQuotaConfig, clock = Date.now,
  codexReader = readCodex, agyReader = readAgy, claudeReader = readClaude, engineLoader = loadEngineConfig } = {}) {
  let config;
  try { config = loadConfig(); } catch (error) {
    const reason = `Configuration quotas illisible : ${error.message}`;
    return Object.fromEntries(['codex', 'agy', 'claude'].map((name) => [name, unknown(reason)]));
  }
  if (cache && clock() - cache.at < config.cacheTtlSec * 1000) return refreshStale(cache.value, config, clock());
  if (pending) return pending;
  pending = Promise.all([codexReader(config, clock()), agyReader(config, engineLoader().agyBin), claudeReader(config, clock())])
    .then(([codex, agy, claude]) => {
      const value = { codex, agy, claude };
      cache = { at: clock(), value };
      return value;
    }).finally(() => { pending = undefined; });
  return pending;
}

export function isAgentAvailable(agentName, quotas, config) {
  const agent = config.agents[agentName];
  if (!agent) return { available: true, reason: `Agent inconnu : ${agentName}` };
  const quota = quotas[agent.cli];
  if (!quota || quota.status !== 'ok') return { available: true, reason: quota?.reason ?? 'Quota inconnu' };
  const specific = config.thresholds[agentName];
  for (const window of quota.windows) {
    if (window.scope && window.scope !== agentName) continue;
    const threshold = specific && (!specific.window || specific.window === window.label) ? specific : config.thresholds.default;
    if (remainingPct(window) < threshold.minRemainingPct) {
      return { available: false, reason: `${window.label}${window.scope ? ` ${window.scope}` : ''} : ${remainingPct(window)} % restants` };
    }
  }
  return { available: true, reason: quota.stale ? 'Relevé périmé' : 'Quota suffisant' };
}

export function quotaAgentConfig() {
  let thresholds;
  try { thresholds = loadQuotaConfig().thresholds; } catch { thresholds = {}; }
  return { agents: loadAgents(), thresholds };
}
