import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checksFailures, formatChecks, loadChecks, loadChecksConfig, runChecks } from '../src/checks.js';

const config = { projectFile: '.nay/checks.json', defaultTimeoutSec: 30, maxOutputChars: 200, env: { CI: '1' } };

async function withProject(content, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'nay-checks-'));
  try {
    if (content !== undefined) {
      await mkdir(join(dir, '.nay'));
      await writeFile(join(dir, '.nay/checks.json'), content);
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const node = (code) => `"${process.execPath}" -e "${code}"`;

test('config/checks.json est valide', () => {
  const loaded = loadChecksConfig();
  assert.equal(typeof loaded.projectFile, 'string');
  assert.equal(loaded.baseline, true);
});

test('loadChecks : absent → null ; nom et délai par défaut', async () => {
  await withProject(undefined, async (dir) => assert.equal(await loadChecks(dir, config), null));
  await withProject(JSON.stringify({ checks: [{ command: 'npm test' }, { name: 'lint', command: 'ruff .', timeoutSec: 5 }] }),
    async (dir) => assert.deepEqual(await loadChecks(dir, config), [
      { name: 'npm test', command: 'npm test', timeoutSec: 30 },
      { name: 'lint', command: 'ruff .', timeoutSec: 5 }]));
});

test('loadChecks : un fichier invalide est une erreur, pas une absence de contrôles', async () => {
  for (const [content, message] of [['{', /JSON invalide/], ['{"checks":[]}', /liste non vide/],
    ['{"checks":[{"name":"x"}]}', /sans « command »/], ['{"checks":[{"command":"a","timeoutSec":0}]}', /timeoutSec/],
    ['{"checks":[{"command":"a","tdd":"oui"}]}', /« tdd » doit être un booléen/]]) {
    await withProject(content, async (dir) => assert.rejects(loadChecks(dir, config), message));
  }
});

test('runChecks : tous les contrôles tournent, avec code, sortie tronquée et variables d’env', async () => {
  await withProject(undefined, async (dir) => {
    const results = await runChecks([
      { name: 'ok', command: node('process.exit(process.env.CI === \'1\' ? 0 : 3)'), timeoutSec: 30 },
      { name: 'ko', command: node('console.log(\'x\'.repeat(500)); console.error(\'FIN\'); process.exit(2)'), timeoutSec: 30 },
    ], { cwd: dir, config });
    assert.deepEqual(results.map((r) => [r.ok, r.code]), [[true, 0], [false, 2]]);
    assert.ok(results[1].output.length <= config.maxOutputChars);
    assert.match(results[1].output, /FIN\s*$/);
    assert.match(formatChecks(results), /^ok ok \(\d+ s\) · ko ÉCHEC \(code 2\)$/);
    assert.match(checksFailures(results), /^### ko — code 2\nCommande : /);
    assert.doesNotMatch(checksFailures(results), /### ok/);
  });
});

test('runChecks : un contrôle trop long est arrêté et compté en échec', async () => {
  await withProject(undefined, async (dir) => {
    const [result] = await runChecks([{ name: 'lent', command: node('setTimeout(() => {}, 60000)'), timeoutSec: 0.3 }],
      { cwd: dir, config });
    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
    assert.match(formatChecks([result]), /lent ÉCHEC \(délai de 0.3 s dépassé\)/);
  });
});

test('loadChecks : le contrôle marqué « tdd » est repéré ; config : motifs de tests lus', async () => {
  await withProject(JSON.stringify({ checks: [{ name: 'lint', command: 'ruff .' }, { name: 'tests', command: 'pytest', tdd: true }] }),
    async (dir) => assert.deepEqual((await loadChecks(dir, config)).map((check) => check.tdd), [undefined, true]));
  const loaded = loadChecksConfig();
  assert.ok(loaded.testPatterns.length > 0);
  assert.equal(typeof loaded.tddWorktreesDir, 'string');
});

test('runChecks : extraEnv complète les variables d’env de la config', async () => {
  await withProject(undefined, async (dir) => {
    const [result] = await runChecks([{ name: 'env', command: node('process.exit(process.env.NAY_TEST_FILES === \'a b\' && process.env.CI === \'1\' ? 0 : 4)'), timeoutSec: 30 }],
      { cwd: dir, config, extraEnv: { NAY_TEST_FILES: 'a b' } });
    assert.equal(result.ok, true);
  });
});
