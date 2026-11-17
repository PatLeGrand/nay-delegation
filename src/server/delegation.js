import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { validateDelegation } from '../delegation.js';
import { safePath, httpError } from './paths.js';

export async function readJson(root, path) {
  return JSON.parse(await readFile(await safePath(root, path), 'utf8'));
}

export async function readDelegation(root) {
  return { delegation: await readJson(root, 'config/delegation.json'),
    agents: Object.keys(await readJson(root, 'config/agents.json')) };
}

export async function writeDelegation(root, delegation) {
  const agents = Object.keys(await readJson(root, 'config/agents.json'));
  const errors = validateDelegation(delegation, agents);
  if (errors.length) throw httpError(400, 'Délégation invalide', errors);
  const destination = await safePath(root, 'config/delegation.json');
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(delegation, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
  return { ok: true, delegation };
}
