// Vue « Relais » : trajectoires des stories, passages de relais entre agents, verdicts et fiches.
import { FEATURE_STATE_LABELS } from '../config.js';
import { el, mockBadge } from '../dom.js';
import {
  agentColor, agentGlyph, agentLabel, formatDuration, formatTokens, roleLabel,
} from '../format.js';
import { buildStoryRelays } from '../model.js';

function renderStoryChecks(report) {
  const failed = report.status === 'CONTRÔLES';
  return el('div', { class: failed ? 'callout callout--danger' : 'small' },
    el('span', { class: 'small mono muted' }, `Story ${report.storyId}`),
    failed ? el('strong', null, 'Contrôles en échec') : null,
    report.checks ? el('p', null, `Contrôles : ${report.checks} `,
      report.checksBy === 'nay' ? el('span', { class: 'badge badge-info' }, 'vérifiés par Nay') : null,
      report.checksBy === 'dev' ? el('span', { class: 'badge badge-warn' }, 'déclarés, non vérifiés') : null,
    ) : null,
  );
}

function renderRelayCard(story, state, actions) {
  const mockDecision = state.mockDecisions[story.name];
  const effectiveState = mockDecision === 'merge' ? 'fusionnee' : mockDecision === 'changes' ? 'en_cours' : story.state;
  const stateLabel = FEATURE_STATE_LABELS[effectiveState] ?? effectiveState;

  return el('article', {
    class: `panel story-card${story.waitingForUser && !mockDecision ? ' story-card--waiting' : ''}`,
  },
    el('header', { class: 'story-card__head' },
      el('div', { class: 'story-card__title-block' },
        el('div', { class: 'story-card__title-row' },
          el('h3', { class: 'story-card__title' }, story.title ?? story.name),
          story.hasDoc || !story.storyChecks.length ? el('span', { class: `state-pill state-pill--${effectiveState}` }, stateLabel) : null,
          mockDecision ? mockBadge(mockDecision === 'merge' ? 'Fusion simulée' : 'Correction simulée') : null,
        ),
        el('div', { class: 'story-card__meta mono muted' },
          story.branch ? el('span', null, story.branch) : null,
          story.calls.length ? el('span', null, `${story.calls.length} appels`) : null,
          story.tokens > 0 ? el('span', null, formatTokens(story.tokens)) : null,
          story.durationMs > 0 ? el('span', null, formatDuration(story.durationMs)) : null,
        ),
      ),
      story.waitingForUser && !mockDecision
        ? el('div', { class: 'story-card__actions' },
          mockBadge(),
          el('button', {
            type: 'button',
            class: 'btn btn-primary btn-xs',
            onClick: () => actions.mockDecide(story.name, 'merge'),
          }, 'Approuver'),
          el('button', {
            type: 'button',
            class: 'btn btn-ghost btn-xs',
            onClick: () => actions.mockDecide(story.name, 'changes'),
          }, 'Corriger'),
        )
        : null,
    ),

    story.task ? el('p', { class: 'story-card__task' }, story.task) : null,

    // Chaîne de passage de relais des appels
    story.calls.length > 0
      ? el('div', { class: 'relay-track', role: 'list', 'aria-label': `Relais d’appels pour ${story.name}` },
        ...story.calls.flatMap((call, idx) => {
          const nodes = [];
          if (idx > 0) {
            nodes.push(el('span', {
              class: `relay-arrow${call.resumedFrom ? ' relay-arrow--resume' : ''}`,
              'aria-hidden': 'true',
              title: call.resumedFrom ? 'Reprise de session' : 'Passage de relais',
            }, call.resumedFrom ? '↩' : '→'));
          }
          nodes.push(el('button', {
            type: 'button',
            role: 'listitem',
            class: `relay-capsule relay-capsule--${call.status ?? 'ok'}`,
            style: { '--agent-color': agentColor(call.agent) },
            onClick: () => call.callId && actions.openCall(call.callId),
            title: `Inspecter l’appel de ${agentLabel(call.agent)} (${roleLabel(call.role)})`,
          },
            el('span', { class: 'relay-capsule__glyph', 'aria-hidden': 'true' }, agentGlyph(call.agent)),
            el('span', { class: 'relay-capsule__body' },
              el('strong', null, agentLabel(call.agent)),
              el('span', { class: 'relay-capsule__sub mono' },
                `${roleLabel(call.role)}${call.durationMs ? ` · ${formatDuration(call.durationMs)}` : ''}`),
              call.branch ? el('small', { class: 'relay-capsule__sub mono' }, call.branch) : null,
            ),
            el('span', { class: `status-dot status-dot--${call.status ?? 'ok'}`, 'aria-hidden': 'true' }),
          ));
          return nodes;
        }),
      )
      : null,

    // Rail des verdicts + tests
    (story.verdicts.length > 0 || story.tests || story.final || story.storyChecks.length > 0)
      ? el('div', { class: 'story-card__verdicts' },
        story.verdicts.length > 0
          ? el('div', { class: 'verdict-rail', 'aria-label': 'Historique des verdicts' },
            ...story.verdicts.map((v, i) =>
              el('span', { class: `verdict-chip verdict-chip--${v === 'APPROUVÉ' ? 'pass' : 'changes'}` },
                `T${i + 1} · ${v}`),
            ),
          )
          : null,
        ...story.storyChecks.map(renderStoryChecks),
        story.tests ? el('p', { class: 'small muted' }, `Tests : ${story.tests}`) : null,
        story.final ? el('p', { class: 'small' }, story.final) : null,
      )
      : null,

    // Rapports développeur / relecteur dépliables
    (story.developer || story.reviewer)
      ? el('details', { class: 'story-details' },
        el('summary', null, 'Consulter la fiche complète (développeur & relecture)'),
        el('div', { class: 'story-details__body' },
          story.developer ? el('div', { class: 'story-note' },
            el('h4', null, 'Compte rendu développeur'),
            el('pre', { class: 'note-pre' }, story.developer),
          ) : null,
          story.reviewer ? el('div', { class: 'story-note' },
            el('h4', null, 'Relecture'),
            el('pre', { class: 'note-pre' }, story.reviewer),
          ) : null,
        ),
      )
      : null,
  );
}

export function renderRelais(state, actions) {
  const stories = buildStoryRelays({
    features: state.features ?? [],
    storyChecks: state.storyChecks,
    usage: state.usage,
    status: state.status,
    featureFilter: state.feature,
  });

  const waiting = stories.filter((s) => s.waitingForUser && !state.mockDecisions[s.name]);
  const others = stories.filter((s) => !s.waitingForUser || state.mockDecisions[s.name]);

  return el('div', { class: 'view-relais' },
    el('header', { class: 'view-banner' },
      el('div', null,
        el('h2', { class: 'view-banner__title' }, 'Trajectoires de relais'),
        el('p', { class: 'muted small' },
          'Chaque story relie les fiches docs/features aux appels réels et reprises de session. Cliquer une capsule ouvre sa boîte noire.'),
      ),
      el('div', { class: 'view-banner__stats mono' },
        el('span', null, `${stories.length} stories`),
        el('span', null, `${waiting.length} en attente de décision`),
      ),
    ),
    waiting.length > 0
      ? el('section', { class: 'relais-section', 'aria-label': 'Sas de décision' },
        el('h3', { class: 'section-kicker' }, 'Sas de décision — action requise'),
        el('div', { class: 'story-stack' }, ...waiting.map((s) => renderRelayCard(s, state, actions))),
      )
      : null,
    el('section', { class: 'relais-section', 'aria-label': 'Toutes les stories' },
      waiting.length > 0 ? el('h3', { class: 'section-kicker' }, 'Journal des stories') : null,
      others.length === 0 && waiting.length === 0
        ? el('div', { class: 'panel empty-state' }, 'Aucune story ou activité enregistrée pour ce filtre.')
        : el('div', { class: 'story-stack' }, ...others.map((s) => renderRelayCard(s, state, actions))),
    ),
  );
}
