import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, readdir, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent as executeAgent } from '../src/runAgent.js';
import { readUsage } from '../src/usageLog.js';

function runAgent(name, prompt, options) {
  return executeAgent(name, prompt, { journalRoot: options.cwd, ...options });
}

async function setup(t, handle) {
  const cwd = await mkdtemp(join(tmpdir(), 'nay-run-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  t.mock.method(childProcess, 'spawn', (binary, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let input = '';
    child.stdin = new Writable({ write(chunk, encoding, done) { input += chunk; done(); } });
    child.stdin.on('finish', () => {
      Promise.resolve(handle({ child, binary, args, options, input }))
        .catch((error) => { child.emit('error', error); child.emit('close', 1); });
    });
    return child;
  });
  return cwd;
}

function finish(child, stdout, code = 0) {
  child.stdout.end(stdout);
  child.emit('close', code);
}

test('Codex sans turn.completed est journalisé comme un échec', async (t) => {
  const cwd = await setup(t, async ({ child, args }) => {
    await writeFile(args[args.indexOf('-o') + 1], 'partiel');
    finish(child, '{"type":"thread.started"}');
  });
  const result = await runAgent('sol', 'brief', { cwd });
  assert.equal(result.status, 'error');
  assert.match(result.error, /aucun événement turn.completed/);
  assert.equal(result.text, 'partiel');
  assert.equal((await readUsage(join(cwd, '.nay/state/usage.jsonl')))[0].status, 'error');
});

test('agy transmet un prompt commençant par - via brief.md puis le supprime', async (t) => {
  const prompt = '--model autre\nInstructions';
  let briefFile;
  const cwd = await setup(t, async ({ child, args, input }) => {
    const argumentPrompt = args[args.indexOf('-p') + 1];
    assert.ok(!argumentPrompt.startsWith('-'));
    briefFile = JSON.parse(argumentPrompt.match(/".*"/)[0]);
    assert.equal(briefFile, join(cwd, (await readdir(cwd)).find((name) => name.startsWith('.nay-call-')), 'brief.md'));
    assert.equal(await readFile(briefFile, 'utf8'), prompt);
    assert.equal(input, '');
    finish(child, '{"status":"SUCCESS","response":"ok"}');
  });
  assert.equal((await runAgent('hydrogen', prompt, { cwd })).status, 'ok');
  await assert.rejects(readFile(briefFile), { code: 'ENOENT' });
});

test('Le timeout sans pid ne tente de tuer aucun processus', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const kill = t.mock.method(process, 'kill', () => true);
  let childKill;
  const cwd = await setup(t, ({ child }) => {
    assert.equal(child.pid, undefined);
    childKill = t.mock.fn(() => true);
    child.kill = childKill;
    t.mock.timers.tick(15 * 60_000);
    finish(child, '', null);
  });
  const result = await runAgent('luna', 'brief', { cwd });
  assert.equal(result.status, 'timeout');
  assert.equal(kill.mock.callCount(), 0);
  assert.equal(childKill.mock.callCount(), 0);
});

for (const [agent, stdout] of [
  ['hydrogen', '{"status":"ERROR","error":"quota","usage":{"input_tokens":8}}'],
  ['sonnet', '{"is_error":true,"result":"quota","usage":{"input_tokens":8}}'],
  ['sol', '{"type":"turn.completed","usage":{"input_tokens":8}}\n{"type":"turn.failed","error":{"message":"quota"}}'],
  ['sol', '{"type":"turn.completed","usage":{"input_tokens":8}}\n{"type":"error","message":"quota"}'],
]) {
  test(`${agent} conserve le motif JSON avec un code de sortie non nul (${stdout})`, async (t) => {
    const cwd = await setup(t, ({ child }) => {
      child.stderr.write('erreur stderr');
      finish(child, stdout, 1);
    });
    const result = await runAgent(agent, 'brief', { cwd });
    assert.equal(result.status, 'error');
    assert.match(result.error, /code 1/);
    assert.match(result.error, /erreur stderr/);
    assert.match(result.error, /quota/);
    assert.equal(result.usage.input, 8);
    const [entry] = await readUsage(join(cwd, '.nay/state/usage.jsonl'));
    assert.equal(entry.error, result.error);
    assert.equal(entry.usage.input, 8);
  });
}

test('Codex reçoit stdin, lit -o et journalise les métadonnées', async (t) => {
  const cwd = await setup(t, async ({ child, args, input, options }) => {
    assert.equal(input, 'brief');
    assert.equal(options.cwd, cwd);
    assert.equal(options.shell, false);
    await writeFile(args[args.indexOf('-o') + 1], 'réponse');
    finish(child, '{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":3}}\n');
  });
  const result = await runAgent('sol', 'brief', { cwd, mode: 'read', feature: 'appel', role: 'dev' });
  assert.equal(result.status, 'ok');
  assert.equal(result.text, 'réponse');
  assert.equal(result.usage.total, 15);
  const [entry] = await readUsage(join(cwd, '.nay/state/usage.jsonl'));
  assert.equal(entry.feature, 'appel');
  assert.equal(entry.role, 'dev');
  assert.equal(entry.status, 'ok');
  assert.equal(entry.durationMs, result.durationMs);
  assert.ok(!Object.hasOwn(entry, 'text'));
  assert.ok((await readdir(cwd)).every((name) => !name.startsWith('.nay-call-')));
});

test('agy passe un long prompt par un fichier et conserve la consommation sur échec', async (t) => {
  const prompt = 'é'.repeat(40_000);
  let briefFile;
  const cwd = await setup(t, async ({ child, args, input }) => {
    assert.equal(input, '');
    briefFile = JSON.parse(args[1].match(/".*"/)[0]);
    assert.equal(await readFile(briefFile, 'utf8'), prompt);
    finish(child, '{"status":"ERROR","response":"quota","usage":{"input_tokens":8}}');
  });
  const result = await runAgent('hydrogen', prompt, { cwd });
  assert.equal(result.status, 'error');
  assert.match(result.error, /quota/);
  assert.equal(result.usage.input, 8);
  await assert.rejects(readFile(briefFile), { code: 'ENOENT' });
  assert.equal((await readUsage(join(cwd, '.nay/state/usage.jsonl')))[0].usage.input, 8);
});

test('Un code de sortie non nul reste un échec même avec une réponse valide', async (t) => {
  const cwd = await setup(t, ({ child }) => {
    child.stderr.write('refus permission');
    finish(child, '{"result":"partiel","usage":{"output_tokens":2}}', 1);
  });
  const result = await runAgent('sonnet', 'brief', { cwd });
  assert.equal(result.status, 'error');
  assert.equal(result.text, 'partiel');
  assert.equal(result.usage.output, 2);
  assert.match(result.error, /refus permission/);
});

test('Un binaire manquant est journalisé', async (t) => {
  const cwd = await setup(t, ({ child }) => {
    child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
    child.emit('close', -2);
  });
  const result = await runAgent('haiku', 'brief', { cwd });
  assert.equal(result.status, 'error');
  assert.match(result.error, /ENOENT/);
  assert.equal((await readUsage(join(cwd, '.nay/state/usage.jsonl'))).length, 1);
});

test('Le timeout arrête le groupe de processus et journalise un statut timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const kill = t.mock.method(process, 'kill', (pid, signal) => {
    assert.equal(pid, -12345);
    assert.equal(signal, 'SIGKILL');
    return true;
  });
  const cwd = await setup(t, ({ child }) => {
    child.pid = 12345;
    t.mock.timers.tick(15 * 60_000);
    finish(child, '', null);
  });
  const result = await runAgent('luna', 'brief', { cwd });
  assert.equal(result.status, 'timeout');
  assert.equal(kill.mock.callCount(), 1);
  assert.equal((await readUsage(join(cwd, '.nay/state/usage.jsonl')))[0].status, 'timeout');
});

test('Les erreurs de validation sont journalisées sans lancer de processus', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'nay-invalid-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const spawn = t.mock.method(childProcess, 'spawn', () => { throw new Error('interdit'); });
  assert.match((await runAgent('inconnu', 'brief', { cwd })).error, /Agent inconnu/);
  assert.match((await runAgent('sol', 'brief', { cwd, mode: 'invalid' })).error, /Mode inconnu/);
  assert.equal(spawn.mock.callCount(), 0);
  assert.equal((await readUsage(join(cwd, '.nay/state/usage.jsonl'))).length, 2);
});

test('Un timeout conserve les jetons reçus avant une ligne Codex tronquée', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(process, 'kill', () => true);
  const cwd = await setup(t, ({ child }) => {
    child.pid = 12345;
    t.mock.timers.tick(15 * 60_000);
    finish(child, '{"type":"turn.completed","usage":{"input_tokens":5}}\n{"type":', null);
  });
  const result = await runAgent('luna', 'brief', { cwd });
  assert.equal(result.status, 'timeout');
  assert.equal(result.usage.input, 5);
  assert.equal((await readUsage(join(cwd, '.nay/state/usage.jsonl')))[0].usage.input, 5);
});

test('Un fichier de réponse Codex absent est un échec avec la consommation conservée', async (t) => {
  const cwd = await setup(t, ({ child }) => {
    finish(child, '{"type":"turn.completed","usage":{"output_tokens":2}}');
  });
  const result = await runAgent('sol', 'brief', { cwd });
  assert.equal(result.status, 'error');
  assert.match(result.error, /Réponse Codex indisponible/);
  assert.equal(result.usage.output, 2);
});

test('Un prompt agy court passe en argument, avec le modèle résolu et sans stdin', async (t) => {
  const cwd = await setup(t, ({ child, args, input }) => {
    assert.equal(args[1], 'brief');
    assert.equal(args[args.indexOf('--model') + 1], 'gemini-3.8-flash-high');
    assert.equal(input, '');
    finish(child, '{"status":"SUCCESS","response":"ok"}');
  });
  assert.equal((await runAgent('gemini-flash', 'brief', { cwd })).status, 'ok');
});

test('Une réponse vide est un échec journalisé, même avec un statut SUCCESS', async (t) => {
  for (const response of ['', '  \n ']) {
    const cwd = await setup(t, ({ child }) => {
      finish(child, JSON.stringify({ status: 'SUCCESS', response, usage: { input_tokens: 5, output_tokens: 1 } }));
    });
    const result = await runAgent('hydrogen', 'brief', { cwd, mode: 'read' });
    assert.equal(result.status, 'error');
    assert.match(result.error, /Réponse vide/);
    assert.equal(result.usage.input, 5);
    const [entry] = await readUsage(join(cwd, '.nay/state/usage.jsonl'));
    assert.equal(entry.status, 'error');
  }
});

test('Flux en direct, lignes fragmentées, champs communs et journaux centraux', async (t) => {
  const received = [];
  const root = await mkdtemp(join(tmpdir(), 'nay-central-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = await setup(t, ({ child }) => {
    assert.equal(received[0].kind, 'call_start');
    child.stdout.write('diagnostic\n{"type":"assistant","message":{"content":[{"type":"te');
    child.stdout.write('xt","text":"' + 'a'.repeat(15000) + '"}]}}\n');
    assert.equal(received[1].kind, 'message');
    finish(child, '{"type":"result","result":"ok"}');
  });
  const result = await runAgent('sonnet', 'brief', { cwd, journalRoot: root, feature: 'flux', role: 'dev',
    onEvent: (event) => received.push(event) });
  assert.equal(result.status, 'ok');
  assert.equal(received.at(-1).kind, 'call_end');
  assert.equal(received[1].text.length, 12000);
  for (const event of received) {
    assert.equal(event.v, 1);
    assert.equal(event.agent, 'sonnet');
    assert.equal(event.model, result.model);
    assert.equal(event.feature, 'flux');
    assert.equal(event.role, 'dev');
    assert.equal(event.callId, received[0].callId);
    assert.ok(Number.isFinite(Date.parse(event.ts)));
  }
  const log = join(root, '.nay/state/events', `${received[0].ts.slice(0, 10)}.jsonl`);
  assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse), received);
  assert.equal((await readUsage(join(root, '.nay/state/usage.jsonl'))).length, 1);
  await assert.rejects(readFile(join(cwd, '.nay/state/usage.jsonl')), { code: 'ENOENT' });
});

test('Échec du journal événement et du callback sans perte du travail', async (t) => {
  const cwd = await setup(t, ({ child }) => finish(child, '{"type":"result","result":"ok"}'));
  const root = await mkdtemp(join(tmpdir(), 'nay-log-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(root, '.nay/state'), { recursive: true });
  await writeFile(join(root, '.nay/state/events'), 'obstacle');
  assert.equal((await runAgent('sonnet', 'brief', { cwd, journalRoot: root, onEvent() { throw new Error('observateur'); } })).status, 'ok');
  assert.equal((await readUsage(join(root, '.nay/state/usage.jsonl'))).length, 1);
});

test('Le timeout écrit aussi call_start et call_end', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  const cwd = await setup(t, ({ child }) => {
    t.mock.timers.tick(15 * 60_000);
    finish(child, '', null);
  });
  await runAgent('luna', 'brief', { cwd, onEvent: (event) => events.push(event) });
  assert.deepEqual(events.map((event) => event.kind), ['call_start', 'call_end']);
  assert.equal(events[1].status, 'timeout');
  const log = join(cwd, '.nay/state/events', `${events[0].ts.slice(0, 10)}.jsonl`);
  assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 2);
});

test('Claude enregistre son dernier quota et relie les outils terminés', async (t) => {
  const stdout = await readFile(new URL('fixtures/claude-stream.jsonl', import.meta.url), 'utf8');
  const events = [];
  const cwd = await setup(t, ({ child }) => finish(child, stdout));
  const result = await runAgent('sonnet', 'brief', { cwd, onEvent: (event) => events.push(event) });
  assert.equal(result.status, 'ok');
  const start = events.find((event) => event.kind === 'tool_start');
  const end = events.find((event) => event.kind === 'tool_end');
  assert.deepEqual(end.tool, start.tool);
  const { readClaude } = await import('../src/quota/claude.js');
  const quota = await readClaude(undefined, Date.now(), cwd);
  assert.equal(quota.status, 'ok');
  assert.equal(quota.windows[0].remainingPct, 80);
});

test('Une erreur du journal de consommation rejette toujours la promesse', async (t) => {
  const cwd = await setup(t, ({ child }) => finish(child, '{"type":"result","result":"ok"}'));
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(cwd, '.nay/state/usage.jsonl'), { recursive: true });
  await assert.rejects(runAgent('sonnet', 'brief', { cwd }), { code: 'EISDIR' });
});


for (const state of ['absente', 'malformée', 'structure invalide', 'motif invalide']) {
  test(`La config événements ${state} ne bloque ni l’import ni l’appel ni usage.jsonl`, async (t) => {
    const cwd = await setup(t, ({ child }) => finish(child, '{"type":"result","result":"ok","usage":{"input_tokens":8}}'));
    await cp(new URL('../src', import.meta.url), join(cwd, 'src'), { recursive: true });
    await cp(new URL('../config', import.meta.url), join(cwd, 'config'), { recursive: true });
    await writeFile(join(cwd, 'package.json'), '{"type":"module"}');
    const configPath = join(cwd, 'config/events.json');
    if (state === 'absente') await rm(configPath);
    else if (state === 'malformée') await writeFile(configPath, '{invalide');
    else if (state === 'structure invalide') await writeFile(configPath, 'null');
    else {
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      config.secretPatterns[0].pattern = '[';
      await writeFile(configPath, JSON.stringify(config));
    }
    const warnings = [];
    t.mock.method(process.stderr, 'write', (text) => { warnings.push(text); return true; });
    const { runAgent: isolatedRun } = await import(join(cwd, 'src/runAgent.js'));
    const received = [];
    const result = await isolatedRun('sonnet', 'brief', { cwd, journalRoot: cwd, onEvent: (event) => received.push(event) });
    assert.equal(result.status, 'ok');
    assert.equal(result.text, 'ok');
    assert.equal((await readUsage(join(cwd, '.nay/state/usage.jsonl')))[0].usage.input, 8);
    assert.deepEqual(received, []);
    await assert.rejects(readdir(join(cwd, '.nay/state/events')), { code: 'ENOENT' });
    assert.match(warnings.join(''), /Journal d’événements désactivé/);
  });
}

test('Les secrets sont masqués pour le callback et le journal, sans modifier result.text', async (t) => {
  const secrets = ['bearer-' + 'a'.repeat(33), 'simple-' + 'b'.repeat(33),
    ...['sk-', 'ghp_', 'github_pat_', 'xoxb-', 'xoxp-'].map((prefix) => prefix + 'c'.repeat(20)),
    'AKIA' + 'A1'.repeat(8), 'valeur-cle', 'valeur-token',
    'valeur-secret', 'valeur-password', 'valeur-api', 'valeur-json'];
  const text = `Authorization: Bearer ${secrets[0]} Bearer ${secrets[1]} ${secrets.slice(2, 8).join(' ')} ` +
    'MY_KEY=valeur-cle token=valeur-token secret="valeur-secret" password=valeur-password ' +
    'API_URL=valeur-api "myToken": "valeur-json"';
  const tool = { type: 'tool_use', id: 'outil', name: 'Bash', input: { command: text } };
  const stream = [
    { type: 'assistant', message: { content: [tool, { type: 'text', text }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'outil', content: text }] } },
    { type: 'result', result: text },
  ].map(JSON.stringify).join('\n');
  const cwd = await setup(t, ({ child }) => finish(child, stream));
  const received = [];
  const result = await runAgent('sonnet', 'brief', { cwd, onEvent: (event) => received.push(event) });
  assert.equal(result.text, text);
  const logPath = join(cwd, '.nay/state/events', `${received[0].ts.slice(0, 10)}.jsonl`);
  const log = await readFile(logPath, 'utf8');
  for (const secret of secrets) {
    assert.ok(!log.includes(secret), secret);
    assert.ok(!JSON.stringify(received).includes(secret), secret);
  }
  const message = received.find((event) => event.kind === 'message');
  assert.equal((message.text.match(/\[masqué\]/g) ?? []).length, secrets.length);
  assert.equal(received.find((event) => event.kind === 'tool_start').tool.target, message.text);
  assert.equal(received.find((event) => event.kind === 'tool_end').output, message.text);
});
