import { CALL_STATUS_LABELS, RECENT_CALLS_LIMIT, USAGE_GROUPS } from '../config.js';
import { badge, el, emptyMessage, replaceContent, table } from '../dom.js';
import { agentColor, formatCompact, formatDateTime, formatDuration, formatInt, orDash } from '../format.js';

function totalsBlock(totals) {
  const items = [
    ['Appels', formatInt(totals.calls)],
    ['Entrée', formatCompact(totals.input)],
    ['dont cache', formatCompact(totals.cachedInput)],
    ['Sortie', formatCompact(totals.output)],
    ['Durée', formatDuration(totals.durationMs)],
  ];
  return el('dl', { class: 'totals' }, items.map(([label, value]) =>
    el('div', { class: 'total' }, el('dt', { text: label }), el('dd', { text: value }))));
}

const legend = () => el('p', { class: 'legend' },
  el('span', { class: 'swatch seg-cache' }), ' Entrée en cache ',
  el('span', { class: 'swatch seg-input' }), ' Entrée non cachée ',
  el('span', { class: 'swatch seg-output' }), ' Sortie');

function barRow(row, max, colorize) {
  const fresh = Math.max(0, (row.input ?? 0) - (row.cachedInput ?? 0));
  const segments = [['seg-cache', row.cachedInput ?? 0], ['seg-input', fresh], ['seg-output', row.output ?? 0]];
  const percent = (n) => (max ? `${(n / max) * 100}%` : '0%');
  const label = el('span', { class: 'bar-label', text: row.key ?? '—' });
  if (colorize) label.style.setProperty('--dot', agentColor(row.key));
  return el('li', { class: 'bar-row' },
    label,
    el('span', { class: 'bar-track', attrs: { role: 'img', 'aria-label': `${formatInt(row.cachedInput)} en cache, ${formatInt(fresh)} non cachés, ${formatInt(row.output)} en sortie` } },
      segments.map(([cls, n]) => el('span', { class: `bar-seg ${cls}`, style: { width: percent(n) } }))),
    el('span', { class: 'bar-value', text: `${formatCompact((row.input ?? 0) + (row.output ?? 0))} · ${formatInt(row.calls)} appel(s)` }));
}

function barGroup(title, rows, colorize) {
  const list = rows ?? [];
  const max = Math.max(0, ...list.map((r) => (r.input ?? 0) + (r.output ?? 0)));
  return el('section', { class: 'card' },
    el('h3', { text: title }),
    list.length ? el('ul', { class: 'bars' }, list.map((r) => barRow(r, max, colorize))) : emptyMessage('Aucune donnée.'));
}

function windowRow(w) {
  const pct = Math.max(0, Math.min(100, w.remainingPct ?? 0));
  return el('li', { class: 'quota-window' },
    el('span', { text: `${orDash(w.label)} : ${w.remainingPct ?? '?'} % restants` }),
    el('span', { class: 'meter', attrs: { role: 'img', 'aria-label': `${pct} % restants` } }, el('span', { class: 'meter-fill', style: { width: `${pct}%` } })),
    el('span', { class: 'muted', text: w.resetsAt ? `renouvellement ${formatDateTime(w.resetsAt)}` : '' }));
}

function providerCard(name, info) {
  const known = info?.status === 'ok' && info.windows?.length;
  return el('section', { class: 'card' },
    el('h3', {}, name, ' ', known ? null : badge('inconnu', 'neutral'), info?.stale ? badge('relevé périmé', 'warn') : null),
    known ? el('ul', { class: 'plain' }, info.windows.map(windowRow)) : el('p', { class: 'muted', text: 'Quota inconnu : l’agent n’est pas bloqué.' }),
    info?.measuredAt ? el('p', { class: 'muted', text: `Relevé : ${formatDateTime(info.measuredAt)}` }) : null);
}

function unavailableAgents(agents) {
  const down = (agents ?? []).filter((a) => a.available === false);
  if (!down.length) return el('p', { class: 'muted', text: 'Tous les agents sont disponibles.' });
  return el('ul', { class: 'plain' }, down.map((a) =>
    el('li', {}, badge(a.name, 'bad'), ` ${a.provider ?? ''} — ${orDash(a.reason)}`)));
}

function quotaSection(quota) {
  if (!quota) return el('section', {}, el('h2', { text: 'Quotas' }), emptyMessage('Quotas indisponibles.'));
  const providers = Object.entries(quota.providers ?? {});
  return el('section', {},
    el('h2', { text: 'Quotas' }),
    providers.length ? el('div', { class: 'grid' }, providers.map(([name, info]) => providerCard(name, info))) : emptyMessage('Aucun fournisseur.'),
    el('h3', { text: 'Agents indisponibles' }),
    unavailableAgents(quota.agents));
}

function recentTable(recent) {
  if (!recent?.length) return emptyMessage('Aucun appel enregistré.');
  const rows = recent.slice(0, RECENT_CALLS_LIMIT).map((c) => [
    formatDateTime(c.timestamp), c.agent, c.model, orDash(c.feature), orDash(c.role),
    CALL_STATUS_LABELS[c.status] ?? orDash(c.status),
    formatInt((c.usage?.input ?? 0) + (c.usage?.output ?? 0)), formatDuration(c.durationMs),
  ]);
  return table(['Heure', 'Agent', 'Modèle', 'Fonctionnalité', 'Rôle', 'Statut', 'Jetons', 'Durée'], rows);
}

export function renderDashboard(container, { usage, quota }) {
  const usageBlocks = usage
    ? [
        el('h2', { text: 'Consommation' }),
        totalsBlock(usage.totals ?? {}),
        legend(),
        el('div', { class: 'grid' }, USAGE_GROUPS.map((g) => barGroup(g.title, usage[g.key], g.key === 'byAgent'))),
      ]
    : [el('h2', { text: 'Consommation' }), emptyMessage('Consommation indisponible.')];
  replaceContent(container,
    ...usageBlocks,
    quotaSection(quota),
    el('h2', { text: `${RECENT_CALLS_LIMIT} derniers appels` }),
    recentTable(usage?.recent));
}
