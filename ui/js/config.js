// Configuration et constantes de l'Observatoire Orbital Nay.

export const REFRESH_MS = 15000;
export const LIVE_TICK_MS = 1000;
export const CALL_LOAD_ATTEMPTS = 5;
export const CALL_LOAD_RETRY_MS = 250;
export const CALL_LIVE_REFRESH_MS = 2000;
export const SSE_RECONNECT_MS = 5000;
export const LIVE_TAPE_LIMIT = 60;
export const OUTPUT_PREVIEW_CHARS = 240;
export const HISTOGRAM_DAYS = 14;
export const DAY_MS = 86400000;
export const SUCCESS_SAMPLE_SIZE = 20;
export const LOW_QUOTA_PCT = 25;
export const CRITICAL_QUOTA_PCT = 10;

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const THEME_KEY = 'nay-observatory-theme';
export const THEMES = ['dark', 'light'];

export const API = {
  usage: '/api/usage',
  quota: '/api/quota',
  status: '/api/status',
  features: '/api/features',
  storyChecks: '/api/story-checks',
  delegation: '/api/delegation',
  delegationPerso: '/api/delegation/perso',
  roles: '/api/roles',
  role: (id) => `/api/roles/${encodeURIComponent(id)}`,
  models: '/api/models',
  modelsRefresh: '/api/models/refresh',
  agents: '/api/agents',
  agent: (name) => `/api/agents/${encodeURIComponent(name)}`,
  stream: '/api/events/stream',
  call: (id) => `/api/calls/${encodeURIComponent(id)}`,
};

export const VIEWS = [
  { id: 'orbite', key: '1', label: 'Orbite', subtitle: 'Planétarium de vol, quotas et télémétrie en direct' },
  { id: 'relais', key: '2', label: 'Relais', subtitle: 'Trajectoires des stories, verdicts et reprises de session' },
  { id: 'chronographe', key: '3', label: 'Chronographe', subtitle: 'Frise du jour, spectre 14 jours et fiabilité' },
  { id: 'aiguillage', key: '4', label: 'Aiguillage', subtitle: 'Cascade de délégation par rôle et disponibilité' },
  { id: 'laboratoire', key: '5', label: 'Laboratoire', subtitle: 'Fonctionnalités en maquette et contrats d’API proposés' },
  { id: 'hangar', key: '6', label: 'Hangar', subtitle: 'Flotte d’agents et modèles proposés par chaque CLI' },
];
export const DEFAULT_VIEW = 'orbite';

export const PERIODS = [
  { value: 'today', label: 'Aujourd’hui (UTC)', days: 1 },
  { value: 'week', label: '7 jours', days: 7 },
  { value: 'month', label: '30 jours', days: 30 },
  { value: 'all', label: 'Tout', days: null },
];
export const DEFAULT_PERIOD = 'all';

// Signatures chromatiques et orbitales des agents.
export const AGENT_META = {
  sol: { color: '#f59e0b', glyph: '☉', provider: 'codex', label: 'Sol' },
  terra: { color: '#10b981', glyph: '♁', provider: 'codex', label: 'Terra' },
  luna: { color: '#94a3b8', glyph: '☾', provider: 'codex', label: 'Luna' },
  astra: { color: '#eab308', glyph: '✦', provider: 'codex', label: 'Astra' },
  neon: { color: '#06b6d4', glyph: '◈', provider: 'agy', label: 'Neon' },
  hydrogen: { color: '#fb7185', glyph: '◉', provider: 'agy', label: 'Hydrogen' },
  argon: { color: '#a855f7', glyph: '⬡', provider: 'agy', label: 'Argon' },
  'gemini-flash': { color: '#f97316', glyph: '⚡', provider: 'agy', label: 'Gemini Flash' },
  sonnet: { color: '#3b82f6', glyph: '♫', provider: 'claude', label: 'Sonnet' },
  haiku: { color: '#14b8a6', glyph: '◌', provider: 'claude', label: 'Haiku' },
  opus: { color: '#f5a623', glyph: '◎', provider: 'claude', label: 'Opus' },
};
export const FALLBACK_COLORS = ['#64748b', '#d97706', '#0ea5e9', '#ec4899', '#84cc16'];

export const PROVIDER_ORBITS = [
  { id: 'codex', label: 'Codex', radius: 108, color: '#f59e0b' },
  { id: 'agy', label: 'Agy', radius: 168, color: '#06b6d4' },
  { id: 'claude', label: 'Claude', radius: 222, color: '#3b82f6' },
];

export const ROLE_ALIASES = {
  dev: 'developpeur',
  developer: 'developpeur',
  reviewer: 'relecteur',
  review: 'relecteur',
  explorer: 'explorateur',
  orchestrator: 'orchestrateur',
};

export const ROLE_LABELS = {
  orchestrateur: 'Orchestrateur',
  explorateur: 'Explorateur',
  developpeur: 'Développeur',
  tachesFaciles: 'Tâches faciles',
  surAppel: 'Sur appel',
  conformite: 'Conformité au brief',
  relecteur: 'Relecteur',
};

export const PROVIDER_LABELS = { codex: 'Codex', agy: 'Antigravity (agy)', claude: 'Claude' };
export const AGENT_EFFORTS = ['low', 'medium', 'high', 'xhigh'];
export const AGENT_DEFAULT_TIMEOUT_MIN = 30;
export const AGENT_MAX_TIMEOUT_MIN = 600;
export const MODEL_VENDOR_PREFIXES = ['gpt', 'gemini', 'claude'];

export const DELEGATION_SIMPLE_ROLES = ['explorateur', 'developpeur', 'tachesFaciles', 'surAppel', 'conformite'];

export const FEATURE_STATE_LABELS = {
  en_cours: 'En cours',
  en_relecture: 'En relecture',
  attend_decision: 'Attend ta décision',
  fusionnee: 'Fusionnée',
};

export const CALL_STATUS_LABELS = {
  running: 'En vol',
  ok: 'Terminé',
  error: 'Échec',
  timeout: 'Délai dépassé',
};

export const ALERT_KIND_LABELS = {
  commande_longue: 'Commande longue',
  silence: 'Silence prolongé',
  echecs: 'Échecs répétés',
  travail_repete: 'Travail répété',
};

export const TOOL_KIND_LABELS = {
  command: 'Commande',
  read: 'Lecture',
  edit: 'Édition',
  search: 'Recherche',
  web: 'Web',
  other: 'Outil',
};

export const NO_FEATURE_LABEL = '(sans fonctionnalité)';

// Tarifs indicatifs ($ / 1M jetons) utilisés uniquement par la maquette Budget.
export const MOCK_PRICING_PER_M = {
  sol: { input: 3.0, cached: 0.3, output: 15.0 },
  terra: { input: 1.5, cached: 0.15, output: 6.0 },
  luna: { input: 0.5, cached: 0.05, output: 2.0 },
  astra: { input: 5.0, cached: 0.5, output: 20.0 },
  neon: { input: 2.5, cached: 0.25, output: 12.0 },
  hydrogen: { input: 1.25, cached: 0.12, output: 5.0 },
  argon: { input: 2.0, cached: 0.2, output: 10.0 },
  'gemini-flash': { input: 0.35, cached: 0.04, output: 1.4 },
  sonnet: { input: 3.0, cached: 0.3, output: 15.0 },
  haiku: { input: 0.8, cached: 0.08, output: 4.0 },
  default: { input: 2.0, cached: 0.2, output: 10.0 },
};

export const MOCK_DAILY_BUDGET_USD = 25;
