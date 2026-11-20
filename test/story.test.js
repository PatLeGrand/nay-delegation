import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT, formatStory, parseVerdict, runStory } from '../src/story.js';
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
  const { runs, checker } = fakeChecks([false, true]);
  const { calls, execute } = scripted([
    (agent) => { state.dirty = ' M a.py'; return result(agent, 'fait\nNAY-COMMIT: feat: a\nNAY-FILES: a.py'); },
    (agent) => result(agent, 'corrigé\nNAY-COMMIT: fix: a\nNAY-FILES: a.py'),
    (agent) => result(agent, 'RAS\nNAY-VERDICT: PASS'),
  ]);
  const report = await story('brief', { execute, git, delegation, committer: commitOk, checker, cwd: '/projet' });
  assert.equal(report.code, EXIT.ok);
  assert.deepEqual(runs, ['/projet', '/projet']);
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
  const { checker } = fakeChecks([false, false]);
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
  const none = scripted([]);
  const offQuota = await story('brief', { execute: none.execute, git: fakeGit().git, delegation, dev: 'sonnet',
    isAvailable: (agent) => agent !== 'sonnet' });
  assert.match(offQuota.detail, /sonnet \(imposé par --dev\) est indisponible/);
  const unknown = await story('brief', { execute: none.execute, git: fakeGit().git, delegation, dev: 'inconnu' });
  assert.equal(unknown.status, 'AUCUN AGENT');
  assert.match(unknown.detail, /agent inconnu : inconnu/);
  assert.equal(none.calls.length, 0);
});
