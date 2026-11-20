import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT, formatStory, parseDisputes, parseVerdict, runStory } from '../src/story.js';
import { commitAndRecord } from '../src/commit.js';
import { runCommand } from '../src/command.js';

const delegation = { developpeur: ['sol', 'sonnet'],
  relecteur: { parDefaut: ['hydrogen', 'terra'], selonAuteur: {} } };

const result = (agent, text, extra = {}) => ({ agent, status: 'ok', callId: `${agent}-call`, sessionId: `${agent}-s`,
  text, usage: { input: 1, output: 1 }, durationMs: 1, ...extra });

// Faux git : un arbre « sale » dès qu'un agent a écrit quelque chose.
function fakeGit({ repo = true } = {}) {
  const state = { dirty: '' };
  return { state, git: { isRepo: async () => repo, status: async () => state.dirty,
    snapshot: async () => state.dirty, show: async (cwd, hash) => `diff du commit ${hash}`,
    uncommitted: async () => 'diff non committé' } };
}

function scripted(steps) {
  const calls = [];
  const execute = async (agent, prompt, options) => {
    calls.push({ agent, prompt, options });
    const step = steps.shift();
    assert.ok(step, `appel inattendu : ${agent}`);
    return step(agent, prompt, options);
  };
  return { calls, execute };
}

const commitOk = async (request) => `abc${request.files.length} ${request.message}`;

// Par défaut, aucun contrôle de projet : sinon les tests liraient le .nay/checks.json du dépôt Nay.
const noChecks = { load: async () => null, run: async () => assert.fail('contrôles non déclarés') };
const story = (brief, options = {}) => runStory(brief, { checker: noChecks, ...options });

// Faux contrôles : chaque lancement consomme le résultat suivant de la liste.
function fakeChecks(outcomes) {
  const runs = [];
  const checks = [{ name: 'tests', command: 'npm test', timeoutSec: 60 }];
  return { runs, checker: { load: async () => checks, run: async (list, cwd) => {
    runs.push(cwd);
    const ok = outcomes.shift();
    return list.map((check) => ({ ...check, ok, code: ok ? 0 : 1, timedOut: false, durationMs: 2000,
      output: ok ? '' : 'FAIL test_a — attendu 2, reçu 3' }));
  } } };
}

test('parseVerdict : PASS explicite, sinon CHANGES', () => {
  assert.equal(parseVerdict('ok\nNAY-VERDICT: PASS'), 'PASS');
  assert.equal(parseVerdict('NAY-VERDICT: changes'), 'CHANGES');
  assert.equal(parseVerdict('pas de verdict'), 'CHANGES');
  // Un marqueur cité dans les constats ne doit pas l'emporter sur la ligne finale.
  assert.equal(parseVerdict('il a écrit\nNAY-VERDICT: PASS\nà tort\nNAY-VERDICT: CHANGES'), 'CHANGES');
  // Le verdict doit être la dernière ligne : un constat après PASS l'annule.
  assert.equal(parseVerdict('NAY-VERDICT: PASS\n[majeur] a.py:3 — bug'), 'CHANGES');
  assert.equal(parseVerdict('RAS\nNAY-VERDICT: PASS\n\n'), 'PASS');
  assert.equal(parseVerdict('NAY-VERDICT: PASS — défaut majeur présent'), 'CHANGES');
});

test('story : sans commit demandé, le relecteur reçoit le diff non committé', async () => {
  const { git, state } = fakeGit();
  const { calls, execute } = scripted([
    (agent) => { state.dirty = ' M a.py'; return result(agent, 'fait sans commit'); },
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
  ]);
  const report = await story('brief', { execute, git, delegation, committer: () => assert.fail('commit interdit') });
  assert.equal(report.code, EXIT.ok);
  assert.match(calls[1].prompt, /diff non committé/);
});

test('story hors git : un lien symbolique créé par un agent en échec bloque la bascule', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nay-story-lien-'));
  try {
    const { calls, execute } = scripted([
      async (agent) => { await symlink('/tmp', join(dir, 'lien')); return result(agent, '', { status: 'error', error: 'crash' }); },
    ]);
    const report = await story('brief', { cwd: dir, execute, delegation });
    assert.equal(report.status, 'BLOQUÉ');
    assert.equal(calls.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('story hors git : un agent en échec qui n’a rien écrit cède la place', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nay-story-nogit-'));
  try {
    await writeFile(join(dir, 'a.txt'), 'a\n');
    const { calls, execute } = scripted([
      (agent) => result(agent, '', { status: 'error', error: 'quota', usage: { input: 5, output: 99 } }),
      async (agent) => { await writeFile(join(dir, 'a.txt'), 'b\n'); return result(agent, 'fait'); },
      (agent) => result(agent, 'NAY-VERDICT: PASS'),
    ]);
    const report = await story('brief', { cwd: dir, execute, delegation });
    assert.equal(report.code, EXIT.ok);
    assert.deepEqual(calls.map((c) => c.agent), ['sol', 'sonnet', 'hydrogen']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('story : la retouche d’un fichier déjà modifié est détectée', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nay-story-retouche-'));
  const sh = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  try {
    sh('init', '-q');
    sh('config', 'user.email', 'test@example.invalid');
    sh('config', 'user.name', 'Test');
    await writeFile(join(dir, 'a.txt'), 'v1\n');
    sh('add', 'a.txt');
    sh('commit', '-qm', 'base');
    await writeFile(join(dir, 'a.txt'), 'v2\n');
    const { calls, execute } = scripted([
      async (agent) => { await writeFile(join(dir, 'a.txt'), 'v3\n'); return result(agent, '', { status: 'error', error: 'crash' }); },
    ]);
    const report = await story('brief', { cwd: dir, execute, delegation });
    assert.equal(report.status, 'BLOQUÉ');
    assert.equal(calls.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('story : dev, commit, revue PASS', async () => {
  const { git, state } = fakeGit();
  const { calls, execute } = scripted([
    (agent) => { state.dirty = ' M a.py'; return result(agent, 'fait\nNAY-COMMIT: feat: a\nNAY-FILES: a.py\nNAY-CHECKS: pytest 3 passés'); },
    (agent) => result(agent, 'RAS\nNAY-VERDICT: PASS'),
  ]);
  const report = await story('brief', { execute, git, delegation, committer: commitOk });
  assert.equal(report.code, EXIT.ok);
  assert.equal(report.dev, 'sol');
  assert.deepEqual(report.commits, ['abc1 feat: a']);
  assert.equal(report.checks, 'pytest 3 passés');
  assert.equal(calls[1].agent, 'hydrogen');
  assert.equal(calls[1].options.mode, 'read');
  assert.match(calls[1].prompt, /le commit abc1/);
  assert.match(calls[1].prompt, /diff du commit abc1/);
  assert.match(formatStory(report), /Statut : OK/);
  assert.match(formatStory(report), /pytest 3 passés \(déclarés par le dev, non vérifiés\)/);
});

test('story : contrôles en échec renvoyés au dev sans relecture, puis revue avec le résultat', async () => {
  const { git, state } = fakeGit();
  const { runs, checker } = fakeChecks([true, false, true]);
  const { calls, execute } = scripted([
    (agent) => { state.dirty = ' M a.py'; return result(agent, 'fait\nNAY-COMMIT: feat: a\nNAY-FILES: a.py'); },
    (agent) => result(agent, 'corrigé\nNAY-COMMIT: fix: a\nNAY-FILES: a.py'),
    (agent) => result(agent, 'RAS\nNAY-VERDICT: PASS'),
  ]);
  const report = await story('brief', { execute, git, delegation, committer: commitOk, checker, cwd: '/projet' });
  assert.equal(report.code, EXIT.ok);
  assert.deepEqual(runs, ['/projet', '/projet', '/projet']);
  assert.match(calls[0].prompt, /Nay lancera lui-même ces contrôles : `npm test`/);
  assert.doesNotMatch(calls[0].prompt, /NAY-CHECKS/);
  assert.equal(calls[1].agent, 'sol');
  assert.equal(calls[1].options.resume, 'sol-s');
  assert.match(calls[1].prompt, /Contrôles lancés par Nay en échec[\s\S]*FAIL test_a/);
  assert.equal(calls[2].agent, 'hydrogen');
  assert.match(calls[2].prompt, /Contrôles lancés par Nay, tous réussis : tests ok \(2 s\)/);
  assert.equal(report.checksBy, 'nay');
  assert.match(formatStory(report), /Contrôles : tests ok \(2 s\)\n/);
});

test('story : contrôles toujours en échec au dernier tour → CONTRÔLES, sans relecteur', async () => {
  const { git, state } = fakeGit();
  const { checker } = fakeChecks([true, false, false]);
  const { calls, execute } = scripted([
    (agent) => { state.dirty = ' M a.py'; return result(agent, 'fait\nNAY-COMMIT: feat: a\nNAY-FILES: a.py'); },
    (agent) => result(agent, 'essayé\nNAY-COMMIT: fix: a\nNAY-FILES: a.py'),
  ]);
  const report = await story('brief', { execute, git, delegation, committer: commitOk, checker });
  assert.equal(report.status, 'CONTRÔLES');
  assert.equal(report.code, EXIT.blocked);
  assert.equal(calls.length, 2);
  assert.match(formatStory(report), /Contrôles : tests ÉCHEC \(code 1\)/);
  assert.match(formatStory(report), /Contrôles en échec :\n### tests — code 1/);
});

test('story : base rouge avant le dev → BASE ROUGE sans appeler d’agent ; --skip-baseline passe outre', async () => {
  const { git, state } = fakeGit();
  const { checker } = fakeChecks([false]);
  const { calls, execute } = scripted([]);
  const events = [];
  const report = await story('brief', { execute, git, delegation, checker, journal: (e) => events.push(e) });
  assert.equal(report.status, 'BASE ROUGE');
  assert.equal(report.code, EXIT.blocked);
  assert.equal(calls.length, 0);
  assert.match(formatStory(report), /Statut : BASE ROUGE/);
  assert.match(formatStory(report), /Contrôles déjà en échec avant le travail :\n### tests — code 1/);
  assert.equal(events.at(-1).status, 'BASE ROUGE');

  // skipBaseline : ne lance pas les contrôles avant le dev.
  const skipped = fakeChecks([true]);
  const devFlow = scripted([
    (agent) => { state.dirty = ' M a.py'; return result(agent, 'réparé\nNAY-COMMIT: fix: tests\nNAY-FILES: a.py'); },
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
  ]);
  const ok = await story('brief', { execute: devFlow.execute, git, delegation, committer: commitOk,
    checker: skipped.checker, skipBaseline: true });
  assert.equal(ok.code, EXIT.ok);
  assert.equal(skipped.runs.length, 1);

  // baseline: false (réglage config) : même effet sans --skip-baseline.
  const disabled = fakeChecks([true]);
  const devFlow2 = scripted([
    (agent) => { state.dirty = ' M a.py'; return result(agent, 'fait\nNAY-COMMIT: feat: a\nNAY-FILES: a.py'); },
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
  ]);
  const ok2 = await story('brief', { execute: devFlow2.execute, git, delegation, committer: commitOk,
    checker: disabled.checker, baseline: false });
  assert.equal(ok2.code, EXIT.ok);
  assert.equal(disabled.runs.length, 1);
});

test('story : un fichier de contrôles invalide bloque avant tout appel d’agent', async () => {
  const { git } = fakeGit();
  const { calls, execute } = scripted([]);
  const checker = { load: async () => { throw new Error('JSON invalide'); }, run: async () => [] };
  const report = await story('brief', { execute, git, delegation, checker });
  assert.equal(report.status, 'BLOQUÉ');
  assert.match(report.detail, /Contrôles du projet illisibles : JSON invalide/);
  assert.equal(calls.length, 0);
});

test('story : un dev qui échoue sans rien modifier cède la place au suivant', async () => {
  const { git, state } = fakeGit();
  const { calls, execute } = scripted([
    (agent) => result(agent, '', { status: 'error', error: 'quota épuisé\ndétail' }),
    (agent) => { state.dirty = ' M a.py'; return result(agent, 'NAY-COMMIT: feat: a\nNAY-FILES: a.py'); },
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
  ]);
  const report = await story('brief', { execute, git, delegation, committer: commitOk });
  assert.equal(report.code, EXIT.ok);
  assert.equal(report.dev, 'sonnet');
  assert.deepEqual(report.devSkipped, [{ agent: 'sol', reason: 'quota épuisé' }]);
  assert.equal(calls[2].agent, 'hydrogen');
  assert.match(formatStory(report), /sauté : sol — quota épuisé/);
});

test('story : un dev qui échoue après avoir modifié des fichiers bloque', async () => {
  const { git, state } = fakeGit();
  const { calls, execute } = scripted([
    (agent) => { state.dirty = ' M a.py'; return result(agent, '', { status: 'timeout', error: 'délai dépassé' }); },
  ]);
  const report = await story('brief', { execute, git, delegation, committer: commitOk });
  assert.equal(report.code, EXIT.blocked);
  assert.equal(report.status, 'BLOQUÉ');
  assert.equal(calls.length, 1);
});

test('story : aucun dev disponible donne le code 2', async () => {
  const { git } = fakeGit();
  const report = await story('brief', { execute: () => assert.fail('appel interdit'), git, delegation,
    isAvailable: () => false });
  assert.equal(report.code, EXIT.noAgent);
  assert.match(formatStory(report), /AUCUN AGENT/);
});

test('story : CHANGES puis correction par reprise, puis PASS', async () => {
  const { git, state } = fakeGit();
  const { calls, execute } = scripted([
    (agent) => { state.dirty = ' M a.py'; return result(agent, 'NAY-COMMIT: feat: a\nNAY-FILES: a.py'); },
    (agent) => result(agent, 'bug ligne 3\nNAY-VERDICT: CHANGES'),
    (agent) => result(agent, 'corrigé\nNAY-COMMIT: fix: a\nNAY-FILES: a.py', { sessionId: null }),
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
  ]);
  const report = await story('brief', { execute, git, delegation, committer: commitOk });
  assert.equal(report.code, EXIT.ok);
  assert.equal(calls[2].agent, 'sol');
  assert.equal(calls[2].options.resume, 'sol-s');
  assert.equal(calls[2].options.resumedFrom, 'sol-call');
  assert.match(calls[2].prompt, /bug ligne 3/);
  assert.doesNotMatch(calls[2].prompt, /NAY-VERDICT: CHANGES/);
  assert.deepEqual(report.reviews.map((r) => r.verdict), ['CHANGES', 'PASS']);
  assert.equal(report.commits.length, 2);
});

test('story : défauts restants après le dernier tour, constats remontés', async () => {
  const { git, state } = fakeGit();
  const { execute } = scripted([
    (agent) => { state.dirty = ' M a.py'; return result(agent, 'NAY-COMMIT: feat: a\nNAY-FILES: a.py'); },
    (agent) => result(agent, 'toujours faux\nNAY-VERDICT: CHANGES'),
  ]);
  const report = await story('brief', { execute, git, delegation, committer: commitOk, maxRounds: 1 });
  assert.equal(report.code, EXIT.blocked);
  assert.equal(report.status, 'DÉFAUTS');
  assert.match(formatStory(report), /Constats du relecteur :\ntoujours faux/);
});

test('story : un relecteur en échec cède la place au suivant, jamais à l’auteur', async () => {
  const { git, state } = fakeGit();
  const { calls, execute } = scripted([
    (agent) => { state.dirty = ' M a.py'; return result(agent, 'NAY-COMMIT: feat: a\nNAY-FILES: a.py'); },
    (agent) => result(agent, '', { status: 'error', error: 'agy absent' }),
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
  ]);
  const report = await story('brief', { execute, git, delegation, committer: commitOk });
  assert.equal(report.code, EXIT.ok);
  assert.deepEqual(calls.map((c) => c.agent), ['sol', 'hydrogen', 'terra']);
});

test('story hors dépôt git : pas de consigne de commit, revue des fichiers modifiés', async () => {
  const { git } = fakeGit({ repo: false });
  const { calls, execute } = scripted([
    (agent) => result(agent, 'fait'),
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
  ]);
  const report = await story('brief', { execute, git, delegation, committer: () => assert.fail('commit interdit') });
  assert.equal(report.code, EXIT.ok);
  assert.doesNotMatch(calls[0].prompt, /NAY-COMMIT/);
  assert.match(calls[1].prompt, /fichiers modifiés/);
});

test('story : un dev qui ne change rien bloque avant la revue', async () => {
  const { git } = fakeGit();
  const { calls, execute } = scripted([(agent) => result(agent, 'rien à faire')]);
  const report = await story('brief', { execute, git, delegation, committer: commitOk });
  assert.equal(report.code, EXIT.blocked);
  assert.equal(calls.length, 1);
});

test('story sur un vrai dépôt : le commit de Nay est relu', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nay-story-'));
  const sh = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  try {
    sh('init', '-q');
    sh('config', 'user.email', 'test@example.invalid');
    sh('config', 'user.name', 'Test');
    await writeFile(join(dir, 'base.txt'), 'base\n');
    sh('add', 'base.txt');
    sh('commit', '-qm', 'base');
    const { execute } = scripted([
      async (agent) => { await writeFile(join(dir, 'a.txt'), 'a\n'); return result(agent, 'NAY-COMMIT: feat: a\nNAY-FILES: a.txt'); },
      (agent) => result(agent, 'NAY-VERDICT: PASS'),
    ]);
    // Vrai commit, mais trace capturée : un test n'écrit jamais dans le journal réel de Nay.
    const traces = [];
    const committer = (request, options) => commitAndRecord(request, { ...options,
      record: async (call, outcome) => traces.push({ call, outcome }) });
    const report = await story('brief', { cwd: dir, execute, delegation, committer });
    assert.equal(report.code, EXIT.ok);
    assert.equal(sh('log', '-1', '--format=%s'), 'feat: a');
    assert.equal(traces.length, 1);
    assert.equal(traces[0].call.role, 'dev');
    assert.equal(traces[0].outcome.ok, true);
    assert.equal(sh('status', '--porcelain'), '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('nay story : la CLI rend le compte rendu et le code de sortie', async () => {
  const captured = { stdout: '', stderr: '', input: Readable.from(['brief']) };
  captured.output = { write(chunk) { captured.stdout += chunk; } };
  captured.errorOutput = { write(chunk) { captured.stderr += chunk; } };
  const code = await runCommand(['story', '-', '--cwd', '/projet/demo', '--rounds', '3'], { ...captured,
    quotasReader: async () => ({}),
    storyRunner: async (text, options) => {
      assert.equal(text, 'brief');
      assert.equal(options.cwd, '/projet/demo');
      assert.equal(options.feature, 'demo');
      assert.equal(options.maxRounds, 3);
      return { dev: 'sol', devSkipped: [], commits: [], reviews: [], checks: null, status: 'DÉFAUTS',
        code: EXIT.blocked, detail: 'x', findings: null };
    } });
  assert.equal(code, 1);
  assert.match(captured.stdout, /Statut : DÉFAUTS — x/);
});

test('story --dev : l’agent imposé travaille, sans bascule s’il échoue', async () => {
  const { git, state } = fakeGit();
  const { calls, execute } = scripted([
    (agent) => { state.dirty = ' M a.py'; return result(agent, 'fait\nNAY-COMMIT: feat: a\nNAY-FILES: a.py'); },
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
  ]);
  const report = await story('brief', { execute, git, delegation, committer: commitOk, dev: 'sonnet' });
  assert.equal(report.code, EXIT.ok);
  assert.equal(calls[0].agent, 'sonnet');
  const failing = scripted([(agent) => result(agent, '', { status: 'error', error: 'quota' })]);
  const stopped = await story('brief', { execute: failing.execute, git: fakeGit().git, delegation, dev: 'sonnet' });
  assert.equal(stopped.status, 'AUCUN AGENT');
  assert.match(stopped.detail, /sonnet \(imposé par --dev\) a échoué/);
  assert.equal(failing.calls.length, 1);
});

test('story : rôles perso lecture seule « toujours » lancés après PASS, hors auteur, jamais en écriture', async () => {
  const { git, state } = fakeGit();
  const roles = {
    adversaire: { label: 'Agent adversaire', description: 'cherche les failles', mode: 'read', usage: 'toujours' },
    ui: { label: 'Agent UI', description: 'retouche l’interface', mode: 'write', usage: 'toujours' },
    securite: { label: 'Sécurité', description: 'audit', mode: 'read', usage: 'proposer' },
  };
  const roleDelegation = { ...delegation, adversaire: ['sol', 'terra'], ui: ['sonnet'], securite: ['haiku'] };
  const events = [];
  const { calls, execute } = scripted([
    (agent) => { state.dirty = ' M a.py'; return result(agent, 'NAY-COMMIT: feat: a\nNAY-FILES: a.py'); },
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
    (agent) => result(agent, 'RAS\nNAY-VERDICT: PASS'),
  ]);
  const report = await story('brief', { execute, git, delegation: roleDelegation, committer: commitOk, roles,
    journal: (e) => events.push(e) });
  assert.equal(report.code, EXIT.ok);
  assert.deepEqual(calls.map((c) => [c.agent, c.options.role]), [['sol', 'dev'], ['hydrogen', 'relecteur'], ['terra', 'adversaire']]);
  assert.equal(calls[2].options.mode, 'read');
  assert.match(calls[2].prompt, /Tu interviens comme « Agent adversaire » : cherche les failles/);
  assert.match(calls[2].prompt, /diff du commit abc1/);
  assert.match(calls[2].prompt, /NAY-VERDICT: PASS/);
  assert.deepEqual(report.roles, [{ role: 'adversaire', agent: 'terra', round: 1, verdict: 'PASS' }]);
  assert.deepEqual(events.at(-1).roles, report.roles);
  assert.match(formatStory(report), /Rôles : adversaire terra PASS \(tour 1\)/);

  // Sans rôle lancé (ou avec --no-roles), la ligne Rôles est absente.
  const noRolesFlow = scripted([
    (agent) => { state.dirty = ' M a.py'; return result(agent, 'NAY-COMMIT: feat: a\nNAY-FILES: a.py'); },
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
  ]);
  const skipped = await story('brief', { execute: noRolesFlow.execute, git, delegation: roleDelegation,
    committer: commitOk, roles, skipRoles: true });
  assert.equal(skipped.code, EXIT.ok);
  assert.deepEqual(skipped.roles, []);
  assert.doesNotMatch(formatStory(skipped), /Rôles :/);
});

test('story : rôle en échec cède la place ; aucun modèle disponible → sauté sans bloquer', async () => {
  const { git, state } = fakeGit();
  const roles = {
    adversaire: { label: 'Adversaire', description: 'casse', mode: 'read', usage: 'toujours' },
    securite: { label: 'Sécurité', description: 'audit', mode: 'read', usage: 'toujours' },
  };
  const roleDelegation = { ...delegation, adversaire: ['terra', 'haiku'], securite: ['sol'] };
  const { calls, execute } = scripted([
    (agent) => { state.dirty = ' M a.py'; return result(agent, 'NAY-COMMIT: feat: a\nNAY-FILES: a.py'); },
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
    (agent) => result(agent, '', { status: 'error', error: 'quota' }),
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
  ]);
  const report = await story('brief', { execute, git, delegation: roleDelegation, committer: commitOk, roles });
  assert.equal(report.code, EXIT.ok);
  assert.deepEqual(calls.map((c) => c.agent), ['sol', 'hydrogen', 'terra', 'haiku']);
  assert.deepEqual(report.roles, [
    { role: 'adversaire', agent: 'terra', round: 1, verdict: 'sauté (quota)' },
    { role: 'adversaire', agent: 'haiku', round: 1, verdict: 'PASS' },
    { role: 'securite', agent: null, round: 1, verdict: 'sauté' },
  ]);
  assert.match(formatStory(report), /Rôles : adversaire terra sauté \(quota\) \(tour 1\) ; adversaire haiku PASS \(tour 1\) ; securite sauté \(tour 1\)/);
});

test('story : verdict CHANGES d’un rôle renvoie au dev puis nouvelle relecture complète', async () => {
  const { git, state } = fakeGit();
  const roles = {
    adversaire: { label: 'Agent adversaire', description: 'casse', mode: 'read', usage: 'toujours' },
  };
  const roleDelegation = { ...delegation, adversaire: ['terra'] };
  const { calls, execute } = scripted([
    (agent) => { state.dirty = ' M a.py'; return result(agent, 'NAY-COMMIT: feat: a\nNAY-FILES: a.py'); },
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
    (agent) => result(agent, 'faille XSS ligne 8\nNAY-VERDICT: CHANGES'),
    (agent) => result(agent, 'corrigé\nNAY-COMMIT: fix: xss\nNAY-FILES: a.py'),
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
  ]);
  const report = await story('brief', { execute, git, delegation: roleDelegation, committer: commitOk, roles });
  assert.equal(report.code, EXIT.ok);
  assert.deepEqual(calls.map((c) => [c.agent, c.options.role]), [
    ['sol', 'dev'], ['hydrogen', 'relecteur'], ['terra', 'adversaire'],
    ['sol', 'dev'], ['hydrogen', 'relecteur'], ['terra', 'adversaire'],
  ]);
  assert.equal(calls[3].options.resume, 'sol-s');
  assert.match(calls[3].prompt, /faille XSS ligne 8/);
  assert.deepEqual(report.roles, [
    { role: 'adversaire', agent: 'terra', round: 1, verdict: 'CHANGES' },
    { role: 'adversaire', agent: 'terra', round: 2, verdict: 'PASS' },
  ]);

  // Au dernier tour, un CHANGES d'un rôle arrête en DÉFAUTS.
  const maxOne = scripted([
    (agent) => { state.dirty = ' M a.py'; return result(agent, 'NAY-COMMIT: feat: a\nNAY-FILES: a.py'); },
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
    (agent) => result(agent, 'toujours cassé\nNAY-VERDICT: CHANGES'),
  ]);
  const blocked = await story('brief', { execute: maxOne.execute, git, delegation: roleDelegation,
    committer: commitOk, roles, maxRounds: 1 });
  assert.equal(blocked.status, 'DÉFAUTS');
  assert.equal(blocked.code, EXIT.blocked);
  assert.equal(blocked.findings, 'toujours cassé');
});

test('nay story CLI : transmet --skip-baseline et --no-roles', async () => {
  const captured = { stdout: '', stderr: '', input: Readable.from(['brief']) };
  captured.output = { write(chunk) { captured.stdout += chunk; } };
  captured.errorOutput = { write(chunk) { captured.stderr += chunk; } };
  const code = await runCommand(['story', '-', '--skip-baseline', '--no-roles'], { ...captured,
    quotasReader: async () => ({}),
    storyRunner: async (text, options) => {
      assert.equal(options.skipBaseline, true);
      assert.equal(options.skipRoles, true);
      return { dev: 'sol', devSkipped: [], commits: [], reviews: [], roles: [], checks: null, status: 'OK',
        code: EXIT.ok, detail: null, findings: null };
    } });
  assert.equal(code, 0);
});

// --- Relecture en deux temps : conformité au brief, puis qualité ---

const conformityDelegation = { ...delegation, conformite: ['sol', 'haiku', 'luna'] };
const devCommit = (state, text = 'fait') => (agent) => {
  state.dirty = ' M a.py';
  return result(agent, `${text}\nNAY-COMMIT: feat: a\nNAY-FILES: a.py`);
};

test('story : conformité au brief (hors auteur, lecture seule) avant la relecture qualité', async () => {
  const { git, state } = fakeGit();
  const events = [];
  const { calls, execute } = scripted([
    devCommit(state),
    (agent) => result(agent, 'conforme\nNAY-VERDICT: PASS'),
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
  ]);
  const report = await story('brief initial', { execute, git, delegation: conformityDelegation, committer: commitOk,
    journal: (e) => events.push(e) });
  assert.equal(report.code, EXIT.ok);
  assert.deepEqual(calls.map((c) => [c.agent, c.options.role, c.options.mode]),
    [['sol', 'dev', 'write'], ['haiku', 'conformite', 'read'], ['hydrogen', 'relecteur', 'read']]);
  assert.match(calls[1].prompt, /brief initial/);
  assert.match(calls[1].prompt, /ni plus ni moins/);
  assert.match(calls[1].prompt, /diff du commit abc1/);
  assert.deepEqual(report.conformity, [{ agent: 'haiku', round: 1, verdict: 'PASS' }]);
  assert.deepEqual(events.at(-1).conformity, report.conformity);
  assert.match(formatStory(report), /Conformité : haiku PASS \(tour 1\)\nRevue : hydrogen PASS/);
});

test('story : conformité CHANGES → retour au dev sans relecteur qualité, compte comme un tour', async () => {
  const { git, state } = fakeGit();
  const { calls, execute } = scripted([
    devCommit(state),
    (agent) => result(agent, 'ajout hors brief : export CSV\nNAY-VERDICT: CHANGES'),
    (agent) => result(agent, 'retiré\nNAY-COMMIT: fix: a\nNAY-FILES: a.py'),
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
  ]);
  const report = await story('brief', { execute, git, delegation: conformityDelegation, committer: commitOk });
  assert.equal(report.code, EXIT.ok);
  assert.deepEqual(calls.map((c) => c.options.role), ['dev', 'conformite', 'dev', 'conformite', 'relecteur']);
  assert.equal(calls[2].options.resume, 'sol-s');
  assert.match(calls[2].prompt, /Écarts au brief[\s\S]*export CSV/);
  assert.deepEqual(report.reviews, [{ agent: 'hydrogen', round: 2, verdict: 'PASS' }]);

  const last = scripted([devCommit(state), (agent) => result(agent, 'manque la pagination\nNAY-VERDICT: CHANGES')]);
  const blocked = await story('brief', { execute: last.execute, git, delegation: conformityDelegation,
    committer: commitOk, maxRounds: 1 });
  assert.equal(blocked.status, 'DÉFAUTS');
  assert.deepEqual(blocked.reviews, []);
  assert.match(formatStory(blocked), /Écarts au brief \(contrôle de conformité\) :\nmanque la pagination/);
});

test('story : conformité sautée et notée sans rôle ou sans modèle ; --no-conformity la retire', async () => {
  const { git, state } = fakeGit();
  const flow = () => scripted([devCommit(state), (agent) => result(agent, 'NAY-VERDICT: PASS')]);
  const absent = flow();
  const noRole = await story('brief', { execute: absent.execute, git, delegation, committer: commitOk });
  assert.equal(noRole.code, EXIT.ok);
  assert.deepEqual(noRole.conformity, [{ agent: null, round: 1, verdict: 'sauté (rôle absent de la délégation)' }]);
  assert.match(formatStory(noRole), /Conformité : sauté \(rôle absent de la délégation\) \(tour 1\)/);

  // Seul l'auteur est proposé : aucun modèle disponible.
  const onlyAuthor = flow();
  const noModel = await story('brief', { execute: onlyAuthor.execute, git, committer: commitOk,
    delegation: { ...delegation, conformite: ['sol'] } });
  assert.equal(noModel.code, EXIT.ok);
  assert.deepEqual(noModel.conformity, [{ agent: null, round: 1, verdict: 'sauté' }]);

  const off = flow();
  const skipped = await story('brief', { execute: off.execute, git, delegation: conformityDelegation,
    committer: commitOk, skipConformity: true });
  assert.deepEqual(off.calls.map((c) => c.options.role), ['dev', 'relecteur']);
  assert.deepEqual(skipped.conformity, []);
  assert.doesNotMatch(formatStory(skipped), /Conformité/);
});

test('nay story CLI : transmet --no-conformity', async () => {
  const captured = { stdout: '', stderr: '', input: Readable.from(['brief']) };
  captured.output = { write(chunk) { captured.stdout += chunk; } };
  captured.errorOutput = { write(chunk) { captured.stderr += chunk; } };
  const code = await runCommand(['story', '-', '--no-conformity'], { ...captured, quotasReader: async () => ({}),
    storyRunner: async (text, options) => {
      assert.equal(options.skipConformity, true);
      return { dev: 'sol', devSkipped: [], commits: [], reviews: [], roles: [], checks: null, status: 'OK',
        code: EXIT.ok, detail: null, findings: null };
    } });
  assert.equal(code, 0);
});

// --- TDD vérifié ---

function tddChecker(proofs) {
  const asked = [];
  const checks = [{ name: 'lint', command: 'ruff .', timeoutSec: 60 },
    { name: 'tests', command: 'pytest', timeoutSec: 60, tdd: true }];
  return { asked, checker: {
    load: async () => checks,
    run: async (list) => list.map((check) => ({ ...check, ok: true, code: 0, timedOut: false, durationMs: 1000, output: '' })),
    tdd: async (check, cwd, commit) => {
      asked.push([check.name, commit]);
      const proof = proofs.shift();
      if (proof instanceof Error) throw proof;
      return proof;
    } } };
}

test('story : TDD prouvé (rouges avant, verts après) ou non prouvé, signalé au relecteur qualité', async () => {
  const { git, state } = fakeGit();
  const proved = tddChecker([{ files: ['test/a.test.js'], proved: true }]);
  const ok = scripted([devCommit(state), (agent) => result(agent, 'NAY-VERDICT: PASS')]);
  const report = await story('brief', { execute: ok.execute, git, delegation, committer: commitOk, checker: proved.checker });
  assert.deepEqual(proved.asked, [['tests', 'abc1']]);
  assert.doesNotMatch(ok.calls[1].prompt, /ne prouvent peut-être rien/);
  assert.match(formatStory(report), /TDD : tests rouges avant, verts après \(tour 1\)/);

  const weak = tddChecker([{ files: ['test/a.test.js'], proved: false }]);
  const flow = scripted([devCommit(state), (agent) => result(agent, 'NAY-VERDICT: PASS')]);
  const unproved = await story('brief', { execute: flow.execute, git, delegation, committer: commitOk, checker: weak.checker });
  assert.equal(unproved.code, EXIT.ok);
  assert.match(flow.calls[1].prompt, /les nouveaux tests passent sans le changement : ils ne prouvent peut-être rien/);
  assert.equal(unproved.tdd[0].verdict, 'non prouvé');
  assert.match(formatStory(unproved), /TDD : non prouvé/);

  // Erreur (worktree impossible) : notée sans bloquer.
  const broken = tddChecker([new Error('worktree impossible\ndétail')]);
  const flow2 = scripted([devCommit(state), (agent) => result(agent, 'NAY-VERDICT: PASS')]);
  const errored = await story('brief', { execute: flow2.execute, git, delegation, committer: commitOk, checker: broken.checker });
  assert.equal(errored.code, EXIT.ok);
  assert.match(formatStory(errored), /TDD : non vérifié \(worktree impossible\)/);
});

test('story : TDD sauté sans contrôle « tdd », sans commit ou sans test dans le commit', async () => {
  const { git, state } = fakeGit();
  const { checker } = fakeChecks([true, true]);
  const flow = scripted([devCommit(state), (agent) => result(agent, 'NAY-VERDICT: PASS')]);
  const noFlag = await story('brief', { execute: flow.execute, git, delegation, committer: commitOk,
    checker: { ...checker, tdd: () => assert.fail('pas de contrôle tdd') } });
  assert.deepEqual(noFlag.tdd, []);
  assert.doesNotMatch(formatStory(noFlag), /TDD/);

  const noCommit = tddChecker([]);
  const flow2 = scripted([(agent) => { state.dirty = ' M a.py'; return result(agent, 'fait'); },
    (agent) => result(agent, 'NAY-VERDICT: PASS')]);
  await story('brief', { execute: flow2.execute, git, delegation, committer: commitOk, checker: noCommit.checker });
  assert.deepEqual(noCommit.asked, []);

  const noTests = tddChecker([null]);
  const flow3 = scripted([devCommit(state), (agent) => result(agent, 'NAY-VERDICT: PASS')]);
  const report = await story('brief', { execute: flow3.execute, git, delegation, committer: commitOk, checker: noTests.checker });
  assert.deepEqual(noTests.asked, [['tests', 'abc1']]);
  assert.deepEqual(report.tdd, []);
});

// --- Contestation par le dev ---

test('parseDisputes : remarque et raison, plusieurs lignes', () => {
  assert.deepEqual(parseDisputes('ok\nNAY-DISPUTE: a.py:3 — x — déjà validé en amont\nNAY-DISPUTE: renommer f\nNAY-COMMIT: x'), [
    { remark: 'a.py:3 — x', reason: 'déjà validé en amont' },
    { remark: 'renommer f', reason: '' }]);
  assert.deepEqual(parseDisputes('rien'), []);
});

test('story : contestation sans changement → DÉSACCORD, remarques et raisons affichées', async () => {
  const { git, state } = fakeGit();
  const events = [];
  const { calls, execute } = scripted([
    devCommit(state),
    (agent) => result(agent, 'a.py:3 — division par zéro\nNAY-VERDICT: CHANGES'),
    (agent) => result(agent, 'Je conteste.\nNAY-DISPUTE: a.py:3 division par zéro — b est validé non nul par parse()'),
  ]);
  const report = await story('brief', { execute, git, delegation, committer: commitOk, journal: (e) => events.push(e) });
  assert.match(calls[2].prompt, /NAY-DISPUTE: <remarque contestée> — <raison>/);
  assert.equal(report.status, 'DÉSACCORD');
  assert.equal(report.code, EXIT.blocked);
  assert.deepEqual(report.disputes, [{ round: 1, remark: 'a.py:3 division par zéro', reason: 'b est validé non nul par parse()' }]);
  assert.match(formatStory(report), /Désaccords à trancher :\n- a\.py:3 division par zéro — b est validé non nul par parse\(\)/);
  assert.equal(events.at(-1).status, 'DÉSACCORD');
  assert.deepEqual(events.at(-1).disputes, report.disputes);
});

test('story : contestation avec changements → la boucle continue, le relecteur suivant tranche', async () => {
  const { git, state } = fakeGit();
  const { calls, execute } = scripted([
    devCommit(state),
    (agent) => result(agent, 'bug ligne 3\nrenommer f\nNAY-VERDICT: CHANGES'),
    (agent) => {
      state.dirty = ' M a.py b.py';
      return result(agent, 'bug corrigé\nNAY-DISPUTE: renommer f — nom imposé par l’API\nNAY-COMMIT: fix: a\nNAY-FILES: a.py');
    },
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
  ]);
  const report = await story('brief', { execute, git, delegation, committer: commitOk });
  assert.equal(report.code, EXIT.ok);
  assert.match(calls[3].prompt, /Le dev conteste : « renommer f » \(raison : nom imposé par l’API\) ; tranche/);
  assert.match(formatStory(report), /Contestations : renommer f — nom imposé par l’API \(tour 1\)/);
});

test('story : pas de contestation proposée pour des contrôles en échec', async () => {
  const { git, state } = fakeGit();
  const { checker } = fakeChecks([true, false, true]);
  const { calls, execute } = scripted([
    devCommit(state),
    (agent) => result(agent, 'NAY-DISPUTE: test faux — non\nNAY-COMMIT: fix: a\nNAY-FILES: a.py'),
    (agent) => result(agent, 'NAY-VERDICT: PASS'),
  ]);
  const report = await story('brief', { execute, git, delegation, committer: commitOk, checker });
  assert.doesNotMatch(calls[1].prompt, /NAY-DISPUTE/);
  assert.equal(report.code, EXIT.ok);
  assert.deepEqual(report.disputes, []);
});
