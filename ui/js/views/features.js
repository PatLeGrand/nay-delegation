import { FEATURE_STATE_LABELS } from '../config.js';
import { badge, el, emptyMessage, replaceContent, table } from '../dom.js';
import { orDash } from '../format.js';

const stateVariant = (state) => ({ attend_decision: 'warn', fusionnee: 'ok', en_relecture: 'info' })[state] ?? 'neutral';

function stateBadge(feature) {
  const label = FEATURE_STATE_LABELS[feature.state] ?? orDash(feature.state);
  return badge(label, stateVariant(feature.state));
}

export function renderFeatures(container, features) {
  if (!features?.length) return replaceContent(container, emptyMessage('Aucune fiche de fonctionnalité.'));
  const rows = features.map((f) => [
    f.title ?? f.name,
    stateBadge(f),
    orDash(f.lastVerdict),
    orDash(f.tests),
    orDash(f.decision),
  ]);
  replaceContent(container, table(['Nom', 'État', 'Dernier verdict', 'Tests', 'Décision'], rows));
}

function decisionCard(feature) {
  return el(
    'li',
    { class: 'card decide-card' },
    el('h3', { text: feature.title ?? feature.name }),
    feature.branch ? el('p', { class: 'muted', text: feature.branch }) : null,
    el('dl', { class: 'facts' },
      ...[['Dernier verdict', feature.lastVerdict], ['Tests', feature.tests]]
        .flatMap(([label, value]) => [el('dt', { text: label }), el('dd', { text: orDash(value) })])),
  );
}

export function renderDecide(section, features) {
  const waiting = (features ?? []).filter((f) => f.waitingForUser);
  section.hidden = waiting.length === 0;
  if (!waiting.length) return;
  replaceContent(
    section,
    el('h2', { text: `À décider (${waiting.length})` }),
    el('ul', { class: 'cards' }, waiting.map(decisionCard)),
  );
}
