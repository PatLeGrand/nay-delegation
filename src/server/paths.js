import { lstat, realpath } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

export function httpError(status, message, errors) {
  return Object.assign(new Error(message), { status, errors });
}

// Refuser les liens dans chaque composant empêche aussi les sorties via un dossier lié.
export async function safePath(root, name) {
  const base = await realpath(root);
  const path = resolve(base, name);
  const rel = relative(base, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) {
    throw httpError(403, 'Chemin interdit');
  }
  let current = base;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw httpError(403, 'Lien symbolique interdit');
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
  return path;
}
