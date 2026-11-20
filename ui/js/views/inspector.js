// Boîte Noire : tiroir latéral d'inspection d'un appel (/api/calls/:callId) et reprise de session.
import { CALL_STATUS_LABELS, NO_FEATURE_LABEL, OUTPUT_PREVIEW_CHARS, TOOL_KIND_LABELS } from '../config.js';
import { el, mockBadge, mount } from '../dom.js';
import {
  agentColor, agentGlyph, agentLabel, cacheRatio, formatDuration,
  formatPct, formatTimeUtc, formatTokens, roleLabel, truncate,
} from '../format.js';

function summarizeEvents(events) {
  const start = events.find((e) => e.kind === 'call_start');
  const end = [...events].reverse().find((e) => e.kind === 'call_end');
  const lastUsage = end?.usage ?? [...events].reverse().find((e) => e.kind === 'usage')?.usage ?? null;
  const first = events[0] ?? {};
  return {
    agent: start?.agent ?? end?.agent ?? first.agent,
    model: start?.model ?? end?.model ?? first.model,
    feature: start?.feature ?? end?.feature ?? first.feature,
    role: start?.role ?? end?.role ?? first.role,
    mode: start?.mode ?? null,
    resumedFrom: start?.resumedFrom ?? null,
    status: end ? (end.status ?? 'ok') : 'running',
    error: end?.error ?? null,
    durationMs: end?.durationMs ?? (start?.ts && end?.ts ? Date.parse(end.ts) - Date.parse(start.ts) : null),
    sessionId: end?.sessionId ?? null,
    usage: lastUsage,
    ended: Boolean(end),
  };
}

function renderEventItem(ev) {
  const ts = el('span', { class: 'mono muted event-ts' }, formatTimeUtc(ev.ts));

  if (ev.kind === 'call_start') {
    return el('li', { class: 'event-item event-item--meta' },
      ts,
      el('span', { class: 'badge badge-muted' }, 'Début'),
      el('span', { class: 'mono small' },
        `mode ${ev.mode ?? '—'}${ev.resumedFrom ? ` · repris depuis ${ev.resumedFrom.slice(0, 8)}` : ''}`),
    );
  }

  if (ev.kind === 'tool_start') {
    const kindLabel = TOOL_KIND_LABELS[ev.tool?.kind] ?? ev.tool?.name ?? 'Outil';
    return el('li', { class: 'event-item event-item--tool' },
      ts,
      el('span', { class: 'badge badge-info' }, kindLabel),
      el('span', { class: 'mono small event-target' }, `${ev.tool?.name ?? ''} ${ev.tool?.target ?? ''}`.trim()),
    );
  }

  if (ev.kind === 'tool_end') {
    const ok = ev.ok !== false;
    const output = ev.output ? String(ev.output) : '';
    const isLong = output.length > OUTPUT_PREVIEW_CHARS;
    return el('li', { class: `event-item event-item--tool-end${ok ? '' : ' event-item--fail'}` },
      el('div', { class: 'event-row' },
        ts,
        el('span', { class: `badge ${ok ? 'badge-ok' : 'badge-danger'}` },
          ok ? 'OK' : `Échec${ev.exitCode != null ? ` (${ev.exitCode})` : ''}`),
        el('span', { class: 'mono small event-target' },
          `${ev.tool?.name ?? 'outil'}${ev.tool?.target ? ` · ${truncate(ev.tool.target, 70)}` : ''}`),
        ev.durationMs != null ? el('span', { class: 'mono muted small' }, formatDuration(ev.durationMs)) : null,
      ),
      output
        ? (isLong
          ? el('details', { class: 'event-output' },
            el('summary', { class: 'small muted' }, `Sortie (${output.length} car.)`),
            el('pre', { class: 'code-out' }, output))
          : el('pre', { class: 'code-out event-output-inline' }, output))
        : null,
    );
  }

  if (ev.kind === 'message') {
    return el('li', { class: 'event-item event-item--message' },
      el('div', { class: 'event-row' },
        ts,
        el('span', { class: 'badge badge-accent' }, 'Message'),
      ),
      el('pre', { class: 'message-pre' }, ev.text ?? ''),
    );
  }

  if (ev.kind === 'call_end') {
    return el('li', { class: `event-item event-item--meta${ev.status !== 'ok' ? ' event-item--fail' : ''}` },
      el('div', { class: 'event-row' },
        ts,
        el('span', { class: `badge ${ev.status === 'ok' ? 'badge-ok' : 'badge-danger'}` },
          CALL_STATUS_LABELS[ev.status] ?? ev.status),
        ev.durationMs != null ? el('span', { class: 'mono small' }, formatDuration(ev.durationMs)) : null,
      ),
      ev.error ? el('p', { class: 'danger-text small mono' }, ev.error) : null,
    );
  }

  if (ev.kind === 'commit') {
    return el('li', { class: `event-item event-item--meta${ev.ok ? '' : ' event-item--fail'}` },
      el('div', { class: 'event-row' },
        ts,
        el('span', { class: `badge ${ev.ok ? 'badge-ok' : 'badge-danger'}` }, ev.ok ? 'Commit' : 'Commit échoué'),
        el('span', { class: 'mono small' }, ev.ok ? (ev.commit ?? '') : (ev.message ?? '')),
      ),
      ev.error ? el('p', { class: 'danger-text small mono' }, ev.error) : null,
      Array.isArray(ev.files) && ev.files.length
        ? el('p', { class: 'small mono' }, `${ev.files.length} fichier(s) : ${ev.files.join(' ')}`) : null,
    );
  }

  return null;
}

export function renderInspector(container, state, actions) {
  const ins = state.inspector;
  if (!ins.open) {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  const recentMatch = (state.usage?.recent ?? []).find((r) => r.callId === ins.callId);
  const events = ins.data?.events ?? [];
  const meta = events.length ? summarizeEvents(events) : {
    agent: recentMatch?.agent,
    model: recentMatch?.model,
    feature: recentMatch?.feature,
    role: recentMatch?.role,
    mode: recentMatch?.mode,
    resumedFrom: recentMatch?.resumedFrom,
    status: recentMatch?.status ?? 'running',
    durationMs: recentMatch?.durationMs,
    sessionId: recentMatch?.sessionId,
    usage: recentMatch?.usage,
    ended: Boolean(recentMatch && recentMatch.status !== 'running'),
  };

  const sessionId = meta.sessionId ?? recentMatch?.sessionId ?? null;
  const canResume = Boolean(meta.ended && sessionId);
  const usage = meta.usage ?? { input: 0, cachedInput: 0, output: 0, thinking: 0 };
  const cancelled = Boolean(state.mockCancelled[ins.callId]);

  const resumeTextarea = el('textarea', {
    class: 'textarea',
    rows: 3,
    placeholder: 'Écrivez vos consignes ou retours de relecture pour reprendre cette session…',
    value: ins.resumeText,
    disabled: ins.resuming,
    onInput: (e) => actions.setResumeText(e.target.value),
  });

  const panel = el('div', { class: 'drawer-backdrop', onClick: (e) => { if (e.target === e.currentTarget) actions.closeCall(); } },
    el('aside', {
      class: 'drawer',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': `Boîte noire de l’appel ${ins.callId}`,
    },
      el('header', { class: 'drawer__head' },
        el('div', { class: 'drawer__id' },
          el('span', { class: 'agent-orb', style: { '--agent-color': agentColor(meta.agent) } }, agentGlyph(meta.agent)),
          el('div', null,
            el('div', { class: 'panel__title-group' },
              el('h2', { class: 'drawer__title' }, agentLabel(meta.agent)),
              el('span', { class: `status-pill status-pill--${meta.status ?? 'ok'}` },
                CALL_STATUS_LABELS[meta.status] ?? meta.status ?? '—'),
            ),
            el('p', { class: 'mono muted small' },
              `${meta.model ?? 'modèle inconnu'} · ${roleLabel(meta.role)} · ${meta.feature ?? NO_FEATURE_LABEL}`),
          ),
        ),
        el('button', {
          type: 'button',
          class: 'icon-btn drawer__close',
          'aria-label': 'Fermer la boîte noire (Échap)',
          onClick: () => actions.closeCall(),
        }, '✕'),
      ),

      el('div', { class: 'drawer__body' },
        // Métadonnées & filiation
        el('dl', { class: 'kpi-mini-grid' },
          el('div', { class: 'kpi-mini' },
            el('dt', null, 'Durée'),
            el('dd', { class: 'mono' }, formatDuration(meta.durationMs)),
          ),
          el('div', { class: 'kpi-mini' },
            el('dt', null, 'Entrée / Cache'),
            el('dd', { class: 'mono' },
              `${formatTokens(usage.input)} (${formatPct(cacheRatio(usage.input, usage.cachedInput))})`),
          ),
          el('div', { class: 'kpi-mini' },
            el('dt', null, 'Sortie'),
            el('dd', { class: 'mono' },
              `${formatTokens(usage.output)}${usage.thinking ? ` · réf. ${formatTokens(usage.thinking)}` : ''}`),
          ),
          el('div', { class: 'kpi-mini' },
            el('dt', null, 'Mode'),
            el('dd', { class: 'mono' }, meta.mode ?? '—'),
          ),
        ),

        meta.resumedFrom
          ? el('div', { class: 'lineage-bar' },
            el('span', { class: 'muted small' }, 'Repris depuis :'),
            el('button', {
              type: 'button',
              class: 'btn btn-ghost btn-xs mono',
              onClick: () => actions.openCall(meta.resumedFrom),
            }, `↩ ${meta.resumedFrom.slice(0, 12)}…`),
          )
          : null,

        // Maquette d'interruption si l'appel est en cours
        !meta.ended && !ins.loading && !ins.error
          ? el('div', { class: 'callout callout--info' },
            el('div', { class: 'panel__title-group' },
              el('strong', { class: 'small' }, 'Appel en vol — mise à jour automatique'),
              mockBadge(),
            ),
            el('button', {
              type: 'button',
              class: cancelled ? 'btn btn-ghost btn-xs' : 'btn btn-danger btn-xs',
              onClick: () => actions.toggleMockCancel(ins.callId),
            }, cancelled ? 'Interruption simulée ✓' : 'Interrompre l’appel'),
          )
          : null,

        // Reprise de session réelle (POST /api/calls/:callId/resume)
        canResume
          ? el('form', {
            class: 'resume-box',
            onSubmit: (e) => {
              e.preventDefault();
              actions.submitResume();
            },
          },
          el('div', { class: 'resume-box__head' },
            el('strong', null, 'Répondre à l’agent'),
            el('span', { class: 'mono muted small' }, `session ${sessionId.slice(0, 10)}…`),
          ),
          resumeTextarea,
          ins.resumeError ? el('p', { class: 'danger-text small', role: 'alert' }, ins.resumeError) : null,
          el('div', { class: 'resume-box__foot' },
            el('span', { class: 'muted small' }, 'Relance la conversation dans le même dossier et ouvre le nouvel appel.'),
            el('button', {
              type: 'submit',
              class: 'btn btn-primary btn-sm',
              disabled: ins.resuming || !ins.resumeText.trim(),
            }, ins.resuming ? 'Envoi…' : 'Reprendre la session'),
          ))
          : null,

        // Journal des événements
        el('section', { class: 'event-stream-section' },
          el('h3', { class: 'sub-title' }, `Journal d’événements (${events.filter((e) => e.kind !== 'usage').length})`),
          ins.loading
            ? el('p', { class: 'muted small' }, 'Lecture de la boîte noire…')
            : ins.error
              ? el('p', { class: 'callout callout--warn small' }, ins.error)
              : events.length === 0
                ? el('p', { class: 'muted small' }, 'Aucun événement journalisé pour cet appel.')
                : el('ol', { class: 'event-list' }, ...events.map(renderEventItem)),
        ),
      ),
    ),
  );

  mount(container, panel);
}
