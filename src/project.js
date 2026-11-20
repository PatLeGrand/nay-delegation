import childProcess from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { loadProjectConfig } from './config.js';

function readGit(args, cwd) {
  return new Promise((resolveRun, reject) => {
    childProcess.execFile('git', args, { cwd }, (error, stdout) => (error ? reject(error) : resolveRun(stdout)));
  });
}

async function projectName(root, file) {
  try {
    const { name } = JSON.parse(await readFile(join(root, file), 'utf8'));
    if (typeof name === 'string' && name.trim()) return name.trim();
  } catch {
    // Le fichier est facultatif.
  }
  return basename(root);
}

export async function detectProject(cwd, { git = readGit } = {}) {
  try {
    if (!cwd) throw new Error('Dossier de travail absent');
    const commonDir = (await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)).trim();
    if (!isAbsolute(commonDir)) throw new Error('Chemin Git commun invalide');
    const projectRoot = dirname(commonDir);
    const branch = (await git(['branch', '--show-current'], cwd)).trim() || null;
    const project = await projectName(projectRoot, loadProjectConfig().projectFile);
    return { project, projectRoot, branch };
  } catch {
    return { project: null, projectRoot: null, branch: null };
  }
}

export function projectFromPath(cwd, config) {
  if (typeof cwd !== 'string' || !cwd) return null;
  const path = normalize(cwd);
  if (config.scratchDirs.some((value) => {
    const dir = resolve(value);
    return path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);
  })) return null;
  const parts = path.split(sep);
  const worktrees = config.worktreeDirs.map((dir) => dir.split('/'));
  const cut = parts.findIndex((_, index) => worktrees.some((dir) =>
    dir.every((part, offset) => parts[index + offset] === part)));
  return basename(cut < 0 ? path : parts.slice(0, cut).join(sep)) || null;
}

export function matchesProject(project, filter) {
  return !filter || (filter === '-' ? project == null : project === filter);
}
