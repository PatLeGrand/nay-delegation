import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as codex from '../src/cli/codex.js';
import * as agy from '../src/cli/agy.js';
import * as claude from '../src/cli/claude.js';
import { appendEvent, truncateEvent, createEventSink, maskEvent } from '../src/eventLog.js';
import { readConfig, repositoryRoot } from '../src/config.js';
import { readClaude, writeClaudeQuota } from '../src/quota/claude.js';

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'nay-events-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function fixture(name) {
  return readFile(new URL(`fixtures/${name}-stream.jsonl`, import.meta.url), 'utf8');
}

for (const [name, adapter] of Object.entries({ codex, agy, claude })) {
  test(`${name} convertit les événements réels sans modifier les entrées`, async () => {
    const stdout = await fixture(name);
    const rows = stdout.trim().split('\n').map(JSON.parse);
    const original = JSON.stringify(rows);
    const events = rows.flatMap((row) => adapter.toEvents(row));
    assert.equal(JSON.stringify(rows), original);
    const start = events.find((event) => event.kind === 'tool_start');
    const end = events.find((event) => event.kind === 'tool_end');
    assert.equal(start.tool.id, end.tool.id);
    assert.equal(end.ok, true);
    assert.ok(start.tool.target);
    assert.ok(events.some((event) => event.kind === 'message'));
    assert.ok(events.some((event) => event.kind === 'usage'));
    const failure = structuredClone(rows.find((row) => row.item?.type === 'command_execution' && row.type === 'item.completed' ||
      row.step_update?.step_type === 'tool' && row.step_update.state === 'DONE' || row.type === 'user'));
    if (name === 'codex') failure.item.exit_code = 1;
    if (name === 'agy') failure.step_update.tool_info.is_error = true;
    if (name === 'claude') failure.message.content[0].is_error = true;
    assert.equal(adapter.toEvents(failure).find((event) => event.kind === 'tool_end').ok, false);
    if (name !== 'codex') {
      const result = adapter.parseResult(stdout);
      assert.equal(result.text.trim(), 'nay');
      assert.ok(result.usage.total > 0);
      assert.throws(() => adapter.parseResult(stdout.split('\n').filter((line) => !line.includes('"event": "result"') && !line.includes('"type": "result"')).join('\n')), /aucun résultat final/);
    }
  });
}

test('Troncature des textes par lignes et caractères', () => {
  assert.deepEqual(truncateEvent({ text: 'abc\ndef\nghi', output: '123456789' }, { maxOutputLines: 2, maxOutputChars: 5 }),
    { text: 'abc\nd', output: '12345' });
});

test('La rotation archive sous un nom unique et garde le nombre maximal d’archives', async (t) => {
  const directory = await temporary(t);
  const config = { ...readConfig('events'), maxFileBytes: 1, maxRotatedFiles: 2 };
  await Promise.all([1, 2, 3, 4].map((index) => appendEvent({ ts: '2026-11-17T00:00:00Z', index }, directory, config)));
  const files = (await readdir(directory)).sort();
  assert.equal(files.length, 3);
  assert.equal(JSON.parse(await readFile(join(directory, '2026-11-17.jsonl'), 'utf8')).index, 4);
  const archives = files.filter((name) => name !== '2026-11-17.jsonl');
  assert.ok(archives.every((name) => /^2026-11-17\.\d+-\d{6}-[0-9a-f]{8}\.jsonl$/.test(name)));
  const kept = await Promise.all(archives.map(async (name) => JSON.parse(await readFile(join(directory, name), 'utf8')).index));
  assert.deepEqual(kept, [2, 3]);
});

test('Sans archive autorisée, le fichier du jour n’est jamais renommé', async (t) => {
  const directory = await temporary(t);
  const config = { ...readConfig('events'), maxFileBytes: 1, maxRotatedFiles: 0 };
  await appendEvent({ ts: '2026-11-17T00:00:00Z', index: 1 }, directory, config);
  await appendEvent({ ts: '2026-11-17T00:00:00Z', index: 2 }, directory, config);
  assert.deepEqual(await readdir(directory), ['2026-11-17.jsonl']);
});

test('Le quota Claude conserve le dernier relevé et détecte la péremption', async (t) => {
  const root = await temporary(t);
  const config = readConfig('quotas');
  assert.equal((await readClaude(config, Date.now(), root)).status, 'unknown');
  const rows = (await fixture('claude')).trim().split('\n').map(JSON.parse);
  for (const row of rows) await writeClaudeQuota(row, config, root);
  const result = await readClaude(config, Date.now(), root);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.windows.map((window) => [window.label, window.remainingPct]), [['5h', 80], ['7j', 67]]);
  assert.equal(result.stale, false);
  assert.equal((await readClaude(config, Date.parse(result.measuredAt) + config.claudeStaleAfterMin * 60000 + 1, root)).stale, true);
});

test('La racine des journaux remonte au dépôt commun du worktree', async () => {
  const root = repositoryRoot();
  assert.ok(!root.includes('/worktrees/'));
  assert.ok(JSON.parse(await readFile(join(root, 'config/engine.json'), 'utf8')).usageLogPath);
});

test('Deux processus écrivent pendant les rotations sans perdre de ligne', async (t) => {
  const directory = await temporary(t);
  const config = { ...readConfig('events'), maxFileBytes: 1, maxRotatedFiles: 30 };
  const ts = '2026-11-17T00:00:00Z';
  await writeFile(join(directory, '2026-11-17.jsonl'), JSON.stringify({ index: 'initial' }) + '\n');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const script = `import { appendEvent } from ${JSON.stringify(new URL('../src/eventLog.js', import.meta.url).href)};
    const [directory, config, prefix] = process.argv.slice(1);
    for (let index = 0; index < 10; index++) {
      await appendEvent({ ts: ${JSON.stringify(ts)}, index: prefix + index }, directory, JSON.parse(config));
    }`;
  await Promise.all(['a', 'b'].map((prefix) => promisify(execFile)(process.execPath,
    ['--input-type=module', '-e', script, directory, JSON.stringify(config), prefix])));
  const files = await readdir(directory);
  assert.ok(files.every((file) => file.endsWith('.jsonl')));
  const rows = (await Promise.all(files.map((file) => readFile(join(directory, file), 'utf8'))))
    .flatMap((text) => text.trim().split('\n').map(JSON.parse));
  assert.equal(rows.length, 21);
  assert.equal(new Set(rows.map((row) => row.index)).size, 21);
});

test('Codex ignore reasoning et les types absents de la configuration', () => {
  for (const type of ['reasoning', 'inconnu']) {
    for (const state of ['item.started', 'item.completed']) {
      assert.deepEqual(codex.toEvents({ type: state, item: { type, id: 'x' } }), []);
    }
  }
  const config = { tools: { outil_configure: { kind: 'read', targets: ['path'] } } };
  assert.equal(codex.toEvents({ type: 'item.started', item: { type: 'outil_configure', path: '/tmp' } }, config)[0].tool.kind, 'read');
});

test('Sans identifiant, les outils sont appariés par kind et target dans leur ordre de lancement', async (t) => {
  const directory = await temporary(t);
  const events = [];
  const sink = createEventSink({}, directory, readConfig('events'), (event) => events.push(event));
  const tool = (id, name, target) => ({ id, name, kind: 'command', target });
  for (const descriptor of [tool('identifié', 'premier', 'a'), tool('undefined', 'autre', 'b'), tool(null, 'second', 'a')]) {
    sink.emit({ kind: 'tool_start', tool: descriptor });
  }
  for (const target of ['b', 'a', 'a']) sink.emit({ kind: 'tool_end', tool: tool(null, 'fin', target) });
  await sink.flush();
  assert.deepEqual(events.filter((event) => event.kind === 'tool_end').map((event) => event.tool.name), ['autre', 'premier', 'second']);
  const [event] = agy.toEvents({ event: 'step_update', step_update: { step_type: 'tool', state: 'ACTIVE', tool_name: 'run_command' } });
  assert.equal(event.tool.id, null);
});

test('Les fenêtres Claude viennent de la config et leur pourcentage est arrondi', async (t) => {
  const root = await temporary(t);
  const config = { ...readConfig('quotas'), claudeWindows: { custom: 'personnalisée' } };
  const windows = { custom: { utilization: 0.3333333, resetsAt: 1900000000 } };
  await writeClaudeQuota({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: windows } }, config, root);
  const result = await readClaude(config, Date.now(), root);
  assert.equal(result.status, 'ok');
  assert.equal(result.windows[0].remainingPct, 66.7);
  assert.equal(result.windows[0].label, 'personnalisée');
  await writeClaudeQuota({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: {} } }, config, root);
  assert.equal((await readClaude(config, Date.now(), root)).windows[0].remainingPct, 66.7);
});

test('Claude émet seulement le texte assistant, tout en conservant les résultats des outils user', () => {
  const message = { content: [{ type: 'text', text: 'texte' }, { type: 'tool_result', tool_use_id: 'x', content: 'sortie' }] };
  assert.deepEqual(claude.toEvents({ type: 'user', message }).map((event) => event.kind), ['tool_end']);
  assert.deepEqual(claude.toEvents({ type: 'assistant', message }).map((event) => event.kind), ['message', 'tool_end']);
});


test('Le masquage précède la troncature et ne modifie pas l’événement source', async (t) => {
  const directory = await temporary(t);
  const events = [];
  const config = { ...readConfig('events'), maxOutputChars: 5 };
  const sink = createEventSink({}, directory, config, (event) => events.push(event));
  const raw = { kind: 'message', text: 'sk-' + 'a'.repeat(20) };
  sink.emit(raw);
  await sink.flush();
  assert.equal(raw.text, 'sk-' + 'a'.repeat(20));
  assert.equal(events[0].text, '[masq');
});

test('Le masquage respecte les segments, les longueurs et la casse des préfixes', () => {
  const config = readConfig('events');
  const ordinary = ['"capital": "Paris"', 'capability', 'monkey=1', 'rapid=true',
    'bearer of bad news', 'pip install sk-learn', 'capital=Paris', 'capability=true',
    '"monkey": "banane"', '"rapid": "oui"', 'Bearer ' + 'a'.repeat(15),
    ...['sk-', 'ghp_', 'github_pat_', 'xoxb-', 'xoxp-'].map((prefix) => prefix + 'a'.repeat(19)),
    'AKIA' + 'A'.repeat(15), 'akia' + 'A'.repeat(16), 'AKIA' + 'a'.repeat(16),
    ...['SK-', 'GHP_', 'GITHUB_PAT_', 'XOXB-', 'XOXP-'].map((prefix) => prefix + 'a'.repeat(20))];
  for (const text of ordinary) assert.equal(maskEvent({ text }, config).text, text, text);
  const secrets = [
    ['OPENAI_API_KEY=sk-' + 'a'.repeat(20), 'OPENAI_API_KEY=[masqué]'],
    ['Authorization: Bearer ' + 'a'.repeat(40), 'Authorization: Bearer [masqué]'],
    ['"apiKey": "valeur"', '"apiKey": "[masqué]"'],
    ['githubToken=ghp_' + 'a'.repeat(20), 'githubToken=[masqué]'],
    ['AKIA' + 'A1'.repeat(8), '[masqué]'],
    ['client_secret=valeur', 'client_secret=[masqué]'],
    ...['api-key', 'client.secret', 'password', 'myAPIKey'].map((name) => [name + '=valeur', name + '=[masqué]']),
    ...['sk-', 'ghp_', 'github_pat_', 'xoxb-', 'xoxp-'].map((prefix) => [prefix + 'a'.repeat(20), '[masqué]']),
  ];
  for (const [text, expected] of secrets) assert.equal(maskEvent({ text }, config).text, expected, text);
});

test('Le champ error est masqué comme les sorties', () => {
  const secretPatterns = [{ pattern: 'sk-[a-z0-9]+', flags: 'g', replacement: '[masqué]' }];
  assert.equal(maskEvent({ kind: 'call_end', error: 'stderr : clé sk-abc123 refusée' }, { secretPatterns }).error,
    'stderr : clé [masqué] refusée');
});

test('Chaque motif utilise ses propres drapeaux', () => {
  const secretPatterns = [{ pattern: 'secret', flags: 'g', replacement: '[masqué]' }];
  assert.equal(maskEvent({ text: 'SECRET secret secret' }, { secretPatterns }).text, 'SECRET [masqué] [masqué]');
});

test('Les valeurs entre guillemets échappés sont masquées entièrement', () => {
  const config = readConfig('events');
  const assignments = [String.raw`SECRET="abc\"def"`, String.raw`SECRET='abc\'def'`,
    String.raw`SECRET="abc\\def\"ghi"`, String.raw`SECRET="abc\\"`];
  for (const assignment of assignments) {
    const text = `${assignment} normal=visible`;
    assert.equal(maskEvent({ text }, config).text, 'SECRET=[masqué] normal=visible', text);
  }
  assert.equal(maskEvent({ text: String.raw`{"client_secret": "abc\"def", "capital": "Paris"}` }, config).text,
    '{"client_secret": "[masqué]", "capital": "Paris"}');
});
