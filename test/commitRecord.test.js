import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitAndRecord, recordCommit } from '../src/commit.js';
import { loadEventConfig } from '../src/config.js';
import { applyEvent, emptyState } from '../src/monitor/state.js';

const request = { message: 'fix: y', files: ['y.js'] };
const call = { callId: 'c1', agent: 'sol', model: 'm', feature: 'f', role: 'dev' };

test('commitAndRecord trace un commit réussi et renvoie sa ligne', async () => {
  const recorded = [];
  const line = await commitAndRecord(request, { cwd: '/w', call,
    commit: async () => 'abc fix: y', record: async (c, outcome) => recorded.push([c, outcome]) });
  assert.equal(line, 'abc fix: y');
  assert.deepEqual(recorded, [[call, { message: 'fix: y', files: ['y.js'], cwd: '/w', ok: true, commit: 'abc fix: y' }]]);
});

test('commitAndRecord trace l’erreur exacte de git puis la relance', async () => {
  const recorded = [];
  const failure = Object.assign(new Error('Command failed'), { stderr: "fatal : le chemin 'x' ne correspond à aucun fichier\n" });
  await assert.rejects(commitAndRecord(request, { cwd: '/w', call,
    commit: async () => { throw failure; }, record: async (c, outcome) => recorded.push(outcome) }), failure);
  assert.equal(recorded[0].ok, false);
  assert.equal(recorded[0].error, "fatal : le chemin 'x' ne correspond à aucun fichier");
});

test('recordCommit écrit un événement commit lisible dans le journal de l’appel', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nay-journal-'));
  try {
    const now = () => new Date('2026-11-20T08:00:00.000Z');
    await recordCommit(call, { message: 'fix: y', files: ['y.js'], cwd: '/w', ok: false, error: 'refus' },
      { journalRoot: root, now });
    const dir = join(root, loadEventConfig().directory);
    const [file] = await readdir(dir);
    const event = JSON.parse((await readFile(join(dir, file), 'utf8')).trim());
    assert.equal(file, '2026-11-20.jsonl');
    assert.deepEqual({ ...event }, { v: 1, callId: 'c1', agent: 'sol', model: 'm', feature: 'f', role: 'dev',
      kind: 'commit', message: 'fix: y', files: ['y.js'], cwd: '/w', ok: false, error: 'refus', ts: '2026-11-20T08:00:00.000Z' });
    // Le moniteur garde l'appel et n'est pas perturbé par ce nouveau type d'événement.
    assert.ok(applyEvent(emptyState(), event, {}));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('recordCommit sans callId ne fait rien et n’échoue jamais', async () => {
  await recordCommit(undefined, { ok: true });
  // Racine impossible (sous un fichier) : l'écriture échoue, sans exception remontée.
  const root = await mkdtemp(join(tmpdir(), 'nay-journal-'));
  try {
    await writeFile(join(root, 'fichier'), 'x');
    await recordCommit({ callId: 'c' }, { ok: true }, { journalRoot: join(root, 'fichier') });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
