import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeLayers, personalDiff, readLayer, userConfigDir, writeLayer } from '../src/userConfig.js';
import { formatGuide, rolePrompt, validateRoleId, validateRoles } from '../src/roles.js';
import { roleCommand } from '../src/roleCommands.js';
import { createServer } from '../src/server/app.js';
import { readConfig } from '../src/config.js';

const adversaire = { label: 'Agent adversaire', description: 'cherche à casser le code', mode: 'read', usage: null };

async function tempDir(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('userConfigDir : NAY_CONFIG_DIR, sinon aucun sous node --test, sinon XDG', () => {
  assert.equal(userConfigDir({ NAY_CONFIG_DIR: '/x/perso', NODE_TEST_CONTEXT: 'child' }), '/x/perso');
  assert.equal(userConfigDir({ NODE_TEST_CONTEXT: 'child' }), null);
  assert.equal(userConfigDir({ XDG_CONFIG_HOME: '/conf' }), '/conf/nay');
});

test('calques : lecture, écriture, fusion et différence avec le dépôt', async (t) => {
  const dir = await tempDir(t, 'nay-perso-');
  assert.deepEqual(readLayer(dir, 'delegation'), {});
  assert.deepEqual(readLayer(null, 'delegation'), {});
  writeLayer(dir, 'delegation', { developpeur: ['sonnet'] });
  assert.deepEqual(readLayer(dir, 'delegation'), { developpeur: ['sonnet'] });
  writeLayer(dir, 'delegation', {});
  await assert.rejects(readFile(join(dir, 'delegation.json')), { code: 'ENOENT' });
  await writeFile(join(dir, 'roles.json'), '{');
  assert.throws(() => readLayer(dir, 'roles'), /JSON invalide dans .*roles\.json/);
  const repo = { developpeur: ['sol'], relecteur: { parDefaut: ['terra'] } };
  assert.deepEqual(mergeLayers(repo, { developpeur: ['sonnet'] }), { developpeur: ['sonnet'], relecteur: { parDefaut: ['terra'] } });
  assert.deepEqual(personalDiff(repo, { developpeur: ['sol'], relecteur: { parDefaut: ['hydrogen'] }, ui: ['haiku'] }),
    { relecteur: { parDefaut: ['hydrogen'] }, ui: ['haiku'] });
});

test('rôles : identifiants et champs validés, rôles intégrés protégés', () => {
  assert.deepEqual(validateRoleId('adversaire-ui'), []);
  assert.match(validateRoleId('developpeur')[0], /rôle intégré/);
  assert.match(validateRoleId('X')[0], /Identifiant invalide/);
  assert.deepEqual(validateRoles({ adversaire }), []);
  const errors = validateRoles({ securite: { label: '', description: 'x', mode: 'exec', usage: 'parfois', extra: 1 } });
  assert.equal(errors.length, 4);
});

test('guide : comportement par défaut, règles et questions avec réponses proposées', () => {
  const roles = { adversaire, securite: { ...adversaire, label: 'Sécurité', description: 'audit', usage: 'toujours' },
    ui: { ...adversaire, label: 'Agent UI', description: 'interface', mode: 'write', usage: 'proposer' },
    style: { ...adversaire, label: 'Style', description: 'mise en forme', mode: 'write', usage: 'toujours' } };
  const guide = formatGuide(roles, { adversaire: ['terra', 'haiku'], securite: ['sonnet'] });
  assert.match(guide, /nay story <brief>/);
  assert.match(guide, /\*\*adversaire\*\* — Agent adversaire \(lecture seule, terra → haiku\)/);
  assert.match(guide, /Toujours : lancé automatiquement par `nay story` après la relecture ; hors story, lance-le sans demander \(nay role securite <brief> --cwd <projet> --diff HEAD\)/);
  assert.match(guide, /ui\*\* — Agent UI \(écriture, aucun modèle/);
  assert.match(guide, /propose-le en une ligne/);
  assert.match(guide, /Toujours : lance-le à chaque travail concerné, sans demander \(nay role style <brief> --cwd <projet>\)/);
  assert.match(guide, /## À demander[\s\S]*Quand veux-tu que j’utilise Agent adversaire/);
  assert.match(guide, /Réponses : Toujours · Seulement quand je le demande · Me le proposer après/);
  assert.match(guide, /nay usage adversaire toujours\|sur-demande\|proposer/);
  assert.doesNotMatch(guide, /j’utilise Sécurité/);
  assert.match(formatGuide({}, {}), /Aucun rôle perso/);
  assert.match(rolePrompt({ ...adversaire, instructions: 'Écris des tests qui échouent.' }, 'brief'),
    /^Tu interviens comme « Agent adversaire » : cherche à casser le code\nÉcris des tests qui échouent\.\n\n---\nbrief$/);
});

test('nay role et nay usage : agent choisi selon la délégation perso, bascule en lecture seule', async (t) => {
  const dir = await tempDir(t, 'nay-role-');
  const previous = process.env.NAY_CONFIG_DIR;
  process.env.NAY_CONFIG_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.NAY_CONFIG_DIR; else process.env.NAY_CONFIG_DIR = previous; });
  writeLayer(dir, 'roles', { adversaire });
  writeLayer(dir, 'delegation', { adversaire: ['terra', 'haiku'] });
  assert.deepEqual(readConfig('delegation').developpeur, (await import('../src/config.js')).readRepoConfig('delegation').developpeur);

  const { usageCommand } = await import('../src/roleCommands.js');
  let out = '';
  const output = { write: (text) => { out += text; } };
  usageCommand(['adversaire', 'proposer'], output, { dir });
  assert.equal(readLayer(dir, 'roles').adversaire.usage, 'proposer');
  assert.throws(() => usageCommand(['adversaire', 'parfois'], output, { dir }), /Usage/);

  const calls = [];
  const execute = async (agent, prompt, options) => {
    calls.push({ agent, prompt, options });
    return agent === 'terra' ? { agent, status: 'error', error: 'quota' }
      : { agent, status: 'ok', text: 'trois failles', usage: { input: 1, output: 1 }, durationMs: 1 };
  };
  const finish = async (result) => { out += `fini ${result.agent}\n`; return 0; };
  const code = await roleCommand(['adversaire', '-', '--cwd', dir], { input: null, output, errorOutput: output,
    execute, isAvailable: () => true, readStdin: async () => 'casse le parseur', finish });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((call) => call.agent), ['terra', 'haiku']);
  assert.equal(calls[0].options.mode, 'read');
  assert.equal(calls[0].options.role, 'adversaire');
  assert.match(calls[0].prompt, /Agent adversaire[\s\S]*casse le parseur/);
  assert.match(out, /Rôle : adversaire · agent haiku · sautés : terra \(indisponible\)/);
  await assert.rejects(roleCommand(['adversaire', '-', '--commit'], { readStdin: async () => '' }), /lecture seule/);
});

test('API /api/roles : ajout, règle, suppression, sans toucher au dépôt', async (t) => {
  const root = await tempDir(t, 'nay-roles-api-');
  for (const directory of ['config', 'ui']) await mkdir(join(root, directory));
  for (const name of ['delegation', 'agents']) await writeFile(join(root, `config/${name}.json`), JSON.stringify(readConfig(name)));
  const userDir = join(root, 'perso');
  const server = createServer({ root, userDir, config: { ...readConfig('ui'), port: 0 }, quotasReader: async () => ({}) });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    return t.skip('Bac à sable : listen EPERM');
  }
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(`${origin}${path}`, { method,
      headers: method === 'GET' ? {} : { Origin: origin, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };

  const created = await call('/api/roles', 'POST', { id: 'adversaire', ...adversaire, agents: ['terra'] });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.roles.adversaire, adversaire);
  assert.deepEqual(created.body.delegation.adversaire, ['terra']);
  assert.equal((await call('/api/roles', 'POST', { id: 'adversaire', ...adversaire, agents: ['terra'] })).status, 400);
  assert.equal((await call('/api/roles', 'POST', { id: 'developpeur', ...adversaire, agents: ['terra'] })).status, 400);
  assert.equal((await call('/api/roles', 'POST', { id: 'ui', ...adversaire, agents: ['inconnu'] })).status, 400);
  assert.equal((await call('/api/roles', 'POST', { id: 'ui', ...adversaire, agents: [] })).status, 400);

  const updated = await call('/api/roles/adversaire', 'PUT', { ...adversaire, usage: 'toujours' });
  assert.equal(updated.body.roles.adversaire.usage, 'toujours');
  assert.equal((await call('/api/roles/inconnu', 'PUT', adversaire)).status, 404);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'config/delegation.json'), 'utf8')), readConfig('delegation'));

  const removed = await call('/api/roles/adversaire', 'DELETE');
  assert.equal(removed.status, 200);
  assert.ok(!('adversaire' in removed.body.roles));
  assert.ok(!('adversaire' in removed.body.delegation));
  assert.equal((await call('/api/roles/adversaire', 'DELETE')).status, 404);
});
