import { API, DELEGATION_ROLE_LABELS } from '../config.js';
import { ApiError, getJson, putJson } from '../api.js';
import { el, emptyMessage, replaceContent, loadingState, errorState } from '../dom.js';

let draft = null;
let dragged = null;

export function move(list, from, to) {
  if (to < 0 || to >= list.length || from === to) return false;
  list.splice(to, 0, list.splice(from, 1)[0]);
  return true;
}

function moveButton(label, name, disabled, onClick) {
  return el('button', {
    class: 'btn btn-small',
    text: label,
    attrs: { type: 'button', disabled, 'aria-label': `${label} ${name}`, 'data-move': label },
    on: { click: onClick },
  });
}

// Après un déplacement la liste est redessinée : on rend le focus au même agent.
function refocus(listNode, name, label) {
  const row = [...listNode.children].find((li) => li.dataset.agent === name);
  const same = row?.querySelector(`button[data-move="${label}"]:not([disabled])`);
  (same ?? row?.querySelector('button:not([disabled])'))?.focus();
}

function fillList(listNode, list) {
  const redraw = (name, label) => { fillList(listNode, list); if (label) refocus(listNode, name, label); };
  replaceContent(listNode, list.map((name, index) => {
    const item = el('li', { class: 'order-item', attrs: { draggable: 'true', 'data-agent': name } },
      el('span', { class: 'grip', text: '⋮⋮', attrs: { 'aria-hidden': 'true' } }),
      el('span', { class: 'order-name', text: name }),
      moveButton('Monter', name, index === 0, () => { move(list, index, index - 1); redraw(name, 'Monter'); }),
      moveButton('Descendre', name, index === list.length - 1, () => { move(list, index, index + 1); redraw(name, 'Descendre'); }));
    item.addEventListener('dragstart', (e) => { dragged = { list, index }; e.dataTransfer.effectAllowed = 'move'; item.classList.add('dragging'); });
    item.addEventListener('dragend', () => { dragged = null; item.classList.remove('dragging'); });
    item.addEventListener('dragover', (e) => { if (dragged?.list === list) e.preventDefault(); });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      const source = dragged;
      dragged = null;
      if (source?.list === list && move(list, source.index, index)) redraw(name, null);
    });
    return item;
  }));
}

function orderList(title, list) {
  const listNode = el('ul', { class: 'order-list', attrs: { 'aria-label': title } });
  fillList(listNode, list);
  return el('section', { class: 'card' }, el('h3', { text: title }), listNode);
}

function sectionsForRole(role, value) {
  const label = DELEGATION_ROLE_LABELS[role] ?? role;
  if (Array.isArray(value)) return [orderList(label, value)];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, inner]) => {
    if (Array.isArray(inner)) return [orderList(`${label} — ${key === 'parDefaut' ? 'par défaut' : key}`, inner)];
    return Object.entries(inner ?? {}).filter(([, l]) => Array.isArray(l))
      .map(([author, l]) => orderList(`${label} — si l’auteur est ${author}`, l));
  });
}

function showMessage(node, kind, lines) {
  replaceContent(node, ...lines.map((line) => el('p', { text: line })));
  node.className = `notice notice-${kind}`;
  node.hidden = false;
}

async function save(messageNode, button) {
  button.disabled = true;
  try {
    await putJson(API.delegation, draft);
    showMessage(messageNode, 'ok', ['Ordre de délégation enregistré.']);
  } catch (error) {
    const details = error instanceof ApiError ? error.errors : [];
    showMessage(messageNode, 'bad', [error.message, ...details]);
  } finally {
    button.disabled = false;
  }
}

function draw(container) {
  const message = el('div', { class: 'notice', attrs: { role: 'status' } });
  message.hidden = true;
  const saveButton = el('button', { class: 'btn btn-primary', text: 'Enregistrer', attrs: { type: 'button' } });
  saveButton.addEventListener('click', () => save(message, saveButton));
  replaceContent(container,
    el('p', { class: 'muted', text: 'Glisse les agents ou utilise Monter / Descendre. Le premier agent disponible est choisi ; rien n’est appliqué avant l’enregistrement.' }),
    el('div', { class: 'grid' }, Object.entries(draft).flatMap(([role, value]) => sectionsForRole(role, value))),
    el('div', { class: 'actions' }, saveButton),
    message);
}

export async function loadSettings(container) {
  replaceContent(container, loadingState());
  try {
    const data = await getJson(API.delegation);
    draft = structuredClone(data.delegation ?? {});
    if (!Object.keys(draft).length) return replaceContent(container, emptyMessage('Aucune délégation configurée.'));
    draw(container);
  } catch (error) {
    replaceContent(container, errorState(`Paramètres indisponibles : ${error.message}`, () => loadSettings(container)));
  }
}
