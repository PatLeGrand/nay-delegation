import { NO_FEATURE_LABEL, TIMELINE_MIN_BAR_PCT, TIMELINE_TICKS } from '../config.js';
import { el, emptyMessage, replaceContent } from '../dom.js';
import { agentColor, formatDuration, formatTime, toMs } from '../format.js';
import { openAgentDialog } from './agentDialog.js';

let selectedFeature = null;

const featureKey = (call) => call.feature ?? NO_FEATURE_LABEL;

export function computeBars(calls, nowMs) {
  const spans = calls
    .map((call) => ({ call, start: toMs(call.startedAt), end: toMs(call.endedAt) ?? nowMs }))
    .filter((s) => s.start !== null)
    .sort((a, b) => a.start - b.start);
  if (!spans.length) return { bars: [], min: 0, max: 0 };
  const min = spans[0].start;
  const max = Math.max(...spans.map((s) => s.end), min + 1);
  const range = max - min;
  const bars = spans.map((s) => ({
    ...s,
    left: ((s.start - min) / range) * 100,
    width: Math.max(TIMELINE_MIN_BAR_PCT, ((s.end - s.start) / range) * 100),
  }));
  return { bars, min, max };
}

function axis(min, max) {
  const ticks = Array.from({ length: TIMELINE_TICKS }, (_, i) => {
    const ratio = i / (TIMELINE_TICKS - 1);
    return el('span', { class: 'tick', text: formatTime(new Date(min + (max - min) * ratio).toISOString()), style: { left: `${ratio * 100}%` } });
  });
  return el('div', { class: 'axis', attrs: { 'aria-hidden': 'true' } }, ticks);
}

function barRow({ call, start, end, left, width }) {
  const description = `${call.agent}, ${call.role ?? 'rôle inconnu'}, ${formatDuration(end - start)}${call.endedAt ? '' : ' (en cours)'}`;
  const bar = el('button', {
    class: 'timeline-bar',
    attrs: { type: 'button', title: description, 'aria-label': description },
    style: { left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, background: agentColor(call.agent) },
    on: { click: () => openAgentDialog(call.callId) },
  });
  return el('li', { class: 'timeline-row' },
    el('span', { class: 'timeline-name', text: `${call.agent} · ${call.role ?? '?'}` }),
    el('span', { class: 'timeline-lane' }, bar));
}

function picker(features, onChange) {
  const select = el('select', { attrs: { id: 'timeline-feature' }, on: { change: () => onChange(select.value) } },
    features.map((name) => el('option', { text: name, attrs: { value: name, selected: name === selectedFeature } })));
  return el('p', {}, el('label', { text: 'Fonctionnalité : ', attrs: { for: 'timeline-feature' } }), select);
}

export function renderTimeline(container, status) {
  if (!status) return replaceContent(container, emptyMessage('État des agents indisponible.'));
  const calls = status?.calls ?? [];
  if (!calls.length) return replaceContent(container, emptyMessage('Aucun appel d’agent aujourd’hui.'));
  const features = [...new Set(calls.map(featureKey))];
  if (!features.includes(selectedFeature)) selectedFeature = features[0];
  const nowMs = toMs(status.now) ?? Date.now();
  const { bars, min, max } = computeBars(calls.filter((c) => featureKey(c) === selectedFeature), nowMs);
  const rerender = (name) => { selectedFeature = name; renderTimeline(container, status); container.querySelector('#timeline-feature')?.focus(); };
  replaceContent(container, picker(features, rerender),
    bars.length
      ? el('div', { class: 'timeline' }, axis(min, max), el('ul', { class: 'plain' }, bars.map(barRow)))
      : emptyMessage('Aucune heure de début exploitable.'));
}
