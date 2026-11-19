import { el, emptyMessage, replaceContent, table } from '../dom.js';
import { agentColor, formatDuration, formatInt, formatPercent } from '../format.js';

export function renderReliability(container, usage) {
  const rows = usage?.reliability ?? [];
  replaceContent(container,
    el('p', { class: 'muted section-note', text: 'Un appel dont le statut diffère de « ok » est compté comme un échec. Les durées médianes incluent tous les appels avec une durée connue.' }),
    rows.length ? table(['Agent', 'Appels', 'Taux d’échec', 'Durée médiane', 'Causes fréquentes'], rows.map((row) => [
      el('strong', {}, el('span', { class: 'dot', style: { '--dot': agentColor(row.key) } }), ` ${row.key ?? 'Inconnu'}`),
      formatInt(row.calls),
      el('span', { class: row.failures ? 'error' : '', text: `${formatPercent(row.failureRate)} · ${row.failures} échec(s)` }),
      formatDuration(row.medianDurationMs),
      row.topErrors.length ? el('ul', { class: 'plain error-causes' }, row.topErrors.map(({ error, count }) => el('li', {}, el('span', { text: error }), el('strong', { text: ` × ${count}` })))) : 'Aucun échec',
    ])) : emptyMessage('Aucun appel à analyser. Élargissez la période ou lancez une story.'));
}
