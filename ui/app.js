import { getJson } from './js/api.js';
import {
  API, DEFAULT_VIEW, LIVE_REFRESH_MIN_MS, REFRESH_MS, RETRY_MS, SSE_RECONNECT_MS, VIEWS,
} from './js/config.js';
import { el, replaceContent } from './js/dom.js';
import { renderDashboard } from './js/views/dashboard.js';
import { renderDecide, renderFeatures } from './js/views/features.js';
import { renderLive } from './js/views/live.js';
import { loadSettings } from './js/views/settings.js';
import { renderTimeline } from './js/views/timeline.js';

const data = { usage: null, quota: null, status: null, features: null };
const $ = (id) => document.getElementById(id);

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
  if (active === 'settings') loadSettings($('view-settings'));
}

function buildTabs() {
  $('tabs').append(...VIEWS.map(({ id, label }) => el('a', { text: label, attrs: { href: `#${id}`, id: `tab-${id}` } })));
}

function renderAll() {
  renderDecide($('decide'), data.features);
  renderDashboard($('view-dashboard'), data);
  renderFeatures($('view-features'), data.features);
  renderLive($('view-live'), data.status);
  renderTimeline($('view-timeline'), data.status);
}

function setBanner(visible) {
  $('banner').hidden = !visible;
}

function setLiveIndicator(connected) {
  $('live-indicator').textContent = connected ? 'Flux en direct : connecté' : 'Flux en direct : reconnexion…';
  $('live-indicator').dataset.state = connected ? 'on' : 'off';
}

async function fetchInto(key, path) {
  try {
    data[key] = await getJson(path);
    return true;
  } catch (error) {
    if (!error.unreachable) data[key] = null;
    return !error.unreachable;
  }
}

let refreshTimer = null;

async function refreshAll() {
  clearTimeout(refreshTimer);
  const results = await Promise.all([
    fetchInto('usage', API.usage), fetchInto('quota', API.quota),
    fetchInto('status', API.status), fetchInto('features', API.features),
  ]);
  const reachable = results.some(Boolean);
  setBanner(!reachable);
  if (reachable) renderAll();
  refreshTimer = setTimeout(refreshAll, reachable ? REFRESH_MS : RETRY_MS);
}

let lastStatusAt = 0;
let statusTimer = null;

async function refreshStatus() {
  lastStatusAt = Date.now();
  if (await fetchInto('status', API.status)) {
    setBanner(false);
    renderLive($('view-live'), data.status);
    renderTimeline($('view-timeline'), data.status);
  }
}

// Limite la fréquence : un appel immédiat, puis au plus un par intervalle.
function scheduleStatusRefresh() {
  if (statusTimer) return;
  const wait = Math.max(0, LIVE_REFRESH_MIN_MS - (Date.now() - lastStatusAt));
  statusTimer = setTimeout(() => { statusTimer = null; refreshStatus(); }, wait);
}

function connectStream() {
  const source = new EventSource(API.stream);
  source.addEventListener('open', () => setLiveIndicator(true));
  source.addEventListener('agent', scheduleStatusRefresh);
  source.addEventListener('error', () => {
    setLiveIndicator(false);
    if (source.readyState === EventSource.CLOSED) setTimeout(connectStream, SSE_RECONNECT_MS);
  });
}

// Le premier relevé des quotas peut prendre quelques secondes : la page ne doit pas paraître vide.
function showLoading() {
  for (const { id } of VIEWS) replaceContent($(`view-${id}`), el('p', { class: 'muted', text: 'Chargement…' }));
}

function start() {
  buildTabs();
  showLoading();
  showView();
  window.addEventListener('hashchange', showView);
  setLiveIndicator(false);
  connectStream();
  refreshAll();
}

start();
