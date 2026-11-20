// Config personnelle de chaque dev, hors du dépôt : ses agents, son ordre de délégation et ses
// rôles. Elle se superpose aux valeurs du dépôt clé par clé, sans jamais les modifier.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const LAYERED = ['agents', 'delegation', 'roles'];

// NAY_CONFIG_DIR l'emporte ; sous `node --test` sans lui, pas de couche perso, pour que les
// tests ne dépendent pas des réglages du dev qui les lance.
export function userConfigDir(env = process.env) {
  if (env.NAY_CONFIG_DIR) return resolve(env.NAY_CONFIG_DIR);
  if (env.NODE_TEST_CONTEXT) return null;
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'nay');
}

function layerFile(dir, name) {
  return join(dir, `${name}.json`);
}

export function readLayer(dir, name) {
  if (!dir) return {};
  const file = layerFile(dir, name);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    throw new SyntaxError(`JSON invalide dans ${file} : ${cause.message}`, { cause });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${file} doit contenir un objet`);
  return data;
}

// Un calque vide est supprimé : on revient alors entièrement aux valeurs du dépôt.
export function writeLayer(dir, name, data) {
  if (!dir) throw new Error('Pas de dossier de config perso (NAY_CONFIG_DIR)');
  const file = layerFile(dir, name);
  if (!Object.keys(data).length) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dir, { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

// Une clé perso remplace entièrement celle du dépôt (un rôle, un agent).
export function mergeLayers(repo, personal) {
  return { ...repo, ...personal };
}

// Ne garde que ce qui diffère du dépôt : une clé redevenue identique suit à nouveau le dépôt.
export function personalDiff(repo, merged) {
  return Object.fromEntries(Object.entries(merged)
    .filter(([key, value]) => JSON.stringify(repo[key]) !== JSON.stringify(value)));
}
