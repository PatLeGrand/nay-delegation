import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendUsage, readUsage } from '../src/usageLog.js';

test('Le journal crée le dossier, ajoute des appels et ignore les lignes corrompues', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nay-log-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'state', 'usage.jsonl');
  assert.deepEqual(await readUsage(path), []);
  await appendUsage({ agent: 'sol', feature: 'appel', role: 'dev', status: 'ok' }, path);
  await appendFile(path, 'invalide\n{"tronqué":\nnull\n\n');
  await appendUsage({ agent: 'luna', status: 'error' }, path);
  const entries = await readUsage(path);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].feature, 'appel');
  assert.equal(entries[0].role, 'dev');
  assert.match(entries[0].timestamp, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.equal(entries[1].agent, 'luna');
  assert.equal(entries[1].feature, null);
  assert.equal(entries[1].role, null);
});
