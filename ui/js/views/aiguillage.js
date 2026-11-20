// Vue « Aiguillage » : éditeur visuel de la délégation (glisser-déposer + clavier), enregistrée
// dans la config perso du dev ; rôles perso avec leur règle d'usage ; simulateur d'aiguillage.
import { DELEGATION_SIMPLE_ROLES, ROLE_LABELS } from '../config.js';
import { el, mockBadge } from '../dom.js';
import { agentColor, agentGlyph, agentLabel } from '../format.js';
import { simulateDelegation } from '../model.js';

function cloneDelegation(delegation) {
  return JSON.parse(JSON.stringify(delegation));
}

function renderCascadeList({ title, subtitle, list, allAgents, quotaMap, onChange, onRemoveGroup }) {
  const remaining = allAgents.filter((a) => !list.includes(a));
  let dragFrom = -1;

  // Détermine quel agent serait choisi maintenant selon les quotas réels
  const firstAvailable = list.find((a) => quotaMap.get(a)?.available !== false);

  const move = (from, to) => {
    if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const remove = (idx) => {
    const next = list.filter((_, i) => i !== idx);
    onChange(next);
  };

  const addSelect = remaining.length > 0
    ? el('select', {
      class: 'select select-xs',
      'aria-label': `Ajouter un agent à ${title}`,
      onChange: (e) => {
        const val = e.target.value;
        if (!val) return;
        onChange([...list, val]);
        e.target.value = '';
      },
    },
    el('option', { value: '' }, '+ Ajouter un agent…'),
    ...remaining.map((a) => el('option', { value: a }, agentLabel(a))))
    : null;

  return el('section', { class: 'panel cascade-card' },
    el('header', { class: 'panel__head' },
      el('div', null,
        el('h3', { class: 'panel__title' }, title),
        subtitle ? el('p', { class: 'muted small' }, subtitle) : null,
      ),
      el('div', { class: 'cascade-card__tools' },
        addSelect,
        onRemoveGroup
          ? el('button', {
            type: 'button',
            class: 'btn btn-ghost btn-xs danger-text',
            onClick: onRemoveGroup,
            title: `Supprimer la règle pour ${title}`,
          }, 'Supprimer')
          : null,
      ),
    ),
    list.length === 0
      ? el('p', { class: 'callout callout--warn small' }, 'Liste vide : ajoutez au moins un agent avant d’enregistrer.')
      : el('ol', { class: 'cascade-list' },
        ...list.map((agent, idx) => {
          const q = quotaMap.get(agent);
          const avail = q ? q.available !== false : true;
          const isWinner = agent === firstAvailable;
          return el('li', {
            class: `cascade-slot${isWinner ? ' cascade-slot--active' : ''}${!avail ? ' cascade-slot--unavail' : ''}`,
            draggable: 'true',
            onDragstart: (e) => {
              dragFrom = idx;
              e.dataTransfer.effectAllowed = 'move';
              e.currentTarget.classList.add('is-dragging');
            },
            onDragend: (e) => {
              dragFrom = -1;
              e.currentTarget.classList.remove('is-dragging');
            },
            onDragover: (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            },
            onDrop: (e) => {
              e.preventDefault();
              if (dragFrom !== -1 && dragFrom !== idx) move(dragFrom, idx);
            },
          },
            el('span', { class: 'cascade-rank mono' }, String(idx + 1)),
            el('span', { class: 'agent-tag', style: { '--agent-color': agentColor(agent) } },
              el('span', { class: 'agent-tag__glyph', 'aria-hidden': 'true' }, agentGlyph(agent)),
              agentLabel(agent),
            ),
            el('span', { class: `avail-pill ${avail ? 'avail-pill--ok' : 'avail-pill--off'}` },
              isWinner ? 'Actif' : avail ? 'Secours' : 'Sous seuil'),
            el('div', { class: 'cascade-controls' },
              el('button', {
                type: 'button',
                class: 'icon-btn',
                disabled: idx === 0,
                'aria-label': `Monter ${agentLabel(agent)} dans ${title}`,
                onClick: () => move(idx, idx - 1),
              }, '↑'),
              el('button', {
                type: 'button',
                class: 'icon-btn',
                disabled: idx === list.length - 1,
                'aria-label': `Descendre ${agentLabel(agent)} dans ${title}`,
                onClick: () => move(idx, idx + 1),
              }, '↓'),
              el('button', {
                type: 'button',
                class: 'icon-btn icon-btn--danger',
                'aria-label': `Retirer ${agentLabel(agent)} de ${title}`,
                onClick: () => remove(idx),
              }, '×'),
            ),
          );
        }),
      ),
  );
}

function renderSimulator(draft, allAgents, state, actions) {
  const sim = state.simState;
  const result = simulateDelegation(draft, {
    role: sim.role,
    author: sim.author,
    unavailable: sim.unavailable,
    quotaAgents: state.quota?.agents ?? [],
  });

  const roles = [...DELEGATION_SIMPLE_ROLES, 'relecteur', ...Object.keys(state.delegation?.roles ?? {})];

  return el('section', { class: 'panel simulator-panel', 'aria-label': 'Simulateur d’aiguillage' },
    el('header', { class: 'panel__head' },
      el('div', { class: 'panel__title-group' },
        el('h3', { class: 'panel__title' }, 'Simulateur d’aiguillage'),
        mockBadge(),
      ),
      el('span', { class: 'mono muted small' }, 'POST /api/delegation/simulate'),
    ),
    el('div', { class: 'sim-controls' },
      el('label', { class: 'field' },
        el('span', { class: 'field__label' }, 'Rôle demandé'),
        el('select', {
          class: 'select',
          value: sim.role,
          onChange: (e) => actions.updateSim({ role: e.target.value }),
        }, ...roles.map((r) => el('option', { value: r, selected: sim.role === r },
          ROLE_LABELS[r] ?? state.delegation?.roles?.[r]?.label ?? r))),
      ),
      sim.role === 'relecteur'
        ? el('label', { class: 'field' },
          el('span', { class: 'field__label' }, 'Auteur du code'),
          el('select', {
            class: 'select',
            value: sim.author,
            onChange: (e) => actions.updateSim({ author: e.target.value }),
          },
          el('option', { value: '' }, '(non précisé)'),
          ...allAgents.map((a) => el('option', { value: a, selected: sim.author === a }, agentLabel(a))),
          el('option', { value: 'orchestrateur', selected: sim.author === 'orchestrateur' }, 'Orchestrateur')))
        : null,
    ),
    el('div', { class: 'sim-toggles' },
      el('span', { class: 'field__label' }, 'Simuler des agents indisponibles :'),
      el('div', { class: 'chip-row' },
        ...allAgents.map((a) => {
          const isOff = sim.unavailable.includes(a);
          return el('button', {
            type: 'button',
            class: `chip-toggle${isOff ? ' chip-toggle--off' : ''}`,
            'aria-pressed': isOff ? 'true' : 'false',
            onClick: () => {
              const next = isOff ? sim.unavailable.filter((x) => x !== a) : [...sim.unavailable, a];
              actions.updateSim({ unavailable: next });
            },
          }, `${isOff ? '✕ ' : ''}${agentLabel(a)}`);
        }),
      ),
    ),
    el('div', { class: 'sim-result' },
      result.chosen
        ? el('div', { class: 'sim-winner' },
          el('span', { class: 'muted small' }, 'Agent sélectionné :'),
          el('span', { class: 'agent-tag', style: { '--agent-color': agentColor(result.chosen) } },
            el('span', { class: 'agent-tag__glyph', 'aria-hidden': 'true' }, agentGlyph(result.chosen)),
            agentLabel(result.chosen),
          ),
        )
        : el('p', { class: 'callout callout--danger small' }, result.error),
      el('ol', { class: 'sim-steps' },
        ...result.steps.map((step) =>
          el('li', { class: `sim-step sim-step--${step.status}` },
            el('strong', null, agentLabel(step.agent)),
            el('span', { class: 'mono small muted' }, step.reason),
          ),
        ),
      ),
    ),
  );
}

function personalNote(delegation) {
  if (!delegation?.configDir) return 'Config perso indisponible : les réglages ne peuvent pas être enregistrés.';
  const roles = delegation.personal ?? [];
  return `Tes réglages vont dans ${delegation.configDir}, jamais dans le dépôt. `
    + (roles.length ? `Rôles réglés par toi : ${roles.join(', ')}.` : 'Tu suis l’ordre du dépôt.');
}

function usageSelect({ value, usages, label, onChange, focusKey }) {
  return el('select', { class: 'select select-xs', 'aria-label': label, 'data-focus-key': focusKey, onChange },
    el('option', { value: '', selected: !value }, 'À demander par l’orchestrateur'),
    ...Object.entries(usages ?? {}).map(([key, text]) => el('option', { value: key, selected: value === key }, text)));
}

// Rôles perso : une carte d'ordre de modèles par rôle, sa règle d'usage, et le formulaire d'ajout.
function renderRoles(source, allAgents, quotaMap, state, actions, updateDraft) {
  const roles = state.delegation?.roles ?? {};
  const usages = state.delegation?.usages ?? {};
  return el('section', { class: 'relais-section' },
    el('div', { class: 'section-head-row' },
      el('h3', { class: 'section-kicker' }, 'Rôles perso'),
      state.roleForm ? null : el('button', { type: 'button', class: 'btn btn-ghost btn-xs',
        onClick: () => actions.openRoleForm() }, '+ Nouveau rôle'),
    ),
    el('p', { class: 'muted small' },
      'Ex. agent UI, agent adversaire, sécurité. Sans règle, l’orchestrateur te demandera quand les utiliser (nay guide).'),
    state.roleForm ? renderRoleForm(state, actions, allAgents, usages) : null,
    Object.keys(roles).length
      ? el('div', { class: 'cascade-grid' },
        ...Object.entries(roles).map(([id, role]) => el('div', { class: 'role-card' },
          renderCascadeList({
            title: role.label,
            subtitle: `${id} · ${role.mode === 'read' ? 'lecture seule' : 'écriture'} — ${role.description}`,
            list: source[id] ?? [],
            allAgents,
            quotaMap,
            onChange: (next) => updateDraft((d) => { d[id] = next; }),
            onRemoveGroup: () => actions.removeRole(id),
          }),
          el('label', { class: 'field role-usage' },
            el('span', { class: 'field__label' }, 'Quand l’utiliser'),
            usageSelect({ value: role.usage, usages, label: `Règle d’usage de ${role.label}`, focusKey: `usage:${id}`,
              onChange: (e) => actions.setRoleUsage(id, e.target.value) })),
        )))
      : state.roleForm ? null : el('p', { class: 'muted small' }, 'Aucun rôle perso pour l’instant.'),
  );
}

function renderRoleForm(state, actions, allAgents, usages) {
  const form = state.roleForm;
  const input = (key, label, attrs = {}) => el('label', { class: 'field' },
    el('span', { class: 'field__label' }, label),
    el(attrs.multiline ? 'textarea' : 'input', { class: attrs.multiline ? 'textarea' : 'input', value: form[key], 'data-focus-key': `role:${key}`,
      placeholder: attrs.placeholder ?? '', rows: attrs.multiline ? 3 : undefined,
      onInput: (e) => actions.editRoleForm({ [key]: e.target.value }, { silent: true }) }));
  return el('form', { class: 'panel role-form', onSubmit: (e) => { e.preventDefault(); actions.submitRole(); } },
    el('div', { class: 'role-form__grid' },
      input('id', 'Identifiant', { placeholder: 'adversaire' }),
      input('label', 'Nom affiché', { placeholder: 'Agent adversaire' }),
      input('description', 'Ce qu’il fait (lu par l’orchestrateur)', { placeholder: 'cherche les cas qui cassent le code' }),
      el('label', { class: 'field' }, el('span', { class: 'field__label' }, 'Accès'),
        el('select', { class: 'select', onChange: (e) => actions.editRoleForm({ mode: e.target.value }) },
          el('option', { value: 'read', selected: form.mode === 'read' }, 'Lecture seule'),
          el('option', { value: 'write', selected: form.mode === 'write' }, 'Écriture'))),
      el('label', { class: 'field' }, el('span', { class: 'field__label' }, 'Premier modèle'),
        el('select', { class: 'select', onChange: (e) => actions.editRoleForm({ agents: [e.target.value] }) },
          ...allAgents.map((a) => el('option', { value: a, selected: form.agents[0] === a }, agentLabel(a))))),
      el('label', { class: 'field' }, el('span', { class: 'field__label' }, 'Quand l’utiliser'),
        usageSelect({ value: form.usage, usages, label: 'Règle d’usage du nouveau rôle', focusKey: 'role:usage',
          onChange: (e) => actions.editRoleForm({ usage: e.target.value }) })),
    ),
    input('instructions', 'Consignes données à l’agent (facultatif)', { multiline: true,
      placeholder: 'Écris des tests qui font échouer le code ; ne corrige rien.' }),
    state.roleErrors.length
      ? el('div', { class: 'callout callout--danger small', role: 'alert' },
        el('ul', null, ...state.roleErrors.map((err) => el('li', null, err))))
      : null,
    el('div', { class: 'role-form__actions' },
      el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => actions.closeRoleForm() }, 'Annuler'),
      el('button', { type: 'submit', class: 'btn btn-primary', disabled: state.roleBusy },
        state.roleBusy ? 'Ajout…' : 'Ajouter le rôle')),
    el('p', { class: 'muted small' }, 'Les modèles de secours s’ajoutent ensuite sur la carte du rôle.'),
  );
}

export function renderAiguillage(state, actions) {
  const source = state.delegationDraft ?? state.delegation?.delegation;
  const allAgents = state.delegation?.agents ?? [];
  const quotaMap = new Map((state.quota?.agents ?? []).map((a) => [a.name, a]));

  if (!source) {
    return el('div', { class: 'panel empty-state' }, 'Chargement de la configuration de délégation…');
  }

  const updateDraft = (mutator) => {
    const next = cloneDelegation(source);
    mutator(next);
    actions.setDelegationDraft(next);
  };

  const authorKeys = Object.keys(source.relecteur?.selonAuteur ?? {});
  const availableAuthors = [...allAgents, 'orchestrateur'].filter((a) => !authorKeys.includes(a));

  return el('div', { class: 'view-aiguillage' },
    el('header', { class: 'view-banner' },
      el('div', null,
        el('h2', { class: 'view-banner__title' }, 'Tableau d’aiguillage'),
        el('p', { class: 'muted small' },
          'Réordonnez par glisser-déposer ou au clavier (↑/↓). Les voyants indiquent la disponibilité temps réel selon les quotas.'),
        el('p', { class: 'muted small' }, personalNote(state.delegation)),
      ),
      el('div', { class: 'view-banner__actions' },
        state.delegation?.personal?.length && !state.delegationDirty
          ? el('button', {
            type: 'button',
            class: 'btn btn-ghost',
            onClick: () => actions.resetPersonalDelegation(),
          }, 'Revenir aux valeurs du dépôt')
          : null,
        state.delegationDirty
          ? el('button', {
            type: 'button',
            class: 'btn btn-ghost',
            onClick: () => actions.resetDelegationDraft(),
          }, 'Annuler')
          : null,
        el('button', {
          type: 'button',
          class: 'btn btn-primary',
          disabled: !state.delegationDirty || state.delegationSaving,
          onClick: () => actions.saveDelegation(),
        }, state.delegationSaving ? 'Enregistrement…' : 'Enregistrer (config perso)'),
      ),
    ),

    state.delegationErrors?.length
      ? el('div', { class: 'callout callout--danger', role: 'alert' },
        el('strong', null, 'Validation refusée par le serveur :'),
        el('ul', null, ...state.delegationErrors.map((err) => el('li', null, err))),
      )
      : null,

    el('div', { class: 'cascade-grid' },
      ...DELEGATION_SIMPLE_ROLES.map((role) =>
        renderCascadeList({
          title: ROLE_LABELS[role] ?? role,
          subtitle: `Rôle « ${role} »`,
          list: source[role] ?? [],
          allAgents,
          quotaMap,
          onChange: (next) => updateDraft((d) => { d[role] = next; }),
        }),
      ),
      renderCascadeList({
        title: 'Relecteur (par défaut)',
        subtitle: 'Utilisé si aucune règle par auteur ne s’applique (l’auteur est toujours exclu)',
        list: source.relecteur?.parDefaut ?? [],
        allAgents,
        quotaMap,
        onChange: (next) => updateDraft((d) => {
          d.relecteur = d.relecteur ?? { parDefaut: [], selonAuteur: {} };
          d.relecteur.parDefaut = next;
        }),
      }),
    ),

    renderRoles(source, allAgents, quotaMap, state, actions, updateDraft),

    el('section', { class: 'relais-section' },
      el('div', { class: 'section-head-row' },
        el('h3', { class: 'section-kicker' }, 'Relecteur selon l’auteur'),
        availableAuthors.length > 0
          ? el('select', {
            class: 'select select-xs',
            'aria-label': 'Ajouter une règle de relecture pour un auteur',
            onChange: (e) => {
              const author = e.target.value;
              if (!author) return;
              const fallback = (source.relecteur?.parDefaut ?? []).filter((a) => a !== author);
              updateDraft((d) => {
                d.relecteur.selonAuteur = d.relecteur.selonAuteur ?? {};
                d.relecteur.selonAuteur[author] = fallback.length ? fallback : allAgents.filter((a) => a !== author).slice(0, 2);
              });
              e.target.value = '';
            },
          },
          el('option', { value: '' }, '+ Ajouter une règle par auteur…'),
          ...availableAuthors.map((a) => el('option', { value: a }, agentLabel(a))))
          : null,
      ),
      el('div', { class: 'cascade-grid' },
        ...authorKeys.map((author) =>
          renderCascadeList({
            title: `Si auteur = ${agentLabel(author)}`,
            subtitle: 'Liste spécifique de relecture',
            list: source.relecteur.selonAuteur[author] ?? [],
            allAgents: allAgents.filter((a) => a !== author),
            quotaMap,
            onChange: (next) => updateDraft((d) => { d.relecteur.selonAuteur[author] = next; }),
            onRemoveGroup: () => updateDraft((d) => { delete d.relecteur.selonAuteur[author]; }),
          }),
        ),
      ),
    ),

    renderSimulator(source, allAgents, state, actions),
  );
}
