import { OUTPUT_PREVIEW_CHARS, CALL_LOAD_ATTEMPTS, CALL_LOAD_RETRY_MS, CALL_LIVE_REFRESH_MS } from '../config.js';
import { fetchCall, resumeCall } from '../api.js';
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

function renderCall(events, callId) {
  if (!events.length) return emptyMessage('Aucun événement pour cet appel.');
  const summary = summarize(events);
  const items = buildTimeline(events);
  return el('div', {},
    header(summary), errorLine(summary.end),
    summary.first.resumedFrom ? el('p', { class: 'muted', text: `Reprise de ${summary.first.resumedFrom.slice(0, 8)}` }) : null,
    summary.end?.sessionId ? replyForm(callId) : null,
    el('h3', { text: 'Outils et messages' }),
    items.length ? el('ol', { class: 'events' }, items.map((i) => (i.type === 'tool' ? toolItem(i) : messageItem(i)))) : emptyMessage('Aucun outil ni message.'));
}

// Une réponse lente d'un appel précédent ne doit pas remplacer la fiche ouverte ensuite.
let openRequest = 0;

export async function openAgentDialog(callId, { pending = false } = {}) {
  const request = ++openRequest;
  ensureDialog();
  replaceContent(body, el('h2', { text: 'Fiche de l’agent', attrs: { id: 'agent-dialog-title' } }), el('p', { class: 'muted', text: 'Chargement…' }));
  if (!dialog.open) dialog.showModal();
  try {
    const { events } = await loadCall(callId, pending);
    if (request !== openRequest) return;
    replaceContent(body, el('h2', { text: 'Fiche de l’agent', attrs: { id: 'agent-dialog-title' } }), renderCall(events ?? [], callId));
    // Un appel en cours n'a pas encore de fin : relire la fiche jusqu'à son call_end.
    if (!events?.some((event) => event.kind === 'call_end')) refreshWhileRunning(callId, request);
  } catch (error) {
    if (request !== openRequest) return;
    replaceContent(body, el('h2', { text: 'Fiche de l’agent', attrs: { id: 'agent-dialog-title' } }), el('p', { class: 'error', text: error.message }), el('button', { class: 'btn', text: 'Réessayer', on: { click: () => openAgentDialog(callId) } }));
  }
}

function refreshWhileRunning(callId, request) {
  setTimeout(async () => {
    if (request !== openRequest || !dialog.open) return;
    try {
      const { events } = await fetchCall(callId);
      if (request !== openRequest || !dialog.open) return;
      replaceContent(body, el('h2', { text: 'Fiche de l’agent', attrs: { id: 'agent-dialog-title' } }), renderCall(events ?? [], callId));
      if (!events?.some((event) => event.kind === 'call_end')) refreshWhileRunning(callId, request);
    } catch { refreshWhileRunning(callId, request); }
  }, CALL_LIVE_REFRESH_MS);
}

function replyForm(callId) {
  const message = el('textarea', { attrs: { id: 'agent-reply', rows: 4, required: true } });
  const errorLine = el('p', { class: 'error', attrs: { role: 'alert' } });
  const send = el('button', { class: 'btn', text: 'Envoyer', attrs: { type: 'submit' } });
  const form = el('form', { class: 'agent-reply' }, el('label', { text: 'Répondre à l’agent', attrs: { for: 'agent-reply' } }), message, send, errorLine);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!message.value.trim()) { errorLine.textContent = 'Message vide'; return; }
    send.disabled = true;
    errorLine.textContent = '';
    const request = openRequest;
    try {
      const next = await resumeCall(callId, message.value);
      if (request === openRequest && dialog.open) await openAgentDialog(next.callId, { pending: true });
    } catch (error) {
      errorLine.textContent = error.message;
    } finally { send.disabled = false; }
  });
  return form;
}

async function loadCall(callId, pending) {
  for (let attempt = 1; ; attempt++) {
    try { return await fetchCall(callId); } catch (error) {
      if (!pending || error.status !== 404 || attempt >= CALL_LOAD_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, CALL_LOAD_RETRY_MS));
    }
  }
}
