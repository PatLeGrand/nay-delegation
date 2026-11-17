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
  { id: 'dashboard', label: 'Tableau de bord' },
  { id: 'features', label: 'Fonctionnalités' },
  { id: 'live', label: 'Agents en direct' },
  { id: 'timeline', label: 'Frise' },
  { id: 'settings', label: 'Paramètres' },
];
export const DEFAULT_VIEW = 'dashboard';

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
