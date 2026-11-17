import { sortedOpenTools } from './state.js';
import { formatDuration, shorten } from './format.js';

const NO_VALUE = '-';

function currentToolLabel(call, config) {
  const [oldest] = sortedOpenTools(call.currentTools);
  if (!oldest) return NO_VALUE;
  const target = shorten(oldest.target ?? '', config.targetMaxChars);
  return target ? `${oldest.kind} ${target}` : oldest.kind;
}

export function formatCallLine(call, nowMs, config) {
  const elapsed = (call.endedAt ?? nowMs) - call.startedAt;
  return [call.agent ?? NO_VALUE, call.role ?? NO_VALUE, call.feature ?? NO_VALUE, call.status,
    currentToolLabel(call, config), formatDuration(elapsed),
    `outils ${call.toolCount}`, `échecs ${call.failures}`].join(' · ');
}

export function formatAlertLine(alert) {
  return `⚠ ${alert.agent ?? NO_VALUE} · ${alert.feature ?? NO_VALUE} · ${alert.kind} · ${alert.detail}`;
}

export function formatReport(state, alerts, nowMs, config) {
  const calls = Object.values(state.calls).sort((a, b) => a.startedAt - b.startedAt);
  return [
    ...calls.map((call) => formatCallLine(call, nowMs, config)),
    ...(alerts.length ? alerts.map(formatAlertLine) : ['Aucune alerte']),
  ];
}
