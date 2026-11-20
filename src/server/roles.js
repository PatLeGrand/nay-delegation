// Points d'accès /api/roles : rôles perso du dev (adversaire, sécurité…) et leur ordre de modèles.
import { validateDelegation } from '../delegation.js';
import { validateRoleId } from '../roles.js';
import { checkRoles, readDelegation, readLayered, savePersonal } from './delegation.js';
import { httpError } from './paths.js';

function split(body) {
  const { id, agents, ...role } = body ?? {};
  if (role.usage === undefined) role.usage = null;
  if (role.instructions === '') delete role.instructions;
  return { id, agents, role };
}

async function layers(root, userDir) {
  const [roles, delegation, agents] = await Promise.all(['roles', 'delegation', 'agents']
    .map((name) => readLayered(root, userDir, name)));
  return { roles, delegation, agentNames: Object.keys(agents.merged) };
}

function checkAgents(id, list, agentNames, delegation) {
  const errors = validateDelegation({ ...delegation, [id]: list }, agentNames)
    .filter((error) => error.startsWith(`${id} :`));
  if (errors.length) throw httpError(400, 'Modèles du rôle invalides', errors);
}

export async function addRole(root, userDir, body) {
  const { id, agents, role } = split(body);
  const { roles, delegation, agentNames } = await layers(root, userDir);
  const idErrors = validateRoleId(id);
  if (!idErrors.length && Object.hasOwn(roles.merged, id)) idErrors.push(`Le rôle ${id} existe déjà`);
  if (idErrors.length) throw httpError(400, 'Rôle invalide', idErrors);
  checkRoles({ [id]: role });
  checkAgents(id, agents, agentNames, delegation.merged);
  savePersonal(userDir, 'roles', { ...roles.personal, [id]: role });
  savePersonal(userDir, 'delegation', { ...delegation.personal, [id]: agents });
  return { ok: true, id, ...await readDelegation(root, userDir) };
}

// Modifier un rôle du dépôt crée une version perso ; `agents` est facultatif.
export async function updateRole(root, userDir, id, body) {
  const { id: renamed, agents, role } = split(body);
  const { roles, delegation, agentNames } = await layers(root, userDir);
  if (!Object.hasOwn(roles.merged, id)) throw httpError(404, `Rôle inconnu : ${id}`);
  if (renamed !== undefined && renamed !== id) throw httpError(400, 'Renommer un rôle n’est pas possible');
  checkRoles({ [id]: role });
  if (agents !== undefined) checkAgents(id, agents, agentNames, delegation.merged);
  savePersonal(userDir, 'roles', { ...roles.personal, [id]: role });
  if (agents !== undefined) savePersonal(userDir, 'delegation', { ...delegation.personal, [id]: agents });
  return { ok: true, id, ...await readDelegation(root, userDir) };
}

// Seule la version perso est supprimée : un rôle du dépôt revient à sa version d'origine.
export async function deleteRole(root, userDir, id) {
  const { roles, delegation } = await layers(root, userDir);
  if (!Object.hasOwn(roles.personal, id)) {
    throw httpError(Object.hasOwn(roles.repo, id) ? 409 : 404,
      Object.hasOwn(roles.repo, id) ? `${id} vient du dépôt : il ne peut pas être supprimé ici` : `Rôle inconnu : ${id}`);
  }
  const { [id]: _removed, ...rest } = roles.personal;
  savePersonal(userDir, 'roles', rest);
  if (!Object.hasOwn(roles.repo, id) && Object.hasOwn(delegation.personal, id)) {
    const { [id]: _order, ...others } = delegation.personal;
    savePersonal(userDir, 'delegation', others);
  }
  return { ok: true, id, ...await readDelegation(root, userDir) };
}
