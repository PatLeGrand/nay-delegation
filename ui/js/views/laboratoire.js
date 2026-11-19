// Vue « Laboratoire » : fonctionnalités prospectives en maquette avec données simulées
// et aperçu des contrats d'API documentés dans docs/maquettes.md.
import { el, mockBadge } from '../dom.js';
import { agentColor, agentLabel, formatInt, formatUsd } from '../format.js';
import { estimateMockBudget } from '../model.js';

const CONTRACTS = [
  {
    id: 'budget',
    method: 'GET',
    route: '/api/budget?feature=&since=',
    summary: 'Calcule le coût estimé en USD (entrée neuve, cache relu, sortie) et l’économie liée au cache à partir de config/pricing.json.',
    response: '{ "currency": "USD", "totalUsd": 14.82, "savedByCacheUsd": 41.20, "dailyCapUsd": 25, "byAgent": [{ "agent": "sol", "totalUsd": 9.10, "savedUsd": 28.40 }] }',
  },
  {
    id: 'simulate',
    method: 'POST',
    route: '/api/delegation/simulate',
    summary: 'Exécute chooseAgent() à blanc avec une délégation candidate, un rôle, un auteur et une liste d’indisponibles simulés.',
    response: '{ "chosen": "sonnet", "steps": [{ "agent": "sol", "status": "skipped", "reason": "Quota 5h sous le seuil" }, { "agent": "sonnet", "status": "chosen", "reason": "Premier candidat disponible" }] }',
  },
  {
    id: 'cancel',
    method: 'POST',
    route: '/api/calls/:callId/cancel',
    summary: 'Envoie SIGTERM puis SIGKILL au groupe de processus d’un appel en cours et journalise call_end avec status="cancelled".',
    response: '{ "callId": "…", "status": "cancelling", "signal": "SIGTERM" }',
  },
  {
    id: 'decision',
    method: 'POST',
    route: '/api/features/:name/decision',
    summary: 'Enregistre la décision utilisateur (« merge » ou « changes ») dans docs/features/<name>.md et retourne la fiche mise à jour.',
    response: '{ "name": "quotas", "decision": "merge", "state": "fusionnee", "updatedAt": "2026-11-19T04:00:00.000Z" }',
  },
];

export function renderLaboratoire(state, actions) {
  const budget = estimateMockBudget(state.usage);
  const runningCalls = (state.status?.calls ?? []).filter((c) => c.status === 'running');
  const demoCall = runningCalls[0] ?? {
    callId: 'demo-call-001',
    agent: 'sol',
    feature: 'exemple-maquette',
    role: 'developpeur',
    status: 'running',
  };
  const cancelled = Boolean(state.mockCancelled[demoCall.callId]);

  return el('div', { class: 'view-laboratoire' },
    el('header', { class: 'view-banner' },
      el('div', null,
        el('div', { class: 'panel__title-group' },
          el('h2', { class: 'view-banner__title' }, 'Laboratoire — fonctionnalités en maquette'),
          mockBadge('4 propositions'),
        ),
        el('p', { class: 'muted small' },
          'Ces modules fonctionnent avec des données simulées côté client. Leurs contrats d’API complets sont spécifiés dans docs/maquettes.md.'),
      ),
    ),

    el('div', { class: 'lab-grid' },
      // Maquette 1 : Budget & économies de cache
      el('section', { class: 'panel lab-card', 'aria-label': 'Maquette Budget et coût estimé' },
        el('header', { class: 'panel__head' },
          el('div', { class: 'panel__title-group' },
            el('h3', { class: 'panel__title' }, 'Budget & économies de cache'),
            mockBadge(),
          ),
          el('span', { class: 'mono muted small' }, 'GET /api/budget'),
        ),
        el('div', { class: 'budget-hero' },
          el('div', { class: 'budget-stat' },
            el('span', { class: 'muted small' }, 'Coût estimé (période)'),
            el('strong', { class: 'mono budget-val' }, formatUsd(budget.totalUsd)),
          ),
          el('div', { class: 'budget-stat' },
            el('span', { class: 'muted small' }, 'Économisé grâce au cache'),
            el('strong', { class: 'mono budget-val ok-text' }, formatUsd(budget.savedUsd)),
          ),
          el('div', { class: 'budget-stat' },
            el('span', { class: 'muted small' }, `Plafond journalier (${formatUsd(budget.budgetCapUsd)})`),
            el('strong', { class: 'mono budget-val' }, `${Math.round(budget.budgetPct)} %`),
          ),
        ),
        el('div', { class: 'meter' },
          el('div', {
            class: `meter__fill meter__fill--${budget.budgetPct > 85 ? 'danger' : budget.budgetPct > 60 ? 'warn' : 'ok'}`,
            style: { width: `${budget.budgetPct.toFixed(1)}%` },
          }),
        ),
        budget.rows.length > 0
          ? el('ul', { class: 'budget-list' },
            ...budget.rows.slice(0, 6).map((r) =>
              el('li', { class: 'budget-row' },
                el('span', null,
                  el('span', { class: 'dot-inline', style: { background: agentColor(r.agent) } }),
                  el('strong', null, agentLabel(r.agent)),
                  el('span', { class: 'mono muted small' }, ` · ${formatInt(r.calls)} appels`),
                ),
                el('span', { class: 'mono' },
                  `${formatUsd(r.totalUsd)} `,
                  el('span', { class: 'ok-text small' }, `(-${formatUsd(r.savedUsd)} cache)`),
                ),
              ),
            ),
          )
          : el('p', { class: 'muted small' }, 'Aucun appel sur la période pour estimer le coût.'),
      ),

      // Maquette 2 : Interruption d'appel en vol
      el('section', { class: 'panel lab-card', 'aria-label': 'Maquette Interruption d’appel' },
        el('header', { class: 'panel__head' },
          el('div', { class: 'panel__title-group' },
            el('h3', { class: 'panel__title' }, 'Arrêt d’urgence en vol'),
            mockBadge(),
          ),
          el('span', { class: 'mono muted small' }, 'POST /api/calls/:id/cancel'),
        ),
        el('p', { class: 'small muted' },
          'Permet d’interrompre proprement un agent bloqué sur une commande longue ou une boucle répétée sans quitter l’interface.'),
        el('div', { class: 'demo-box' },
          el('div', { class: 'demo-box__head' },
            el('span', { class: `pulse-dot ${cancelled ? 'pulse-dot--danger' : 'pulse-dot--live'}` }),
            el('strong', null, agentLabel(demoCall.agent)),
            el('span', { class: 'mono muted small' }, demoCall.feature ?? 'sans-feature'),
            !runningCalls.length ? el('span', { class: 'badge badge-muted' }, 'Appel simulé') : null,
          ),
          el('div', { class: 'demo-box__foot' },
            cancelled
              ? el('span', { class: 'danger-text small mono' }, 'SIGTERM simulé envoyé — appel marqué interrompu.')
              : el('span', { class: 'muted small' }, 'Prêt à envoyer un signal d’arrêt au groupe de processus.'),
            el('button', {
              type: 'button',
              class: cancelled ? 'btn btn-ghost btn-xs' : 'btn btn-danger btn-xs',
              onClick: () => actions.toggleMockCancel(demoCall.callId),
            }, cancelled ? 'Réinitialiser la démo' : 'Interrompre l’appel'),
          ),
        ),
      ),
    ),

    // Synthèse des contrats d'API
    el('section', { class: 'panel', 'aria-label': 'Contrats d’API proposés' },
      el('header', { class: 'panel__head' },
        el('h3', { class: 'panel__title' }, 'Contrats d’API spécifiés (docs/maquettes.md)'),
        el('button', {
          type: 'button',
          class: 'btn btn-ghost btn-xs',
          onClick: () => actions.setView('aiguillage'),
        }, 'Tester le simulateur d’aiguillage →'),
      ),
      el('div', { class: 'contract-grid' },
        ...CONTRACTS.map((c) =>
          el('article', { class: 'contract-card' },
            el('div', { class: 'contract-card__head mono' },
              el('span', { class: `method-badge method-badge--${c.method.toLowerCase()}` }, c.method),
              el('strong', null, c.route),
            ),
            el('p', { class: 'small muted' }, c.summary),
            el('pre', { class: 'code-out small' }, c.response),
          ),
        ),
      ),
    ),
  );
}
