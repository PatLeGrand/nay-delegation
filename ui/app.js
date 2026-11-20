// Contrôleur principal de l'Observatoire Orbital Nay.
import {
  API, CALL_LIVE_REFRESH_MS, CALL_LOAD_ATTEMPTS, CALL_LOAD_RETRY_MS,
  DEFAULT_PERIOD, DEFAULT_VIEW, LIVE_TAPE_LIMIT, LIVE_TICK_MS, PERIODS,
  REFRESH_MS, SSE_RECONNECT_MS, THEME_KEY, THEMES, VIEWS,
} from './js/config.js';
import {
  buildQuery, createAgent, deleteAgent, fetchAgents, fetchCall, fetchDelegation, fetchFeatures,
  fetchModels, fetchQuota, fetchStatus, fetchUsage, refreshModels, resumeCall, saveDelegation, updateAgent,
  resetDelegation, createRole, updateRole, deleteRole,
} from './js/api.js';
import { el, mount } from './js/dom.js';
import { computeSinceIso, formatDuration } from './js/format.js';
import { renderOrbite } from './js/views/orbite.js';
import { renderRelais } from './js/views/relais.js';
import { renderChronographe } from './js/views/chronographe.js';
import { renderAiguillage } from './js/views/aiguillage.js';
import { renderLaboratoire } from './js/views/laboratoire.js';
import { renderInspector } from './js/views/inspector.js';
import { newAgentForm, renderHangar } from './js/views/hangar.js';

const RENDERERS = {
  orbite: renderOrbite,
  relais: renderRelais,
  chronographe: renderChronographe,
  aiguillage: renderAiguillage,
  laboratoire: renderLaboratoire,
  hangar: renderHangar,
};

const state = {
  view: DEFAULT_VIEW,
  feature: '',
  period: DEFAULT_PERIOD,
  theme: 'dark',
  nowMs: Date.now(),
  selectedAgent: null,
  usageDim: 'byAgent',
  alertsExpanded: false,

  // Données API
  usage: null,
  quota: null,
  status: null,
  features: [],
  delegation: null,
  agents: null,
  models: null,
  allFeaturesList: [],
  apiErrors: {},

  // Flux temps réel
  sseState: 'connecting',
  liveEvents: [],

  // Édition délégation
  delegationDraft: null,
  delegationDirty: false,
  delegationSaving: false,
  delegationErrors: [],

  // Rôles perso : formulaire d'ajout ouvert ou non, erreurs du serveur
  roleForm: null,
  roleErrors: [],
  roleBusy: false,

  // Hangar : création et réglage des agents
  hangar: {
    adding: null,
    form: null,
    edits: {},
    busy: false,
    errors: [],
    onlyNew: false,
    refreshing: false,
  },

  // Boîte noire (inspecteur d'appel)
  inspector: {
    open: false,
    callId: null,
    loading: false,
    error: null,
    data: null,
    resumeText: '',
    resuming: false,
    resumeError: null,
  },

  // États interactifs des maquettes
  simState: { role: 'developpeur', author: '', unavailable: [] },
  mockDecisions: {},
  mockCancelled: {},
};

const dom = {
  nav: document.getElementById('main-nav'),
  featureSelect: document.getElementById('filter-feature'),
  periodSelect: document.getElementById('filter-period'),
  themeBtn: document.getElementById('theme-toggle'),
  refreshBtn: document.getElementById('refresh-btn'),
  liveBadge: document.getElementById('header-live-badge'),
  stage: document.getElementById('stage'),
  drawerRoot: document.getElementById('drawer-root'),
  toastRoot: document.getElementById('toast-root'),
};

let sseSource = null;
let sseReconnectTimer = null;
let statusDebounceTimer = null;
let inspectorRefreshTimer = null;

function notify(message, tone = 'info') {
  const toast = el('div', { class: `toast toast--${tone}`, role: 'status' }, message);
  dom.toastRoot.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast--leaving');
    setTimeout(() => toast.remove(), 220);
  }, 3600);
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  if (THEMES.includes(saved)) {
    state.theme = saved;
  } else {
    state.theme = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  applyTheme();
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  if (dom.themeBtn) {
    dom.themeBtn.textContent = state.theme === 'dark' ? '☀ Clair' : '☾ Sombre';
    dom.themeBtn.setAttribute('aria-label', state.theme === 'dark' ? 'Activer le thème clair' : 'Activer le thème sombre');
  }
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, state.theme); } catch { /* ignore */ }
  applyTheme();
}

function updateFeatureOptions() {
  const names = new Set(state.allFeaturesList);
  for (const f of state.features ?? []) if (f.name) names.add(f.name);
  for (const r of state.usage?.byFeature ?? []) if (r.key) names.add(r.key);
  for (const c of state.status?.calls ?? []) if (c.feature) names.add(c.feature);
  state.allFeaturesList = [...names].sort();

  const current = state.feature;
  mount(dom.featureSelect,
    el('option', { value: '' }, 'Toutes les fonctionnalités'),
    ...state.allFeaturesList.map((name) => el('option', { value: name, selected: name === current }, name)),
  );
  dom.featureSelect.value = current;
}

function renderNav() {
  const alertCount = state.status?.alerts?.length ?? 0;
  const waitingCount = (state.features ?? []).filter((f) => f.waitingForUser && !state.mockDecisions[f.name]).length;

  mount(dom.nav,
    ...VIEWS.map((v) => {
      const active = state.view === v.id;
      const badge = v.id === 'orbite' && alertCount > 0 ? String(alertCount)
        : v.id === 'relais' && waitingCount > 0 ? String(waitingCount)
          : null;
      return el('button', {
        type: 'button',
        class: `nav-tab${active ? ' nav-tab--active' : ''}`,
        'aria-current': active ? 'page' : null,
        title: `${v.subtitle} (touche ${v.key})`,
        onClick: () => actions.setView(v.id),
      },
      el('span', { class: 'nav-tab__key mono', 'aria-hidden': 'true' }, v.key),
      el('span', null, v.label),
      badge ? el('span', { class: 'nav-tab__badge mono' }, badge) : null);
    }),
  );
}

function renderHeaderBadge() {
  const active = (state.status?.calls ?? []).filter((c) => c.status === 'running').length;
  const alerts = state.status?.alerts?.length ?? 0;
  dom.liveBadge.className = `live-badge ${alerts > 0 ? 'live-badge--alert' : active > 0 ? 'live-badge--live' : 'live-badge--idle'}`;
  dom.liveBadge.textContent = alerts > 0
    ? `${alerts} alerte${alerts > 1 ? 's' : ''}`
    : active > 0
      ? `${active} en vol`
      : 'Flotte en veille';
}

function render() {
  state.nowMs = Date.now();
  renderNav();
  renderHeaderBadge();
  const renderer = RENDERERS[state.view] ?? renderOrbite;
  const errorBanner = Object.keys(state.apiErrors).length
    ? el('div', { class: 'callout callout--warn api-banner', role: 'status' },
      `Certaines données sont temporairement indisponibles : ${Object.values(state.apiErrors).join(' · ')}`)
    : null;
  const focus = captureFocus();
  mount(dom.stage, errorBanner, renderer(state, actions));
  restoreFocus(focus);
  renderInspector(dom.drawerRoot, state, actions);
}

// Chaque rendu reconstruit la vue : on rend le focus (et le curseur) au champ marqué
// data-focus-key pour pouvoir saisir pendant les rafraîchissements périodiques.
function captureFocus() {
  const active = document.activeElement;
  const key = active?.dataset?.focusKey;
  if (!key || !dom.stage.contains(active)) return null;
  let selection = null;
  try { selection = [active.selectionStart, active.selectionEnd]; } catch { /* champ sans sélection */ }
  return { key, selection };
}

function restoreFocus(focus) {
  if (!focus) return;
  const target = [...dom.stage.querySelectorAll('[data-focus-key]')].find((node) => node.dataset.focusKey === focus.key);
  if (!target) return;
  target.focus();
  try { if (focus.selection?.[0] != null) target.setSelectionRange(...focus.selection); } catch { /* idem */ }
}

async function refreshAll({ includeSlow = true } = {}) {
  const feature = state.feature || undefined;
  const since = computeSinceIso(state.period, Date.now());
  const tasks = [
    ['usage', fetchUsage({ feature, since })],
    ['status', fetchStatus({ feature })],
  ];
  if (includeSlow) {
    tasks.push(['features', fetchFeatures()]);
    tasks.push(['delegation', fetchDelegation()]);
    tasks.push(['quota', fetchQuota()]);
    tasks.push(['agents', fetchAgents()]);
    tasks.push(['models', fetchModels()]);
  }

  let renderQueued = false;
  const scheduleRender = () => {
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => {
      renderQueued = false;
      updateFeatureOptions();
      render();
    });
  };

  await Promise.allSettled(tasks.map(([key, promise]) =>
    promise.then((value) => {
      state[key] = value;
      delete state.apiErrors[key];
      if (key === 'delegation' && !state.delegationDirty) {
        state.delegationDraft = JSON.parse(JSON.stringify(value.delegation));
      }
      scheduleRender();
    }).catch((reason) => {
      state.apiErrors[key] = reason?.message ?? `Erreur ${key}`;
      scheduleRender();
    }),
  ));
}

function connectSse() {
  if (sseSource) {
    sseSource.close();
    sseSource = null;
  }
  clearTimeout(sseReconnectTimer);
  state.sseState = 'connecting';

  const query = buildQuery({ feature: state.feature || undefined });
  try {
    sseSource = new EventSource(`${API.stream}${query}`);
  } catch {
    state.sseState = 'closed';
    render();
    return;
  }

  sseSource.addEventListener('open', () => {
    state.sseState = 'open';
    if (state.view === 'orbite') render();
  });

  sseSource.addEventListener('agent', (event) => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    state.liveEvents.unshift(payload);
    if (state.liveEvents.length > LIVE_TAPE_LIMIT) state.liveEvents.length = LIVE_TAPE_LIMIT;

    // Si l'inspecteur est ouvert sur cet appel, on ajoute l'événement en direct.
    if (state.inspector.open && state.inspector.callId === payload.callId && state.inspector.data?.events) {
      state.inspector.data.events.push(payload);
      renderInspector(dom.drawerRoot, state, actions);
    }

    // Rafraîchit /api/status (anti-rebond court) pour tenir l'Orrery et la frise à jour.
    clearTimeout(statusDebounceTimer);
    statusDebounceTimer = setTimeout(async () => {
      try {
        state.status = await fetchStatus({ feature: state.feature || undefined });
        if (payload.kind === 'call_end') {
          state.usage = await fetchUsage({
            feature: state.feature || undefined,
            since: computeSinceIso(state.period, Date.now()),
          });
        }
        render();
      } catch { /* géré au prochain cycle */ }
    }, 350);
  });

  sseSource.addEventListener('error', () => {
    state.sseState = 'closed';
    sseSource?.close();
    sseSource = null;
    if (state.view === 'orbite') render();
    sseReconnectTimer = setTimeout(connectSse, SSE_RECONNECT_MS);
  });
}

async function loadCallWithRetry(callId) {
  for (let attempt = 0; attempt < CALL_LOAD_ATTEMPTS; attempt++) {
    try {
      return await fetchCall(callId);
    } catch (error) {
      if (error.status !== 404 || attempt === CALL_LOAD_ATTEMPTS - 1) throw error;
      await new Promise((r) => setTimeout(r, CALL_LOAD_RETRY_MS));
    }
  }
  return null;
}

function scheduleInspectorRefresh(callId) {
  clearTimeout(inspectorRefreshTimer);
  const ended = state.inspector.data?.events?.some((e) => e.kind === 'call_end');
  if (!state.inspector.open || state.inspector.callId !== callId || ended) return;
  inspectorRefreshTimer = setTimeout(async () => {
    if (!state.inspector.open || state.inspector.callId !== callId) return;
    try {
      state.inspector.data = await fetchCall(callId);
      renderInspector(dom.drawerRoot, state, actions);
      scheduleInspectorRefresh(callId);
    } catch { /* ignore */ }
  }, CALL_LIVE_REFRESH_MS);
}

// Après un changement de flotte, tout ce qui liste les agents est relu.
// Réponse du serveur après une écriture : le brouillon suit, sauf modifications en cours.
// Un rôle ajouté ou supprimé est quand même reporté dans un brouillon modifié.
function applyDelegation(res, { force = false } = {}) {
  const { ok: _ok, id: _id, ...payload } = res;
  state.delegation = payload;
  if (force || !state.delegationDirty || !state.delegationDraft) {
    state.delegationDraft = JSON.parse(JSON.stringify(payload.delegation));
    state.delegationDirty = false;
    return;
  }
  for (const key of Object.keys(state.delegationDraft)) {
    if (!(key in payload.delegation)) delete state.delegationDraft[key];
  }
  for (const [key, list] of Object.entries(payload.delegation)) {
    if (!(key in state.delegationDraft)) state.delegationDraft[key] = list;
  }
}

async function reloadFleet() {
  const [agents, models, delegation, quota] = await Promise.allSettled(
    [fetchAgents(), fetchModels(), fetchDelegation(), fetchQuota()]);
  if (agents.status === 'fulfilled') state.agents = agents.value;
  if (models.status === 'fulfilled') state.models = models.value;
  if (quota.status === 'fulfilled') state.quota = quota.value;
  if (delegation.status === 'fulfilled') {
    state.delegation = delegation.value;
    if (!state.delegationDirty) state.delegationDraft = JSON.parse(JSON.stringify(delegation.value.delegation));
  }
}

const actions = {
  setView(viewId) {
    if (!RENDERERS[viewId]) return;
    state.view = viewId;
    render();
  },

  selectAgent(agentName) {
    state.selectedAgent = agentName;
    render();
  },

  setUsageDim(dim) {
    state.usageDim = dim;
    render();
  },

  toggleAlerts() {
    state.alertsExpanded = !state.alertsExpanded;
    render();
  },

  async openCall(callId) {
    if (!callId) return;
    clearTimeout(inspectorRefreshTimer);
    state.inspector = {
      open: true,
      callId,
      loading: true,
      error: null,
      data: null,
      resumeText: '',
      resuming: false,
      resumeError: null,
    };
    renderInspector(dom.drawerRoot, state, actions);
    try {
      const data = await loadCallWithRetry(callId);
      if (state.inspector.callId !== callId) return;
      state.inspector.loading = false;
      state.inspector.data = data;
      renderInspector(dom.drawerRoot, state, actions);
      dom.drawerRoot.querySelector('.drawer__close')?.focus();
      scheduleInspectorRefresh(callId);
    } catch (error) {
      if (state.inspector.callId !== callId) return;
      state.inspector.loading = false;
      state.inspector.error = error.message ?? 'Impossible de charger cet appel.';
      renderInspector(dom.drawerRoot, state, actions);
    }
  },

  closeCall() {
    clearTimeout(inspectorRefreshTimer);
    state.inspector.open = false;
    renderInspector(dom.drawerRoot, state, actions);
  },

  setResumeText(text) {
    state.inspector.resumeText = text;
    const submitBtn = dom.drawerRoot.querySelector('.resume-box button[type="submit"]');
    if (submitBtn) submitBtn.disabled = state.inspector.resuming || !text.trim();
  },

  async submitResume() {
    const { callId, resumeText, resuming } = state.inspector;
    if (!callId || !resumeText.trim() || resuming) return;
    state.inspector.resuming = true;
    state.inspector.resumeError = null;
    renderInspector(dom.drawerRoot, state, actions);
    try {
      const res = await resumeCall(callId, resumeText.trim());
      notify('Session reprise — ouverture du nouvel appel.', 'ok');
      await actions.openCall(res.callId);
      void refreshAll({ includeSlow: false });
    } catch (error) {
      state.inspector.resuming = false;
      state.inspector.resumeError = error.message ?? 'Échec de la reprise.';
      renderInspector(dom.drawerRoot, state, actions);
    }
  },

  setDelegationDraft(next) {
    state.delegationDraft = next;
    state.delegationDirty = true;
    state.delegationErrors = [];
    render();
  },

  resetDelegationDraft() {
    if (state.delegation?.delegation) {
      state.delegationDraft = JSON.parse(JSON.stringify(state.delegation.delegation));
    }
    state.delegationDirty = false;
    state.delegationErrors = [];
    render();
  },

  async saveDelegation() {
    if (!state.delegationDraft || state.delegationSaving) return;
    state.delegationSaving = true;
    state.delegationErrors = [];
    render();
    try {
      const res = await saveDelegation(state.delegationDraft);
      applyDelegation(res, { force: true });
      state.delegationSaving = false;
      notify('Délégation enregistrée dans ta config perso.', 'ok');
      render();
    } catch (error) {
      state.delegationSaving = false;
      state.delegationErrors = error.errors?.length ? error.errors : [error.message ?? 'Erreur d’enregistrement'];
      notify('Validation de la délégation refusée.', 'danger');
      render();
    }
  },

  setHangarOnlyNew(onlyNew) {
    state.hangar.onlyNew = onlyNew;
    render();
  },

  async refreshCatalog() {
    if (state.hangar.refreshing) return;
    state.hangar.refreshing = true;
    render();
    try {
      state.models = await refreshModels();
      const failed = Object.entries(state.models.providers).filter(([, p]) => p.status !== 'ok').map(([cli]) => cli);
      notify(failed.length ? `Catalogue relu, sauf : ${failed.join(', ')}.` : 'Catalogues des CLI relus.', failed.length ? 'danger' : 'ok');
    } catch (error) {
      notify(error.message ?? 'Lecture du catalogue impossible.', 'danger');
    } finally {
      state.hangar.refreshing = false;
      render();
    }
  },

  openNewAgent(cli, entry) {
    state.hangar.adding = `${cli}:${entry.model}`;
    state.hangar.form = newAgentForm(cli, entry, Object.keys(state.agents?.agents ?? {}));
    state.hangar.errors = [];
    render();
    dom.stage.querySelector('[data-focus-key="new:name"]')?.select();
  },

  editNewAgent(patch) {
    state.hangar.form = { ...state.hangar.form, ...patch };
  },

  closeNewAgent() {
    state.hangar.adding = null;
    state.hangar.form = null;
    state.hangar.errors = [];
    render();
  },

  async submitNewAgent() {
    const form = state.hangar.form;
    if (!form || state.hangar.busy) return;
    state.hangar.busy = true;
    state.hangar.errors = [];
    render();
    try {
      const { name, cli, model, effort, timeoutMin } = form;
      await createAgent({ name, cli, model, effort, timeoutMin });
      state.hangar.adding = null;
      state.hangar.form = null;
      notify(`Agent ${name} ajouté : donnez-lui un rôle dans l’Aiguillage.`, 'ok');
      await reloadFleet();
    } catch (error) {
      state.hangar.errors = error.errors?.length ? error.errors : [error.message ?? 'Ajout impossible'];
    } finally {
      state.hangar.busy = false;
      render();
    }
  },

  editAgent(name, patch) {
    state.hangar.edits[name] = { ...state.hangar.edits[name], ...patch };
    render();
  },

  cancelAgentEdit(name) {
    delete state.hangar.edits[name];
    render();
  },

  async saveAgent(name) {
    const agent = state.agents?.agents?.[name];
    if (!agent || state.hangar.busy) return;
    state.hangar.busy = true;
    render();
    try {
      await updateAgent(name, { ...agent, ...state.hangar.edits[name] });
      delete state.hangar.edits[name];
      notify(`Agent ${name} enregistré.`, 'ok');
      await reloadFleet();
    } catch (error) {
      notify(error.errors?.length ? error.errors.join(' · ') : (error.message ?? 'Enregistrement impossible'), 'danger');
    } finally {
      state.hangar.busy = false;
      render();
    }
  },

  async resetPersonalDelegation() {
    if (!window.confirm('Revenir à l’ordre du dépôt pour tous les rôles ? Tes rôles perso gardent leurs modèles seulement s’ils viennent du dépôt.')) return;
    try {
      applyDelegation(await resetDelegation(), { force: true });
      notify('Délégation revenue aux valeurs du dépôt.', 'ok');
    } catch (error) {
      notify(error.message ?? 'Retour impossible', 'danger');
    }
    render();
  },

  openRoleForm() {
    const first = state.delegation?.agents?.[0];
    state.roleForm = { id: '', label: '', description: '', instructions: '', mode: 'read', usage: '',
      agents: first ? [first] : [] };
    state.roleErrors = [];
    render();
  },

  editRoleForm(patch, { silent = false } = {}) {
    state.roleForm = { ...state.roleForm, ...patch };
    if (!silent) render();
  },

  closeRoleForm() {
    state.roleForm = null;
    state.roleErrors = [];
    render();
  },

  async submitRole() {
    const form = state.roleForm;
    if (!form || state.roleBusy) return;
    state.roleBusy = true;
    state.roleErrors = [];
    render();
    try {
      const { usage, ...rest } = form;
      applyDelegation(await createRole({ ...rest, usage: usage || null }));
      state.roleForm = null;
      notify(`Rôle ${form.id} ajouté.${usage ? '' : ' L’orchestrateur te demandera quand l’utiliser.'}`, 'ok');
    } catch (error) {
      state.roleErrors = error.errors?.length ? error.errors : [error.message ?? 'Ajout impossible'];
    } finally {
      state.roleBusy = false;
      render();
    }
  },

  async setRoleUsage(id, usage) {
    const role = state.delegation?.roles?.[id];
    if (!role) return;
    try {
      applyDelegation(await updateRole(id, { ...role, usage: usage || null }));
      notify(`Règle de ${id} enregistrée.`, 'ok');
    } catch (error) {
      notify(error.errors?.length ? error.errors.join(' · ') : (error.message ?? 'Enregistrement impossible'), 'danger');
    }
    render();
  },

  async removeRole(id) {
    if (!window.confirm(`Supprimer le rôle ${id} et son ordre de modèles ?`)) return;
    try {
      applyDelegation(await deleteRole(id));
      notify(`Rôle ${id} supprimé.`, 'ok');
    } catch (error) {
      notify(error.message ?? 'Suppression impossible', 'danger');
    }
    render();
  },

  async removeAgent(name, { revert = false } = {}) {
    const question = revert ? `Revenir à la version du dépôt de ${name} ?` : `Retirer ${name} de ta flotte ?`;
    if (state.hangar.busy || !window.confirm(question)) return;
    state.hangar.busy = true;
    render();
    try {
      await deleteAgent(name);
      delete state.hangar.edits[name];
      notify(revert ? `${name} est revenu à la version du dépôt.` : `Agent ${name} retiré de ta flotte.`, 'ok');
      await reloadFleet();
    } catch (error) {
      notify(error.status === 409 ? `${name} est encore cité dans l’aiguillage.` : (error.message ?? 'Suppression impossible'), 'danger');
    } finally {
      state.hangar.busy = false;
      render();
    }
  },

  updateSim(patch) {
    state.simState = { ...state.simState, ...patch };
    render();
  },

  mockDecide(featureName, decision) {
    state.mockDecisions[featureName] = decision;
    notify(
      decision === 'merge'
        ? `[Maquette] Fusion simulée pour « ${featureName} ».`
        : `[Maquette] Retour en correction simulé pour « ${featureName} ».`,
      'info',
    );
    render();
  },

  toggleMockCancel(callId) {
    state.mockCancelled[callId] = !state.mockCancelled[callId];
    notify(
      state.mockCancelled[callId]
        ? '[Maquette] Signal SIGTERM simulé envoyé à l’appel.'
        : '[Maquette] État de démo réinitialisé.',
      'info',
    );
    render();
  },
};

// Initialisation des filtres & raccourcis clavier
function bindControls() {
  mount(dom.periodSelect,
    ...PERIODS.map((p) => el('option', { value: p.value, selected: p.value === state.period }, p.label)),
  );

  dom.featureSelect.addEventListener('change', (e) => {
    state.feature = e.target.value;
    connectSse();
    void refreshAll({ includeSlow: false });
  });

  dom.periodSelect.addEventListener('change', (e) => {
    state.period = e.target.value;
    void refreshAll({ includeSlow: false });
  });

  dom.themeBtn.addEventListener('click', toggleTheme);
  dom.refreshBtn.addEventListener('click', () => {
    void refreshAll({ includeSlow: true });
    notify('Données actualisées.', 'info');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.inspector.open) {
        actions.closeCall();
      } else if (state.selectedAgent) {
        actions.selectAgent(null);
      }
      return;
    }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
    const matchView = VIEWS.find((v) => v.key === e.key);
    if (matchView) {
      e.preventDefault();
      actions.setView(matchView.id);
    } else if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      toggleTheme();
    } else if (e.key === '/') {
      e.preventDefault();
      dom.featureSelect.focus();
    }
  });
}

// Horloge légère pour animer la durée des vols en cours sans re-rendre toute la page
function startLiveTick() {
  setInterval(() => {
    const now = Date.now();
    document.querySelectorAll('[data-live-since]').forEach((node) => {
      const started = Date.parse(node.dataset.liveSince);
      if (Number.isFinite(started)) node.textContent = formatDuration(Math.max(0, now - started));
    });
  }, LIVE_TICK_MS);
}

initTheme();
bindControls();
render();
void refreshAll({ includeSlow: true });
connectSse();
startLiveTick();
setInterval(() => { void refreshAll({ includeSlow: true }); }, REFRESH_MS);
