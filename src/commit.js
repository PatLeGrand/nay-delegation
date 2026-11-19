import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Consigne ajoutée au brief : le sandbox du dev garde .git en lecture seule,
// c'est donc Nay, hors sandbox, qui committe à partir de ces deux lignes.
export const COMMIT_INSTRUCTIONS = `

---
Ne lance pas git commit : Nay committe pour toi. Termine ta réponse par exactement deux lignes :
NAY-COMMIT: <message du commit, une ligne>
NAY-FILES: <fichiers à committer, chemins relatifs séparés par des espaces>
Si tu n'as rien à committer, n'écris pas ces lignes.`;

// Les marqueurs demandés sont en fin de réponse : on retient la dernière occurrence, pour ne
// pas prendre un marqueur cité plus haut dans le texte.
export function lastMarker(text = '', key) {
  return [...text.matchAll(new RegExp(`^${key}:[ \\t]*(.+)$`, 'gm'))].at(-1)?.[1].trim() ?? null;
}

export function parseCommitRequest(text = '') {
  const message = lastMarker(text, 'NAY-COMMIT');
  const files = lastMarker(text, 'NAY-FILES')?.split(/\s+/).filter(Boolean) ?? [];
  if (!message || !files.length) return null;
  return { message, files };
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

// Chemin réel : un lien symbolique du dépôt qui pointe ailleurs ne doit pas passer le contrôle.
// Pour un fichier supprimé, on résout son dossier parent existant le plus proche.
async function realTarget(path) {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(await realTarget(parent), basename(path));
  }
}

// Committe uniquement les fichiers annoncés, jamais tout l'arbre.
export async function commitRequest(request, { cwd = process.cwd(), git = run } = {}) {
  const { stdout: top } = await git('git', ['rev-parse', '--show-toplevel'], { cwd });
  const root = await realpath(top.trim());
  const outside = [];
  for (const file of request.files) {
    const target = resolve(cwd, file);
    if (!inside(await realpath(cwd), await realTarget(target)) || !inside(root, await realTarget(target))) outside.push(file);
  }
  if (outside.length) throw new Error(`Fichiers hors du dépôt : ${outside.join(', ')}`);
  await git('git', ['add', '--', ...request.files], { cwd });
  await git('git', ['commit', '-m', request.message, '--', ...request.files], { cwd });
  const { stdout } = await git('git', ['log', '-1', '--format=%h %s'], { cwd });
  return stdout.trim();
}
