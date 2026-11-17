import { readConfig } from './config.js';

export function loadDelegation() {
  return checkedDelegation(readConfig('delegation'));
}

function checkedDelegation(delegation) {
  const errors = validateDelegation(delegation, Object.keys(readConfig('agents')));
  if (errors.length) throw new Error(`Configuration de délégation invalide :\n${errors.join('\n')}`);
  return delegation;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateList(list, path, agentNames, errors) {
  if (!Array.isArray(list) || list.length === 0) {
    errors.push(`${path} : une liste non vide est requise`);
    return;
  }
  const seen = new Set();
  for (const agent of list) {
    if (typeof agent !== 'string') {
      errors.push(`${path} : chaque agent doit être une chaîne`);
      continue;
    }
    if (!agentNames.has(agent)) errors.push(`${path} : agent inconnu : ${agent}`);
    if (seen.has(agent)) errors.push(`${path} : doublon : ${agent}`);
    seen.add(agent);
  }
}

export function validateDelegation(delegation, agentNames) {
  if (!isRecord(delegation)) return ['La délégation doit être un objet'];
  const errors = [];
  const names = new Set(agentNames);
  for (const [role, list] of Object.entries(delegation)) {
    if (role !== 'relecteur') validateList(list, role, names, errors);
  }
  const reviewer = delegation.relecteur;
  validateList(reviewer?.parDefaut, 'relecteur.parDefaut', names, errors);
  if (reviewer?.selonAuteur !== undefined) {
    if (!isRecord(reviewer.selonAuteur)) errors.push('relecteur.selonAuteur doit être un objet');
    else for (const [author, list] of Object.entries(reviewer.selonAuteur)) {
      if (author !== 'orchestrateur' && !names.has(author)) {
        errors.push(`relecteur.selonAuteur.${author} : auteur inconnu : ${author}`);
      }
      validateList(list, `relecteur.selonAuteur.${author}`, names, errors);
      if (Array.isArray(list) && !list.some((agent) => agent !== author)) {
        errors.push(`relecteur.selonAuteur.${author} : un autre agent que l’auteur est requis`);
      }
    }
  }
  return errors;
}

function roleCandidates(role, author, delegation) {
  if (role === 'relecteur' && (typeof author !== 'string' || !author.trim())) {
    throw new Error('auteur requis pour choisir un relecteur');
  }
  // Un auteur entouré d'espaces ne serait pas reconnu et pourrait se relire lui-même.
  if (role === 'relecteur' && author !== author.trim()) {
    throw new Error(`auteur mal formé : ${JSON.stringify(author)}`);
  }
  checkedDelegation(delegation);
  if (!Object.hasOwn(delegation, role)) throw new Error(`Rôle inconnu : ${role}`);
  if (role !== 'relecteur') return delegation[role];
  const { parDefaut, selonAuteur = {} } = delegation.relecteur;
  return Object.hasOwn(selonAuteur, author) ? selonAuteur[author] : parDefaut;
}

export function candidatesFor(role, { author, delegation = readConfig('delegation') } = {}) {
  const candidates = roleCandidates(role, author, delegation);
  return candidates.filter((agent) => role !== 'relecteur' || agent !== author);
}

export function chooseAgent(role, { author, isAvailable = () => true,
  delegation = readConfig('delegation') } = {}) {
  if (typeof isAvailable !== 'function') throw new Error('isAvailable doit être une fonction');
  const skipped = [];
  for (const agent of roleCandidates(role, author, delegation)) {
    const reason = role === 'relecteur' && agent === author ? 'auteur'
      : available(agent, isAvailable) ? null : 'indisponible';
    if (!reason) return { agent, skipped };
    skipped.push({ agent, reason });
  }
  const tried = skipped.map(({ agent, reason }) => `${agent} (${reason})`).join(', ');
  throw new Error(`Aucun agent disponible pour ${role}. Agents essayés : ${tried || 'aucun candidat'}`);
}

function available(agent, isAvailable) {
  const result = isAvailable(agent);
  if (typeof result !== 'boolean') {
    throw new Error(`isAvailable doit renvoyer un booléen pour ${agent}`);
  }
  return result;
}
