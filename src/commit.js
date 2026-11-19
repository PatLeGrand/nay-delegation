import { execFile } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
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

export function parseCommitRequest(text = '') {
  const message = text.match(/^NAY-COMMIT:[ \t]*(.+)$/m)?.[1].trim();
  const files = text.match(/^NAY-FILES:[ \t]*(.+)$/m)?.[1].trim().split(/\s+/).filter(Boolean) ?? [];
  if (!message || !files.length) return null;
  return { message, files };
}

function insideRoot(root, file) {
  const path = relative(root, resolve(root, file));
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
}

// Committe uniquement les fichiers annoncés, jamais tout l'arbre.
export async function commitRequest(request, { cwd = process.cwd(), git = run } = {}) {
  const { stdout: top } = await git('git', ['rev-parse', '--show-toplevel'], { cwd });
  const root = top.trim();
  const outside = request.files.filter((file) => !insideRoot(cwd, file) || !insideRoot(root, resolve(cwd, file)));
  if (outside.length) throw new Error(`Fichiers hors du dépôt : ${outside.join(', ')}`);
  await git('git', ['add', '--', ...request.files], { cwd });
  await git('git', ['commit', '-m', request.message, '--', ...request.files], { cwd });
  const { stdout } = await git('git', ['log', '-1', '--format=%h %s'], { cwd });
  return stdout.trim();
}
