import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runChecks } from '../src/checks.js';
import { globToRegExp, isTestFile, tddGit, verifyTdd } from '../src/tdd.js';

const PATTERNS = ['**/test/**', '**/*.test.*', '**/test_*.py'];
const DIR = '.nay/worktrees';
const config = { projectFile: '.nay/checks.json', defaultTimeoutSec: 30, maxOutputChars: 2000, env: {} };
const runCheck = async (check, cwd, extraEnv) => (await runChecks([check], { cwd, config, extraEnv }))[0];
// Lance seulement les tests du commit (NAY_TEST_FILES, fourni par Nay). NODE_TEST_CONTEXT, hérité
// du lanceur de tests, ferait finir le processus enfant sans code d'échec.
const check = { name: 'tests', command: `env -u NODE_TEST_CONTEXT "${process.execPath}" --test $NAY_TEST_FILES`,
  timeoutSec: 30, tdd: true };

test('isTestFile : motifs glob avec **, * et dossiers à toute profondeur', () => {
  assert.ok(isTestFile('test/a.js', PATTERNS));
  assert.ok(isTestFile('pkg/test/sub/a.js', PATTERNS));
  assert.ok(isTestFile('src/a.test.js', PATTERNS));
  assert.ok(isTestFile('test_calc.py', PATTERNS));
  assert.ok(!isTestFile('src/contest.js', PATTERNS));
  assert.ok(!isTestFile('src/a.js', PATTERNS));
  assert.ok(globToRegExp('a?.md').test('ab.md'));
  assert.ok(!globToRegExp('*.md').test('docs/a.md'));
});

// Dépôt : base avec add() faux, puis un commit qui corrige et ajoute un test (ou un test déjà vert).
async function repoWith(t, { fixed }) {
  const dir = await mkdtemp(join(tmpdir(), 'nay-tdd-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sh = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const write = async (file, text) => {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), text);
  };
  sh('init', '-q');
  sh('config', 'user.email', 'test@example.invalid');
  sh('config', 'user.name', 'Test');
  await write('.gitignore', '.nay/worktrees/\n');
  await write('add.mjs', 'export const add = (a, b) => a - b;\n');
  await write('mul.mjs', 'export const mul = (a, b) => a * b;\n');
  sh('add', '.');
  sh('commit', '-qm', 'base');
  if (fixed) await write('add.mjs', 'export const add = (a, b) => a + b;\n');
  const target = fixed ? 'add' : 'mul';
  await write(`test/${target}.test.mjs`, `import test from 'node:test';\nimport assert from 'node:assert/strict';\n`
    + `import { ${target} } from '../${target}.mjs';\ntest('${target}', () => assert.equal(${target}(2, 2), 4));\n`);
  sh('add', '.');
  sh('commit', '-qm', 'change');
  return { dir, sh, commit: sh('rev-parse', '--short', 'HEAD') };
}

async function worktreesLeft(dir) {
  return readdir(join(dir, DIR)).catch(() => []);
}

test('verifyTdd : nouveaux tests rouges sur le parent → prouvé ; worktree supprimé', async (t) => {
  const { dir, sh, commit } = await repoWith(t, { fixed: true });
  const proof = await verifyTdd({ cwd: dir, commit, check, patterns: PATTERNS, dir: DIR, runCheck });
  assert.deepEqual(proof, { files: ['test/add.test.mjs'], proved: true });
  assert.deepEqual(await worktreesLeft(dir), []);
  assert.equal(sh('worktree', 'list').split('\n').length, 1);
  assert.equal(sh('status', '--porcelain'), '');
});

test('verifyTdd : nouveaux tests déjà verts sur le parent → non prouvé', async (t) => {
  const { dir, commit } = await repoWith(t, { fixed: false });
  const proof = await verifyTdd({ cwd: dir, commit, check, patterns: PATTERNS, dir: DIR, runCheck });
  assert.deepEqual(proof, { files: ['test/mul.test.mjs'], proved: false });
});

test('verifyTdd : rien à prouver sans test dans le commit ni parent', async (t) => {
  const { dir, sh, commit } = await repoWith(t, { fixed: true });
  const never = () => assert.fail('contrôle non attendu');
  assert.equal(await verifyTdd({ cwd: dir, commit, check, patterns: ['**/*.py'], dir: DIR, runCheck: never }), null);
  const root = sh('rev-list', '--max-parents=0', 'HEAD');
  assert.equal(await verifyTdd({ cwd: dir, commit: root, check, patterns: PATTERNS, dir: DIR, runCheck: never }), null);
});

test('withParentTree : le worktree est supprimé même si le contrôle lève une erreur', async (t) => {
  const { dir, sh, commit } = await repoWith(t, { fixed: true });
  await assert.rejects(tddGit.withParentTree(dir, { commit, files: ['test/add.test.mjs'], dir: DIR }, async (root) => {
    assert.match(await readFile(join(root, 'add.mjs'), 'utf8'), /a - b/);
    assert.match(await readFile(join(root, 'test/add.test.mjs'), 'utf8'), /add\(2, 2\)/);
    throw new Error('boum');
  }), /boum/);
  assert.deepEqual(await worktreesLeft(dir), []);
  assert.equal(sh('worktree', 'list').split('\n').length, 1);
});
