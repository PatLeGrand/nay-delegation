// Toutes les constantes de la page au même endroit.

export const REFRESH_MS = 15000;
export const CALL_LOAD_ATTEMPTS = 5;
export const CALL_LOAD_RETRY_MS = 200;
export const CALL_LIVE_REFRESH_MS = 2000;
export const RETRY_MS = 5000;
export const LIVE_REFRESH_MIN_MS = 2000;
export const SSE_RECONNECT_MS = 5000;
export const RECENT_CALLS_LIMIT = 50;
export const OUTPUT_PREVIEW_CHARS = 200;
export const TIMELINE_TICKS = 5;
export const TIMELINE_MIN_BAR_PCT = 0.6;

export const API = {
  usage: '/api/usage',
  quota: '/api/quota',
  status: '/api/status',
  features: '/api/features',
  delegation: '/api/delegation',
  stream: '/api/events/stream',
  call: (id) => `/api/calls/${encodeURIComponent(id)}`,
};

export const VIEWS = [
  { id: 'standup', label: 'Standup' },
  { id: 'dashboard', label: 'Consommation' },
  { id: 'features', label: 'Stories / fonctionnalités' },
  { id: 'live', label: 'Direct' },
  { id: 'timeline', label: 'Frise' },
  { id: 'reliability', label: 'Fiabilité' },
  { id: 'settings', label: 'Paramètres' },
];
export const DEFAULT_VIEW = 'standup';

// Couleurs de la frise et des pastilles d'agent (lisibles en thème clair et sombre).
export const AGENT_COLORS = {
  sol: '#2a7de1',
  terra: '#2f9e5b',
  hydrogen: '#d9822b',
  luna: '#8e5bd1',
  argon: '#c2477f',
  sonnet: '#b8860b',
  haiku: '#7a8a3a',
  'gemini-flash': '#d4513d',
  opus: '#5b6bd1',
};
export const AGENT_FALLBACK_COLORS = ['#6c7a89', '#a0522d', '#4682b4', '#9b870c', '#7b4fa3'];

// Ordre d'affichage de l'arbre ; les alias couvrent les valeurs libres de `--role`.
export const ROLE_TREE = [
  { id: 'orchestrateur', label: 'Orchestrateur' },
  { id: 'explorateur', label: 'Explorateur' },
  { id: 'developpeur', label: 'Développeur' },
  { id: 'relecteur', label: 'Relecteur' },
];
export const ROLE_ALIASES = {
  dev: 'developpeur',
  developer: 'developpeur',
  reviewer: 'relecteur',
  review: 'relecteur',
  explorer: 'explorateur',
  orchestrator: 'orchestrateur',
};
export const OTHER_ROLES_LABEL = 'Autres rôles';
export const NO_FEATURE_LABEL = '(sans fonctionnalité)';

export const FEATURE_STATE_LABELS = {
  en_cours: 'En cours',
  en_relecture: 'En relecture',
  attend_decision: 'Attend ta décision',
  fusionnee: 'Fusionnée',
};

export const CALL_STATUS_LABELS = {
  running: 'en cours',
  ok: 'terminé',
  error: 'échec',
  timeout: 'délai dépassé',
};

export const ALERT_KIND_LABELS = {
  commande_longue: 'Commande longue',
};

export const DELEGATION_ROLE_LABELS = {
  explorateur: 'Explorateur',
  developpeur: 'Développeur',
  tachesFaciles: 'Tâches faciles',
  surAppel: 'Sur appel',
  relecteur: 'Relecteur',
};

export const USAGE_GROUPS = [
  { key: 'byAgent', title: 'Par agent' },
  { key: 'byModel', title: 'Par modèle' },
  { key: 'byFeature', title: 'Par fonctionnalité' },
  { key: 'byRole', title: 'Par rôle' },
];

export const THEME_KEY = 'nay-theme';
export const THEMES = ['dark', 'light'];
export const DAY_MS = 86400000;
export const HISTOGRAM_DAYS = 14;
export const STANDUP_RECENT_LIMIT = 10;
export const SUCCESS_SAMPLE_SIZE = 20;
export const RECENT_FAILURE_MS = 86400000;
export const LOW_QUOTA_PCT = 20;
export const PERIODS = [
  { value: 'today', label: 'Aujourd’hui (UTC)', days: 1 },
  { value: 'week', label: '7 jours', days: 7 },
  { value: 'month', label: '30 jours', days: 30 },
  { value: 'all', label: 'Tout', days: null },
];
export const DEFAULT_PERIOD = 'all';
export const VIEW_DESCRIPTIONS = {
  standup: 'L’équipe, son activité et ses derniers résultats.',
  dashboard: 'Les jetons et le temps consacrés à vos projets.',
  features: 'Suivez les passages de relais, du développement à la correction.',
  live: 'Les outils et les appels suivis en temps réel, aujourd’hui.',
  timeline: 'Le déroulement des appels d’aujourd’hui, par fonctionnalité.',
  reliability: 'Les résultats et les causes d’échec sur la période sélectionnée.',
  settings: 'Définissez l’ordre des agents pour chaque rôle.',
};
export const NAV_ICONS = {
  standup: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  dashboard: ['M4 20V10', 'M12 20V4', 'M20 20v-7'],
  features: ['M4 4h6v6H4z', 'M14 14h6v6h-6z', 'M7 10v7h7', 'M10 7h7v7'],
  live: ['M2 12h4l3-8 6 16 3-8h4'],
  timeline: ['M4 5h10', 'M8 12h12', 'M4 19h8'],
  reliability: ['M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z', 'M8 12l3 3 5-6'],
  settings: ['M4 6h16', 'M4 12h16', 'M4 18h16', 'M8 3v6', 'M16 9v6', 'M10 15v6'],
};
export const SVG_NS = 'http://www.w3.org/2000/svg';

export const SKELETON_COUNT = 3;
export const DATA_LABELS = { usage: 'Consommation', quota: 'Quotas', status: 'Direct', features: 'Fiches', delegation: 'Délégation' };
export const VIEW_DEPENDENCIES = {
  standup: ['quota', 'usage', 'status', 'delegation'], dashboard: ['usage', 'quota'],
  features: ['features', 'usage', 'status'], live: ['status'], timeline: ['status'], reliability: ['usage'],
};
export const STORY_ROLE_LABELS = {
  developpeur: 'Développement', relecteur: 'Revue', explorateur: 'Exploration', orchestrateur: 'Orchestration',
};
