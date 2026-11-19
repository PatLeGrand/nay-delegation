// Utilitaires DOM & SVG sûrs : aucun innerHTML avec des données.
import { SVG_NS } from './config.js';

function applyProps(element, props) {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class' || key === 'className') {
      element.setAttribute('class', String(value));
    } else if (key === 'style' && typeof value === 'object') {
      for (const [sk, sv] of Object.entries(value)) {
        if (sv == null) continue;
        if (sk.startsWith('--')) element.style.setProperty(sk, String(sv));
        else element.style[sk] = sv;
      }
    } else if (key === 'dataset' && typeof value === 'object') {
      for (const [dk, dv] of Object.entries(value)) {
        if (dv != null) element.dataset[dk] = String(dv);
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      element.setAttribute(key, '');
    } else if (key in element && key !== 'list' && key !== 'type' && !(element instanceof SVGElement)) {
      element[key] = value;
    } else {
      element.setAttribute(key, String(value));
    }
  }
}

function appendChildren(element, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) {
      appendChildren(element, child);
    } else if (child instanceof Node) {
      element.appendChild(child);
    } else {
      element.appendChild(document.createTextNode(String(child)));
    }
  }
}

export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  applyProps(node, props);
  appendChildren(node, children);
  return node;
}

export function svgEl(tag, props, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  applyProps(node, props);
  appendChildren(node, children);
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(container, ...children) {
  clear(container);
  appendChildren(container, children);
  return container;
}

export function mockBadge(label = 'Maquette') {
  return el('span', { class: 'badge badge-mock', title: 'Données simulées — contrat API dans docs/maquettes.md' }, label);
}
