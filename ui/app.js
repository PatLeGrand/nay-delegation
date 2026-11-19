import { getJson } from './js/api.js';
import {
  API, DEFAULT_VIEW, LIVE_REFRESH_MIN_MS, REFRESH_MS, RETRY_MS, SSE_RECONNECT_MS, VIEWS,
  THEME_KEY, THEMES, PERIODS, DEFAULT_PERIOD, DAY_MS, VIEW_DESCRIPTIONS, NAV_ICONS, VIEW_DEPENDENCIES, DATA_LABELS,
} from './js/config.js';
import { el, replaceContent, icon, loadingState, errorState } from './js/dom.js';
import { renderDashboard } from './js/views/dashboard.js';
import { renderDecide, renderFeatures } from './js/views/features.js';
import { renderLive } from './js/views/live.js';
import { loadSettings } from './js/views/settings.js';
import { renderTimeline } from './js/views/timeline.js';
import { renderStandup } from './js/views/standup.js';
import { renderReliability } from './js/views/reliability.js';

const data = { usage: null, quota: null, status: null, features: null, delegation: null };
const errors = {};
const $ = (id) => document.getElementById(id);
let feature = '';
let period = DEFAULT_PERIOD;
let generation = 0;
let refreshTimer;
let statusTimer;
let lastStatusAt = 0;
let source;
let streamTimer;
let settingsLoaded = false;

function sinceDate() {
  const days = PERIODS.find((item) => item.value === period)?.days;
  if (!days) return null;
  const today = new Date().setUTCHours(0, 0, 0, 0);
  return new Date(today - (days - 1) * DAY_MS).toISOString();
}

function filteredPath(path, includeSince = true) {
  const params = new URLSearchParams();
  if (feature) params.set('feature', feature);
  const since = sinceDate();
  if (includeSince && since) params.set('since', since);
  return `${path}${params.size ? `?${params}` : ''}`;
}

function currentView() {
  const id = location.hash.slice(1);
  return VIEWS.some((v) => v.id === id) ? id : DEFAULT_VIEW;
}

function showView() {
  const active = currentView();
  for (const { id } of VIEWS) {
    $(`view-${id}`).hidden = id !== active;
    const tab = $(`tab-${id}`);
    if (id === active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  const title = VIEWS.find((v) => v.id === active).label;
  $('view-title').textContent = title;
  $('view-description').textContent = VIEW_DESCRIPTIONS[active];
  document.title = `Nay — ${title}`;
  if (active === 'settings' && !settingsLoaded) {
    settingsLoaded = true;
    loadSettings($('view-settings'));
  }
}

function buildFilters() {
  const features = el('select', { attrs: { id: 'filter-feature' }, on: { change: () => { feature = features.value; changeFilters(); } } },
    el('option', { text: 'Toutes les fonctionnalités', attrs: { value: '' } }));
  const periods = el('select', { attrs: { id: 'filter-period' }, on: { change: () => { period = periods.value; changeFilters(); } } },
    PERIODS.map(({ value, label }) => el('option', { text: label, attrs: { value, selected: value === period } })));
  $('filters').append(
    el('label', {}, 'Fonctionnalité', features), el('label', {}, 'Période', periods));
}

// Conserver les options même lorsque la réponse courante est filtrée.
const featureNames = new Set();
function updateFeatureOptions() {
  for (const f of data.features ?? []) featureNames.add(f.name);
  for (const row of data.usage?.byFeature ?? []) if (row.key) featureNames.add(row.key);
  for (const call of data.status?.calls ?? []) if (call.feature) featureNames.add(call.feature);
  const select = $('filter-feature');
  const existing = new Set([...select.options].map((o) => o.value));
  for (const name of [...featureNames].sort()) if (!existing.has(name)) select.append(el('option', { text: name, attrs: { value: name } }));
  select.value = feature;
}

function renderAll() {
  updateFeatureOptions();
  const features = feature ? data.features?.filter((f) => f.name === feature) : data.features;
  renderDecide($('decide'), features);
  const renderers = {
    standup: () => renderStandup($('view-standup'), data),
    dashboard: () => renderDashboard($('view-dashboard'), data),
    features: () => renderFeatures($('view-features'), features, data.usage, data.status),
    live: () => renderLive($('view-live'), data.status),
    timeline: () => renderTimeline($('view-timeline'), data.status),
    reliability: () => renderReliability($('view-reliability'), data.usage),
  };
  for (const [id, render] of Object.entries(renderers)) {
    render();
    for (const key of VIEW_DEPENDENCIES[id]) {
      if (errors[key]) $(`view-${id}`).prepend(errorState(`${DATA_LABELS[key]} : ${errors[key]}`, refreshAll));
    }
  }
}

async function fetchInto(key, path, version) {
  try {
    let result = await getJson(path);
    if (version !== generation) return true;
    if (key === 'status' && sinceDate()) {
      const since = Date.parse(sinceDate());
      result = { ...result, calls: result.calls.filter((c) => Date.parse(c.startedAt) >= since) };
      const ids = new Set(result.calls.map((c) => c.callId));
      result.alerts = result.alerts.filter((a) => ids.has(a.callId));
    }
    data[key] = result;
    delete errors[key];
    return true;
  } catch (error) {
    if (version !== generation) return false;
    errors[key] = error.message;
    return !error.unreachable;
  }
}

async function refreshAll() {
  clearTimeout(refreshTimer);
  const version = generation;
  const results = await Promise.all([
    fetchInto('usage', filteredPath(API.usage), version), fetchInto('quota', API.quota, version),
    fetchInto('status', filteredPath(API.status), version), fetchInto('features', API.features, version),
    fetchInto('delegation', API.delegation, version),
  ]);
  if (version !== generation) return;
  const reachable = results.some(Boolean);
  $('banner').hidden = reachable;
  renderAll();
  refreshTimer = setTimeout(refreshAll, reachable ? REFRESH_MS : RETRY_MS);
}

async function refreshStatus() {
  lastStatusAt = Date.now();
  const version = generation;
  await fetchInto('status', filteredPath(API.status), version);
  await fetchInto('usage', filteredPath(API.usage), version);
  if (version === generation) renderAll();
}

function scheduleStatusRefresh() {
  if (statusTimer) return;
  const wait = Math.max(0, LIVE_REFRESH_MIN_MS - (Date.now() - lastStatusAt));
  statusTimer = setTimeout(() => { statusTimer = null; refreshStatus(); }, wait);
}

function setLiveIndicator(connected) {
  $('live-indicator').textContent = connected ? 'En direct' : 'Reconnexion…';
  $('live-indicator').dataset.state = connected ? 'on' : 'off';
}

function connectStream() {
  clearTimeout(streamTimer);
  source?.close();
  setLiveIndicator(false);
  const current = new EventSource(filteredPath(API.stream, false));
  source = current;
  current.addEventListener('open', () => { if (source === current) setLiveIndicator(true); });
  current.addEventListener('agent', scheduleStatusRefresh);
  current.addEventListener('error', () => {
    if (source !== current) return;
    setLiveIndicator(false);
    if (current.readyState === EventSource.CLOSED) streamTimer = setTimeout(connectStream, SSE_RECONNECT_MS);
  });
}

function changeFilters() {
  generation++;
  clearTimeout(statusTimer);
  statusTimer = null;
  for (const key of ['usage', 'status']) { data[key] = null; delete errors[key]; }
  for (const { id } of VIEWS) if (id !== 'settings') replaceContent($(`view-${id}`), loadingState());
  connectStream();
  refreshAll();
}

function setupTheme() {
  let theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (THEMES.includes(saved)) theme = saved;
  } catch { /* Le navigateur peut refuser le stockage local. */ }
  const apply = () => {
    document.documentElement.dataset.theme = theme;
    $('theme-toggle').textContent = theme === 'dark' ? '☀ Thème clair' : '☾ Thème sombre';
    $('theme-toggle').setAttribute('aria-label', `Activer le thème ${theme === 'dark' ? 'clair' : 'sombre'}`);
  };
  $('theme-toggle').addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* Stockage facultatif. */ }
    apply();
  });
  apply();
}

setupTheme();
$('tabs').append(...VIEWS.map(({ id, label }) => el('a', { attrs: { href: `#${id}`, id: `tab-${id}` } }, icon(NAV_ICONS[id]), el('span', { text: label }))));
buildFilters();
for (const { id } of VIEWS) replaceContent($(`view-${id}`), loadingState());
showView();
window.addEventListener('hashchange', showView);
connectStream();
refreshAll();
