import { formatDuration, shorten } from './format.js';

const SECOND_MS = 1000;
const FAILING_STATUSES = ['error', 'timeout'];
const MESSAGES = {
  commande: 'Commande relancée à l\'identique après un échec',
  lecture: 'Fichier relu sans modification entre-temps',
  recherche: 'Même recherche faite plusieurs fois',
};

function makeAlert(call, kind, since, detail) {
  return { callId: call.callId, agent: call.agent, feature: call.feature, kind, since, detail };
}

function longCommandAlerts(call, nowMs, config) {
  return Object.values(call.currentTools)
    .filter((tool) => tool.kind === 'command' && nowMs - tool.startedAt > config.longCommandSec * SECOND_MS)
    .map((tool) => {
      const name = shorten(tool.target ?? '', config.targetMaxChars) || 'Une commande';
      return makeAlert(call, 'commande_longue', tool.startedAt,
        `${name} tourne depuis ${formatDuration(nowMs - tool.startedAt)}`);
    });
}

function silenceAlerts(call, nowMs, config) {
  if (nowMs - call.lastEventAt <= config.silenceSec * SECOND_MS) return [];
  return [makeAlert(call, 'silence', call.lastEventAt,
    `Aucun événement depuis ${formatDuration(nowMs - call.lastEventAt)}`)];
}

function failureAlerts(call, config) {
  if (call.consecutiveFailures === 0 || call.consecutiveFailures < config.failuresAlertAt) return [];
  return [makeAlert(call, 'echecs', call.lastFailureAt,
    `${call.consecutiveFailures} outils en échec de suite`)];
}

function describe(rule, target, config) {
  const shown = shorten(target, config.targetMaxChars);
  return shown ? `${MESSAGES[rule]} : ${shown}` : MESSAGES[rule];
}

function newRules() {
  return { commands: new Map(), reads: new Set(), searches: new Set() };
}

// Une modification change le résultat probable d'une commande ou d'une recherche : le cycle
// test → correction → re-test n'est pas du travail répété.
function clearOnEdit(rules, entry) {
  rules.commands.clear();
  rules.searches.clear();
  rules.reads.delete(entry.target);
}

function seenBefore(seen, entry, rule) {
  const repeated = seen.has(entry.target);
  seen.add(entry.target);
  return repeated ? rule : null;
}

function repeatedRule(rules, entry) {
  if (entry.kind === 'edit') {
    clearOnEdit(rules, entry);
    return null;
  }
  if (!entry.target) return null;
  if (entry.kind === 'command') {
    const failedBefore = rules.commands.get(entry.target)?.ok === false;
    rules.commands.set(entry.target, entry);
    return failedBefore ? 'commande' : null;
  }
  if (entry.kind === 'read') return seenBefore(rules.reads, entry, 'lecture');
  if (entry.kind === 'search') return seenBefore(rules.searches, entry, 'recherche');
  return null;
}

// Une seule passe sur l'historique : chaque règle garde ce qu'elle a vu pour repérer la répétition.
function repeatedWorkFindings(history, config) {
  const findings = new Map();
  const rules = newRules();
  for (const entry of history) {
    const rule = repeatedRule(rules, entry);
    const key = `${rule}:${entry.target}`;
    if (rule && !findings.has(key)) {
      findings.set(key, { ts: entry.ts, text: describe(rule, entry.target, config) });
    }
  }
  return [...findings.values()];
}

function repeatedWorkAlerts(call, config) {
  return repeatedWorkFindings(call.history, config)
    .map((finding) => makeAlert(call, 'travail_repete', finding.ts, finding.text));
}

// Un appel terminé n'a plus de silence ni de commande en cours ; le reste du bilan garde sa valeur.
function callAlerts(call, nowMs, config) {
  const lasting = repeatedWorkAlerts(call, config);
  if (call.status === 'running') {
    return [...longCommandAlerts(call, nowMs, config), ...silenceAlerts(call, nowMs, config),
      ...failureAlerts(call, config), ...lasting];
  }
  return FAILING_STATUSES.includes(call.status) ? [...failureAlerts(call, config), ...lasting] : lasting;
}

// `since` est un instant en millisecondes (epoch).
export function computeAlerts(state, nowMs, config) {
  return Object.values(state.calls).flatMap((call) => callAlerts(call, nowMs, config));
}
