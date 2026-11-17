import { OUTPUT_PREVIEW_CHARS } from '../config.js';
import { fetchCall } from '../api.js';
import { badge, el, emptyMessage, replaceContent } from '../dom.js';
import { formatDateTime, formatDuration, formatInt, formatTime, orDash } from '../format.js';

let dialog = null;
let body = null;

function ensureDialog() {
  if (dialog) return;
  body = el('div', { class: 'dialog-body' });
  const close = el('button', { class: 'btn', text: 'Fermer', attrs: { type: 'button' }, on: { click: () => dialog.close() } });
  dialog = el('dialog', { class: 'agent-dialog', attrs: { 'aria-labelledby': 'agent-dialog-title' } }, body, el('form', { attrs: { method: 'dialog' } }, close));
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  document.body.append(dialog);
}

// Associe tool_start et tool_end par identifiant d'outil, sinon par nom, dans l'ordre.
export function buildTimeline(events) {
  const items = [];
  const open = [];
  for (const event of events) {
    if (event.kind === 'tool_start') {
      const item = { type: 'tool', tool: event.tool ?? {}, ts: event.ts, done: false };
      items.push(item);
      open.push(item);
    } else if (event.kind === 'tool_end') {
      const id = event.tool?.id;
      const index = open.findIndex((i) => (id ? i.tool.id === id : i.tool.name === event.tool?.name));
      const item = index >= 0 ? open.splice(index, 1)[0] : items[items.push({ type: 'tool', tool: event.tool ?? {}, ts: event.ts }) - 1];
      Object.assign(item, { done: true, ok: event.ok, exitCode: event.exitCode, durationMs: event.durationMs, output: event.output });
    } else if (event.kind === 'message') {
      items.push({ type: 'message', text: event.text, ts: event.ts });
    }
  }
  return items;
}

function summarize(events) {
  const first = events[0] ?? {};
  const end = events.findLast((e) => e.kind === 'call_end');
  const lastUsage = events.findLast((e) => e.kind === 'usage');
  return {
    first,
    end,
    usage: end?.usage ?? lastUsage?.usage ?? null,
    durationMs: end?.durationMs ?? null,
  };
}

function header({ first, end, usage, durationMs }) {
  const facts = [
    ['Agent', first.agent], ['Modèle', first.model], ['Rôle', first.role], ['Fonctionnalité', first.feature],
    ['Début', formatDateTime(first.ts)], ['Durée', end ? formatDuration(durationMs) : 'en cours'],
    ['Entrée', usage ? formatInt(usage.input) : null], ['dont cache', usage ? formatInt(usage.cachedInput) : null],
    ['Sortie', usage ? formatInt(usage.output) : null],
  ];
  return el('dl', { class: 'facts' }, facts.flatMap(([label, value]) => [el('dt', { text: label }), el('dd', { text: orDash(value) })]));
}

function outputBlock(output) {
  if (!output) return null;
  const preview = output.length > OUTPUT_PREVIEW_CHARS ? `${output.slice(0, OUTPUT_PREVIEW_CHARS)}…` : output;
  return el('details', {}, el('summary', { text: `Sortie : ${preview.replace(/\s+/g, ' ')}` }), el('pre', { text: output }));
}

function toolItem(item) {
  const state = !item.done ? badge('en cours', 'info') : item.ok ? badge('ok', 'ok') : badge('échec', 'bad');
  return el('li', { class: 'event' },
    el('span', { class: 'muted', text: formatTime(item.ts) }), ' ', state, ' ',
    el('strong', { text: item.tool.kind ?? 'other' }), ' ',
    el('code', { text: item.tool.target ?? item.tool.name ?? '' }),
    item.durationMs !== undefined ? el('span', { class: 'muted', text: ` · ${formatDuration(item.durationMs)}` }) : null,
    item.exitCode !== undefined && item.exitCode !== null ? el('span', { class: 'muted', text: ` · code ${item.exitCode}` }) : null,
    outputBlock(item.output));
}

function messageItem(item) {
  return el('li', { class: 'event message' },
    el('span', { class: 'muted', text: formatTime(item.ts) }), ' ', badge('message', 'neutral'),
    el('p', { class: 'message-text', text: item.text ?? '' }));
}

function errorLine(end) {
  return end?.status && end.status !== 'ok' ? el('p', { class: 'error', text: `Fin : ${end.status}${end.error ? ` — ${end.error}` : ''}` }) : null;
}

function renderCall(events) {
  if (!events.length) return emptyMessage('Aucun événement pour cet appel.');
  const summary = summarize(events);
  const items = buildTimeline(events);
  return el('div', {},
    header(summary), errorLine(summary.end),
    el('h3', { text: 'Outils et messages' }),
    items.length ? el('ol', { class: 'events' }, items.map((i) => (i.type === 'tool' ? toolItem(i) : messageItem(i)))) : emptyMessage('Aucun outil ni message.'));
}

// Une réponse lente d'un appel précédent ne doit pas remplacer la fiche ouverte ensuite.
let openRequest = 0;

export async function openAgentDialog(callId) {
  const request = ++openRequest;
  ensureDialog();
  replaceContent(body, el('h2', { text: 'Fiche de l’agent', attrs: { id: 'agent-dialog-title' } }), el('p', { class: 'muted', text: 'Chargement…' }));
  if (!dialog.open) dialog.showModal();
  try {
    const { events } = await fetchCall(callId);
    if (request !== openRequest) return;
    replaceContent(body, el('h2', { text: 'Fiche de l’agent', attrs: { id: 'agent-dialog-title' } }), renderCall(events ?? []));
  } catch (error) {
    if (request !== openRequest) return;
    replaceContent(body, el('h2', { text: 'Fiche de l’agent', attrs: { id: 'agent-dialog-title' } }), el('p', { class: 'error', text: error.message }));
  }
}
