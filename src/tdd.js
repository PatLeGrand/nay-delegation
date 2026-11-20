// Preuve TDD : les tests ajoutés par un commit doivent échouer sur le commit parent.
// Sinon ils passent sans le changement et ne prouvent peut-être rien.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;
const CHANGED = new Set(['A', 'M']);

const git = (cwd, args, options = {}) => run('git', args, { cwd, maxBuffer: MAX_BUFFER, ...options });

// Glob minimal : `**/` (zéro ou plusieurs dossiers), `**`, `*` (hors « / »), `?`.
export function globToRegExp(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    if (glob.startsWith('**/', i)) {
      source += '(?:.*/)?';
      i += 2;
    } else if (glob.startsWith('**', i)) {
      source += '.*';
      i += 1;
    } else if (glob[i] === '*') source += '[^/]*';
    else if (glob[i] === '?') source += '[^/]';
    else source += glob[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

export function isTestFile(path, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

async function removeWorktree(cwd, path) {
  try {
    await git(cwd, ['worktree', 'remove', '--force', path]);
  } catch {
    await rm(path, { recursive: true, force: true });
    await git(cwd, ['worktree', 'prune']).catch(() => {});
  }
}

export const tddGit = {
  async hasParent(cwd, commit) {
    try {
      await git(cwd, ['rev-parse', '--verify', '--quiet', `${commit}^`]);
      return true;
    } catch {
      return false;
    }
  },
  // Fichiers ajoutés ou modifiés par le commit, relatifs à la racine du dépôt.
  async changedFiles(cwd, commit) {
    const { stdout } = await git(cwd, ['diff-tree', '--no-commit-id', '--name-status', '--no-renames', '-r', '-z', commit]);
    const fields = stdout.split('\0').filter(Boolean);
    const files = [];
    for (let i = 0; i + 1 < fields.length; i += 2) {
      if (CHANGED.has(fields[i])) files.push(fields[i + 1]);
    }
    return files;
  },
  // Dossier de la story relatif à la racine du dépôt (vide à la racine).
  async prefix(cwd) {
    const { stdout } = await git(cwd, ['rev-parse', '--show-prefix']);
    return stdout.trim();
  },
  // Worktree détaché sur le parent, avec les nouveaux tests du commit ; supprimé même en cas d'erreur.
  async withParentTree(cwd, { commit, files, dir }, fn) {
    const path = join(cwd, dir, `tdd-${randomBytes(4).toString('hex')}`);
    await mkdir(dirname(path), { recursive: true });
    await git(cwd, ['worktree', 'add', '--detach', '--quiet', path, `${commit}^`]);
    try {
      for (const file of files) {
        const { stdout } = await git(cwd, ['show', `${commit}:${file}`], { encoding: 'buffer' });
        await mkdir(dirname(join(path, file)), { recursive: true });
        await writeFile(join(path, file), stdout);
      }
      return await fn(path);
    } finally {
      await removeWorktree(cwd, path);
    }
  },
};

// null si rien à prouver (pas de parent, aucun test dans le commit) ; sinon { files, proved }.
// `runCheck(check, cwd, env)` lance le contrôle comme runChecks et rend son résultat.
export async function verifyTdd({ cwd, commit, check, patterns, dir, runCheck, ops = tddGit }) {
  if (!(await ops.hasParent(cwd, commit))) return null;
  const files = (await ops.changedFiles(cwd, commit)).filter((file) => isTestFile(file, patterns));
  if (!files.length) return null;
  const prefix = await ops.prefix(cwd);
  const result = await ops.withParentTree(cwd, { commit, files, dir }, (root) =>
    runCheck(check, join(root, prefix), { NAY_TEST_FILES: files.map((file) => relative(prefix, file)).join(' ') }));
  return { files, proved: !result.ok };
}
