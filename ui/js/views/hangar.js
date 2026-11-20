// Vue « Hangar » : flotte d'agents (config/agents.json) et modèles proposés par chaque CLI.
import { AGENT_DEFAULT_TIMEOUT_MIN, AGENT_MAX_TIMEOUT_MIN, PROVIDER_LABELS, ROLE_LABELS } from '../config.js';
import { el } from '../dom.js';
import { agentColor, agentGlyph, agentLabel } from '../format.js';
import {
  agentChanged, countNew, defaultEffort, effortsFor, modelKey, sortedModels, suggestAgentName,
} from '../hangar-model.js';

function roleText(role) {
  const [base, , author] = role.split('.');
  const label = ROLE_LABELS[base] ?? base;
  if (role.endsWith('.parDefaut')) return `${label} (défaut)`;
  return author ? `${label} si ${agentLabel(author)}` : label;
}

function formatWhen(iso) {
  if (!iso) return 'jamais';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function effortSelect({ entry, value, label, focusKey, onChange }) {
  return el('select', { class: 'select select-xs', 'aria-label': label, dataset: { focusKey }, onChange },
    ...effortsFor(entry).map((effort) => el('option', { value: effort, selected: effort === value }, effort)));
}

function timeoutInput({ value, label, focusKey, onInput }) {
  return el('input', { class: 'input input-xs mono', type: 'number', min: '1', max: String(AGENT_MAX_TIMEOUT_MIN),
    step: '1', value: String(value), 'aria-label': label, dataset: { focusKey }, onInput });
}

function findEntry(models, agent) {
  return models?.providers?.[agent.cli]?.models?.find((entry) => entry.model === agent.model) ?? null;
}

function renderFleet(state, actions) {
  const agents = state.agents?.agents ?? {};
  const roles = state.agents?.roles ?? {};
  const { edits, busy } = state.hangar;
  const names = Object.keys(agents);

  return el('section', { class: 'panel hangar-fleet', 'aria-label': 'Flotte d’agents' },
    el('header', { class: 'panel__head' },
      el('div', null,
        el('h3', { class: 'panel__title' }, `Flotte · ${names.length} agents`),
        el('p', { class: 'muted small' }, 'Effort et délai modifiables ; un agent encore cité dans l’aiguillage ne peut pas être retiré.'),
      ),
    ),
    names.length === 0
      ? el('p', { class: 'empty-state' }, state.agents ? 'Aucun agent configuré.' : 'Chargement de la flotte…')
      : el('div', { class: 'table-scroll' }, el('table', { class: 'hangar-table' },
        el('thead', null, el('tr', null,
          ...['Agent', 'CLI', 'Modèle', 'Effort', 'Délai (min)', 'Rôles', ''].map((title) => el('th', { scope: 'col' }, title)))),
        el('tbody', null, ...names.map((name) => {
          const agent = agents[name];
          const edit = edits[name] ?? {};
          const used = roles[name] ?? [];
          const entry = findEntry(state.models, agent);
          const changed = agentChanged(agent, edit);
          const retired = state.models?.providers?.[agent.cli]?.status === 'ok' && !entry;
          return el('tr', { class: changed ? 'is-dirty' : null },
            el('td', null, el('span', { class: 'agent-tag', style: { '--agent-color': agentColor(name) } },
              el('span', { class: 'agent-tag__glyph', 'aria-hidden': 'true' }, agentGlyph(name)), agentLabel(name))),
            el('td', { class: 'mono small' }, agent.cli),
            el('td', { class: 'mono small' }, agent.model,
              retired ? el('span', { class: 'badge badge-warn hangar-badge', title: 'Ce modèle n’apparaît plus dans le catalogue du CLI' }, 'retiré') : null),
            el('td', null, effortSelect({ entry, value: edit.effort ?? agent.effort, label: `Effort de ${name}`,
              focusKey: `effort:${name}`, onChange: (e) => actions.editAgent(name, { effort: e.target.value }) })),
            el('td', null, timeoutInput({ value: edit.timeoutMin ?? agent.timeoutMin, label: `Délai de ${name} en minutes`,
              focusKey: `timeout:${name}`, onInput: (e) => actions.editAgent(name, { timeoutMin: Number(e.target.value) }, { silent: true }) })),
            el('td', null, used.length
              ? el('div', { class: 'chip-row hangar-roles' }, ...used.map((role) => el('span', { class: 'chip' }, roleText(role))))
              : el('span', { class: 'muted small' }, 'aucun')),
            el('td', { class: 'hangar-actions' },
              changed ? el('button', { type: 'button', class: 'btn btn-primary btn-xs', disabled: busy,
                onClick: () => actions.saveAgent(name) }, 'Enregistrer') : null,
              changed ? el('button', { type: 'button', class: 'btn btn-ghost btn-xs', disabled: busy,
                onClick: () => actions.cancelAgentEdit(name) }, 'Annuler') : null,
              el('button', { type: 'button', class: 'icon-btn icon-btn--danger', disabled: busy || used.length > 0,
                title: used.length ? `Retirez d’abord ${name} de l’aiguillage` : `Retirer ${name} de la flotte`,
                'aria-label': `Retirer ${name} de la flotte`, onClick: () => actions.removeAgent(name) }, '×')),
          );
        })),
      )),
  );
}

function renderAddForm(cli, entry, state, actions) {
  const form = state.hangar.form;
  return el('form', { class: 'hangar-add', onSubmit: (e) => { e.preventDefault(); actions.submitNewAgent(); } },
    el('label', { class: 'field' }, el('span', { class: 'field__label' }, 'Nom de l’agent'),
      el('input', { class: 'input input-xs mono', value: form.name, required: true, maxLength: 32,
        pattern: '[a-z][a-z0-9.\\-]*', dataset: { focusKey: 'new:name' }, 'aria-label': 'Nom du nouvel agent',
        onInput: (e) => actions.editNewAgent({ name: e.target.value }) })),
    el('label', { class: 'field' }, el('span', { class: 'field__label' }, 'Effort'),
      effortSelect({ entry, value: form.effort, label: 'Effort du nouvel agent', focusKey: 'new:effort',
        onChange: (e) => actions.editNewAgent({ effort: e.target.value }) })),
    el('label', { class: 'field' }, el('span', { class: 'field__label' }, 'Délai (min)'),
      timeoutInput({ value: form.timeoutMin, label: 'Délai du nouvel agent en minutes', focusKey: 'new:timeout',
        onInput: (e) => actions.editNewAgent({ timeoutMin: Number(e.target.value) }) })),
    el('div', { class: 'hangar-add__buttons' },
      el('button', { type: 'submit', class: 'btn btn-primary btn-xs', disabled: state.hangar.busy },
        state.hangar.busy ? 'Ajout…' : 'Ajouter à la flotte'),
      el('button', { type: 'button', class: 'btn btn-ghost btn-xs', onClick: () => actions.closeNewAgent() }, 'Annuler')),
    state.hangar.errors.length
      ? el('ul', { class: 'callout callout--danger small hangar-errors', role: 'alert' },
        ...state.hangar.errors.map((error) => el('li', null, error)))
      : null,
  );
}

function renderModel(cli, entry, state, actions) {
  const key = modelKey(cli, entry.model);
  const open = state.hangar.adding === key;
  const isNew = !entry.usedBy?.length;
  return el('li', { class: `model-row${isNew ? ' model-row--new' : ''}${open ? ' model-row--open' : ''}` },
    el('div', { class: 'model-row__main' },
      el('div', { class: 'model-row__id' },
        el('strong', null, entry.label),
        el('span', { class: 'mono small muted' }, entry.model),
      ),
      el('div', { class: 'model-row__meta' },
        entry.efforts.length
          ? el('span', { class: 'mono small muted', title: 'Niveaux d’effort proposés' }, entry.efforts.join(' · '))
          : el('span', { class: 'small muted' }, 'effort fixe'),
        isNew
          ? el('span', { class: 'badge badge-accent' }, 'nouveau')
          : el('span', { class: 'small muted' }, 'utilisé par ',
            ...entry.usedBy.flatMap((name, index) => [index ? ', ' : null, el('strong', null, agentLabel(name))])),
        open ? null : el('button', { type: 'button', class: `btn btn-xs ${isNew ? 'btn-primary' : 'btn-ghost'}`,
          'aria-label': `Créer un agent avec ${entry.model}`,
          onClick: () => actions.openNewAgent(cli, entry) }, isNew ? 'Ajouter' : 'Autre agent'),
      ),
    ),
    entry.description ? el('p', { class: 'small muted model-row__desc' }, entry.description) : null,
    open ? renderAddForm(cli, entry, state, actions) : null,
  );
}

function renderProvider(cli, provider, state, actions) {
  const models = sortedModels(provider, { onlyNew: state.hangar.onlyNew });
  const fresh = provider.models.filter((entry) => !entry.usedBy?.length).length;
  return el('section', { class: 'panel model-provider', 'aria-label': `Modèles ${PROVIDER_LABELS[cli] ?? cli}` },
    el('header', { class: 'panel__head' },
      el('div', null,
        el('h3', { class: 'panel__title' }, PROVIDER_LABELS[cli] ?? cli),
        el('p', { class: 'muted small' },
          `${provider.models.length} modèles · ${fresh} nouveaux · lu ${formatWhen(provider.fetchedAt)}`,
          cli === 'claude' ? ' · liste fixe (config/models.json)' : ''),
      ),
      provider.status === 'ok'
        ? el('span', { class: 'avail-pill avail-pill--ok' }, 'catalogue à jour')
        : el('span', { class: 'avail-pill avail-pill--off', title: provider.reason }, provider.stale ? 'périmé' : 'illisible'),
    ),
    provider.status !== 'ok'
      ? el('p', { class: 'callout callout--warn small' }, `Lecture impossible : ${provider.reason}`,
        provider.stale ? ' — affichage du dernier catalogue connu.' : '')
      : null,
    models.length
      ? el('ul', { class: 'model-list' }, ...models.map((entry) => renderModel(cli, entry, state, actions)))
      : el('p', { class: 'muted small' }, state.hangar.onlyNew ? 'Aucun nouveau modèle.' : 'Aucun modèle.'),
  );
}

export function renderHangar(state, actions) {
  const { models } = state;
  const fresh = countNew(models);
  return el('div', { class: 'view-hangar' },
    el('header', { class: 'view-banner' },
      el('div', null,
        el('h2', { class: 'view-banner__title' }, 'Hangar'),
        el('p', { class: 'muted small' },
          'Catalogue relu à chaque démarrage de nay ui. Un agent ajouté ici apparaît aussitôt dans l’Aiguillage, où lui donner un rôle.'),
      ),
      el('div', { class: 'view-banner__actions' },
        el('label', { class: 'hangar-toggle small' },
          el('input', { type: 'checkbox', checked: state.hangar.onlyNew, onChange: (e) => actions.setHangarOnlyNew(e.target.checked) }),
          `Nouveaux seulement (${fresh})`),
        el('button', { type: 'button', class: 'btn btn-ghost', disabled: state.hangar.refreshing || models?.refreshing,
          onClick: () => actions.refreshCatalog() },
        state.hangar.refreshing || models?.refreshing ? 'Lecture des CLI…' : '↻ Relire les catalogues'),
      ),
    ),
    renderFleet(state, actions),
    el('h3', { class: 'section-kicker hangar-kicker' }, 'Modèles disponibles'),
    models
      ? el('div', { class: 'model-grid' },
        ...Object.entries(models.providers).map(([cli, provider]) => renderProvider(cli, provider, state, actions)))
      : el('div', { class: 'panel empty-state' }, 'Lecture du catalogue des modèles…'),
  );
}

export function newAgentForm(cli, entry, existing) {
  return { cli, model: entry.model, name: suggestAgentName(entry.model, existing),
    effort: defaultEffort(entry), timeoutMin: AGENT_DEFAULT_TIMEOUT_MIN };
}
