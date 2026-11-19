import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMIT_INSTRUCTIONS, commitRequest, parseCommitRequest } from '../src/commit.js';
import { runCommand } from '../src/command.js';

function streams(text = '') {
  const captured = { stdout: '', stderr: '', input: Readable.from([text]) };
  captured.output = { write(chunk) { captured.stdout += chunk; } };
  captured.errorOutput = { write(chunk) { captured.stderr += chunk; } };
  return captured;
}

const ok = (text) => ({ agent: 'sol', model: 'm', effort: 'e', status: 'ok', callId: 'c', sessionId: 's',
  text, durationMs: 1000, usage: { input: 1, output: 1 } });

async function repo() {
  const dir = await mkdtemp(join(tmpdir(), 'nay-commit-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  await writeFile(join(dir, 'base.txt'), 'base\n');
  git('add', 'base.txt');
  git('commit', '-qm', 'base');
  return { dir, git };
}

test('parseCommitRequest lit le message et les fichiers', () => {
  assert.deepEqual(parseCommitRequest('fait\nNAY-COMMIT: feat(x): ajout\nNAY-FILES: a.js  b/c.js\n'),
    { message: 'feat(x): ajout', files: ['a.js', 'b/c.js'] });
  assert.equal(parseCommitRequest('NAY-COMMIT: feat: sans fichiers'), null);
  assert.equal(parseCommitRequest('rien'), null);
});

test('commitRequest ne committe que les fichiers annoncés', async () => {
  const { dir, git } = await repo();
  try {
    await writeFile(join(dir, 'a.txt'), 'a\n');
    await writeFile(join(dir, 'autre.txt'), 'hors tâche\n');
    const line = await commitRequest({ message: 'feat: a', files: ['a.txt'] }, { cwd: dir });
    assert.match(line, /^[0-9a-f]+ feat: a$/);
    assert.equal(git('show', '--name-only', '--format=', 'HEAD'), 'a.txt');
    assert.equal(git('status', '--short'), '?? autre.txt');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('commitRequest refuse un fichier hors du dépôt', async () => {
  const { dir, git } = await repo();
  try {
    await assert.rejects(commitRequest({ message: 'x', files: ['../evil'] }, { cwd: dir }), /hors du dépôt/);
    assert.equal(git('log', '--oneline').split('\n').length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('nay run --commit ajoute la consigne et committe la demande de l’agent', async () => {
  const captured = streams('brief');
  let received;
  const code = await runCommand(['run', 'sol', '-', '--commit', '--cwd', '/work'], { ...captured,
    execute: async (agent, prompt) => { received = prompt; return ok('fait\nNAY-COMMIT: fix: y\nNAY-FILES: y.js'); },
    committer: async (request, { cwd }) => {
      assert.deepEqual(request, { message: 'fix: y', files: ['y.js'] });
      assert.equal(cwd, '/work');
      return 'abc123 fix: y';
    } });
  assert.equal(code, 0);
  assert.equal(received, `brief${COMMIT_INSTRUCTIONS}`);
  assert.match(captured.stdout, /Commit : abc123 fix: y/);
});

test('nay run --commit sans demande ne committe rien', async () => {
  const captured = streams('brief');
  const code = await runCommand(['run', 'sol', '-', '--commit'], { ...captured,
    execute: async () => ok('rien à faire'), committer: () => assert.fail('commit interdit') });
  assert.equal(code, 0);
  assert.match(captured.stdout, /Commit : aucun/);
});

test('un échec de commit fait échouer la commande', async () => {
  const captured = streams('brief');
  const code = await runCommand(['run', 'sol', '-', '--commit'], { ...captured,
    execute: async () => ok('NAY-COMMIT: x\nNAY-FILES: x'),
    committer: async () => { throw Object.assign(new Error('git'), { stderr: 'rien à valider' }); } });
  assert.equal(code, 1);
  assert.match(captured.stderr, /Commit : échec — rien à valider/);
});

test('--commit est refusé en lecture seule', async () => {
  const captured = streams('brief');
  const code = await runCommand(['run', 'sol', '-', '--commit', '--read-only'], { ...captured,
    execute: () => assert.fail('appel interdit') });
  assert.equal(code, 1);
  assert.match(captured.stderr, /incompatible/);
});

test('nay resume --commit committe dans le dossier de l’appel repris', async () => {
  const captured = streams('retours');
  const code = await runCommand(['resume', 'c', '-', '--commit'], { ...captured,
    resumer: async (callId, prompt) => {
      assert.equal(prompt, `retours${COMMIT_INSTRUCTIONS}`);
      return { ...ok('NAY-COMMIT: fix: z\nNAY-FILES: z.js'), cwd: '/repris' };
    },
    committer: async (request, { cwd }) => { assert.equal(cwd, '/repris'); return 'def fix: z'; } });
  assert.equal(code, 0);
  assert.match(captured.stdout, /Commit : def fix: z/);
});
