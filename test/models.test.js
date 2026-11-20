import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import {
  claudeModels, createCatalog, fetchCatalog, parseAgyModels, parseCodexModels,
} from '../src/models/catalog.js';
import { formatAgents, rolesUsing, validateAgent, validateName } from '../src/agents.js';
import { createServer } from '../src/server/app.js';
import { readConfig } from '../src/config.js';

const fixture = (name) => readFile(new URL(`./fixtures/models/${name}`, import.meta.url), 'utf8');
const epoch = Date.parse('2026-11-19T12:00:00Z');

test('Codex : modèles visibles seulement, efforts limités à ceux de Nay', async () => {
  const models = parseCodexModels(await fixture('codex.json'));
  assert.deepEqual(models.map((entry) => entry.model), ['gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6-luna']);
  assert.deepEqual(models[0].efforts, ['low', 'medium', 'high', 'xhigh']);
  assert.equal(models[0].defaultEffort, 'low');
  assert.equal(models[0].label, 'GPT-6.2-Sol');
  assert.throws(() => parseCodexModels('{}'), /liste/);
});

test('agy : variantes regroupées en modèle {effort}, modèles sans effort gardés tels quels', async () => {
  const models = parseAgyModels(await fixture('agy.txt'));
  const neon = models.find((entry) => entry.model === 'gemini-4-neon-{effort}');
  assert.deepEqual(neon.efforts, ['low', 'medium', 'high', 'xhigh']);
  assert.equal(neon.label, 'Gemini 4 Neon');
  const orchestrator = models.find((entry) => entry.model === 'gemini-pro-orchestrator-neon');
  assert.deepEqual(orchestrator.efforts, []);
  assert.ok(models.some((entry) => entry.model === 'claude-opus-5-5-{effort}'));
  assert.ok(!models.some((entry) => entry.model.startsWith('Fetching')));
  assert.throws(() => parseAgyModels('Fetching available models...\n'), /Aucun modèle/);
});

test('Claude : liste fixe de config/models.json', () => {
  const models = claudeModels(readConfig('models'));
  assert.ok(models.some((entry) => entry.model === 'claude-opus-5-5'));
  assert.ok(models.every((entry) => entry.efforts.includes('medium')));
});

test('Catalogue : un fournisseur en échec garde son dernier catalogue, marqué périmé', async () => {
  const ok = { codex: async () => [{ model: 'a', efforts: [] }], agy: async () => [{ model: 'b', efforts: [] }],
    claude: async () => [] };
  const first = await fetchCatalog({ listers: ok, now: () => epoch });
  const second = await fetchCatalog({ listers: { ...ok, agy: async () => { throw new Error('agy absent'); } },
    previous: first, now: () => epoch + 1000 });
  assert.equal(second.providers.codex.status, 'ok');
  assert.deepEqual(second.providers.agy, { status: 'error', reason: 'agy absent',
    fetchedAt: first.fetchedAt, stale: true, models: [{ model: 'b', efforts: [] }] });
  const empty = await fetchCatalog({ listers: { ...ok, codex: async () => { throw new Error('x'); } } });
  assert.equal(empty.providers.codex.stale, false);
});

test('Catalogue : cache sur disque et une seule lecture des CLI à la fois', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nay-models-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const listers = { codex: async () => { calls++; return []; }, agy: async () => [], claude: async () => [] };
  const config = { cachePath: '.nay/state/models.json' };
  const catalog = createCatalog({ root, config, listers });
  const [a, b] = await Promise.all([catalog.refresh(), catalog.refresh()]);
  assert.equal(a, b);
  assert.equal(calls, 1);
  const reloaded = createCatalog({ root, config, listers });
  assert.deepEqual(await reloaded.get(), JSON.parse(JSON.stringify(a)));
  assert.equal(calls, 1);
});

const catalog = { providers: {
  codex: { status: 'ok', models: [{ model: 'gpt-6.2-sol', efforts: ['low', 'medium'] }] },
  agy: { status: 'error', models: [] },
  claude: { status: 'ok', models: [{ model: 'claude-opus-5-5', efforts: [] }] },
} };

test('Validation d’un agent : champs, catalogue, efforts et modèle retiré', () => {
  const options = { catalog, maxTimeoutMin: 600 };
  const agent = { cli: 'codex', model: 'gpt-6.2-sol', effort: 'medium', timeoutMin: 40 };
  assert.deepEqual(validateAgent(agent, options), []);
  assert.match(validateAgent({ ...agent, effort: 'high' }, options)[0], /non proposé/);
  assert.match(validateAgent({ ...agent, model: 'gpt-9' }, options)[0], /absent du catalogue/);
  assert.deepEqual(validateAgent({ ...agent, model: 'gpt-9' }, { ...options, previous: { cli: 'codex', model: 'gpt-9' } }), []);
  assert.deepEqual(validateAgent({ cli: 'agy', model: 'inconnu-{effort}', effort: 'low', timeoutMin: 5 }, options), []);
  assert.match(validateAgent({ ...agent, timeoutMin: 0 }, options)[0], /Délai/);
  assert.match(validateAgent({ ...agent, cli: 'autre' }, options)[0], /CLI inconnu/);
  assert.match(validateAgent({ ...agent, extra: 1 }, options)[0], /Champs inconnus/);
  assert.match(validateAgent({ ...agent, model: 'a"b' }, options)[0], /Modèle invalide/);
  assert.deepEqual(validateName('sol-6.2', { sol: {} }), []);
  for (const name of ['sol', 'Sol', '6sol', 'orchestrateur', '', 'a/b']) assert.equal(validateName(name, { sol: {} }).length, 1, name);
});

test('Rôles qui citent un agent et format une ligne par agent', () => {
  const delegation = { developpeur: ['sol'], relecteur: { parDefaut: ['terra'], selonAuteur: { sol: ['terra'], luna: ['sol'] } } };
  assert.deepEqual(rolesUsing(delegation, 'sol'), ['developpeur', 'relecteur.selonAuteur.sol', 'relecteur.selonAuteur.luna']);
  assert.deepEqual(rolesUsing(delegation, 'haiku'), []);
  assert.equal(formatAgents({ a: { cli: 'codex', model: 'm', effort: 'low', timeoutMin: 5 } }),
    '{\n  "a": { "cli": "codex", "model": "m", "effort": "low", "timeoutMin": 5 }\n}\n');
});

test('API /api/models et /api/agents : ajout, modification, suppression et protections', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nay-agents-'));
  await mkdir(join(root, 'config'));
  await mkdir(join(root, 'ui'));
  await writeFile(join(root, 'config/agents.json'), formatAgents({
    sol: { cli: 'codex', model: 'gpt-6.1-sol', effort: 'medium', timeoutMin: 40 },
    terra: { cli: 'codex', model: 'gpt-6.2-sol', effort: 'low', timeoutMin: 30 } }));
  await writeFile(join(root, 'config/delegation.json'), JSON.stringify({ developpeur: ['sol'],
    relecteur: { parDefaut: ['sol'], selonAuteur: {} } }));
  let refreshes = 0;
  const fake = { get: async () => catalog, refresh: async () => { refreshes++; return catalog; }, refreshing: () => false };
  const server = createServer({ root, catalog: fake, config: { ...readConfig('ui'), port: 0 },
    quotasReader: async () => ({}) });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    return t.skip('Bac à sable : listen EPERM');
  }
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  const call = async (path, method = 'GET', body, extra = headers) => {
    const response = await fetch(`${origin}${path}`, { method, headers: method === 'GET' ? {} : extra,
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };

  const models = await call('/api/models');
  assert.deepEqual(models.body.providers.codex.models[0].usedBy, ['terra']);
  assert.equal((await call('/api/models/refresh', 'POST')).status, 200);
  assert.equal(refreshes, 1);
  assert.equal((await call('/api/models/refresh', 'POST', undefined, {})).status, 403);

  const opus = { name: 'opus', cli: 'claude', model: 'claude-opus-5-5', effort: 'high', timeoutMin: 60 };
  assert.equal((await call('/api/agents', 'POST', opus, { 'Content-Type': 'application/json' })).status, 403);
  const created = await call('/api/agents', 'POST', opus);
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.agents.opus, { cli: 'claude', model: 'claude-opus-5-5', effort: 'high', timeoutMin: 60 });
  assert.match(await readFile(join(root, 'config/agents.json'), 'utf8'), /\n {2}"opus": \{ "cli": "claude"/);
  assert.equal((await call('/api/agents', 'POST', opus)).status, 400);
  assert.ok((await call('/api/agents', 'POST', { ...opus, name: 'x', model: 'gpt-9', cli: 'codex' })).body.errors.length);
  assert.ok((await call('/api/quota')).body.agents.some((agent) => agent.name === 'opus'));
  assert.ok((await call('/api/delegation')).body.agents.includes('opus'));

  const updated = await call('/api/agents/sol', 'PUT', { cli: 'codex', model: 'gpt-6.1-sol', effort: 'low', timeoutMin: 45 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.agents.sol.timeoutMin, 45);
  assert.equal((await call('/api/agents/sol', 'PUT', { name: 'soleil', cli: 'codex', model: 'gpt-6.1-sol', effort: 'low', timeoutMin: 45 })).status, 400);
  assert.equal((await call('/api/agents/inconnu', 'PUT', opus)).status, 404);

  const refused = await call('/api/agents/sol', 'DELETE');
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.body.errors, ['developpeur', 'relecteur.parDefaut']);
  const removed = await call('/api/agents/opus', 'DELETE');
  assert.equal(removed.status, 200);
  assert.ok(!('opus' in removed.body.agents));
  assert.deepEqual((await call('/api/agents')).body.roles.sol, ['developpeur', 'relecteur.parDefaut']);
});
