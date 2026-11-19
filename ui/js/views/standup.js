import { LOW_QUOTA_PCT, RECENT_FAILURE_MS, STANDUP_RECENT_LIMIT, SUCCESS_SAMPLE_SIZE, CALL_STATUS_LABELS } from '../config.js';
import { badge, el, emptyMessage, replaceContent } from '../dom.js';
import { agentColor, formatDuration, formatDateTime, formatInt, toMs } from '../format.js';
import { callControl, alertList } from './live.js';
import { recentTable } from './dashboard.js';

function quotaWindows(agent, provider) {
  if (provider?.status !== 'ok') return [];
  return (provider.windows ?? []).filter((w) => !w.scope || w.scope === agent.name);
}

function quotaRow(window) {
  const reset = toMs(window.resetsAt);
  const remaining = reset !== null && reset <= Date.now() ? 100 : window.remainingPct;
  const pct = Number.isFinite(remaining) ? Math.max(0, Math.min(100, remaining)) : null;
  return el('li', { class: 'quota-window' },
    el('div', { class: 'spread muted' }, el('span', { text: window.label ?? 'Fenêtre de quota' }), el('strong', { text: pct === null ? 'Inconnu' : `${pct} %` })),
    pct === null ? null : el('div', { class: 'meter', attrs: { role: 'meter', 'aria-label': `Quota restant : ${window.label}`, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct } },
      el('span', { class: `meter-fill${pct < LOW_QUOTA_PCT ? ' meter-low' : ''}`, style: { width: `${pct}%` } })),
    el('small', { class: 'muted', text: reset === null ? 'Réinitialisation inconnue' : reset <= Date.now() ? 'Fenêtre renouvelée · relevé à actualiser' : `Réinitialisation dans ${formatDuration(reset - Date.now())}` }));
}

function agentCard(agent, { usage, quota, status }) {
  const history = (usage?.recent ?? []).filter((c) => c.agent === agent.name);
  const last = history[0];
  const active = (status?.calls ?? []).filter((c) => c.agent === agent.name && c.status === 'running');
  const provider = quota?.providers?.[agent.provider];
  const windows = quotaWindows(agent, provider);
  const low = agent.available === false || windows.some((w) => w.remainingPct < LOW_QUOTA_PCT && !(toMs(w.resetsAt) !== null && toMs(w.resetsAt) <= Date.now()));
  const failed = last && last.status !== 'ok' && Date.now() - Date.parse(last.timestamp) < RECENT_FAILURE_MS;
  const state = active.length ? ['Au travail', 'info'] : low ? ['Quota bas', 'warn'] : failed ? ['En échec récent', 'bad'] : ['Disponible', 'ok'];
  const sample = history.slice(0, SUCCESS_SAMPLE_SIZE);
  const successes = sample.filter((c) => c.status === 'ok').length;
  const now = toMs(status?.now) ?? Date.now();
  return el('article', { class: 'card agent-card', style: { '--agent-color': agentColor(agent.name) } },
    el('div', { class: 'spread agent-heading' }, el('h3', {}, el('span', { class: 'dot', style: { '--dot': agentColor(agent.name) } }), agent.name), badge(...state)),
    el('p', { class: 'muted agent-model', text: active.find((c) => c.model)?.model ?? history.find((c) => c.model)?.model ?? 'Modèle non observé' }),
    active.length ? el('ul', { class: 'plain agent-work' }, active.map((c) => el('li', {},
      el('p', { class: 'work-label', text: `${c.feature ?? 'Sans fonctionnalité'} · ${c.role ?? 'Sans rôle'}` }),
      callControl(c, status?.alerts ?? [], now))))
      : el('div', { class: 'idle-work' }, el('span', { text: 'Aucun appel en cours' }), el('small', { class: 'muted', text: 'Prêt pour le prochain passage de relais' })),
    el('div', { class: 'last-result' }, el('span', { class: 'eyebrow', text: 'DERNIER RÉSULTAT' }),
      last ? el('p', { text: `${CALL_STATUS_LABELS[last.status] ?? last.status ?? 'Statut inconnu'} · ${last.feature ?? 'Sans fonctionnalité'} · ${formatDuration(last.durationMs)}` }) : emptyMessage('Aucun appel sur cette période.'),
      last ? el('small', { class: 'muted', text: formatDateTime(last.timestamp) }) : null),
    el('div', { class: 'agent-quota' }, el('h4', { text: 'Quota restant' }),
      windows.length ? el('ul', { class: 'plain' }, windows.map(quotaRow)) : el('p', { class: 'muted', text: 'Quota inconnu · agent non bloqué' }),
      provider?.stale ? badge('Relevé périmé', 'warn') : null),
    el('div', { class: 'spread success-line' }, el('span', { class: 'muted', text: `Réussite · ${formatInt(sample.length)} appels récents` }),
      el('strong', { text: sample.length ? `${Math.round(successes / sample.length * 100)} %` : '—' })));
}

export function renderStandup(container, data) {
  const names = new Set([...(data.delegation?.agents ?? []), ...(data.quota?.agents ?? []).map((a) => a.name)]);
  const agents = [...names].map((name) => ({ name, ...data.quota?.agents?.find((a) => a.name === name) }));
  const working = data.status?.calls?.filter((c) => c.status === 'running').length ?? 0;
  replaceContent(container,
    el('div', { class: 'section-heading spread' }, el('h2', { text: 'L’équipe au quotidien' }), el('span', { class: 'muted', text: `${agents.length} agents · ${working} appel(s) en cours` })),
    agents.length ? el('div', { class: 'grid agent-grid' }, agents.map((a) => agentCard(a, data))) : emptyMessage('Aucun agent configuré. Vérifiez la délégation dans les paramètres.'),
    el('h2', { text: 'Alertes actives' }), alertList(data.status?.alerts ?? []) ?? emptyMessage('Aucune alerte active.'),
    el('h2', { text: `${STANDUP_RECENT_LIMIT} derniers appels` }), recentTable(data.usage?.recent, STANDUP_RECENT_LIMIT));
}
