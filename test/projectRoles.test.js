import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentMode, globToRegExp, parseAgentFile, readProjectRoles, touchesPaths, withRoleChains }
  from '../src/projectRoles.js';
import { formatGuide, loadRolesReport, roleDelegation, rolePrompt, USAGES, validateRoleId, validateRoles } from '../src/roles.js';
import { guideCommand, roleCommand, usageCommand } from '../src/roleCommands.js';
import { EXIT, formatStory, runStory } from '../src/story.js';
import { createServer } from '../src/server/app.js';
import { readConfig } from '../src/config.js';

const AGENTS = {
  'security-reviewer': `---
name: security-reviewer
description: Relecteur sécurité en lecture seule d'un diff.
tools: Read, Grep, Glob, Bash
model: opus
effort: medium
---

Tu relis la sécurité.
**Lecture seule**.
`,
  'ui-ux-reviewer': `---
name: ui-ux-reviewer
description: Relecteur UI/UX d'un diff qui touche des pages Vue.
model: opus
disallowedTools: Edit, Write, NotebookEdit
---
Tu relis l'interface.
`,
  'qa-attacker': `---
name: qa-attacker
description: QA adverse, peut ajouter des tests QaTest.
disallowedTools: Edit, NotebookEdit
---
Péte le code.
`,
  'db-reviewer': `---
name: db-reviewer
description: Relecteur base de données.
tools: Read, Grep
---
Relis le SQL.
`,
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

async function tempDir(t, prefix) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// Dépôt Git avec des sous-agents committés, plus un fichier invalide.
async function projectRepo(t, { agents = AGENTS, overrides, extra = {} } = {}) {
  const root = await tempDir(t, 'nay-projet-');
  git(root, 'init', '-q', '-b', 'develop');
  await mkdir(join(root, '.claude/agents'), { recursive: true });
  for (const [name, text] of Object.entries({ ...agents, ...extra })) {
    await writeFile(join(root, `.claude/agents/${name}.md`), text);
  }
  git(root, 'add', '.');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'agents');
  if (overrides) {
    await mkdir(join(root, '.nay'));
    await writeFile(join(root, '.nay/roles.json'), JSON.stringify(overrides));
  }
  return root;
}

const options = { validateId: validateRoleId, usages: USAGES, agentNames: ['hydrogen', 'terra', 'sonnet', 'opus'] };

test('frontmatter : champs, listes et blocs ; fichier sans frontmatter refusé', () => {
  const { fields, body } = parseAgentFile(AGENTS['security-reviewer']);
  assert.equal(fields.name, 'security-reviewer');
  assert.equal(fields.tools, 'Read, Grep, Glob, Bash');
  assert.equal(body, 'Tu relis la sécurité.\n**Lecture seule**.');
  const listed = parseAgentFile('---\nname: "x-y"\ntools:\n  - Read\n  - Edit\ndescription: >\n  sur deux\n  lignes\n---\ncorps');
  assert.deepEqual(listed.fields, { name: 'x-y', tools: ['Read', 'Edit'], description: 'sur deux lignes' });
  assert.throws(() => parseAgentFile('# pas de frontmatter'), /frontmatter absent/);
});

test('mode : lecture seule sans Edit ni Write, sinon écriture', () => {
  assert.equal(agentMode({ tools: 'Read, Grep, Glob, Bash' }), 'read');
  assert.equal(agentMode({ tools: ['Read', 'Write'] }), 'write');
  assert.equal(agentMode({ disallowedTools: 'Edit, Write, NotebookEdit' }), 'read');
  assert.equal(agentMode({ disallowedTools: 'Edit, NotebookEdit' }), 'write');
  assert.equal(agentMode({}), 'write');
});

test('motifs de chemin : ** traverse les dossiers, * reste dans un segment', () => {
  const db = ['scripts-sql/**', 'app/**/Models/**', 'app/**/Repositories/**', 'Docs/DB.md'];
  assert.ok(touchesPaths(['scripts-sql/migrations/us-12/up.sql'], db));
  assert.ok(touchesPaths(['app/Modules/Teams/Models/Team.php'], db));
  assert.ok(touchesPaths(['app/Models/User.php'], db));
  assert.ok(touchesPaths(['Docs/DB.md'], db));
  assert.ok(!touchesPaths(['Docs/DB.mdx', 'app/Modules/Teams/Http/Controller.php', 'docs/DB.md'], db));
  assert.ok(touchesPaths(['resources/js/Pages/Show.vue'], ['**/*.vue']));
  assert.ok(touchesPaths(['App.vue'], ['**/*.vue']));
  assert.ok(!touchesPaths(['resources/js/app.ts'], ['**/*.vue']));
  assert.ok(globToRegExp('src/*.js').test('src/a.js'));
  assert.ok(!globToRegExp('src/*.js').test('src/x/a.js'));
});

test('lecture des sous-agents : rôles, réglages .nay/roles.json, fichiers invalides ignorés', async (t) => {
  const root = await projectRepo(t, {
    extra: { cassé: '# sans frontmatter', 'developpeur': '---\nname: developpeur\ndescription: x\n---\n' },
    overrides: {
      'security-reviewer': { usage: 'toujours' },
      'db-reviewer': { usage: 'selon-diff', paths: ['scripts-sql/**'], agents: ['opus'] },
      'ui-ux-reviewer': { usage: 'selon-diff' },
      inconnu: { usage: 'toujours' },
    },
  });
  const { project, roles, errors } = readProjectRoles(join(root, '.claude'), options);
  assert.deepEqual(project, { checkout: root, root, name: root.split('/').at(-1) });
  assert.deepEqual(Object.keys(roles).sort(), ['db-reviewer', 'qa-attacker', 'security-reviewer', 'ui-ux-reviewer']);
  assert.deepEqual(roles['security-reviewer'], { label: 'Security reviewer',
    description: 'Relecteur sécurité en lecture seule d\'un diff.', instructions: 'Tu relis la sécurité.\n**Lecture seule**.',
    mode: 'read', usage: 'toujours', source: 'projet', claudeModel: 'opus', file: '.claude/agents/security-reviewer.md' });
  assert.equal(roles['qa-attacker'].mode, 'write');
  assert.deepEqual([roles['db-reviewer'].usage, roles['db-reviewer'].paths, roles['db-reviewer'].agents],
    ['selon-diff', ['scripts-sql/**'], ['opus']]);
  assert.equal(roles['ui-ux-reviewer'].usage, null, 'réglage invalide ignoré');
  assert.equal(errors.length, 4);
  assert.match(errors.join('\n'), /cassé\.md ignoré : frontmatter absent/);
  assert.match(errors.join('\n'), /developpeur\.md ignoré : developpeur est un rôle intégré/);
  assert.match(errors.join('\n'), /ui-ux-reviewer ignoré \(usage selon-diff : paths requis\)/);
  assert.match(errors.join('\n'), /inconnu ignoré \(aucun agent/);

  // Consigne relue à chaque appel : un changement du fichier est pris tout de suite.
  await writeFile(join(root, '.claude/agents/db-reviewer.md'), AGENTS['db-reviewer'].replace('Relis le SQL.', 'Nouvelle consigne.'));
  assert.equal(readProjectRoles(root, options).roles['db-reviewer'].instructions, 'Nouvelle consigne.');

  // Hors Git, ou JSON de réglages cassé : rien ne plante.
  const outside = await tempDir(t, 'nay-hors-git-');
  assert.deepEqual(readProjectRoles(outside, options), { project: null, roles: {}, errors: [] });
  await writeFile(join(root, '.nay/roles.json'), '{');
  const broken = readProjectRoles(root, options);
  assert.equal(broken.roles['security-reviewer'].usage, null);
  assert.match(broken.errors.join('\n'), /\.nay\/roles\.json : JSON invalide/);
});

test('worktree : agents de sa branche, réglages du checkout principal', async (t) => {
  const root = await projectRepo(t, { overrides: { 'security-reviewer': { usage: 'toujours' } } });
  git(root, 'checkout', '-q', '-b', 'sans-agents');
  git(root, 'rm', '-rq', '.claude');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'retrait');
  const worktree = join(await tempDir(t, 'nay-wt-'), 'develop');
  git(root, 'worktree', 'add', '-q', worktree, 'develop');
  assert.deepEqual(readProjectRoles(root, options).roles, {}, 'branche du checkout principal sans agents');
  const { project, roles } = readProjectRoles(worktree, options);
  assert.deepEqual([project.checkout, project.root], [worktree, root]);
  assert.equal(roles['security-reviewer'].usage, 'toujours');
});

test('fusion : le rôle de projet masque le rôle global de même id ; chaîne du relecteur par défaut', async (t) => {
  const root = await projectRepo(t, { overrides: { 'db-reviewer': { usage: 'sur-demande', agents: ['opus'] } } });
  const perso = await tempDir(t, 'nay-perso-');
  const global = { label: 'Sécurité perso', description: 'audit', mode: 'write', usage: 'proposer' };
  await writeFile(join(perso, 'roles.json'), JSON.stringify({ 'security-reviewer': global, autre: global }));
  process.env.NAY_CONFIG_DIR = perso;
  t.after(() => { delete process.env.NAY_CONFIG_DIR; });
  const report = loadRolesReport({ cwd: root });
  assert.equal(report.roles['security-reviewer'].source, 'projet');
  assert.deepEqual(report.masked, ['security-reviewer']);
  assert.deepEqual(report.roles.autre, global);
  const other = await tempDir(t, 'nay-autre-');
  assert.deepEqual(Object.keys(loadRolesReport({ cwd: other }).roles).sort(), ['autre', 'security-reviewer']);
  assert.equal(loadRolesReport({ cwd: other }).roles['security-reviewer'].source, undefined);

  const delegation = { relecteur: { parDefaut: ['hydrogen', 'terra'] }, 'security-reviewer': ['sonnet'] };
  const chains = withRoleChains(delegation, report.roles);
  assert.deepEqual(chains['security-reviewer'], ['hydrogen', 'terra'], 'la chaîne du rôle global masqué ne s’applique pas');
  assert.deepEqual(chains['db-reviewer'], ['opus']);
  assert.equal(chains.autre, undefined);
  assert.equal(roleDelegation({}, delegation), delegation);
});

test('validation : selon-diff réservé aux rôles de projet', () => {
  assert.match(validateRoles({ x1: { label: 'X', description: 'x', mode: 'read', usage: 'selon-diff' } })[0],
    /réservé aux rôles de projet/);
});

test('guide : rôles du projet avec leur règle, rien depuis un autre projet', async (t) => {
  const root = await projectRepo(t, { overrides: {
    'security-reviewer': { usage: 'toujours' },
    'db-reviewer': { usage: 'selon-diff', paths: ['scripts-sql/**', 'Docs/DB.md'] },
    'qa-attacker': { usage: 'sur-demande' },
  } });
  const chunks = [];
  guideCommand(['--cwd', root], { write: (text) => chunks.push(text) });
  const guide = chunks.join('');
  assert.match(guide, /## Rôles du projet nay-projet-\w+ \(sous-agents \.claude\/agents\)/);
  assert.match(guide, /\*\*security-reviewer\*\* — Security reviewer \(lecture seule, .*model: opus pour Claude Code, ignoré par Nay\)/);
  assert.match(guide, /Selon le diff : lancé automatiquement par `nay story` après la relecture si le diff touche `scripts-sql\/\*\*`, `Docs\/DB\.md`/);
  assert.match(guide, /qa-attacker\*\* — Qa attacker \(écriture/);
  assert.match(guide, /« Quand veux-tu que j’utilise Ui ux reviewer/);
  assert.match(guide, /nay usage ui-ux-reviewer toujours\|sur-demande\|proposer\|selon-diff/);

  const other = await tempDir(t, 'nay-autre-');
  const elsewhere = [];
  guideCommand(['--cwd', other], { write: (text) => elsewhere.push(text) });
  assert.doesNotMatch(elsewhere.join(''), /reviewer|Rôles du projet/);
  assert.match(formatGuide({}, {}), /Aucun rôle perso/);
});

test('nay usage : la règle d’un rôle de projet va dans .nay/roles.json du projet', async (t) => {
  const root = await projectRepo(t);
  const perso = await tempDir(t, 'nay-perso-');
  const out = [];
  const output = { write: (text) => out.push(text) };
  usageCommand(['ui-ux-reviewer', 'selon-diff', '**/*.vue', '--cwd', root], output, { dir: perso });
  usageCommand(['security-reviewer', 'toujours', '--cwd', root], output, { dir: perso });
  assert.deepEqual(JSON.parse(await readFile(join(root, '.nay/roles.json'), 'utf8')), {
    'ui-ux-reviewer': { usage: 'selon-diff', paths: ['**/*.vue'] }, 'security-reviewer': { usage: 'toujours' } });
  assert.match(out[0], /Règle de ui-ux-reviewer \(projet .*\) : Selon le diff \(chemins touchés\) \(\*\*\/\*\.vue\)/);
  // Repasser à « demander » garde les motifs pour plus tard.
  usageCommand(['ui-ux-reviewer', 'demander', '--cwd', root], output, { dir: perso });
  assert.deepEqual(JSON.parse(await readFile(join(root, '.nay/roles.json'), 'utf8'))['ui-ux-reviewer'],
    { usage: null, paths: ['**/*.vue'] });
  assert.throws(() => usageCommand(['db-reviewer', 'selon-diff', '--cwd', root], output, { dir: perso }), /au moins un motif/);
  assert.throws(() => usageCommand(['db-reviewer', 'toujours', 'x/**', '--cwd', root], output, { dir: perso }), /Usage/);
  await assert.rejects(readFile(join(perso, 'roles.json')), { code: 'ENOENT' }, 'config globale intacte');
});

test('nay role : consigne du sous-agent et chaîne du relecteur, model: ignoré', async (t) => {
  const root = await projectRepo(t);
  const calls = [];
  const code = await roleCommand(['security-reviewer', '-', '--cwd', root], {
    input: null, output: { write() {} }, errorOutput: { write() {} }, readStdin: async () => 'Relis la PR 12',
    isAvailable: (agent) => agent !== readConfig('delegation').relecteur.parDefaut[0],
    execute: async (agent, prompt, opts) => { calls.push({ agent, prompt, opts }); return { status: 'ok' }; },
    finish: () => 0 });
  assert.equal(code, 0);
  assert.equal(calls[0].agent, readConfig('delegation').relecteur.parDefaut[1]);
  assert.equal(calls[0].opts.mode, 'read');
  assert.match(calls[0].prompt, /^Tu interviens comme « Security reviewer » : Relecteur sécurité.*\nTu relis la sécurité\./s);
  assert.equal(rolePrompt({ label: 'L', description: 'd' }, 'b'), 'Tu interviens comme « L » : d\n\n---\nb');
});

test('story : rôle « selon le diff » lancé seulement si le diff touche ses chemins', async () => {
  const state = { dirty: '' };
  const git = { isRepo: async () => true, status: async () => state.dirty, snapshot: async () => state.dirty,
    show: async (cwd, hash) => `diff du commit ${hash}`, uncommitted: async () => 'diff',
    changedFiles: async () => ['resources/js/Pages/Show.vue', 'app/Http/Controller.php'] };
  const roles = {
    'db-reviewer': { label: 'Db reviewer', description: 'SQL', mode: 'read', usage: 'selon-diff',
      paths: ['scripts-sql/**'], source: 'projet' },
    'ui-ux-reviewer': { label: 'Ui ux reviewer', description: 'UI', mode: 'read', usage: 'selon-diff',
      paths: ['**/*.vue'], source: 'projet' },
  };
  const calls = [];
  const steps = [
    (agent) => { state.dirty = ' M a.vue'; return { agent, text: 'NAY-COMMIT: feat: a\nNAY-FILES: a.vue' }; },
    (agent) => ({ agent, text: 'NAY-VERDICT: PASS' }),
    (agent) => ({ agent, text: 'RAS\nNAY-VERDICT: PASS' }),
  ];
  const execute = async (agent, prompt, opts) => {
    calls.push({ agent, prompt, opts });
    return { status: 'ok', callId: `${agent}-c`, sessionId: 's', usage: { input: 1, output: 1 }, durationMs: 1,
      ...steps.shift()(agent) };
  };
  const report = await runStory('brief', { execute, git, roles, committer: async () => 'abc1 feat: a',
    checker: { load: async () => null }, delegation: { developpeur: ['sol'], relecteur: { parDefaut: ['hydrogen', 'terra'] } } });
  assert.equal(report.code, EXIT.ok);
  assert.deepEqual(calls.map((c) => [c.agent, c.opts.role]), [['sol', 'dev'], ['hydrogen', 'relecteur'], ['hydrogen', 'ui-ux-reviewer']]);
  assert.match(calls[2].prompt, /Tu interviens comme « Ui ux reviewer »/);
  assert.deepEqual(report.roles, [
    { role: 'db-reviewer', agent: null, round: 1, verdict: 'non concerné' },
    { role: 'ui-ux-reviewer', agent: 'hydrogen', round: 1, verdict: 'PASS' }]);
  assert.match(formatStory(report), /Rôles : db-reviewer non concerné \(tour 1\) ; ui-ux-reviewer hydrogen PASS \(tour 1\)/);
});

test('API /api/project-roles : rôles du projet choisi et règle enregistrée dans le projet', async (t) => {
  const project = await projectRepo(t);
  const root = await tempDir(t, 'nay-api-');
  for (const directory of ['config', 'ui', '.nay/state']) await mkdir(join(root, directory), { recursive: true });
  for (const name of ['delegation', 'agents']) await writeFile(join(root, `config/${name}.json`), JSON.stringify(readConfig(name)));
  await writeFile(join(root, '.nay/state/usage.jsonl'), `${JSON.stringify({ timestamp: '2026-11-20T10:00:00Z',
    agent: 'sol', project: 'mon-projet', cwd: join(project, '.claude') })}\n`);
  const server = createServer({ root, userDir: join(root, 'perso'), usagePath: '.nay/state/usage.jsonl',
    config: { ...readConfig('ui'), port: 0 }, quotasReader: async () => ({}) });
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
  const listed = await call('/api/project-roles?project=mon-projet');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.project.root, project);
  assert.equal(listed.body.roles['ui-ux-reviewer'].source, 'projet');
  assert.deepEqual(listed.body.chains['ui-ux-reviewer'], readConfig('delegation').relecteur.parDefaut);
  assert.deepEqual((await call('/api/project-roles?project=autre')).body.roles, {});
  assert.deepEqual((await call('/api/project-roles')).body.roles, {});
  assert.ok(!('selon-diff' in (await call('/api/delegation')).body.usages), 'pas de selon-diff pour les rôles globaux');

  const saved = await call('/api/project-roles/security-reviewer?project=mon-projet', 'PUT', { usage: 'toujours' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.roles['security-reviewer'].usage, 'toujours');
  assert.deepEqual(JSON.parse(await readFile(join(project, '.nay/roles.json'), 'utf8')), { 'security-reviewer': { usage: 'toujours' } });
  assert.equal((await call('/api/project-roles/db-reviewer?project=mon-projet', 'PUT', { usage: 'selon-diff' })).status, 400);
  assert.equal((await call('/api/project-roles/inconnu?project=mon-projet', 'PUT', { usage: 'toujours' })).status, 404);
  assert.equal((await call('/api/project-roles/db-reviewer?project=autre', 'PUT', { usage: 'toujours' })).status, 404);
});
