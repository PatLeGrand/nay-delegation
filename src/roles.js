// Rôles ajoutés par le dev (adversaire, sécurité, UI…) et règle d'usage que l'orchestrateur suit.
import { readConfig } from './config.js';

// Rôles intégrés : leur comportement ne change pas, ils n'ont pas de règle d'usage.
export const BUILTIN_ROLES = {
  explorateur: 'lit le code et rapporte, en lecture seule',
  developpeur: 'écrit le code (nay story)',
  tachesFaciles: 'tâches de code simples',
  surAppel: 'secours sur demande explicite',
  relecteur: 'relit le travail d’un autre modèle (nay story)',
};

export const USAGES = {
  toujours: 'Toujours',
  'sur-demande': 'Seulement quand je le demande',
  proposer: 'Me le proposer après',
};

export const MODES = ['read', 'write'];
const ID = /^[a-z][a-z0-9-]{1,31}$/;
const FIELDS = ['label', 'description', 'instructions', 'mode', 'usage'];
const MAX_TEXT = 4000;

function text(value, field, errors, { required = true } = {}) {
  if (value === undefined && !required) return;
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > MAX_TEXT) {
    errors.push(`${field} : texte${required ? ' non vide' : ''} de ${MAX_TEXT} caractères au plus`);
  }
}

export function validateRoleId(id) {
  if (typeof id !== 'string' || !ID.test(id)) {
    return ['Identifiant invalide : minuscules, chiffres ou « - », 2 à 32 caractères'];
  }
  if (Object.hasOwn(BUILTIN_ROLES, id) || id === 'orchestrateur') return [`${id} est un rôle intégré`];
  return [];
}

export function validateRole(role) {
  if (!role || typeof role !== 'object' || Array.isArray(role)) return ['Rôle invalide'];
  const errors = [];
  const extra = Object.keys(role).filter((key) => !FIELDS.includes(key));
  if (extra.length) errors.push(`Champs inconnus : ${extra.join(', ')}`);
  text(role.label, 'label', errors);
  text(role.description, 'description', errors);
  text(role.instructions, 'instructions', errors, { required: false });
  if (!MODES.includes(role.mode)) errors.push('mode : read (lecture seule) ou write');
  if (role.usage !== null && role.usage !== undefined && !Object.hasOwn(USAGES, role.usage)) {
    errors.push(`usage : ${Object.keys(USAGES).join(', ')} ou null (à demander)`);
  }
  return errors;
}

export function validateRoles(roles) {
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) return ['Les rôles doivent être un objet'];
  return Object.entries(roles).flatMap(([id, role]) =>
    [...validateRoleId(id), ...validateRole(role)].map((error) => `rôle ${id} : ${error}`));
}

export function loadRoles() {
  const roles = readConfig('roles');
  const errors = validateRoles(roles);
  if (errors.length) throw new Error(`Rôles invalides :\n${errors.join('\n')}`);
  return roles;
}

export function getRole(id, roles = loadRoles()) {
  if (!Object.hasOwn(roles, id)) throw new Error(`Rôle inconnu : ${id} (rôles perso : ${Object.keys(roles).join(', ') || 'aucun'})`);
  return roles[id];
}

// Consigne ajoutée au brief : le rôle dit à l'agent ce qu'on attend de lui.
export function rolePrompt(role, brief) {
  const instructions = role.instructions?.trim() ? `\n${role.instructions.trim()}` : '';
  return `Tu interviens comme « ${role.label} » : ${role.description.trim()}${instructions}\n\n---\n${brief}`;
}

function usageLine(id, role) {
  const run = `nay role ${id} <brief> --cwd <projet>${role.mode === 'read' ? ' --diff HEAD' : ''}`;
  if (role.usage === 'toujours') return `Toujours : lance-le à chaque travail concerné, sans demander (${run}).`;
  if (role.usage === 'sur-demande') return 'Seulement quand l’utilisateur le demande explicitement.';
  if (role.usage === 'proposer') return `Après le travail concerné, propose-le en une ligne ; lance-le s’il accepte (${run}).`;
  return 'Règle pas encore fixée : ne le lance pas, pose d’abord la question ci-dessous.';
}

// Texte lu par l'orchestrateur en début de session : rôles, règles, et questions à poser.
export function formatGuide(roles, delegation) {
  const lines = ['# Nay — consignes pour l’orchestrateur', '',
    'Comportement par défaut, inchangé : code courant → `nay story <brief> --cwd <projet> --feature <nom>`',
    '(développeur puis relecteur d’un autre modèle). Rôles intégrés :',
    ...Object.entries(BUILTIN_ROLES).map(([id, what]) => `- ${id} : ${what}`)];
  const custom = Object.entries(roles);
  if (!custom.length) {
    lines.push('', 'Aucun rôle perso. L’utilisateur peut en ajouter dans l’interface (`nay ui`, Aiguillage).');
    return `${lines.join('\n')}\n`;
  }
  lines.push('', '## Rôles perso de l’utilisateur', '');
  for (const [id, role] of custom) {
    const models = delegation[id]?.length ? delegation[id].join(' → ') : 'aucun modèle (à choisir dans Aiguillage)';
    lines.push(`- **${id}** — ${role.label} (${role.mode === 'read' ? 'lecture seule' : 'écriture'}, ${models})`,
      `  ${role.description.trim()}`, `  ${usageLine(id, role)}`);
  }
  const pending = custom.filter(([, role]) => !role.usage);
  if (pending.length) {
    lines.push('', '## À demander à l’utilisateur', '',
      'Pose chaque question avec ces réponses proposées, puis enregistre son choix pour ne plus le redemander :', '');
    for (const [id, role] of pending) {
      lines.push(`- « Quand veux-tu que j’utilise ${role.label} (${role.description.trim()}) ? »`,
        `  Réponses : ${Object.values(USAGES).join(' · ')}`,
        `  Puis : \`nay usage ${id} ${Object.keys(USAGES).join('|')}\``);
    }
  }
  lines.push('', 'Si l’utilisateur change d’avis plus tard : `nay usage <rôle> <règle>` (ou `demander` pour reposer la question).');
  return `${lines.join('\n')}\n`;
}
