import { FEATURE_STATE_LABELS, STORY_ROLE_LABELS } from '../config.js';
import { badge, el, emptyMessage, replaceContent, table } from '../dom.js';
import { callControl, groupByFeature } from './live.js';
import { orDash, normalizeRole } from '../format.js';

const stateVariant = (state) => ({ attend_decision: 'warn', fusionnee: 'ok', en_relecture: 'info' })[state] ?? 'neutral';

function stateBadge(feature) {
  const label = FEATURE_STATE_LABELS[feature.state] ?? orDash(feature.state);
  return badge(label, stateVariant(feature.state));
}

export function renderFeatures(container, features, usage, status) {
  const calls = new Map((usage?.recent ?? []).map((c, i) => [c.callId ?? `journal-${i}`, { ...c, startedAt: c.timestamp, endedAt: c.timestamp }]));
  for (const call of status?.calls ?? []) calls.set(call.callId, { ...calls.get(call.callId), ...call });
  const ordered = [...calls.values()].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const stories = el('div', { class: 'grid story-grid' }, [...groupByFeature(ordered)].map(([name, chain]) =>
    el('article', { class: 'card' }, el('h3', { text: name }), el('ol', { class: 'story-chain' }, chain.map((c, index) => {
      const role = normalizeRole(c.role);
      const afterReview = chain.slice(0, index).some((previous) => normalizeRole(previous.role) === 'relecteur');
      const correction = c.resumedFrom || (c.resumedFrom === undefined && afterReview);
      const label = role === 'developpeur' && correction ? 'Correction' : STORY_ROLE_LABELS[role] ?? c.role ?? 'Sans rôle';
      return el('li', {}, el('span', { class: 'chain-role', text: label }), callControl(c, status?.alerts ?? [], Date.now()));
    })))));
  const storyHeading = el('h2', { text: 'Passages de relais' });
  const storyContent = ordered.length ? stories : emptyMessage('Aucun appel sur cette période. Lancez « nay story » pour démarrer une chaîne.');
  if (!features?.length) return replaceContent(container, storyHeading, storyContent, el('h2', { text: 'Fiches de fonctionnalité' }), emptyMessage('Aucune fiche de fonctionnalité.'));
  const rows = features.map((f) => [
    f.title ?? f.name,
    stateBadge(f),
    orDash(f.lastVerdict),
    orDash(f.tests),
    orDash(f.decision),
  ]);
  replaceContent(container, storyHeading, storyContent, el('h2', { text: 'Fiches de fonctionnalité' }), table(['Nom', 'État', 'Dernier verdict', 'Tests', 'Décision'], rows));
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
