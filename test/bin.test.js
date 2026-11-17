import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../src/command.js';

function streams(text = '') {
  const captured = { stdout: '', stderr: '', input: Readable.from([text]) };
  captured.output = { write(chunk) { captured.stdout += chunk; } };
  captured.errorOutput = { write(chunk) { captured.stderr += chunk; } };
  return captured;
}

const response = { agent: 'sonnet', model: 'sonnet', effort: 'medium', status: 'ok',
  text: 'réponse', durationMs: 1234, usage: { input: 2, output: 1 } };

test('La CLI transmet stdin et les options, puis affiche l’en-tête et le texte', async () => {
  const captured = streams('bonjour');
  const code = await runCommand(['run', 'sonnet', '-', '--read-only', '--cwd', '/work',
    '--feature', 'appel', '--role', 'review'], { ...captured,
    execute: async (agent, prompt, options) => {
      assert.equal(agent, 'sonnet');
      assert.equal(prompt, 'bonjour');
      assert.deepEqual(options, { mode: 'read', cwd: '/work', feature: 'appel', role: 'review' });
      return response;
    } });
  assert.equal(code, 0);
  assert.equal(captured.stdout, '[sonnet · sonnet/medium · 1.2s · in 2 / out 1]\nréponse\n');
  assert.equal(captured.stderr, '');
});

test('La CLI lit un fichier et renvoie 1 pour un échec agent', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'nay-bin-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const brief = join(cwd, 'brief.md');
  await writeFile(brief, 'brief');
  const captured = streams();
  const code = await runCommand(['run', 'sonnet', brief], { ...captured,
    execute: async (agent, prompt, options) => {
      assert.equal(prompt, 'brief');
      assert.equal(options.mode, 'write');
      return { ...response, status: 'error', error: 'refus' };
    } });
  assert.equal(code, 1);
  assert.equal(captured.stderr, 'refus\n');
});

test('La CLI refuse les arguments incomplets ou inconnus avant tout appel', async () => {
  for (const args of [[], ['run', 'sol'], ['run', 'sol', '-', '--inconnu']]) {
    const captured = streams();
    const code = await runCommand(args, { ...captured, execute: () => assert.fail('appel interdit') });
    assert.equal(code, 1);
    assert.ok(captured.stderr.length > 0);
  }
});

test('choose affiche le choix et les raisons sans appeler d’agent', async () => {
  const captured = streams();
  const code = await runCommand(['choose', 'relecteur', '--author', 'terra',
    '--unavailable', 'hydrogen'], { ...captured, execute: () => assert.fail('appel interdit') });
  assert.equal(code, 0);
  assert.equal(captured.stdout, 'Agent choisi : sonnet\nSauté : hydrogen (indisponible)\n');
  assert.equal(captured.stderr, '');
});

test('choose renvoie 1 et explique pourquoi aucun agent ne convient', async () => {
  const captured = streams();
  const code = await runCommand(['choose', 'developpeur', '--unavailable', 'sol,sonnet'], captured);
  assert.equal(code, 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /sol \(indisponible\), sonnet \(indisponible\)/);
});

test('choose relecteur sans auteur renvoie 1 sans choisir d’agent', async () => {
  for (const args of [['choose', 'relecteur'], ['choose', 'relecteur', '--author', ''],
    ['choose', 'relecteur', '--author', '   ']]) {
    const captured = streams();
    assert.equal(await runCommand(args, { ...captured,
      execute: () => assert.fail('appel interdit') }), 1);
    assert.equal(captured.stdout, '');
    assert.match(captured.stderr, /auteur requis pour choisir un relecteur/);
  }
});

test('check-config valide la configuration du dépôt', async () => {
  const captured = streams();
  assert.equal(await runCommand(['check-config'], captured), 0);
  assert.equal(captured.stdout, 'Configuration de délégation valide\n');
  assert.equal(captured.stderr, '');
});

test('check-config renvoie 1 et toutes les erreurs d’une configuration invalide', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'nay-check-config-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  for (const path of ['src', 'bin', 'config', 'package.json']) {
    await cp(new URL(`../${path}`, import.meta.url), join(cwd, path), { recursive: true });
  }
  await writeFile(join(cwd, 'config/delegation.json'), JSON.stringify({
    developpeur: ['inconnu', 'inconnu'], explorateur: [],
  }));
  const { runCommand: runCopiedCommand } = await import(pathToFileURL(join(cwd, 'src/command.js')));
  const captured = streams();
  assert.equal(await runCopiedCommand(['check-config'], captured), 1);
  assert.equal(captured.stdout, '');
  for (const message of [/agent inconnu/, /doublon/, /explorateur.*liste non vide/,
    /relecteur.parDefaut.*liste non vide/]) assert.match(captured.stderr, message);
});

test('Les nouvelles commandes refusent les arguments invalides', async () => {
  for (const args of [['choose'], ['choose', 'developpeur', 'extra'],
    ['choose', 'inconnu'], ['choose', 'developpeur', '--cwd', '/tmp'],
    ['check-config', 'extra'], ['check-config', '--author', 'sol']]) {
    const captured = streams();
    assert.equal(await runCommand(args, captured), 1);
    assert.ok(captured.stderr.length > 0);
  }
});

test('choose sans --unavailable saute un agent dont le quota réel est sous son seuil', async () => {
  const captured = streams();
  const resetsAt = new Date(Date.now() + 3_600_000).toISOString();
  const quotas = {
    codex: { status: 'ok', windows: [{ label: '5h', remainingPct: 10, resetsAt },
      { label: '7j', remainingPct: 90, resetsAt }] },
    agy: { status: 'unknown', reason: 'test' },
    claude: { status: 'unknown', reason: 'test' },
  };
  const code = await runCommand(['choose', 'developpeur'], { ...captured, quotasReader: async () => quotas });
  assert.equal(code, 0);
  assert.equal(captured.stdout, 'Agent choisi : sonnet\nSauté : sol (indisponible)\n');
});

test('status résume les appels et les alertes d’un fichier d’événements', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'nay-status-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const start = Date.parse('2026-11-17T10:00:00.000Z');
  const base = { v: 1, callId: 'c1', agent: 'sol', model: 'gpt', feature: 'alertes', role: 'developpeur' };
  const lines = [
    { ...base, kind: 'call_start', ts: new Date(start).toISOString(), mode: 'write' },
    { ...base, kind: 'tool_start', ts: new Date(start).toISOString(),
      tool: { id: 't1', name: 'Bash', kind: 'command', target: 'npm test' } },
    { ...base, callId: 'c2', feature: 'autre', kind: 'call_start', ts: new Date(start).toISOString() },
  ].map((line) => JSON.stringify(line));
  const file = join(dir, '2026-11-17.jsonl');
  await writeFile(file, `${lines.join('\n')}\nligne illisible\n`);
  const now = () => start + 120_000;

  const captured = streams();
  assert.equal(await runCommand(['status', '--file', file], { ...captured, now }), 0);
  assert.match(captured.stdout, /sol · developpeur · alertes · running · command npm test · 2 min · outils 1 · échecs 0/);
  assert.match(captured.stdout, /⚠ sol · alertes · commande_longue · npm test tourne depuis 2 min/);
  assert.equal(captured.stderr, '');

  const filtered = streams();
  assert.equal(await runCommand(['status', '--file', file, '--feature', 'autre'], { ...filtered, now }), 0);
  assert.doesNotMatch(filtered.stdout, /commande_longue/);
  assert.match(filtered.stdout, /autre/);
});

test('status sur un fichier absent ou vide affiche « Aucun événement »', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'nay-status-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const empty = join(dir, 'vide.jsonl');
  await writeFile(empty, '');
  for (const file of [join(dir, 'absent.jsonl'), empty]) {
    const captured = streams();
    assert.equal(await runCommand(['status', '--file', file], captured), 0);
    assert.equal(captured.stdout, 'Aucun événement\n');
  }
  const extra = streams();
  assert.equal(await runCommand(['status', 'extra'], extra), 1);
});

test('status sur un fichier sans aucun événement valide affiche « Aucun événement »', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'nay-status-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'invalide.jsonl');
  await writeFile(file, `ligne illisible\n${JSON.stringify({ kind: 'tool_start' })}\n${JSON.stringify({ callId: 'c1', ts: 'pas une date' })}\n`);
  const captured = streams();
  assert.equal(await runCommand(['status', '--file', file], captured), 0);
  assert.equal(captured.stdout, 'Aucun événement\n');
});

test('choose valide rôle et auteur avant de lire les quotas', async () => {
  const captured = streams();
  const code = await runCommand(['choose', 'relecteur'], { ...captured,
    quotasReader: () => assert.fail('lecture des quotas interdite') });
  assert.equal(code, 1);
});
