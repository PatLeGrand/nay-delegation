// Règles d'ajout, de modification et de suppression des agents de config/agents.json.
import { EFFORTS } from './config.js';
import { PROVIDERS, findModel } from './models/catalog.js';

const NAME = /^[a-z][a-z0-9.-]{0,31}$/;
const RESERVED = ['orchestrateur'];
const FIELDS = ['cli', 'model', 'effort', 'timeoutMin'];

// Le contrôle par le catalogue est sauté si le fournisseur n'a pas pu être lu, ou si le modèle
// d'un agent existant ne change pas (un modèle retiré du catalogue reste modifiable).
export function validateAgent(agent, { catalog, previous, maxTimeoutMin }) {
  const errors = [];
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)) return ['Agent invalide'];
  const extra = Object.keys(agent).filter((key) => !FIELDS.includes(key));
  if (extra.length) errors.push(`Champs inconnus : ${extra.join(', ')}`);
  if (!PROVIDERS.includes(agent.cli)) errors.push(`CLI inconnu : ${agent.cli}`);
  if (typeof agent.model !== 'string' || !/^[\w.{}-]+$/.test(agent.model)) errors.push('Modèle invalide');
  if (!EFFORTS.includes(agent.effort)) errors.push(`Effort inconnu : ${agent.effort}`);
  if (!Number.isInteger(agent.timeoutMin) || agent.timeoutMin < 1 || agent.timeoutMin > maxTimeoutMin) {
    errors.push(`Délai invalide : entier de 1 à ${maxTimeoutMin} minutes`);
  }
  if (errors.length) return errors;
  const unchanged = previous?.cli === agent.cli && previous?.model === agent.model;
  const provider = catalog?.providers?.[agent.cli];
  if (!unchanged && provider?.status === 'ok') {
    const entry = findModel(catalog, agent.cli, agent.model);
    if (!entry) errors.push(`Modèle absent du catalogue ${agent.cli} : ${agent.model}`);
    else if (entry.efforts.length && !entry.efforts.includes(agent.effort)) {
      errors.push(`Effort ${agent.effort} non proposé par ${agent.model}`);
    }
  }
  return errors;
}

export function validateName(name, agents) {
  if (typeof name !== 'string' || !NAME.test(name) || RESERVED.includes(name)) {
    return ['Nom invalide : minuscules, chiffres, « . » ou « - », 32 caractères au plus'];
  }
  return Object.hasOwn(agents, name) ? [`L’agent ${name} existe déjà`] : [];
}

// Rôles de config/delegation.json qui citent l'agent, pour refuser sa suppression.
export function rolesUsing(delegation, name) {
  const roles = [];
  for (const [role, value] of Object.entries(delegation ?? {})) {
    if (Array.isArray(value)) {
      if (value.includes(name)) roles.push(role);
      continue;
    }
    if (value?.parDefaut?.includes(name)) roles.push(`${role}.parDefaut`);
    for (const [author, list] of Object.entries(value?.selonAuteur ?? {})) {
      if (author === name || list.includes(name)) roles.push(`${role}.selonAuteur.${author}`);
    }
  }
  return roles;
}

// Une ligne par agent, comme le fichier écrit à la main.
export function formatAgents(agents) {
  const lines = Object.entries(agents).map(([name, agent]) => `  ${JSON.stringify(name)}: ${
    JSON.stringify(Object.fromEntries(FIELDS.filter((key) => key in agent).map((key) => [key, agent[key]])))
      .replace(/^\{/, '{ ').replace(/\}$/, ' }').replace(/":/g, '": ').replace(/,"/g, ', "')}`);
  return `{\n${lines.join(',\n')}\n}\n`;
}
