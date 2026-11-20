// Logique pure du Hangar (sans DOM, testable sous Node).
import { AGENT_EFFORTS, MODEL_VENDOR_PREFIXES } from './config.js';

// `gpt-6.2-sol` → `sol`, puis `sol-6.2` si `sol` est pris, puis `sol-6.2-2`…
export function suggestAgentName(model, existing, prefixes = MODEL_VENDOR_PREFIXES) {
  const parts = model.replace(/-?\{effort\}$/, '').toLowerCase().split('-').filter(Boolean);
  const versions = parts.filter((part) => /^\d/.test(part));
  const words = parts.filter((part) => !/^\d/.test(part) && !prefixes.includes(part));
  const base = (words.join('-') || parts.join('-') || 'agent').replace(/[^a-z0-9.-]/g, '');
  const taken = new Set(existing);
  const candidates = [base, versions.length ? `${base}-${versions.join('-')}` : null].filter(Boolean);
  const free = candidates.find((name) => !taken.has(name) && /^[a-z]/.test(name));
  if (free) return free;
  const last = candidates.at(-1);
  for (let index = 2; ; index++) if (!taken.has(`${last}-${index}`)) return `${last}-${index}`;
}

export function effortsFor(entry) {
  return entry?.efforts?.length ? entry.efforts : AGENT_EFFORTS;
}

export function defaultEffort(entry) {
  const efforts = effortsFor(entry);
  if (efforts.includes('medium')) return 'medium';
  return entry?.defaultEffort && efforts.includes(entry.defaultEffort) ? entry.defaultEffort : efforts[0];
}

export function modelKey(cli, model) {
  return `${cli}:${model}`;
}

// Modèles d'un fournisseur, les nouveaux d'abord, en gardant l'ordre du CLI dans chaque groupe.
export function sortedModels(provider, { onlyNew = false } = {}) {
  const models = provider?.models ?? [];
  const fresh = models.filter((entry) => !entry.usedBy?.length);
  return onlyNew ? fresh : [...fresh, ...models.filter((entry) => entry.usedBy?.length)];
}

export function countNew(models) {
  return Object.values(models?.providers ?? {})
    .reduce((total, provider) => total + provider.models.filter((entry) => !entry.usedBy?.length).length, 0);
}

export function agentChanged(agent, edit) {
  return Boolean(edit) && ['effort', 'timeoutMin'].some((key) => edit[key] !== undefined && edit[key] !== agent[key]);
}
