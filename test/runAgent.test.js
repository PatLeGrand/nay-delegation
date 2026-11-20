import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, readdir, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { runAgent as executeAgent, checkSkipPermissions } from '../src/runAgent.js';
import * as agyCli from '../src/cli/agy.js';
import * as codexCli from '../src/cli/codex.js';
import { appendUsage, readUsage } from '../src/usageLog.js';
import { findResumableCall, resumeCall } from '../src/resume.js';

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
  assert.equal(result.sessionId, null);
  assert.ok(result.callId);
  const [entry] = await readUsage(join(cwd, '.nay/state/usage.jsonl'));
  assert.equal(entry.callId, result.callId);
  assert.equal(entry.project, null);
  assert.equal(entry.branch, null);
  assert.equal(entry.feature, null);
  assert.equal(entry.sessionId, null);
  assert.equal(entry.resumedFrom, null);
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
  const events = [];
  const result = await runAgent('sol', 'brief', { cwd, mode: 'read', feature: 'appel', role: 'dev',
    onEvent: (event) => events.push(event) });
  assert.match(result.callId, /^[0-9a-f-]{36}$/);
  assert.ok(events.length >= 2);
  assert.ok(events.every((event) => event.callId === result.callId));
  const eventDirectory = join(cwd, '.nay/state/events');
  const loggedEvents = (await Promise.all((await readdir(eventDirectory)).map((file) =>
    readFile(join(eventDirectory, file), 'utf8')))).join('').trim().split('\n').map(JSON.parse);
  assert.deepEqual(loggedEvents, events);
  assert.equal(result.status, 'ok');
  assert.equal(result.text, 'réponse');
  assert.equal(result.usage.total, 15);
  const [entry] = await readUsage(join(cwd, '.nay/state/usage.jsonl'));
  assert.equal(entry.callId, result.callId);
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

test('agy en lecture seule reçoit la consigne sans shell', async (t) => {
  const cwd = await setup(t, ({ child, args }) => {
    assert.match(args[1], /^brief\n[\s\S]*n'utilise aucune commande shell/);
    finish(child, '{"status":"SUCCESS","response":"ok"}');
  });
  assert.equal((await runAgent('hydrogen', 'brief', { cwd, mode: 'read' })).status, 'ok');
});

test('agy : un shell bloqué en lecture seule est nommé et repris une fois sans shell', async (t) => {
  const session = '11111111-1111-4111-8111-111111111111';
  const calls = [];
  const cwd = await setup(t, ({ child, args }) => {
    calls.push(args);
    if (calls.length === 1) {
      finish(child, [
        JSON.stringify({ event: 'init', conversation_id: session }),
        JSON.stringify({ event: 'step_update', step_update: { step_type: 'tool', step_index: 1, tool_name: 'run_command',
          state: 'DONE', tool_info: { parameters: { CommandLine: 'ls' }, output: '' } } }),
        JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '' } }),
      ].join('\n'));
    } else {
      finish(child, JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'revue faite' } }));
    }
  });
  const result = await runAgent('hydrogen', 'brief', { cwd, mode: 'read' });
  assert.equal(result.status, 'ok');
  assert.equal(result.text, 'revue faite');
  assert.equal(calls.length, 2);
  assert.equal(calls[1][calls[1].indexOf('--conversation') + 1], session);
  assert.match(calls[1][1], /sans aucune commande shell/);
  const entries = await readUsage(join(cwd, '.nay/state/usage.jsonl'));
  assert.match(entries[0].error, /Shell bloqué en mode plan/);
  assert.equal(entries[1].resumedFrom, entries[0].callId);
});

test('agy : pas de reprise automatique quand l’appelant impose le callId', async (t) => {
  let count = 0;
  const cwd = await setup(t, ({ child }) => {
    count += 1;
    finish(child, [
      JSON.stringify({ event: 'init', conversation_id: '22222222-2222-4222-8222-222222222222' }),
      JSON.stringify({ event: 'step_update', step_update: { step_type: 'tool', step_index: 1, tool_name: 'run_command',
        state: 'DONE', tool_info: { parameters: { CommandLine: 'ls' }, output: '' } } }),
      JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '' } }),
    ].join('\n'));
  });
  const result = await runAgent('hydrogen', 'brief', { cwd, mode: 'read', callId: 'impose' });
  assert.equal(count, 1);
  assert.equal(result.callId, 'impose');
  assert.match(result.error, /Shell bloqué en mode plan/);
});

test('--skip-permissions : réservé à agy en écriture dans un worktree lié', async () => {
  const agy = { cli: 'agy' };
  const linked = async () => '/r/.git/worktrees/w\n/r/.git\n';
  const main = async () => '/r/.git\n/r/.git\n';
  await checkSkipPermissions(agy, 'write', '/w', linked);
  await assert.rejects(checkSkipPermissions(agy, 'write', '/r', main), /pas le dépôt principal/);
  await assert.rejects(checkSkipPermissions(agy, 'write', '/x', async () => { throw new Error('git'); }), /hors Git/);
  await assert.rejects(checkSkipPermissions(agy, 'read', '/w', linked), /lecture seule/);
  await checkSkipPermissions({ cli: 'codex' }, 'write', '/w', linked);
  await assert.rejects(checkSkipPermissions({ cli: 'claude' }, 'write', '/w', linked), /agents agy et codex/);
});

test('codex : danger-full-access seulement si demandé, en écriture', () => {
  const base = { model: 'm', effort: 'medium', cwd: '/w', outputFile: '/o' };
  const sandbox = (args) => args[args.indexOf('-s') + 1];
  assert.equal(sandbox(codexCli.buildArgs({ ...base, skipPermissions: true })), 'danger-full-access');
  assert.equal(sandbox(codexCli.buildArgs(base)), 'workspace-write');
  assert.equal(sandbox(codexCli.buildArgs({ ...base, mode: 'read', skipPermissions: true })), 'read-only');
});

test('agy : --dangerously-skip-permissions seulement si demandé, en écriture', () => {
  const base = { model: 'm', effort: 'medium', prompt: 'p', timeoutMin: 1 };
  assert.ok(agyCli.buildArgs({ ...base, skipPermissions: true }).includes('--dangerously-skip-permissions'));
  assert.ok(!agyCli.buildArgs(base).includes('--dangerously-skip-permissions'));
  assert.ok(!agyCli.buildArgs({ ...base, mode: 'read', skipPermissions: true }).includes('--dangerously-skip-permissions'));
});

test('Un identifiant de reprise invalide est refusé sans lancer de processus', async (t) => {
  const cwd = await setup(t, () => assert.fail('processus interdit'));
  const result = await runAgent('hydrogen', 'brief', { cwd, mode: 'read', resume: '--dangerously-skip-permissions' });
  assert.equal(result.status, 'error');
  assert.match(result.error, /Identifiant de session invalide/);
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
  const git = t.mock.method(childProcess, 'execFile', (binary, args, options, callback) => {
    assert.equal(binary, 'git');
    assert.equal(options.cwd, cwd);
    callback(null, args[0] === 'rev-parse' ? join(cwd, '.git') + '\n' : 'flux-branche\n');
  });
  const result = await runAgent('sonnet', 'brief', { cwd, journalRoot: root, feature: 'flux', role: 'dev',
    onEvent: (event) => received.push(event) });
  assert.equal(result.status, 'ok');
  assert.equal(git.mock.callCount(), 2);
  assert.equal(received.at(-1).kind, 'call_end');
  assert.equal(received[1].text.length, 12000);
  for (const event of received) {
    assert.equal(event.v, 1);
    assert.equal(event.agent, 'sonnet');
    assert.equal(event.model, result.model);
    assert.equal(event.feature, 'flux');
    assert.equal(event.project, basename(cwd));
    assert.equal(event.branch, 'flux-branche');
    assert.equal(event.role, 'dev');
    assert.equal(event.callId, received[0].callId);
    assert.ok(Number.isFinite(Date.parse(event.ts)));
  }
  const log = join(root, '.nay/state/events', `${received[0].ts.slice(0, 10)}.jsonl`);
  assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse), received);
  const entries = await readUsage(join(root, '.nay/state/usage.jsonl'));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].project, basename(cwd));
  assert.equal(entries[0].branch, 'flux-branche');
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

for (const [provider, name] of [['codex', 'sol'], ['claude', 'sonnet'], ['agy', 'hydrogen']]) {
  test(`${provider} capture la session du flux et journalise la filiation`, async (t) => {
    const fixture = await readFile(new URL(`fixtures/${provider}-stream.jsonl`, import.meta.url), 'utf8');
    const stdout = provider === 'claude'
      ? JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-session' }) + '\n' + fixture : fixture;
    const first = JSON.parse(stdout.split('\n')[0]);
    const session = first.thread_id ?? first.session_id ?? first.conversation_id;
    const cwd = await setup(t, async ({ child, args }) => {
      if (provider === 'codex') await writeFile(args[args.indexOf('-o') + 1], 'ok');
      finish(child, stdout);
    });
    const events = [];
    const result = await runAgent(name, 'suite', { cwd, resume: session, resumedFrom: 'parent',
      callId: 'nouveau', onEvent: (event) => events.push(event) });
    assert.equal(result.status, 'ok');
    assert.equal(result.callId, 'nouveau');
    assert.equal(result.sessionId, session);
    assert.ok(events.every((event) => event.callId === result.callId));
    assert.equal(events[0].resumedFrom, 'parent');
    assert.equal(events.at(-1).sessionId, session);
    const [entry] = await readUsage(join(cwd, '.nay/state/usage.jsonl'));
    assert.equal(entry.callId, result.callId);
    assert.equal(entry.sessionId, session);
    assert.equal(entry.resumedFrom, 'parent');
    assert.equal(entry.cwd, cwd);
  });
}

for (const absolute of [false, true]) {
  test(`resumeCall lit et écrit le même usagePath ${absolute ? 'absolu' : 'relatif'}`, async (t) => {
    const cwd = await setup(t, async ({ child, args }) => {
      assert.deepEqual(args.slice(-3), ['--', 'session', '-']);
      await writeFile(args[args.indexOf('-o') + 1], 'suite réussie');
      finish(child, '{"type":"turn.completed","usage":{"input_tokens":2}}');
    });
    const usagePath = absolute ? join(cwd, 'custom/usage.jsonl') : 'custom/usage.jsonl';
    const path = absolute ? usagePath : join(cwd, usagePath);
    const parent = { callId: 'parent', sessionId: 'session', agent: 'sol', mode: 'read', cwd };
    await appendUsage(parent, path);
    const result = await resumeCall('parent', 'suite', { journalRoot: cwd, usagePath });
    assert.equal(result.status, 'ok');
    const entries = await readUsage(path);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].callId, 'parent');
    assert.equal(entries[1].callId, result.callId);
    assert.equal(entries[1].resumedFrom, 'parent');
    await assert.rejects(readFile(join(cwd, '.nay/state/usage.jsonl')), { code: 'ENOENT' });
  });
}

test('findResumableCall refuse les sessions invalides du dernier enregistrement', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'nay-invalid-session-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const path = join(cwd, '.nay/state/usage.jsonl');
  await appendUsage({ callId: 'parent', sessionId: 'valide' }, path);
  for (const sessionId of [null, 123, '', '--help', '-session', 'a b', 'a/b', 'é', 'a\n', 'a'.repeat(201)]) {
    await appendUsage({ callId: 'parent', sessionId }, path);
    await assert.rejects(findResumableCall('parent', { journalRoot: cwd }),
      (error) => error.status === 404 && /sans session/.test(error.message));
  }
});

function cumulativeStream(provider, usage) {
  if (provider === 'codex') return [
    { type: 'thread.started', thread_id: 'session' },
    { type: 'turn.completed', usage: { input_tokens: usage.input, cached_input_tokens: usage.cachedInput,
      output_tokens: usage.output, reasoning_output_tokens: usage.thinking } },
  ].map(JSON.stringify).join('\n');
  return [
    { event: 'init', conversation_id: 'session' },
    { event: 'result', result: { status: 'SUCCESS', response: 'ok', usage: {
      input_tokens: usage.input, cache_read_tokens: usage.cachedInput, output_tokens: usage.output,
      thinking_tokens: usage.thinking, total_tokens: usage.total,
    } } },
  ].map(JSON.stringify).join('\n');
}

for (const [provider, name, initialInput, initialOutput, resumedInput, resumedOutput] of [
  ['codex', 'sol', 554472, 4109, 617770, 4155],
  ['agy', 'hydrogen', 57118, 7741, 61565, 11443],
]) {
  for (const scenario of ['cumul préféré', 'ancien journal', 'borne à zéro', 'échec CLI']) {
    test(`${provider} : consommation de reprise, ${scenario}`, async (t) => {
      const raw = { input: resumedInput, cachedInput: 70, output: resumedOutput, thinking: 4,
        total: resumedInput + resumedOutput + (provider === 'agy' ? 4 : 0) };
      const baseline = scenario === 'borne à zéro'
        ? Object.fromEntries(Object.entries(raw).map(([field, value]) => [field, value + 1]))
        : { input: initialInput, cachedInput: 90, output: initialOutput, thinking: 1,
          total: initialInput + initialOutput + (provider === 'agy' ? 1 : 0) };
      const cwd = await setup(t, async ({ child, args }) => {
        if (provider === 'codex') await writeFile(args[args.indexOf('-o') + 1], 'ok');
        finish(child, cumulativeStream(provider, raw), scenario === 'échec CLI' ? 1 : 0);
      });
      const path = join(cwd, 'custom/usage.jsonl');
      await appendUsage({ callId: 'parent', sessionId: 'session', agent: name, mode: 'read', cwd,
        usage: scenario === 'ancien journal' ? baseline : { input: 1, output: 1, total: 2 },
        ...(scenario === 'ancien journal' ? {} : { usageCumulative: baseline }) }, path);
      const events = [];
      // L'API directe du moteur doit aussi retrouver le parent dans le bon journal.
      const result = await runAgent(name, 'suite', { cwd, resume: 'session', resumedFrom: 'parent',
        usagePath: path, onEvent: (event) => events.push(event) });
      const expected = scenario === 'borne à zéro'
        ? { input: 0, cachedInput: 0, output: 0, thinking: 0, total: 0 }
        : { input: resumedInput - initialInput, cachedInput: 0, output: resumedOutput - initialOutput,
          thinking: 3, total: raw.total - baseline.total };
      assert.equal(result.status, scenario === 'échec CLI' ? 'error' : 'ok');
      assert.deepEqual(result.usage, expected);
      assert.deepEqual(result.usageCumulative, raw);
      assert.deepEqual(events.at(-1).usage, expected);
      assert.deepEqual(events.at(-1).usageCumulative, raw);
      const [parent, entry] = await readUsage(path);
      assert.equal(parent.callId, 'parent');
      assert.deepEqual(entry.usage, expected);
      assert.deepEqual(entry.usageCumulative, raw);
    });
  }

  test(`${provider} : appel initial puis deux reprises sans recompter l'historique`, async (t) => {
    const snapshots = [
      { input: 100, cachedInput: 20, output: 10, thinking: 2, total: provider === 'agy' ? 112 : 110 },
      { input: 160, cachedInput: 30, output: 15, thinking: 3, total: provider === 'agy' ? 178 : 175 },
      { input: 190, cachedInput: 40, output: 18, thinking: 4, total: provider === 'agy' ? 212 : 208 },
    ];
    let index = 0;
    const cwd = await setup(t, async ({ child, args }) => {
      if (provider === 'codex') await writeFile(args[args.indexOf('-o') + 1], 'ok');
      finish(child, cumulativeStream(provider, snapshots[index++]));
    });
    const usagePath = join(cwd, 'custom/usage.jsonl');
    const first = await runAgent(name, 'initial', { cwd, usagePath });
    const second = await resumeCall(first.callId, 'suite', { journalRoot: cwd, usagePath });
    const third = await resumeCall(second.callId, 'suite', { journalRoot: cwd, usagePath });
    for (const result of [first, second, third]) assert.equal(result.status, 'ok');
    assert.deepEqual(first.usage, snapshots[0]);
    assert.deepEqual(first.usageCumulative, snapshots[0]);
    assert.equal(second.usage.input, 60);
    assert.equal(third.usage.input, 30);
    const entries = await readUsage(usagePath);
    for (const field of Object.keys(snapshots[0])) {
      assert.equal(entries.reduce((sum, entry) => sum + entry.usage[field], 0), snapshots[2][field]);
    }
    assert.deepEqual(entries.map((entry) => entry.usageCumulative), snapshots);
  });
}

test('Claude : la reprise conserve sa consommation propre sans champ cumulatif', async (t) => {
  const cwd = await setup(t, ({ child }) => finish(child, JSON.stringify({
    type: 'result', session_id: 'session', result: 'ok',
    usage: { input_tokens: 5, cache_read_input_tokens: 2, output_tokens: 3 },
  })));
  const usagePath = join(cwd, 'custom/usage.jsonl');
  await appendUsage({ callId: 'parent', sessionId: 'session', agent: 'sonnet', cwd,
    usage: { input: 1000, output: 500, total: 1500 },
    usageCumulative: { input: 2000, output: 1000, total: 3000 } }, usagePath);
  const events = [];
  const result = await runAgent('sonnet', 'suite', { cwd, usagePath, resume: 'session',
    resumedFrom: 'parent', onEvent: (event) => events.push(event) });
  const expected = { input: 7, cachedInput: 2, output: 3, thinking: 0, total: 10 };
  assert.equal(result.status, 'ok');
  const entry = (await readUsage(usagePath)).at(-1);
  for (const value of [result, entry, events.at(-1), events.find((event) => event.kind === 'usage')]) {
    assert.deepEqual(value.usage, expected);
    assert.equal(Object.hasOwn(value, 'usageCumulative'), false);
  }
});

test('call_end qualifie la fin pour nay wait : reprise, cause, question et storyId', async (t) => {
  const session = '33333333-3333-4333-8333-333333333333';
  let count = 0;
  const cwd = await setup(t, ({ child }) => {
    count += 1;
    if (count === 1) {
      finish(child, [
        JSON.stringify({ event: 'init', conversation_id: session }),
        JSON.stringify({ event: 'step_update', step_update: { step_type: 'tool', step_index: 1, tool_name: 'run_command',
          state: 'DONE', tool_info: { parameters: { CommandLine: 'ls' }, output: '' } } }),
        JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '' } }),
      ].join('\n'));
    } else {
      finish(child, JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Je garde quel nom ?' } }));
    }
  });
  const result = await runAgent('hydrogen', 'brief', { cwd, mode: 'read', storyId: 'abc123' });
  assert.equal(result.retrying, undefined);
  const { createEventTail } = await import('../src/wait.js');
  const { jobStatus } = await import('../src/lifecycle.js');
  const jobs = await createEventTail(join(cwd, '.nay/state/events'), { since: '2000-01-01' }).poll();
  const [first, second] = Object.values(jobs.calls).sort((a, b) => a.startedAt - b.startedAt);
  assert.deepEqual([first.end.retrying, first.end.cause, first.storyId], [true, 'shell_blocked', 'abc123']);
  assert.deepEqual([second.resumedFrom, second.end.question], [first.id, true]);
  const config = { silenceSec: 180, quotaPattern: 'quota' };
  assert.deepEqual([jobStatus(jobs, first.id, Date.now(), config).state, jobStatus(jobs, first.id, Date.now(), config).via],
    ['needs_input', second.id]);
});
