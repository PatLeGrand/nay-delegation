import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { runCommand } from '../src/command.js';

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'nay-plan-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const plan = join(cwd, 'plan.md');
  return async (markdown, storyRunner, args = [], project = cwd) => {
    await writeFile(plan, markdown);
    let output = '', errors = '', quotas = 0;
    const code = await runCommand(['plan', plan, '--cwd', project, ...args], {
      storyRunner, quotasReader: () => { quotas++; return {}; },
      output: { write(chunk) { output += chunk; } },
      errorOutput: { write(chunk) { errors += chunk; } },
    });
    return { code, output, errors, quotas };
  };
}

function task(id, after = '') {
  return `## ${id} : Tâche ${id}\n${after ? `Après : ${after}\n` : ''}Brief ${id}\n`;
}
const success = { status: 'OK', code: 0, dev: 'sol', reviews: [{ verdict: 'PASS' }] };

test('Plan invalide : aucun quota ni story, même avec une première tâche valide', async t => {
  const plan = await fixture(t);
  let calls = 0;
  for (const [suffix, reason] of [
    [task('A'), /double/], [task('B', 'X'), /inconnue/],
    [task('B', 'C') + task('C', 'B'), /Cycle/], [task('B', 'B'), /Cycle/],
  ]) {
    const result = await plan(task('A') + suffix, () => calls++);
    assert.equal(result.code, 1);
    assert.match(result.errors, reason);
    assert.equal(result.quotas, 0);
  }
  assert.equal(calls, 0);
});

test('Mode série : ordre des dépendances, options de story et rapport en ordre du plan', async t => {
  const plan = await fixture(t);
  const calls = [];
  const result = await plan(task('C', 'A, B') + task('A') + task('B'), (brief, options) => {
    calls.push({ brief, ...options });
    return success;
  }, ['--feature', 'exemple', '--rounds', '3', '--dev', 'sol']);
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(calls.map(c => c.brief), ['A', 'B', 'C'].map(id => `Tâche ${id}\n\nBrief ${id}`));
  assert.equal(new Set(calls.map(c => c.storyId)).size, 3);
  for (const call of calls) {
    assert.equal(call.feature, 'exemple');
    assert.equal(call.dev, 'sol');
    assert.equal(call.maxRounds, 3);
    assert.equal(typeof call.journal, 'function');
  }
  assert.deepEqual(result.output.trim().split('\n'), [calls[2], calls[0], calls[1]].map(call =>
    `${call.brief.at(-1)} · OK · storyId ${call.storyId} · dev sol · verdict PASS`));
});

test('Un échec bloque tous ses descendants et laisse continuer les autres stories', async t => {
  const plan = await fixture(t);
  const calls = [];
  const result = await plan(task('C', 'B') + task('B', 'A') + task('A') + task('D'), brief => {
    const id = brief.at(-1);
    calls.push(id);
    return id === 'A' ? { status: 'AUCUN AGENT', code: 2 } : success;
  });
  assert.deepEqual(calls, ['A', 'D']);
  assert.equal(result.code, 1);
  assert.match(result.output, /^B · non lancée/m);
  assert.match(result.output, /^C · non lancée/m);
});

test('Parallélisme refusé hors git avant tout appel', async t => {
  const plan = await fixture(t);
  const result = await plan(task('A'), assert.fail, ['--parallel', '2']);
  assert.equal(result.code, 1);
  assert.match(result.errors, /dépôt git/);
  assert.equal(result.quotas, 0);
});

test('Deux stories simultanées au plus, chacune sur une branche isolée', async t => {
  const plan = await fixture(t);
  const repo = await mkdtemp(join(tmpdir(), 'nay-plan-git-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const run = promisify(execFile);
  const git = async (cwd, ...args) => (await run('git', args, { cwd })).stdout.trim();
  await git(process.cwd(), 'clone', '--quiet', '--shared', '.', repo);
  const initial = await git(repo, 'rev-parse', 'HEAD');
  const branches = new Map(), finished = new Set();
  let active = 0, peak = 0;
  const gate = Promise.withResolvers();
  const result = await plan(task('A') + task('B') + task('C') + task('D', 'A, B') + task('E', 'A'), async (brief, { cwd }) => {
    const id = brief.at(-1);
    assert.ok(cwd.startsWith(join(repo, '.nay/worktrees/')));
    const branch = await git(cwd, 'branch', '--show-current');
    branches.set(id, branch);
    if (id === 'E') {
      const creation = await git(cwd, 'reflog', 'show', '--format=%gs', branch);
      assert.ok(creation.includes(branches.get('A')));
    }
    if (id === 'D') assert.ok(finished.has('A') && finished.has('B'));
    active++;
    peak = Math.max(peak, active);
    if (active === 2) gate.resolve();
    await gate.promise;
    await setImmediate();
    active--;
    finished.add(id);
    return success;
  }, ['--parallel', '2'], repo);
  assert.equal(result.code, 0, result.errors + result.output);
  assert.equal(peak, 2);
  assert.equal(new Set(branches.values()).size, 5);
  for (const branch of branches.values()) assert.ok(result.output.includes(`branche à fusionner ${branch}`));
  assert.equal(await git(repo, 'rev-parse', 'HEAD'), initial);
});
