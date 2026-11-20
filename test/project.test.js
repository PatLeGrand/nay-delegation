import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { loadProjectConfig } from '../src/config.js';
import { detectProject, projectFromPath } from '../src/project.js';

const config = loadProjectConfig();

test('detectProject : dépôt principal, worktree lié et HEAD détachée', async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'nay-project-'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  for (const [cwd, output, branch] of [
    [projectRoot, 'main\n', 'main'],
    [join(projectRoot, '.nay/worktrees/essai'), 'feature/essai\n', 'feature/essai'],
    [join(projectRoot, '.claude/worktrees/essai'), '\n', null],
  ]) {
    const calls = [];
    const git = async (args, directory) => {
      calls.push([args, directory]);
      return args[0] === 'rev-parse' ? join(projectRoot, '.git') + '\n' : output;
    };
    assert.deepEqual(await detectProject(cwd, { git }),
      { project: basename(projectRoot), projectRoot, branch });
    assert.deepEqual(calls, [
      [['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd],
      [['branch', '--show-current'], cwd],
    ]);
  }
});

test('detectProject : nom personnalisé et repli pour un JSON ou un nom invalide', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'nay-project-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const projectRoot = join(parent, 'depot');
  await mkdir(join(projectRoot, '.nay'), { recursive: true });
  const cwd = join(projectRoot, '.claude/worktrees/essai');
  const git = async ([command]) => command === 'rev-parse' ? join(projectRoot, '.git') : 'essai';
  for (const [contents, expected] of [
    ['{"name":"Mon projet"}', 'Mon projet'], ['{', 'depot'], ['{"name":"  "}', 'depot'], ['{"name":2}', 'depot'],
  ]) {
    await writeFile(join(projectRoot, config.projectFile), contents);
    assert.deepEqual(await detectProject(cwd, { git }), { project: expected, projectRoot, branch: 'essai' });
  }
});

test('detectProject : hors Git ou échec de lecture de la branche', async () => {
  const empty = { project: null, projectRoot: null, branch: null };
  for (const failingCommand of ['rev-parse', 'branch']) {
    const git = async ([command]) => {
      if (command === failingCommand) throw new Error('git en échec');
      return '/projets/nay/.git';
    };
    assert.deepEqual(await detectProject('/projets/nay', { git }), empty);
  }
});

test('projectFromPath : worktrees imbriqués, dossiers temporaires et cwd absent', () => {
  const cases = [
    ['/projets/nay', 'nay'],
    ['/projets/nay/.claude/worktrees/one/src', 'nay'],
    ['/projets/nay/.nay/worktrees/one/.claude/worktrees/two', 'nay'],
    ['/projets/nay/.nay/worktrees-plus/one', 'one'],
    ['/tmp', null],
    ['/tmp/essai/.nay/worktrees/one', null],
    ['/tmp-projets/nay', 'nay'],
    [undefined, null],
  ];
  for (const [cwd, project] of cases) assert.equal(projectFromPath(cwd, config), project, cwd);
});
