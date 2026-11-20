import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readConfig } from './config.js';
import { newStoryId } from './story.js';

const git = promisify(execFile);

function readSections(markdown) {
  const sections = [];
  let section;
  let fence;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker?.[1].startsWith(fence) && !marker[2].trim()) fence = null;
    } else if (marker) {
      fence = marker[1];
    } else if (/^##(?:\s|$)/.test(line)) {
      const heading = /^##\s+([^\s,:]+)\s*:\s*(.+)$/.exec(line.trimEnd());
      if (!heading) throw new Error(`Titre de tâche invalide : ${line}`);
      section = { id: heading[1], title: heading[2], lines: [] };
      sections.push(section);
      continue;
    }
    section?.lines.push(line);
  }
  return sections;
}

export function parsePlan(markdown) {
  const tasks = new Map();
  for (const { id, title, lines } of readSections(markdown)) {
    if (tasks.has(id)) throw new Error(`Identifiant en double : ${id}`);
    const after = /^Après\s*:\s*(.*)$/.exec(lines[0]?.trim());
    if (after) lines.shift();
    const brief = lines.join('\n').trim();
    if (!brief) throw new Error(`Brief vide : ${id}`);
    const dependencies = after ? after[1].split(',').map(value => value.trim()) : [];
    tasks.set(id, { id, title, dependencies, brief });
  }
  if (!tasks.size) throw new Error('Plan vide');
  validateDependencies(tasks);
  return [...tasks.values()];
}

function validateDependencies(tasks) {
  const visiting = new Set();
  const validated = new Set();
  function visit(id) {
    if (validated.has(id)) return;
    if (visiting.has(id)) throw new Error(`Cycle de dépendances : ${id}`);
    if (!tasks.has(id)) throw new Error(`Dépendance inconnue : ${id}`);
    visiting.add(id);
    tasks.get(id).dependencies.forEach(visit);
    visiting.delete(id);
    validated.add(id);
  }
  for (const id of tasks.keys()) visit(id);
}

export async function planWorkspace(cwd, parallel) {
  if (!(await stat(cwd)).isDirectory()) throw new Error(`Dossier projet invalide : ${cwd}`);
  if (parallel === 1) return () => ({ cwd });
  let base, prefix;
  try {
    const { stdout } = await git('git', ['rev-parse', '--is-inside-work-tree', '--show-prefix', '--verify', 'HEAD'], { cwd });
    const [inside, subdirectory, head] = stdout.trimEnd().split('\n');
    if (inside !== 'true' || !head) throw new Error();
    base = head;
    prefix = subdirectory;
  } catch {
    throw new Error('--parallel > 1 exige un dépôt git avec un commit');
  }
  const root = join(cwd, readConfig('plan').worktrees);
  await mkdir(root, { recursive: true });
  return async (storyId, parents) => {
    const path = join(root, storyId);
    const branch = `nay/plan-${storyId}`;
    // Une dépendance unique fournit une base sans fusionner de branches.
    const revision = parents.length === 1 ? parents[0].branch : base;
    await git('git', ['worktree', 'add', '-b', branch, path, revision], { cwd });
    return { cwd: join(path, prefix), branch };
  };
}

async function startTask(task, parents, { workspace, storyRunner, storyOptions }) {
  const storyId = newStoryId();
  let branch;
  try {
    const location = await workspace(storyId, parents);
    branch = location.branch;
    const report = await storyRunner(`${task.title}\n\n${task.brief}`,
      { ...storyOptions, cwd: location.cwd, storyId });
    return { ...report, id: task.id, storyId, branch };
  } catch (error) {
    return { id: task.id, storyId, branch, code: 1, status: 'ÉCHEC', detail: error.message };
  }
}

export async function runPlan(tasks, { parallel, ...options }) {
  const pending = new Set(tasks);
  const running = new Map();
  const results = new Map();
  while (pending.size || running.size) {
    for (const task of pending) {
      if (running.size >= parallel) break;
      const parents = task.dependencies.map(id => results.get(id));
      if (parents.some(parent => parent && parent.code !== 0)) {
        results.set(task.id, { id: task.id, code: 1, status: 'non lancée' });
      } else if (parents.every(Boolean)) {
        running.set(task.id, startTask(task, parents, options));
      } else continue;
      pending.delete(task);
    }
    if (running.size) {
      const report = await Promise.race(running.values());
      results.set(report.id, report);
      running.delete(report.id);
    }
  }
  return tasks.map(task => results.get(task.id));
}

export function formatTask(report) {
  const verdict = report.reviews?.at(-1)?.verdict ?? '—';
  const fields = [report.id, report.status, `storyId ${report.storyId ?? '—'}`,
    `dev ${report.dev ?? '—'}`, `verdict ${verdict}`];
  if (report.branch) fields.push(`${report.code === 0 ? 'branche à fusionner' : 'branche à examiner'} ${report.branch}`);
  if (report.detail) fields.push(report.detail.replace(/\s+/g, ' '));
  return fields.join(' · ');
}
