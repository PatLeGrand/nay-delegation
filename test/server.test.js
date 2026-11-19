import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, appendFile, rename, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { createServer } from '../src/server/app.js';
import { aggregateUsage } from '../src/server/usage.js';
import { parseFeature } from '../src/server/features.js';
import { readConfig } from '../src/config.js';

const uiConfig = readConfig('ui');
const epoch = Date.parse('2026-11-17T12:00:00Z');
const event = (callId, extra = {}) => ({ v: 1, ts: new Date(epoch).toISOString(),
  callId, agent: 'sol', feature: 'serveur', kind: 'call_start', ...extra });

test('usage : totaux, groupes triés, filtres et appels récents', () => {
  const records = [
    { timestamp: '2026-11-16T00:00:00Z', agent: 'sol', model: 'a', feature: 'a', role: 'dev', usage: { input: 20, cachedInput: 10, output: 4 }, durationMs: 9 },
    { timestamp: '2026-11-17T00:00:00Z', agent: 'terra', model: 'b', feature: 'b', role: 'review', usage: { input: 50, output: 5 }, durationMs: 3 },
    { timestamp: '2026-11-18T00:00:00Z', agent: 'sol', model: 'a', feature: 'a', role: 'dev', usage: { input: 3, output: 1 }, durationMs: 2 },
  ];
  const result = aggregateUsage(records, { recent: 2 });
  assert.deepEqual(result.totals, { calls: 3, input: 73, cachedInput: 10, output: 10, durationMs: 14 });
  for (const key of ['byAgent', 'byModel', 'byFeature', 'byRole']) assert.equal(result[key][0].input, 50);
  assert.deepEqual(result.recent, [records[2], records[1]]);
  assert.equal(aggregateUsage(records, { feature: 'a' }).totals.calls, 2);
  assert.equal(aggregateUsage(records, { feature: 'a', since: '2026-11-17' }).totals.calls, 1);
  assert.deepEqual(aggregateUsage([]).recent, []);
});

test('fiches réelles fusionnées et fiches partielles', async () => {
  for (const name of ['quotas', 'ordre-delegation', 'flux-evenements', 'appel-agents', 'alertes']) {
    const parsed = parseFeature(await readFile(new URL(`../docs/features/${name}.md`, import.meta.url), 'utf8'), name);
    assert.equal(parsed.state, 'fusionnee', name);
    assert.equal(parsed.waitingForUser, false);
    assert.ok(parsed.branch?.startsWith('feature/'));
    assert.ok(parsed.tests);
  }
  for (const decision of ['- Ma décision : en attente', '- Ma décision :', '']) {
    const feature = parseFeature(`# Fonctionnalité : essai\n## Reviewer\n- Verdict : À CORRIGER\n- Verdict : APPROUVÉ\n## Tests\n${decision}\n`, 'essai');
    assert.equal(feature.waitingForUser, true);
    assert.deepEqual(feature.verdicts, ['À CORRIGER', 'APPROUVÉ']);
  }
  const notMerged = parseFeature('# Fonctionnalité : essai\n## Reviewer\n- Verdict : APPROUVÉ\n## Tests\n- Ma décision : en attente\n## Décision finale\n\n- Non fusionné : en attente d’être fusionné.\n', 'essai');
  assert.notEqual(notMerged.state, 'fusionnee');
  assert.equal(notMerged.waitingForUser, true);
  const partial = parseFeature('', 'vide');
  for (const key of ['title', 'branch', 'task', 'developer', 'reviewer', 'lastVerdict', 'tests', 'decision', 'final']) assert.equal(partial[key], null, key);
});

async function fixture(t, memory = false, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'nay-server-'));
  for (const directory of ['config', 'ui', 'docs/features', '.nay/state/events']) await mkdir(join(root, directory), { recursive: true });
  await writeFile(join(root, 'ui/index.html'), 'Interface Nay en construction');
  for (const name of ['delegation', 'agents']) await writeFile(join(root, `config/${name}.json`), JSON.stringify(readConfig(name)));
  let now = epoch;
  const file = join(root, '.nay/state/events/2026-11-17.jsonl');
  await writeFile(file, `${JSON.stringify(event('ancien'))}\n`);
  let quotaReads = 0;
  const server = createServer({ root, config: { ...uiConfig, port: 0, sseFilePollMs: 15, sseHeartbeatSec: 0.05 },
    ...options, now: () => now, quotasReader: async () => { quotaReads++; return { codex: { status: 'unknown' } }; } });
  if (!memory) {
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      if (error.code !== 'EPERM') throw error;
      t.skip('Bac à sable : listen EPERM sur 127.0.0.1');
      return null;
    }
  } else server.address = () => ({ port: 4317 });
  t.after(async () => {
    if (!memory) await new Promise((resolve) => server.close(resolve));
    else server.close();
    await rm(root, { recursive: true, force: true });
  });
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  function dispatch(path, { method = 'GET', headers = {}, body } = {}) {
    const request = Readable.from(body ? [Buffer.from(body)] : []);
    Object.assign(request, { url: path, method,
      headers: { host: `127.0.0.1:${port}`, ...Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])) } });
    const response = new PassThrough();
    response.writeHead = (status, headers) => { response.statusCode = status; response.headers = headers; response.headersSent = true; };
    response.flushHeaders = () => {};
    server.emit('request', request, response);
    return response;
  }
  function request(path, { method = 'GET', headers = {}, body } = {}) {
    if (memory) return new Promise((resolve) => {
      const res = dispatch(path, { method, headers, body });
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }
  return { root, file, port, origin, request, dispatch: memory ? dispatch : null, setNow: (value) => { now = value; }, quotaReads: () => quotaReads };
}

async function httpChecks(t, memory) {
  const f = await fixture(t, memory);
  if (!f) return;
  assert.equal((await f.request('/', { headers: { Host: 'evil.example' } })).status, 403);
  assert.equal((await f.request('/../config/agents.json')).status, 403);
  assert.equal((await f.request('/%2e%2e/config/agents.json')).status, 403);
  await symlink(join(f.root, 'config'), join(f.root, 'ui/linked'));
  assert.equal((await f.request('/linked/agents.json')).status, 403);
  assert.match((await f.request('/')).text, /construction/);
  assert.equal((await f.request('/api/calls/inconnu')).status, 404);
  const status = JSON.parse((await f.request('/api/status')).text);
  assert.equal(status.now, new Date(epoch).toISOString());
  assert.equal(status.calls[0].callId, 'ancien');
  assert.equal(status.calls[0].startedAt, new Date(epoch).toISOString());
  assert.deepEqual(status.calls[0].currentTools, []);
  assert.equal(JSON.parse((await f.request('/api/calls/ancien')).text).events.length, 1);
  assert.equal(JSON.parse((await f.request('/api/status?feature=autre')).text).calls.length, 0);
  assert.ok(JSON.parse((await f.request('/api/quota')).text).agents.some((agent) => agent.name === 'sol'));
  assert.equal(f.quotaReads(), 1);
  assert.equal(JSON.parse((await f.request('/api/usage')).text).totals.calls, 0);
  await appendFile(f.file, `${JSON.stringify(event('ancien', { kind: 'usage', usage: { input: 100 } }))}\n`);
  await appendFile(f.file, `${JSON.stringify(event('ancien', { kind: 'usage', usage: { input: 200 } }))}\n`);
  await writeFile(join(f.root, '.nay/state/usage.jsonl'), `${JSON.stringify({ timestamp: new Date(epoch).toISOString(), agent: 'sol', feature: 'serveur', usage: { input: 200, output: 10 } })}\n`);
  assert.equal(JSON.parse((await f.request('/api/usage?feature=serveur')).text).totals.input, 200);
  assert.equal((await f.request('/api/usage?since=invalide')).status, 400);
  assert.deepEqual(JSON.parse((await f.request('/api/features')).text), []);
  const headers = { Origin: f.origin, 'Content-Type': 'application/json' };
  assert.equal((await f.request('/api/delegation', { method: 'PUT', body: '{}' })).status, 403);
  assert.equal((await f.request('/api/delegation', { method: 'PUT', headers: { ...headers, Origin: 'http://evil.example' }, body: '{}' })).status, 403);
  assert.equal((await f.request('/api/delegation', { method: 'PUT', headers: { Origin: f.origin }, body: '{}' })).status, 403);
  const invalid = await f.request('/api/delegation', { method: 'PUT', headers, body: '{}' });
  assert.equal(invalid.status, 400);
  assert.ok(JSON.parse(invalid.text).errors.length);
  assert.equal((await f.request('/api/delegation', { method: 'PUT', headers, body: '{' })).status, 400);
  const delegation = readConfig('delegation');
  delegation.developpeur.reverse();
  const valid = await f.request('/api/delegation', { method: 'PUT', headers, body: JSON.stringify(delegation) });
  assert.equal(valid.status, 200);
  assert.deepEqual(JSON.parse(await readFile(join(f.root, 'config/delegation.json'), 'utf8')), delegation);
  assert.equal((await f.request('/api/delegation', { method: 'PUT', headers, body: ' '.repeat(uiConfig.maxBodyBytes + 1) })).status, 413);
  assert.equal((await f.request('/api/delegation', { method: 'PUT', headers: { ...headers, 'Transfer-Encoding': 'chunked' }, body: ' '.repeat(uiConfig.maxBodyBytes + 1) })).status, 413);
}

test('HTTP localhost : sécurité et contrat', (t) => httpChecks(t, false));
test('Gestionnaires HTTP en mémoire : sécurité et contrat', (t) => httpChecks(t, true));

async function streamClient(t, f, query = '') {
  const req = f.dispatch ? null : http.get(`${f.origin}/api/events/stream${query}`);
  const res = f.dispatch ? f.dispatch(`/api/events/stream${query}`) : (await once(req, 'response'))[0];
  // En mémoire, attendre flushHeaders rend l'abonnement aussi déterministe que le vrai client HTTP.
  if (f.dispatch) await new Promise((resolve) => { res.flushHeaders = resolve; });
  t.after(() => { res.destroy(); req?.destroy(); });
  res.setEncoding('utf8');
  let text = '';
  const waiting = new Set();
  res.on('data', (chunk) => { text += chunk; for (const resolve of waiting) resolve(); waiting.clear(); });
  async function until(fragment) {
    const deadline = Date.now() + 3000;
    while (!text.includes(fragment)) {
      if (Date.now() > deadline) assert.fail(`SSE absent : ${fragment}, reçu : ${text}`);
      await new Promise((resolve) => {
        const timer = setTimeout(() => { waiting.delete(done); resolve(); }, 50);
        const done = () => { clearTimeout(timer); resolve(); };
        waiting.add(done);
      });
    }
  }
  return { until, text: () => text };
}

async function streamChecks(t, memory) {
  const f = await fixture(t, memory);
  if (!f) return;
  const client = await streamClient(t, f, '?feature=serveur');
  await appendFile(f.file, `${JSON.stringify(event('exclu', { feature: 'autre' }))}\n`);
  const line = JSON.stringify(event('ajouté'));
  await appendFile(f.file, line.slice(0, 20));
  await appendFile(f.file, `${line.slice(20)}\n`);
  await client.until('ajouté');
  assert.ok(!client.text().includes('ancien'));
  assert.ok(!client.text().includes('exclu'));
  await appendFile(f.file, `${JSON.stringify(event('avant-rotation'))}\n`);
  await rename(f.file, f.file.replace('.jsonl', '.123-1-abc.jsonl'));
  await writeFile(f.file, `${JSON.stringify(event('après-rotation'))}\n`);
  await client.until('avant-rotation');
  await client.until('après-rotation');
  f.setNow(epoch + 24 * 60 * 60 * 1000);
  await writeFile(join(f.root, '.nay/state/events/2026-11-18.jsonl'), `${JSON.stringify(event('lendemain'))}\n`);
  await client.until('lendemain');
  await client.until(': ping');
}

test('SSE localhost : ajout, rotation et date', (t) => streamChecks(t, false));
test('SSE en mémoire : ajout, rotation, date et filtre', (t) => streamChecks(t, true));

test('POST resume : protections, validation, fin et verrou de session, lancement détaché', async (t) => {
  const { appendUsage } = await import('../src/usageLog.js');
  const calls = [];
  let rejectResume;
  const f = await fixture(t, true, { resumer: (id, message, options) => {
    calls.push({ id, message, options });
    return new Promise((resolve, reject) => { rejectResume = reject; });
  } });
  const path = join(f.root, '.nay/state/usage.jsonl');
  for (const entry of [
    { callId: 'parent', sessionId: 'session' }, { callId: 'alias', sessionId: 'session' },
    { callId: 'actif', sessionId: 'autre' }, { callId: 'sans-session' },
    { callId: 'session-invalide', sessionId: '--help' },
  ]) await appendUsage(entry, path);
  await appendFile(f.file, [event('parent', { kind: 'call_end' }), event('alias', { kind: 'call_end' }),
    event('actif')].map(JSON.stringify).join('\n') + '\n');
  const post = (id, body = { message: 'suite' }, headers = {}) => f.request(`/api/calls/${id}/resume`, {
    method: 'POST', body: JSON.stringify(body), headers: {
      Origin: f.origin, 'Content-Type': 'application/json', ...headers,
    },
  });
  assert.equal((await post('parent', undefined, { Origin: undefined })).status, 403);
  assert.equal((await post('parent', undefined, { Host: 'evil.example' })).status, 403);
  assert.equal((await post('parent', undefined, { 'Content-Type': 'text/plain' })).status, 403);
  for (const body of [null, {}, { message: '' }, { message: '  ' }, { message: 3 }]) {
    assert.equal((await post('parent', body)).status, 400);
  }
  const invalidJson = await f.request('/api/calls/parent/resume', {
    method: 'POST', body: 'pas du JSON',
    headers: { Origin: f.origin, 'Content-Type': 'application/json' },
  });
  assert.equal(invalidJson.status, 400);
  assert.match(JSON.parse(invalidJson.text).error, /JSON invalide/);
  assert.equal(calls.length, 0);
  assert.equal((await post('parent', { message: 'a'.repeat(uiConfig.maxBodyBytes) })).status, 413);
  assert.equal((await post('absent')).status, 404);
  assert.equal((await post('sans-session')).status, 404);
  assert.equal((await post('session-invalide')).status, 404);
  assert.equal((await post('actif')).status, 409);
  const accepted = await post('parent');
  assert.equal(accepted.status, 202);
  const result = JSON.parse(accepted.text);
  assert.equal(result.resumedFrom, 'parent');
  assert.ok(result.callId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'parent');
  assert.equal(calls[0].message, 'suite');
  assert.equal(calls[0].options.callId, result.callId);
  assert.equal(calls[0].options.journalRoot, f.root);
  assert.equal((await post('alias')).status, 409);
  rejectResume(new Error('échec journal simulé'));
  await new Promise(setImmediate);
  assert.equal((await post('alias')).status, 202);
  rejectResume(new Error('autre échec'));
  await new Promise(setImmediate);
});

test('usage : jours UTC et fiabilité exacts, filtres inclus', () => {
  const records = [
    { timestamp: '2026-11-18T01:00:00+02:00', feature: 'a', agent: 'sol', status: 'ok', durationMs: 10, usage: { input: 10, cachedInput: 4, output: 2 } },
    { timestamp: '2026-11-17T23:30:00Z', feature: 'a', agent: 'sol', status: 'error', error: 'Réponse vide de l’agent\nDétails privés', durationMs: 30, usage: { input: 20, output: 3 } },
    { timestamp: '2026-11-18T00:00:00Z', feature: 'a', agent: 'sol', status: 'timeout', error: 'Délai maximal dépassé', durationMs: 50 },
    { timestamp: '2026-11-18T01:00:00Z', feature: 'b', agent: 'terra', status: 'ok', durationMs: 20, usage: { input: 6, cachedInput: 2, output: 1 } },
    { timestamp: '2026-11-18T02:00:00Z', feature: 'a', agent: 'sol', status: 'error', error: 'Réponse vide de l’agent\r\nAutres détails', durationMs: 70 },
  ];
  const result = aggregateUsage(records);
  assert.deepEqual(result.byDay, [
    { day: '2026-11-17', calls: 2, input: 30, cachedInput: 4, output: 5 },
    { day: '2026-11-18', calls: 3, input: 6, cachedInput: 2, output: 1 },
  ]);
  assert.deepEqual(result.reliability, [
    { key: 'sol', calls: 4, failures: 3, failureRate: 0.75, medianDurationMs: 40, topErrors: [
      { error: 'Réponse vide de l’agent', count: 2 }, { error: 'Délai maximal dépassé', count: 1 },
    ] },
    { key: 'terra', calls: 1, failures: 0, failureRate: 0, medianDurationMs: 20, topErrors: [] },
  ]);
  const filtered = aggregateUsage(records, { feature: 'a', since: '2026-11-18' });
  assert.deepEqual(filtered.byDay, [{ day: '2026-11-18', calls: 2, input: 0, cachedInput: 0, output: 0 }]);
  assert.deepEqual(filtered.reliability, [{ key: 'sol', calls: 2, failures: 2, failureRate: 1, medianDurationMs: 60,
    topErrors: [{ error: 'Délai maximal dépassé', count: 1 }, { error: 'Réponse vide de l’agent', count: 1 }] }]);
  assert.deepEqual(aggregateUsage([]).byDay, []);
  assert.deepEqual(aggregateUsage([]).reliability, []);
});

test('usage : trois causes au plus, première ligne et 120 caractères, durées absentes', () => {
  const records = ['a'.repeat(150) + '\nsecret', 'b', 'c', 'd'].map((error) => ({
    agent: 'sol', status: 'error', error, timestamp: 'invalide',
  }));
  const result = aggregateUsage(records);
  assert.deepEqual(result.byDay, []);
  assert.deepEqual(result.reliability, [{ key: 'sol', calls: 4, failures: 4, failureRate: 1, medianDurationMs: null,
    topErrors: [{ error: 'a'.repeat(120), count: 1 }, { error: 'b', count: 1 }, { error: 'c', count: 1 }] }]);
  assert.equal(aggregateUsage([{ agent: 'sol', durationMs: 7 }]).reliability[0].medianDurationMs, 7);
  assert.deepEqual(aggregateUsage([{ agent: 'sol' }]).reliability[0].topErrors, [{ error: 'Cause inconnue', count: 1 }]);
});
