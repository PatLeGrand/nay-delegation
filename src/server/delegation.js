import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { validateDelegation } from '../delegation.js';
import { mergeLayers, personalDiff, readLayer, writeLayer } from '../userConfig.js';
import { BUILTIN_ROLES, USAGES, validateRoles } from '../roles.js';
import { safePath, httpError } from './paths.js';

export async function readJson(root, path) {
  return JSON.parse(await readFile(await safePath(root, path), 'utf8'));
}

// Fichier temporaire puis renommage : un lecteur ne voit jamais un fichier à moitié écrit.
export async function writeAtomic(root, path, text) {
  const destination = await safePath(root, path);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { flag: 'wx' });
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

// Valeurs du dépôt (`root`), config perso du dev (`userDir`) et leur fusion.
export async function readLayered(root, userDir, name) {
  let repo;
  try {
    repo = await readJson(root, `config/${name}.json`);
  } catch (error) {
    if (error.code !== 'ENOENT' || name !== 'roles') throw error;
    repo = {};
  }
  const personal = readLayer(userDir, name);
  return { repo, personal, merged: mergeLayers(repo, personal) };
}

// L'interface ne modifie jamais le dépôt : elle écrit dans la config perso du dev.
export function savePersonal(userDir, name, personal) {
  try {
    writeLayer(userDir, name, personal);
  } catch (error) {
    throw httpError(500, `Config perso non enregistrée : ${error.message}`);
  }
}

export async function readDelegation(root, userDir) {
  const [delegation, agents, roles] = await Promise.all(['delegation', 'agents', 'roles']
    .map((name) => readLayered(root, userDir, name)));
  return { delegation: delegation.merged, agents: Object.keys(agents.merged),
    personal: Object.keys(delegation.personal), configDir: userDir,
    roles: roles.merged, builtinRoles: BUILTIN_ROLES, usages: USAGES };
}

export async function writeDelegation(root, userDir, delegation) {
  const agents = Object.keys((await readLayered(root, userDir, 'agents')).merged);
  const errors = validateDelegation(delegation, agents);
  if (errors.length) throw httpError(400, 'Délégation invalide', errors);
  const { repo } = await readLayered(root, userDir, 'delegation');
  savePersonal(userDir, 'delegation', personalDiff(repo, delegation));
  return { ok: true, ...await readDelegation(root, userDir) };
}

// Revenir aux valeurs du dépôt : la config perso de délégation est effacée.
export async function resetDelegation(root, userDir) {
  savePersonal(userDir, 'delegation', {});
  return { ok: true, ...await readDelegation(root, userDir) };
}

export function checkRoles(roles) {
  const errors = validateRoles(roles);
  if (errors.length) throw httpError(400, 'Rôle invalide', errors);
}
