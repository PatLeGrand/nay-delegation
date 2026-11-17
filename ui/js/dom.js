// Construction du DOM sans innerHTML : tout texte passe par textContent.

export function el(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  const { class: className, text, attrs, style, on } = options;
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value !== null && value !== undefined && value !== false) node.setAttribute(name, value === true ? '' : value);
  }
  for (const [name, value] of Object.entries(style ?? {})) node.style.setProperty(name, value);
  for (const [name, handler] of Object.entries(on ?? {})) node.addEventListener(name, handler);
  appendAll(node, children);
  return node;
}

export function appendAll(node, children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
}

export function replaceContent(node, ...children) {
  node.replaceChildren();
  appendAll(node, children);
}

export function emptyMessage(text) {
  return el('p', { class: 'empty', text });
}

export function badge(text, variant = 'neutral') {
  return el('span', { class: `badge badge-${variant}`, text });
}

export function table(headers, rows) {
  const head = el('tr', {}, headers.map((h) => el('th', { text: h, attrs: { scope: 'col' } })));
  const body = rows.map((cells) => el('tr', {}, cells.map((c) => el('td', {}, c instanceof Node ? c : document.createTextNode(c ?? '—')))));
  return el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, head), el('tbody', {}, body)));
}
