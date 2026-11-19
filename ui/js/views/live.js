import {
  ALERT_KIND_LABELS, CALL_STATUS_LABELS, NO_FEATURE_LABEL, OTHER_ROLES_LABEL, ROLE_TREE,
} from '../config.js';
import { badge, el, emptyMessage, replaceContent } from '../dom.js';
import { agentColor, formatDuration, formatInt, normalizeRole, toMs } from '../format.js';
import { openAgentDialog } from './agentDialog.js';

const statusVariant = (status) => ({ running: 'info', ok: 'ok', error: 'bad', timeout: 'bad' })[status] ?? 'neutral';

export function groupByFeature(calls) {
  const groups = new Map();
  for (const call of calls) {
    const key = call.feature ?? NO_FEATURE_LABEL;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(call);
  }
  return groups;
}

export function groupByRole(calls) {
  const known = new Set(ROLE_TREE.map((r) => r.id));
  const groups = ROLE_TREE.map((r) => ({ label: r.label, calls: calls.filter((c) => normalizeRole(c.role) === r.id) }));
  groups.push({ label: OTHER_ROLES_LABEL, calls: calls.filter((c) => !known.has(normalizeRole(c.role))) });
  return groups.filter((g) => g.calls.length);
}

function callDuration(call, nowMs) {
  if (call.status !== 'running' && Number.isFinite(call.durationMs)) return call.durationMs;
  const start = toMs(call.startedAt);
  const end = toMs(call.endedAt) ?? nowMs;
  return start === null ? null : end - start;
}

function currentToolText(call) {
  const tool = call.currentTools?.[0];
  if (!tool) return null;
  const more = call.currentTools.length > 1 ? ` (+${call.currentTools.length - 1})` : '';
  return `${tool.name ?? tool.kind} : ${tool.target ?? ''}${more}`;
}

export function callControl(call, alerts, nowMs) {
  const hasAlert = alerts.some((a) => a.callId === call.callId);
  const tool = currentToolText(call);
  const button = el('button', {
    class: `call${hasAlert ? ' call-alert' : ''}`,
    attrs: { type: 'button', 'aria-haspopup': call.callId ? 'dialog' : null, disabled: !call.callId },
    on: { click: () => openAgentDialog(call.callId) },
  },
  el('span', { class: 'dot', style: { '--dot': agentColor(call.agent) } }),
  el('strong', { text: call.agent }),
  el('span', { class: 'muted', text: call.model ?? '' }),
  badge(CALL_STATUS_LABELS[call.status] ?? call.status ?? '?', statusVariant(call.status)),
  hasAlert ? badge('alerte', 'bad') : null,
  el('span', { text: formatDuration(callDuration(call, nowMs)) }),
  el('span', { class: 'muted', text: `${formatInt(call.toolCount)} outil(s)` }),
  call.failures ? badge(`${call.failures} échec(s)`, 'warn') : null,
  tool ? el('code', { class: 'current-tool', text: tool }) : null);
  return button;
}

function callButton(call, alerts, nowMs) {
  return el('li', {}, callControl(call, alerts, nowMs));
}

function roleBranch(group, alerts, nowMs) {
  return el('li', { class: 'role-branch' },
    el('h4', { text: group.label }),
    el('ul', { class: 'plain' }, group.calls.map((c) => callButton(c, alerts, nowMs))));
}

function featureTree(name, calls, alerts, nowMs) {
  return el('section', { class: 'card' },
    el('h3', { text: name }),
    el('ul', { class: 'tree' }, groupByRole(calls).map((g) => roleBranch(g, alerts, nowMs))));
}

export function alertList(alerts) {
  if (!alerts.length) return null;
  return el('ul', { class: 'alerts', attrs: { role: 'alert' } }, alerts.map((a) =>
    el('li', {}, badge(ALERT_KIND_LABELS[a.kind] ?? a.kind, 'bad'), ` ${a.agent}${a.feature ? ` (${a.feature})` : ''} — ${a.detail ?? ''}`)));
}

export function renderLive(container, status) {
  const calls = status?.calls ?? [];
  const alerts = status?.alerts ?? [];
  if (!status) return replaceContent(container, emptyMessage('État des agents indisponible.'));
  if (!calls.length) return replaceContent(container, alertList(alerts), emptyMessage('Aucun appel d’agent aujourd’hui.'));
  const nowMs = toMs(status.now) ?? Date.now();
  replaceContent(container, alertList(alerts),
    el('div', { class: 'grid' }, [...groupByFeature(calls)].map(([name, group]) => featureTree(name, group, alerts, nowMs))));
}
