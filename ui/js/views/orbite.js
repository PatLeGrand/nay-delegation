// Vue « Orbite » : Planétarium de vol interactif, quotas orbitaux, bande télémétrique SSE et dock contextuel.
import {
  ALERT_KIND_LABELS, CALL_STATUS_LABELS, CRITICAL_QUOTA_PCT, LOW_QUOTA_PCT,
  NO_FEATURE_LABEL, TOOL_KIND_LABELS,
} from '../config.js';
import { el, svgEl, mockBadge } from '../dom.js';
import {
  agentColor, agentGlyph, agentLabel, cacheRatio, formatCountdown,
  formatDuration, formatInt, formatPct, formatRelative, formatTimeUtc,
  formatTokens, roleLabel, truncate,
} from '../format.js';
import { buildOrreryModel, describeArc } from '../model.js';

function quotaTone(pct) {
  if (pct == null) return 'muted';
  if (pct <= CRITICAL_QUOTA_PCT) return 'danger';
  if (pct <= LOW_QUOTA_PCT) return 'warn';
  return 'ok';
}

function renderActionStrip(state, actions) {
  const alerts = state.status?.alerts ?? [];
  const waiting = (state.features ?? []).filter((f) => f.waitingForUser && !state.mockDecisions[f.name]);
  if (!alerts.length && !waiting.length) return null;

  // Priorise les alertes actives (commande longue / silence / échecs) en tête
  const priority = { commande_longue: 0, silence: 1, echecs: 2, travail_repete: 3 };
  const sortedAlerts = [...alerts].sort((a, b) => (priority[a.kind] ?? 9) - (priority[b.kind] ?? 9));
  const topAlert = sortedAlerts[0];

  return el('section', { class: 'action-zone', 'aria-label': 'Alertes et décisions en attente' },
    alerts.length > 0
      ? el('div', { class: 'alert-ribbon' },
        el('div', { class: 'alert-ribbon__main' },
          el('span', { class: 'pulse-dot pulse-dot--danger', 'aria-hidden': 'true' }),
          el('strong', null, `${alerts.length} alerte${alerts.length > 1 ? 's' : ''}`),
          el('span', { class: 'chip', style: { '--chip-color': agentColor(topAlert.agent) } }, agentLabel(topAlert.agent)),
          el('span', { class: 'alert-ribbon__text' },
            `${ALERT_KIND_LABELS[topAlert.kind] ?? topAlert.kind} — ${truncate(topAlert.detail ?? '', 72)}`),
        ),
        el('div', { class: 'alert-ribbon__actions' },
          topAlert.callId ? el('button', {
            type: 'button',
            class: 'btn btn-ghost btn-xs',
            onClick: () => actions.openCall(topAlert.callId),
          }, 'Inspecter →') : null,
          alerts.length > 1 ? el('button', {
            type: 'button',
            class: 'btn btn-ghost btn-xs',
            'aria-expanded': state.alertsExpanded ? 'true' : 'false',
            onClick: () => actions.toggleAlerts(),
          }, state.alertsExpanded ? 'Réduire' : `Tout voir (${alerts.length})`) : null,
        ),
      )
      : null,

    state.alertsExpanded && alerts.length > 1
      ? el('div', { class: 'action-strip' },
        ...sortedAlerts.map((alert) =>
          el('div', { class: 'action-card action-card--alert' },
            el('div', { class: 'action-card__head' },
              el('span', { class: 'pulse-dot pulse-dot--danger', 'aria-hidden': 'true' }),
              el('strong', null, ALERT_KIND_LABELS[alert.kind] ?? alert.kind),
              el('span', { class: 'chip', style: { '--chip-color': agentColor(alert.agent) } }, agentLabel(alert.agent)),
              alert.feature ? el('span', { class: 'mono muted' }, alert.feature) : null,
            ),
            el('p', { class: 'action-card__detail' }, alert.detail ?? 'Anomalie détectée'),
            el('div', { class: 'action-card__foot' },
              el('span', { class: 'mono muted' }, formatRelative(alert.since, state.nowMs)),
              alert.callId ? el('button', {
                type: 'button',
                class: 'btn btn-ghost btn-xs',
                onClick: () => actions.openCall(alert.callId),
              }, 'Inspecter la boîte noire →') : null,
            ),
          ),
        ),
      )
      : null,

    waiting.length > 0
      ? el('div', { class: 'action-strip' },
        ...waiting.map((feat) =>
          el('div', { class: 'action-card action-card--decision' },
            el('div', { class: 'action-card__head' },
              el('span', { class: 'pulse-dot pulse-dot--warn', 'aria-hidden': 'true' }),
              el('strong', null, `Décision requise : ${feat.title ?? feat.name}`),
              mockBadge(),
            ),
            el('p', { class: 'action-card__detail' },
              `Verdict ${feat.lastVerdict ?? 'APPROUVÉ'} · ${feat.tests ?? 'Tests non renseignés'}`),
            el('div', { class: 'action-card__foot' },
              el('button', {
                type: 'button',
                class: 'btn btn-primary btn-xs',
                onClick: () => actions.mockDecide(feat.name, 'merge'),
              }, 'Approuver la fusion'),
              el('button', {
                type: 'button',
                class: 'btn btn-ghost btn-xs',
                onClick: () => actions.mockDecide(feat.name, 'changes'),
              }, 'Demander correction'),
              el('button', {
                type: 'button',
                class: 'btn btn-ghost btn-xs',
                onClick: () => actions.setView('relais'),
              }, 'Voir la fiche →'),
            ),
          ),
        ),
      )
      : null,
  );
}

function renderOrrerySvg(model, state, actions) {
  const { cx, cy, size, orbits, nodes, activeCount, alertCount } = model;
  const selected = state.selectedAgent;

  const svg = svgEl('svg', {
    class: 'orrery-svg',
    viewBox: `0 0 ${size} ${size}`,
    role: 'img',
    'aria-label': `Planétarium orbital Nay : ${nodes.length} agents sur 3 orbites, ${activeCount} en vol`,
  });

  // Définitions (filtres lumineux subtils)
  const defs = svgEl('defs');
  const glow = svgEl('filter', { id: 'nay-glow', x: '-40%', y: '-40%', width: '180%', height: '180%' },
    svgEl('feGaussianBlur', { stdDeviation: '4', result: 'blur' }),
    svgEl('feMerge', null,
      svgEl('feMergeNode', { in: 'blur' }),
      svgEl('feMergeNode', { in: 'SourceGraphic' }),
    ),
  );
  defs.appendChild(glow);
  svg.appendChild(defs);

  // Réticule astronomique de fond
  const reticle = svgEl('g', { class: 'orrery-reticle', 'aria-hidden': 'true' });
  reticle.appendChild(svgEl('line', { x1: cx, y1: 18, x2: cx, y2: size - 18, class: 'reticle-axis' }));
  reticle.appendChild(svgEl('line', { x1: 18, y1: cy, x2: size - 18, y2: cy, class: 'reticle-axis' }));
  for (let deg = 0; deg < 360; deg += 30) {
    const rad = (deg * Math.PI) / 180;
    const r1 = 248;
    const r2 = deg % 90 === 0 ? 260 : 254;
    reticle.appendChild(svgEl('line', {
      x1: (cx + Math.cos(rad) * r1).toFixed(1),
      y1: (cy + Math.sin(rad) * r1).toFixed(1),
      x2: (cx + Math.cos(rad) * r2).toFixed(1),
      y2: (cy + Math.sin(rad) * r2).toFixed(1),
      class: 'reticle-tick',
    }));
  }
  svg.appendChild(reticle);

  // Anneaux orbitaux et arcs de quotas par fournisseur
  const orbitGroup = svgEl('g', { class: 'orrery-orbits' });
  orbits.forEach((orbit, oi) => {
    const tone = quotaTone(orbit.remainingPct);
    orbitGroup.appendChild(svgEl('circle', {
      cx, cy, r: orbit.radius,
      class: `orbit-track${orbit.remainingPct == null ? ' orbit-track--unknown' : ''}`,
    }));

    if (orbit.remainingPct != null && orbit.remainingPct > 0) {
      orbitGroup.appendChild(svgEl('path', {
        d: describeArc(cx, cy, orbit.radius, orbit.remainingPct),
        class: `orbit-quota orbit-quota--${tone}`,
      }));
    }

    // Légende calibrée en haut à gauche (sans aucune collision avec les nœuds)
    const ly = 22 + oi * 16;
    const pctText = orbit.remainingPct != null ? `${Math.round(orbit.remainingPct)} %` : '—';
    const winText = orbit.windowLabel ? ` (${orbit.windowLabel})` : '';
    orbitGroup.appendChild(svgEl('circle', { cx: 14, cy: ly - 3, r: 3.5, fill: orbit.color }));
    orbitGroup.appendChild(svgEl('text', {
      x: 24,
      y: ly,
      class: 'orbit-label',
    }, `${orbit.label.toUpperCase()} · ${pctText}${winText}`));
  });
  svg.appendChild(orbitGroup);

  // Faisceaux de télémétrie entre l'Orchestrateur et les agents actifs (ou sélectionné)
  const beamGroup = svgEl('g', { class: 'orrery-beams' });
  for (const node of nodes) {
    if (!node.isRunning && selected !== node.name) continue;
    beamGroup.appendChild(svgEl('line', {
      x1: cx, y1: cy,
      x2: node.x.toFixed(1), y2: node.y.toFixed(1),
      class: `telemetry-beam${node.isRunning ? ' telemetry-beam--live' : ' telemetry-beam--focus'}`,
      style: { stroke: node.color },
    }));
  }
  svg.appendChild(beamGroup);

  // Noyau central : Orchestrateur (Opus)
  const coreClass = alertCount > 0 ? 'orrery-core--alert' : activeCount > 0 ? 'orrery-core--live' : 'orrery-core--idle';
  const core = svgEl('g', {
    class: `orrery-core ${coreClass}`,
    tabindex: '0',
    role: 'button',
    'aria-label': `Orchestrateur Opus — ${activeCount} appels en vol, ${alertCount} alertes. Cliquer pour voir toute la flotte.`,
    onClick: () => actions.selectAgent(null),
    onKeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.selectAgent(null); }
    },
  });
  if (activeCount > 0 || alertCount > 0) {
    core.appendChild(svgEl('circle', { cx, cy, r: 44, class: 'core-pulse-ring' }));
  }
  core.appendChild(svgEl('circle', { cx, cy, r: 34, class: 'core-outer' }));
  core.appendChild(svgEl('circle', { cx, cy, r: 26, class: 'core-inner' }));
  core.appendChild(svgEl('text', { x: cx, y: cy - 3, class: 'core-title', 'text-anchor': 'middle' }, 'NAY'));
  core.appendChild(svgEl('text', { x: cx, y: cy + 12, class: 'core-sub', 'text-anchor': 'middle' },
    activeCount > 0 ? `${activeCount} EN VOL` : 'VEILLE'));
  svg.appendChild(core);

  // Nœuds célestes des agents
  const nodesGroup = svgEl('g', { class: 'orrery-nodes' });
  for (const node of nodes) {
    const isSelected = selected === node.name;
    const isDimmed = selected && !isSelected;
    const cls = [
      'agent-node',
      node.isRunning ? 'agent-node--live' : '',
      node.hasAlert ? 'agent-node--alert' : '',
      !node.available ? 'agent-node--unavailable' : '',
      isSelected ? 'agent-node--selected' : '',
      isDimmed ? 'agent-node--dimmed' : '',
    ].filter(Boolean).join(' ');

    const ariaParts = [
      `${node.label} (${node.provider})`,
      node.isRunning ? `${node.runningCalls.length} appel en cours` : `${node.usage.calls} appels`,
      node.available ? 'disponible' : 'indisponible',
    ];
    if (node.hasAlert) ariaParts.push(`${node.alerts.length} alerte`);

    const g = svgEl('g', {
      class: cls,
      transform: `translate(${node.x.toFixed(1)}, ${node.y.toFixed(1)})`,
      tabindex: '0',
      role: 'button',
      'aria-pressed': isSelected ? 'true' : 'false',
      'aria-label': ariaParts.join(', '),
      onClick: () => actions.selectAgent(isSelected ? null : node.name),
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          actions.selectAgent(isSelected ? null : node.name);
        }
      },
    });

    // Halo d'alerte ou de vol actif
    if (node.hasAlert) {
      g.appendChild(svgEl('circle', { r: node.radius + 9, class: 'node-alert-ring' }));
    } else if (node.isRunning) {
      g.appendChild(svgEl('circle', { r: node.radius + 8, class: 'node-live-ring', style: { stroke: node.color } }));
    }

    // Anneau de fiabilité autour de l'agent
    if (node.successRate != null) {
      const ringR = node.radius + 3.5;
      g.appendChild(svgEl('circle', { r: ringR, class: 'node-rel-track' }));
      const pct = Math.max(4, Math.round(node.successRate * 100));
      g.appendChild(svgEl('path', {
        d: describeArc(0, 0, ringR, pct),
        class: `node-rel-arc ${node.successRate < 0.7 ? 'node-rel-arc--warn' : ''}`,
        style: node.successRate >= 0.7 ? { stroke: node.color } : undefined,
      }));
    }

    // Disque principal
    g.appendChild(svgEl('circle', {
      r: node.radius,
      class: 'node-disc',
      style: { '--node-color': node.color },
      filter: node.isRunning || isSelected ? 'url(#nay-glow)' : null,
    }));

    // Glyphe céleste
    g.appendChild(svgEl('text', {
      y: 4.5,
      class: 'node-glyph',
      'text-anchor': 'middle',
      style: { fill: node.color },
    }, node.glyph));

    // Étiquette nom + volume
    const labelY = node.radius + 15;
    g.appendChild(svgEl('text', { y: labelY, class: 'node-name', 'text-anchor': 'middle' }, node.label));
    if (node.tokens > 0 || node.isRunning) {
      g.appendChild(svgEl('text', { y: labelY + 11, class: 'node-metric', 'text-anchor': 'middle' },
        node.isRunning ? '● ACTIF' : formatTokens(node.tokens)));
    }

    nodesGroup.appendChild(g);
  }
  svg.appendChild(nodesGroup);

  return svg;
}

function renderTelemetryTape(state, actions) {
  const selected = state.selectedAgent;
  const liveEvents = state.liveEvents ?? [];
  const todayCalls = state.status?.calls ?? [];

  // Fusionne les événements SSE reçus en direct avec les appels du jour pour ne jamais avoir un ruban vide.
  const sseItems = liveEvents
    .filter((ev) => !selected || ev.agent === selected)
    .map((ev) => ({
      ts: ev.ts,
      agent: ev.agent,
      callId: ev.callId,
      feature: ev.feature,
      branch: ev.branch,
      kind: ev.kind,
      tool: ev.tool,
      text: ev.text,
      output: ev.output,
      ok: ev.ok,
      status: ev.status,
      error: ev.error,
      isLiveSse: true,
    }));

  const callItems = todayCalls
    .filter((c) => !selected || c.agent === selected)
    .slice()
    .sort((a, b) => Date.parse(b.lastEventAt ?? b.startedAt ?? 0) - Date.parse(a.lastEventAt ?? a.startedAt ?? 0))
    .slice(0, 18)
    .map((c) => {
      const tool = c.currentTools?.[0];
      return {
        ts: c.lastEventAt ?? c.startedAt,
        agent: c.agent,
        callId: c.callId,
        feature: c.feature,
        branch: c.branch,
        kind: c.status === 'running' ? 'running' : 'call_end',
        tool,
        status: c.status,
        toolCount: c.toolCount,
        isLiveSse: false,
      };
    });

  const rows = sseItems.length ? [...sseItems, ...callItems.slice(0, 10)] : callItems;

  return el('section', { class: 'panel tape-panel', 'aria-label': 'Bande télémétrique en direct' },
    el('header', { class: 'panel__head' },
      el('div', { class: 'panel__title-group' },
        el('h2', { class: 'panel__title' }, 'Bande télémétrique'),
        el('span', { class: `sse-pill sse-pill--${state.sseState}` },
          el('span', { class: 'sse-dot', 'aria-hidden': 'true' }),
          state.sseState === 'open' ? 'SSE en direct' : state.sseState === 'connecting' ? 'Connexion SSE…' : 'SSE hors ligne',
        ),
      ),
      selected
        ? el('button', { type: 'button', class: 'btn btn-ghost btn-xs', onClick: () => actions.selectAgent(null) },
          `Filtre : ${agentLabel(selected)} ×`)
        : el('span', { class: 'mono muted' }, `${todayCalls.length} appels aujourd’hui`),
    ),
    rows.length === 0
      ? el('div', { class: 'empty-state' },
        'Aucun événement reçu aujourd’hui sur ce périmètre. Le flux SSE affichera chaque outil et message en temps réel dès qu’un agent démarre.')
      : el('ul', { class: 'tape-list' },
        ...rows.slice(0, 24).map((item) => {
          const badgeText = item.kind === 'tool_start' || item.kind === 'tool_end'
            ? (TOOL_KIND_LABELS[item.tool?.kind] ?? item.tool?.name ?? 'Outil')
            : item.kind === 'message' ? 'Message'
              : item.kind === 'running' ? 'En vol'
                : (CALL_STATUS_LABELS[item.status] ?? item.kind);
          const branch = item.feature ? null : item.branch;
          const detail = item.feature || (branch ? '' : NO_FEATURE_LABEL);
          const summary = item.tool?.target
            ? `${item.tool.name ?? 'outil'} · ${truncate(item.tool.target, 84)}`
            : item.text
              ? truncate(item.text, 96)
              : item.error
                ? truncate(item.error, 96)
                : item.toolCount != null
                  ? `${item.toolCount} outils${detail ? ` · ${detail}` : ''}`
                  : detail;

          return el('li', { class: `tape-row${item.isLiveSse ? ' tape-row--sse' : ''}` },
            el('button', {
              type: 'button',
              class: 'tape-row__btn',
              onClick: () => item.callId && actions.openCall(item.callId),
            },
              el('span', { class: 'mono muted tape-row__ts' }, formatTimeUtc(item.ts)),
              el('span', { class: 'agent-tag', style: { '--agent-color': agentColor(item.agent) } },
                el('span', { class: 'agent-tag__glyph', 'aria-hidden': 'true' }, agentGlyph(item.agent)),
                agentLabel(item.agent),
              ),
              el('span', { class: `status-pill status-pill--${item.ok === false || item.status === 'error' ? 'error' : item.status === 'running' ? 'running' : 'ok'}` },
                badgeText),
              el('span', { class: 'tape-row__summary mono' }, summary,
                branch ? el('small', { class: 'muted' }, `${summary ? ' · ' : ''}${branch}`) : null),
            ),
            item.output ? el('details', { class: 'tape-output' },
              el('summary', null, 'Voir la sortie réelle'),
              el('pre', { class: 'code-out' }, truncate(item.output, 1200)),
            ) : null,
          );
        }),
      ),
  );
}

function renderQuotaDock(state) {
  const providers = state.quota?.providers ?? {};
  const agents = state.quota?.agents ?? [];

  return el('section', { class: 'panel', 'aria-label': 'Réservoirs de quotas' },
    el('header', { class: 'panel__head' },
      el('h2', { class: 'panel__title' }, 'Réservoirs de quotas'),
      el('span', { class: 'mono muted' }, `${agents.filter((a) => a.available).length}/${agents.length} dispo`),
    ),
    el('div', { class: 'quota-stack' },
      ...['codex', 'agy', 'claude'].map((pid) => {
        const info = providers[pid] ?? { status: 'unknown', windows: [] };
        const windows = info.windows ?? [];
        const unavailable = agents.filter((a) => a.provider === pid && !a.available);
        return el('div', { class: 'quota-provider' },
          el('div', { class: 'quota-provider__head' },
            el('strong', { class: 'mono' }, pid.toUpperCase()),
            info.stale ? el('span', { class: 'badge badge-warn' }, 'Périmé') : null,
            info.status === 'unknown' ? el('span', { class: 'badge badge-muted' }, 'Inconnu') : null,
            info.measuredAt ? el('span', { class: 'mono muted' }, formatRelative(info.measuredAt, state.nowMs)) : null,
          ),
          windows.length
            ? el('div', { class: 'quota-bars' },
              ...windows.map((w) => {
                const pct = Math.max(0, Math.min(100, Number(w.remainingPct ?? 0)));
                const tone = quotaTone(pct);
                const label = w.scope ? `${w.label} · ${w.scope}` : w.label;
                return el('div', { class: 'quota-bar-row' },
                  el('div', { class: 'quota-bar-row__meta' },
                    el('span', { class: 'mono' }, label),
                    el('span', { class: 'mono muted' },
                      `${Math.round(pct)} %${w.resetsAt ? ` · reset ${formatCountdown(w.resetsAt, state.nowMs)}` : ''}`),
                  ),
                  el('div', { class: 'meter' },
                    el('div', { class: `meter__fill meter__fill--${tone}`, style: { width: `${pct}%` } }),
                  ),
                );
              }),
            )
            : el('p', { class: 'muted small' }, info.reason ?? 'Aucune mesure disponible.'),
          unavailable.length
            ? el('p', { class: 'small danger-text' },
              `Sous seuil : ${unavailable.map((a) => agentLabel(a.name)).join(', ')}`)
            : null,
        );
      }),
    ),
  );
}

function renderSelectedAgentDock(node, state, actions) {
  const recentForAgent = (state.usage?.recent ?? []).filter((r) => r.agent === node.name).slice(0, 12);
  const ratio = cacheRatio(node.usage.input, node.usage.cachedInput);

  return el('div', { class: 'dock-stack' },
    el('section', { class: 'panel agent-dossier', 'aria-label': `Dossier de ${node.label}` },
      el('header', { class: 'panel__head' },
        el('div', { class: 'agent-dossier__id' },
          el('span', { class: 'agent-orb', style: { '--agent-color': node.color } }, node.glyph),
          el('div', null,
            el('h2', { class: 'panel__title' }, node.label),
            el('span', { class: 'mono muted' }, `${node.provider.toUpperCase()} · ${node.available ? 'Disponible' : 'Indisponible'}`),
          ),
        ),
        el('button', { type: 'button', class: 'btn btn-ghost btn-xs', onClick: () => actions.selectAgent(null) }, '← Flotte'),
      ),
      !node.available && node.unavailableReason
        ? el('p', { class: 'callout callout--warn' }, node.unavailableReason)
        : null,
      el('dl', { class: 'kpi-mini-grid' },
        el('div', { class: 'kpi-mini' },
          el('dt', null, 'Appels'),
          el('dd', { class: 'mono' }, formatInt(node.usage.calls)),
        ),
        el('div', { class: 'kpi-mini' },
          el('dt', null, 'Jetons'),
          el('dd', { class: 'mono' }, formatTokens(node.tokens)),
        ),
        el('div', { class: 'kpi-mini' },
          el('dt', null, 'Cache'),
          el('dd', { class: 'mono' }, formatPct(ratio)),
        ),
        el('div', { class: 'kpi-mini' },
          el('dt', null, 'Réussite'),
          el('dd', { class: 'mono' }, node.successRate != null ? formatPct(node.successRate) : '—'),
        ),
      ),
      node.runningCalls.length
        ? el('div', { class: 'sub-block' },
          el('h3', { class: 'sub-title' }, 'En vol maintenant'),
          ...node.runningCalls.map((c) => renderRunningCallCard(c, state.nowMs, actions)),
        )
        : null,
      el('div', { class: 'sub-block' },
        el('h3', { class: 'sub-title' }, 'Appels récents (cliquer pour inspecter)'),
        recentForAgent.length === 0
          ? el('p', { class: 'muted small' }, 'Aucun appel enregistré sur cette période.')
          : el('ul', { class: 'compact-call-list' },
            ...recentForAgent.map((r) => renderRecentCallRow(r, actions)),
          ),
      ),
    ),
  );
}

function renderRunningCallCard(call, nowMs, actions) {
  const tool = call.currentTools?.[0];
  const elapsed = call.startedAt ? Math.max(0, nowMs - Date.parse(call.startedAt)) : 0;
  return el('button', {
    type: 'button',
    class: 'running-card',
    onClick: () => actions.openCall(call.callId),
  },
    el('div', { class: 'running-card__top' },
      el('span', { class: 'pulse-dot pulse-dot--live', 'aria-hidden': 'true' }),
      el('strong', null, agentLabel(call.agent)),
      el('span', { class: 'mono muted' }, roleLabel(call.role)),
      el('span', { class: 'mono running-card__elapsed', dataset: { liveSince: call.startedAt } }, formatDuration(elapsed)),
    ),
    el('div', { class: 'running-card__body mono' },
      tool ? `${tool.name} · ${truncate(tool.target ?? '', 60)}` : (call.feature || call.branch || NO_FEATURE_LABEL)),
  );
}

function renderRecentCallRow(call, actions) {
  const tokens = (call.usage?.input ?? 0) + (call.usage?.output ?? 0);
  return el('li', { class: 'compact-call-item' },
    el('button', {
      type: 'button',
      class: 'compact-call-btn',
      onClick: () => call.callId && actions.openCall(call.callId),
    },
      el('span', { class: `status-dot status-dot--${call.status ?? 'ok'}`, 'aria-hidden': 'true' }),
      el('span', { class: 'compact-call-main' },
        el('strong', null, agentLabel(call.agent)),
        el(call.feature || !call.branch ? 'span' : 'small', { class: 'muted' },
          ` · ${call.feature || call.branch || NO_FEATURE_LABEL}`),
      ),
      el('span', { class: 'mono muted compact-call-meta' },
        `${formatTokens(tokens)} · ${formatDuration(call.durationMs)}`),
    ),
  );
}

export function renderOrbite(state, actions) {
  const model = buildOrreryModel(state);
  const selectedNode = state.selectedAgent
    ? model.nodes.find((n) => n.name === state.selectedAgent)
    : null;
  const runningCalls = (state.status?.calls ?? []).filter((c) => c.status === 'running');
  const recentCalls = (state.usage?.recent ?? []).slice(0, 8);
  const totals = state.usage?.totals ?? { calls: 0, input: 0, cachedInput: 0, output: 0, durationMs: 0 };

  return el('div', { class: 'view-orbite' },
    renderActionStrip(state, actions),
    el('div', { class: 'orbite-grid' },
      el('div', { class: 'orbite-primary' },
        el('section', { class: 'panel orrery-panel', 'aria-label': 'Planétarium orbital des agents' },
          el('header', { class: 'panel__head' },
            el('div', { class: 'panel__title-group' },
              el('h2', { class: 'panel__title' }, 'Planétarium de vol'),
              el('span', { class: 'mono muted' }, 'Cliquer un astre pour filtrer'),
            ),
            el('div', { class: 'orrery-kpis mono' },
              el('span', null, `${formatInt(totals.calls)} appels`),
              el('span', null, `${formatTokens(totals.input + totals.output)} jetons`),
              el('span', null, `Cache ${formatPct(cacheRatio(totals.input, totals.cachedInput))}`),
              el('span', null, formatDuration(totals.durationMs)),
            ),
          ),
          el('div', { class: 'orrery-stage' },
            renderOrrerySvg(model, state, actions),
          ),
          el('footer', { class: 'orrery-legend' },
            el('span', { class: 'legend-item' }, el('span', { class: 'legend-swatch legend-swatch--live' }), 'En vol'),
            el('span', { class: 'legend-item' }, el('span', { class: 'legend-swatch legend-swatch--alert' }), 'Alerte active'),
            el('span', { class: 'legend-item' }, el('span', { class: 'legend-swatch legend-swatch--quota' }), 'Arc = quota restant'),
            el('span', { class: 'legend-item' }, 'Taille = volume de jetons'),
          ),
        ),
        renderTelemetryTape(state, actions),
      ),
      el('aside', { class: 'orbite-dock', 'aria-label': 'Panneau de pilotage latéral' },
        selectedNode
          ? renderSelectedAgentDock(selectedNode, state, actions)
          : el('div', { class: 'dock-stack' },
            el('section', { class: 'panel', 'aria-label': 'Appels en cours' },
              el('header', { class: 'panel__head' },
                el('h2', { class: 'panel__title' }, 'Vols en cours'),
                el('span', { class: 'mono muted' }, String(runningCalls.length)),
              ),
              runningCalls.length === 0
                ? el('p', { class: 'muted small' }, 'Aucun agent en vol actuellement. La flotte est en veille.')
                : el('div', { class: 'running-stack' },
                  ...runningCalls.map((c) => renderRunningCallCard(c, state.nowMs, actions)),
                ),
            ),
            renderQuotaDock(state),
            el('section', { class: 'panel', 'aria-label': 'Derniers appels' },
              el('header', { class: 'panel__head' },
                el('h2', { class: 'panel__title' }, 'Derniers atterrissages'),
                el('span', { class: 'mono muted' }, `${recentCalls.length} récents`),
              ),
              recentCalls.length === 0
                ? el('p', { class: 'muted small' }, 'Aucun appel sur la période sélectionnée.')
                : el('ul', { class: 'compact-call-list' },
                  ...recentCalls.map((r) => renderRecentCallRow(r, actions)),
                ),
            ),
          ),
      ),
    ),
  );
}
