import test from 'node:test';
import assert from 'node:assert/strict';
import { getAgent, loadEngineConfig } from '../src/config.js';
import { runCommand } from '../src/command.js';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('Une erreur JSON indique le fichier fautif et conserve sa cause', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'nay-config-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, 'src'));
  await mkdir(join(cwd, 'config'));
  await cp(new URL('../src/config.js', import.meta.url), join(cwd, 'src/config.mjs'));
  await cp(new URL('../src/userConfig.js', import.meta.url), join(cwd, 'src/userConfig.js'));
  await writeFile(join(cwd, 'config/corrompu.json'), '{');
  const { readConfig } = await import(pathToFileURL(join(cwd, 'src/config.mjs')));
  assert.throws(() => readConfig('corrompu'), (error) => {
    assert.ok(error instanceof SyntaxError);
    assert.match(error.message, /config\/corrompu\.json/);
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
});

test('Un agent inconnu produit une erreur claire, même avec un nom hérité', () => {
  for (const name of ['inconnu', 'toString', '__proto__']) {
    assert.throws(() => getAgent(name), /Agent inconnu/);
  }
});

test('Les modèles agy et les chemins des binaires sont résolus', () => {
  assert.equal(getAgent('gemini-flash').model, 'gemini-3.8-flash-high');
  assert.equal(getAgent('sol').timeoutMin, 40);
  const config = loadEngineConfig(
    { CODEX_BIN: '/custom/codex', AGY_BIN: '/custom/agy', CLAUDE_BIN: '/custom/claude' },
    { exists: () => assert.fail('exists ne doit pas être appelé quand la variable env est définie') },
  );
  assert.equal(config.codexBin, '/custom/codex');
  assert.equal(config.agyBin, '/custom/agy');
  assert.equal(config.claudeBin, '/custom/claude');
  assert.deepEqual(config.fallbacks, []);
});

test('loadEngineConfig replie un chemin absolu absent sur le nom nu et garde les chemins présents ou nus', () => {
  const checked = [];
  const absent = loadEngineConfig({}, { exists: (path) => { checked.push(path); return false; } });
  assert.equal(absent.codexBin, 'codex');
  assert.equal(absent.agyBin, 'agy');
  assert.equal(absent.claudeBin, 'claude');
  assert.deepEqual(checked, ['/usr/lib/chatgpt/resources/codex']);
  assert.deepEqual(absent.fallbacks, [
    { cli: 'codex', configured: '/usr/lib/chatgpt/resources/codex', fallback: 'codex' },
  ]);

  const present = loadEngineConfig({}, { exists: () => true });
  assert.equal(present.codexBin, '/usr/lib/chatgpt/resources/codex');
  assert.equal(present.agyBin, 'agy');
  assert.equal(present.claudeBin, 'claude');
  assert.deepEqual(present.fallbacks, []);
});

test('check-config signale les replis sur le PATH sans échouer', async () => {
  let stdout = '';
  let stderr = '';
  const output = { write(chunk) { stdout += chunk; } };
  const errorOutput = { write(chunk) { stderr += chunk; } };
  const code = await runCommand(['check-config'], {
    output, errorOutput, engineLoader: () => loadEngineConfig({}, { exists: () => false }),
  });
  assert.equal(code, 0);
  assert.equal(stderr, '');
  assert.match(stdout, /codex : \/usr\/lib\/chatgpt\/resources\/codex introuvable, « codex » pris dans le PATH\n/);
});
