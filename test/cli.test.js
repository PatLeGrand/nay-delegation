import test from 'node:test';
import assert from 'node:assert/strict';
import * as codex from '../src/cli/codex.js';
import * as agy from '../src/cli/agy.js';
import * as claude from '../src/cli/claude.js';

for (const mode of ['write', 'read']) {
  test(`Arguments et permissions en mode ${mode}`, () => {
    const options = { model: 'model-{effort}', effort: 'high', mode,
      cwd: '/work space', outputFile: '/tmp/output', prompt: 'Bonjour', timeoutMin: 20 };
    assert.deepEqual(codex.buildArgs(options), ['exec', '--json', '--skip-git-repo-check',
      '-C', '/work space', '-m', 'model-{effort}', '-c', 'model_reasoning_effort=high',
      '-s', mode === 'write' ? 'workspace-write' : 'read-only', '-o', '/tmp/output', '-']);
    assert.deepEqual(agy.buildArgs(options), ['-p', 'Bonjour', '--model', 'model-high',
      '--output-format', 'stream-json', '--print-timeout', '20m', '--mode',
      mode === 'write' ? 'accept-edits' : 'plan']);
    assert.deepEqual(claude.buildArgs(options), ['-p', '--output-format', 'stream-json', '--verbose',
      '--model', 'model-{effort}', '--effort', 'high', '--permission-mode',
      mode === 'write' ? 'acceptEdits' : 'plan']);
    for (const cli of [codex, agy, claude]) {
      assert.ok(cli.buildArgs(options).every((arg) => !arg.includes('dangerously')));
    }
  });
}

test('Codex additionne les tours et lit le texte fourni depuis -o', () => {
  const stdout = [
    { type: 'thread.started' },
    { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10, reasoning_output_tokens: 3 } },
    { type: 'turn.completed', usage: { input_tokens: 20, output_tokens: 5 } },
  ].map(JSON.stringify).join('\n');
  assert.deepEqual(codex.parseResult(stdout, 'réponse\n'), { text: 'réponse\n',
    usage: { input: 120, cachedInput: 40, output: 15, thinking: 3, total: 135 } });
  assert.throws(() => codex.parseResult('{"type":"turn.failed","error":{"message":"quota"}}'), /quota/);
});

test('agy lit la sortie réellement observée', () => {
  const stdout = '{"conversation_id":"…","status":"SUCCESS","response":"ok\\n","duration_seconds":2.19,"num_turns":1,"usage":{"input_tokens":9481,"output_tokens":1,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":9482}}';
  assert.deepEqual(agy.parseResult(stdout), { text: 'ok\n',
    usage: { input: 9481, cachedInput: 0, output: 1, thinking: 0, total: 9482 } });
});

test('Codex refuse une sortie sans tour terminé et préserve le résultat reçu', () => {
  for (const stdout of ['', '{"type":"thread.started"}']) {
    assert.throws(() => codex.parseResult(stdout, 'partiel'), (error) => {
      assert.match(error.message, /aucun événement turn.completed/);
      assert.equal(error.result.text, 'partiel');
      assert.equal(error.result.usage.total, 0);
      return true;
    });
  }
  assert.throws(() => codex.parseResult([
    '{"type":"turn.completed","usage":{"input_tokens":8,"output_tokens":2}}',
    '{"type":"turn.failed","error":{"message":"quota"}}',
  ].join('\n')), (error) => {
    assert.match(error.message, /quota/);
    assert.equal(error.result.usage.total, 10);
    return true;
  });
});

test('agy signale un échec même avec un JSON valide et conserve la consommation', () => {
  assert.throws(() => agy.parseResult('{"status":"ERROR","response":"quota","usage":{"input_tokens":8}}'),
    (error) => /quota/.test(error.message) && error.result.usage.input === 8);
});

test('Claude compte aussi la lecture et la création du cache', () => {
  assert.deepEqual(claude.parseResult(JSON.stringify({ result: 'ok', usage: {
    input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, output_tokens: 3,
  } })), { text: 'ok', usage: { input: 35, cachedInput: 20, output: 3, thinking: 0, total: 38 } });
  assert.throws(() => claude.parseResult('{"is_error":true,"result":"refus"}'), /refus/);
});

for (const [name, cli] of Object.entries({ codex, agy, claude })) {
  test(`${name} refuse une sortie JSON corrompue`, () => {
    assert.throws(() => cli.parseResult('invalide'), SyntaxError);
  });
}

test('Codex conserve les tours terminés et ignore une ligne non JSON', () => {
  const result = codex.parseResult(
    'diagnostic hors JSON\n{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":3}}\n{"type":', 'ok');
  assert.equal(result.usage.total, 15);
  assert.equal(result.text, 'ok');
});

for (const mode of ['read', 'write']) {
  test(`Reprise des trois CLI en mode ${mode}`, () => {
    const options = { model: 'model', effort: 'high', mode, resume: 'session',
      outputFile: '/tmp/result', prompt: 'suite', timeoutMin: 20 };
    assert.deepEqual(codex.buildArgs(options), ['exec', 'resume', '--json', '--skip-git-repo-check',
      '-m', 'model', '-c', 'model_reasoning_effort=high', '-c',
      `sandbox_mode="${mode === 'write' ? 'workspace-write' : 'read-only'}"`, '-o', '/tmp/result', '--', 'session', '-']);
    assert.deepEqual(claude.buildArgs(options).slice(-2), ['--resume', 'session']);
    assert.deepEqual(agy.buildArgs(options).slice(-2), ['--conversation', 'session']);
  });
}

test('Extraction pure des sessions et événements sans identifiant', () => {
  assert.equal(codex.sessionIdFrom({ type: 'thread.started', thread_id: 'c' }), 'c');
  assert.equal(claude.sessionIdFrom({ type: 'system', subtype: 'init', session_id: 's' }), 's');
  assert.equal(claude.sessionIdFrom({ type: 'result', session_id: 's' }), 's');
  assert.equal(agy.sessionIdFrom({ event: 'init', conversation_id: 'a' }), 'a');
  for (const cli of [codex, claude, agy]) {
    for (const event of [null, {}, { session_id: 'incorrect' }]) assert.equal(cli.sessionIdFrom(event), undefined);
  }
});

for (const [name, cli, events] of [
  ['codex', codex, (id) => [{ type: 'thread.started', thread_id: id }]],
  ['claude', claude, (id) => [{ type: 'system', subtype: 'init', session_id: id }, { type: 'result', session_id: id }]],
  ['agy', agy, (id) => [{ event: 'init', conversation_id: id }]],
]) {
  test(`${name} valide le format et les limites des sessions`, () => {
    for (const id of ['a', 'AZaz09_.:-', '_', '.', ':', 'a'.repeat(200)]) {
      for (const event of events(id)) assert.equal(cli.sessionIdFrom(event), id);
    }
    for (const id of [undefined, null, 1, {}, '', '-', '--help', '-session', 'a'.repeat(201),
      'avec espace', 'a/b', 'é', 'a\n', 'a\0', 'a\t']) {
      for (const event of events(id)) assert.equal(cli.sessionIdFrom(event), undefined);
    }
  });
}
