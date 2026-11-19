// Vue « Chronographe » : frise des appels du jour, spectre 14 jours UTC, répartitions et fiabilité.
import { NO_FEATURE_LABEL } from '../config.js';
import { el, svgEl } from '../dom.js';
import {
  agentColor, agentGlyph, agentLabel, cacheRatio, formatDuration,
  formatInt, formatPct, formatShortDate, formatTimeUtc, formatTokens, roleLabel,
} from '../format.js';
import { buildDailySpectrum } from '../model.js';

function renderDayChronogram(state, actions) {
  const calls = (state.status?.calls ?? []).filter((c) => c.startedAt);
  const nowMs = Date.parse(state.status?.now ?? '') || state.nowMs;

  if (!calls.length) {
    return el('section', { class: 'panel', 'aria-label': 'Frise des appels du jour' },
      el('header', { class: 'panel__head' },
        el('h2', { class: 'panel__title' }, 'Frise du jour (UTC)'),
        el('span', { class: 'mono muted' }, '0 appel'),
      ),
      el('div', { class: 'empty-state' }, 'Aucun appel journalisé aujourd’hui sur ce filtre.'),
    );
  }

  const minMs = Math.min(...calls.map((c) => Date.parse(c.startedAt)));
  const maxMs = Math.max(
    nowMs,
    ...calls.map((c) => (c.endedAt ? Date.parse(c.endedAt) : nowMs)),
  );
  const spanMs = Math.max(60_000, maxMs - minMs);

  // Regroupement par fonctionnalité
  const groups = new Map();
  for (const call of calls) {
    const key = call.feature ?? NO_FEATURE_LABEL;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(call);
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => ({
    pct: p * 100,
    label: formatTimeUtc(new Date(minMs + spanMs * p).toISOString()).slice(0, 5),
  }));

  return el('section', { class: 'panel', 'aria-label': 'Frise des appels du jour' },
    el('header', { class: 'panel__head' },
      el('div', { class: 'panel__title-group' },
        el('h2', { class: 'panel__title' }, 'Frise du jour (UTC)'),
        el('span', { class: 'mono muted' }, `${calls.length} appels · cliquer une barre pour inspecter`),
      ),
      el('span', { class: 'mono muted' }, `${ticks[0].label} → ${ticks.at(-1).label}`),
    ),
    el('div', { class: 'chrono-axis' },
      ...ticks.map((t) => el('span', { class: 'chrono-tick mono muted', style: { left: `${t.pct}%` } }, t.label)),
    ),
    el('div', { class: 'chrono-rows' },
      ...[...groups.entries()].map(([feat, featCalls]) => {
        const sorted = [...featCalls].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
        return el('div', { class: 'chrono-group' },
          el('div', { class: 'chrono-group__label mono' }, feat),
          el('div', { class: 'chrono-lanes' },
            ...sorted.map((call) => {
              const s = Date.parse(call.startedAt);
              const e = call.endedAt ? Date.parse(call.endedAt) : nowMs;
              const leftPct = Math.max(0, Math.min(99, ((s - minMs) / spanMs) * 100));
              const widthPct = Math.max(1.2, Math.min(100 - leftPct, ((Math.max(e, s + 1000) - s) / spanMs) * 100));
              const dur = Math.max(0, e - s);
              return el('div', { class: 'chrono-lane' },
                el('button', {
                  type: 'button',
                  class: `chrono-bar chrono-bar--${call.status ?? 'ok'}`,
                  style: {
                    left: `${leftPct.toFixed(2)}%`,
                    width: `${widthPct.toFixed(2)}%`,
                    '--agent-color': agentColor(call.agent),
                  },
                  title: `${agentLabel(call.agent)} · ${roleLabel(call.role)} · ${formatDuration(dur)}`,
                  'aria-label': `${agentLabel(call.agent)} sur ${feat}, ${formatDuration(dur)}, statut ${call.status}`,
                  onClick: () => actions.openCall(call.callId),
                },
                  el('span', { class: 'chrono-bar__text' }, `${agentLabel(call.agent)} · ${formatDuration(dur)}`),
                ),
              );
            }),
          ),
        );
      }),
    ),
  );
}

function renderSpectrumChart(state) {
  const series = buildDailySpectrum(state.usage?.byDay ?? [], state.nowMs);
  const maxVal = Math.max(1, ...series.map((d) => d.freshInput + d.cachedInput + d.output));
  const width = 700;
  const height = 190;
  const padBottom = 26;
  const chartH = height - padBottom - 10;
  const colW = width / series.length;

  const readout = el('span', { class: 'mono muted small' }, 'Survolez un jour pour le détail exact');

  const svg = svgEl('svg', {
    class: 'spectrum-svg',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': 'Spectre de consommation des jetons sur les 14 derniers jours UTC',
  });

  // Lignes de grille horizontales
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    const y = 10 + chartH * (1 - frac);
    svg.appendChild(svgEl('line', { x1: 0, y1: y.toFixed(1), x2: width, y2: y.toFixed(1), class: 'spectrum-grid' }));
  }

  series.forEach((d, idx) => {
    const x = idx * colW + 6;
    const bw = Math.max(10, colW - 12);
    const total = d.freshInput + d.cachedInput + d.output;
    const hCached = (d.cachedInput / maxVal) * chartH;
    const hFresh = (d.freshInput / maxVal) * chartH;
    const hOutput = (d.output / maxVal) * chartH;

    const baseY = 10 + chartH;
    const showDetail = () => {
      readout.textContent = `${d.day} · ${formatInt(d.calls)} appels · Entrée neuve ${formatTokens(d.freshInput)} · Cache ${formatTokens(d.cachedInput)} · Sortie ${formatTokens(d.output)}`;
    };

    const g = svgEl('g', {
      class: 'spectrum-col',
      tabindex: '0',
      role: 'group',
      'aria-label': `${d.day} : ${d.calls} appels, ${formatTokens(total)} jetons`,
      onMouseenter: showDetail,
      onFocus: showDetail,
    });

    // Zone cliquable / survolable complète
    g.appendChild(svgEl('rect', { x: x - 3, y: 8, width: bw + 6, height: chartH + 2, class: 'spectrum-hit' }));

    if (total > 0) {
      let curY = baseY;
      if (hCached > 0) {
        const h = Math.max(2, hCached);
        curY -= h;
        g.appendChild(svgEl('rect', { x, y: curY.toFixed(1), width: bw, height: h.toFixed(1), rx: 2, class: 'bar-cached' }));
      }
      if (hFresh > 0) {
        const h = Math.max(2, hFresh);
        curY -= h;
        g.appendChild(svgEl('rect', { x, y: curY.toFixed(1), width: bw, height: h.toFixed(1), rx: 2, class: 'bar-fresh' }));
      }
      if (hOutput > 0) {
        const h = Math.max(2, hOutput);
        curY -= h;
        g.appendChild(svgEl('rect', { x, y: curY.toFixed(1), width: bw, height: h.toFixed(1), rx: 2, class: 'bar-output' }));
      }
    } else {
      g.appendChild(svgEl('rect', { x, y: baseY - 2, width: bw, height: 2, class: 'bar-empty' }));
    }

    g.appendChild(svgEl('text', {
      x: (x + bw / 2).toFixed(1),
      y: height - 7,
      'text-anchor': 'middle',
      class: 'spectrum-label',
    }, formatShortDate(`${d.day}T00:00:00Z`)));

    svg.appendChild(g);
  });

  return el('section', { class: 'panel', 'aria-label': 'Spectre 14 jours UTC' },
    el('header', { class: 'panel__head' },
      el('div', { class: 'panel__title-group' },
        el('h2', { class: 'panel__title' }, 'Spectre 14 jours (UTC)'),
        readout,
      ),
      el('div', { class: 'spectrum-legend mono' },
        el('span', { class: 'legend-item' }, el('span', { class: 'legend-swatch legend-swatch--fresh' }), 'Entrée neuve'),
        el('span', { class: 'legend-item' }, el('span', { class: 'legend-swatch legend-swatch--cached' }), 'Cache relu'),
        el('span', { class: 'legend-item' }, el('span', { class: 'legend-swatch legend-swatch--output' }), 'Sortie'),
      ),
    ),
    svg,
  );
}

function renderBreakdowns(state, actions) {
  const dims = [
    { key: 'byAgent', label: 'Par agent' },
    { key: 'byModel', label: 'Par modèle' },
    { key: 'byFeature', label: 'Par fonctionnalité' },
    { key: 'byRole', label: 'Par rôle' },
  ];
  const activeDim = state.usageDim || 'byAgent';
  const rows = state.usage?.[activeDim] ?? [];
  const maxTokens = Math.max(1, ...rows.map((r) => (r.input ?? 0) + (r.output ?? 0)));

  return el('section', { class: 'panel', 'aria-label': 'Répartition de la consommation' },
    el('header', { class: 'panel__head' },
      el('h2', { class: 'panel__title' }, 'Répartition des jetons'),
      el('div', { class: 'seg-control', role: 'tablist', 'aria-label': 'Dimension de répartition' },
        ...dims.map((d) =>
          el('button', {
            type: 'button',
            role: 'tab',
            'aria-selected': activeDim === d.key ? 'true' : 'false',
            class: `seg-btn${activeDim === d.key ? ' seg-btn--active' : ''}`,
            onClick: () => actions.setUsageDim(d.key),
          }, d.label),
        ),
      ),
    ),
    rows.length === 0
      ? el('div', { class: 'empty-state' }, 'Aucune consommation enregistrée sur cette période.')
      : el('div', { class: 'breakdown-list' },
        ...rows.map((row) => {
          const total = (row.input ?? 0) + (row.output ?? 0);
          const pct = Math.max(2, (total / maxTokens) * 100);
          const label = activeDim === 'byAgent' ? agentLabel(row.key)
            : activeDim === 'byRole' ? roleLabel(row.key)
              : (row.key ?? NO_FEATURE_LABEL);
          const color = activeDim === 'byAgent' ? agentColor(row.key) : null;
          return el('div', { class: 'breakdown-row' },
            el('div', { class: 'breakdown-row__head' },
              el('span', { class: 'breakdown-row__name' },
                color ? el('span', { class: 'dot-inline', style: { background: color } }) : null,
                el('strong', null, label),
                el('span', { class: 'mono muted' }, ` · ${formatInt(row.calls)} appels · ${formatDuration(row.durationMs)}`),
              ),
              el('span', { class: 'mono' },
                `${formatTokens(total)} `,
                el('span', { class: 'muted' }, `(cache ${formatTokens(row.cachedInput)} · ${formatPct(cacheRatio(row.input, row.cachedInput))})`),
              ),
            ),
            el('div', { class: 'meter meter--thin' },
              el('div', {
                class: 'meter__fill meter__fill--accent',
                style: { width: `${pct.toFixed(1)}%`, ...(color ? { background: color } : {}) },
              }),
            ),
          );
        }),
      ),
  );
}

function renderReliability(state) {
  const rows = state.usage?.reliability ?? [];
  return el('section', { class: 'panel', 'aria-label': 'Fiabilité et causes d’échec' },
    el('header', { class: 'panel__head' },
      el('h2', { class: 'panel__title' }, 'Fiabilité & autopsie des échecs'),
      el('span', { class: 'mono muted' }, `${rows.length} agents observés`),
    ),
    rows.length === 0
      ? el('div', { class: 'empty-state' }, 'Aucune donnée de fiabilité sur la période.')
      : el('div', { class: 'reliability-grid' },
        ...rows.map((row) => {
          const successRate = 1 - (row.failureRate ?? 0);
          const tone = successRate >= 0.85 ? 'ok' : successRate >= 0.6 ? 'warn' : 'danger';
          return el('article', { class: 'rel-card' },
            el('div', { class: 'rel-card__head' },
              el('span', { class: 'agent-tag', style: { '--agent-color': agentColor(row.key) } },
                el('span', { class: 'agent-tag__glyph', 'aria-hidden': 'true' }, agentGlyph(row.key)),
                agentLabel(row.key),
              ),
              el('span', { class: `status-pill status-pill--${tone === 'ok' ? 'ok' : tone === 'warn' ? 'running' : 'error'}` },
                `${formatPct(successRate)} réussite`),
            ),
            el('div', { class: 'rel-card__stats mono muted' },
              el('span', null, `${formatInt(row.calls)} appels`),
              el('span', null, `${formatInt(row.failures)} échecs`),
              el('span', null, `médiane ${formatDuration(row.medianDurationMs)}`),
            ),
            row.topErrors?.length
              ? el('ul', { class: 'error-list' },
                ...row.topErrors.map((err) =>
                  el('li', { class: 'error-list__item mono' },
                    el('span', { class: 'badge badge-danger' }, `×${err.count}`),
                    el('span', null, err.error),
                  ),
                ),
              )
              : el('p', { class: 'muted small' }, 'Aucun échec enregistré sur la période.'),
          );
        }),
      ),
  );
}

export function renderChronographe(state, actions) {
  return el('div', { class: 'view-chronographe' },
    renderDayChronogram(state, actions),
    renderSpectrumChart(state),
    el('div', { class: 'chrono-split' },
      renderBreakdowns(state, actions),
      renderReliability(state),
    ),
  );
}
