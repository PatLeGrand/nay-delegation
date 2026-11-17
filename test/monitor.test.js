import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEvent, buildState, emptyState, sortedOpenTools } from '../src/monitor/state.js';
import { computeAlerts } from '../src/monitor/alerts.js';
import { latestEventsFile, reduceEvents } from '../src/monitor/readEvents.js';
import { formatDuration, shorten } from '../src/monitor/format.js';
import { loadMonitorConfig, validateMonitorConfig } from '../src/monitor/config.js';

const CONFIG = { longCommandSec: 60, silenceSec: 180, failuresAlertAt: 3, historyMax: 50, targetMaxChars: 60 };
const T0 = Date.parse('2026-11-17T10:00:00.000Z');
const at = (sec) => new Date(T0 + sec * 1000).toISOString();
const base = { v: 1, callId: 'c1', agent: 'sol', model: 'gpt', feature: 'alertes', role: 'developpeur' };
const event = (kind, sec, extra = {}) => ({ ...base, kind, ts: at(sec), ...extra });
const tool = (id, kind, target) => ({ id, name: 'brut', kind, target });
const toolStart = (sec, t) => event('tool_start', sec, { tool: t });
const toolEnd = (sec, t, ok = true) => event('tool_end', sec, { tool: t, ok });
const callStart = () => event('call_start', 0, { mode: 'write' });
const alertsAt = (events, sec) => computeAlerts(buildState(events, CONFIG), T0 + sec * 1000, CONFIG);
const kindsAt = (events, sec) => alertsAt(events, sec).map((alert) => alert.kind);

function runTwice(first, second, firstOk) {
  return [callStart(),
    toolStart(1, first), toolEnd(2, first, firstOk),
    toolStart(3, second), toolEnd(4, second, true)];
}

test('Commande longue : rien à 59 s, alerte à 61 s', () => {
  const events = [callStart(), toolStart(0, tool('t1', 'command', 'npm test'))];
  assert.deepEqual(kindsAt(events, 59), []);
  const [alert] = alertsAt(events, 61);
  assert.equal(alert.kind, 'commande_longue');
  assert.equal(alert.callId, 'c1');
  assert.equal(alert.agent, 'sol');
  assert.equal(alert.feature, 'alertes');
  assert.equal(alert.detail, 'npm test tourne depuis 1 min');
});

test('Une lecture longue n’est pas une commande longue', () => {
  const events = [callStart(), toolStart(0, tool('t1', 'read', 'a.js'))];
  assert.deepEqual(kindsAt(events, 120), []);
});

test('Silence : rien à 180 s, alerte au-delà', () => {
  const events = [callStart()];
  assert.deepEqual(kindsAt(events, 180), []);
  assert.deepEqual(kindsAt(events, 181), ['silence']);
});

test('Échecs : alerte au 3e tool_end en échec', () => {
  const failing = (n) => [toolStart(n * 2, tool(`t${n}`, 'command', `cmd ${n}`)),
    toolEnd(n * 2 + 1, tool(`t${n}`, 'command', `cmd ${n}`), false)];
  const twoFailures = [callStart(), ...failing(1), ...failing(2)];
  assert.deepEqual(kindsAt(twoFailures, 10), []);
  assert.deepEqual(kindsAt([...twoFailures, ...failing(3)], 10), ['echecs']);
});

test('Travail répété : commande relancée après un échec, pas après un succès', () => {
  const npm = tool('t1', 'command', 'npm test');
  const again = tool('t2', 'command', 'npm test');
  const [alert] = alertsAt(runTwice(npm, again, false), 10);
  assert.equal(alert.kind, 'travail_repete');
  assert.match(alert.detail, /relancée à l'identique.*npm test/);
  assert.deepEqual(kindsAt(runTwice(npm, again, true), 10), []);
});

test('Travail répété : fichier relu sans modification, pas s’il a été modifié entre-temps', () => {
  const read = (id) => tool(id, 'read', 'src/a.js');
  const edit = tool('e1', 'edit', 'src/a.js');
  const twice = [callStart(), toolStart(1, read('r1')), toolEnd(2, read('r1')),
    toolStart(3, read('r2')), toolEnd(4, read('r2'))];
  assert.deepEqual(kindsAt(twice, 10), ['travail_repete']);
  const withEdit = [callStart(), toolStart(1, read('r1')), toolEnd(2, read('r1')),
    toolStart(3, edit), toolEnd(4, edit), toolStart(5, read('r2')), toolEnd(6, read('r2'))];
  assert.deepEqual(kindsAt(withEdit, 10), []);
});

test('Travail répété : même recherche deux fois, pas deux recherches différentes', () => {
  const search = (id, target) => tool(id, 'search', target);
  const same = runTwice(search('s1', 'TODO'), search('s2', 'TODO'), true);
  assert.deepEqual(kindsAt(same, 10), ['travail_repete']);
  const different = runTwice(search('s1', 'TODO'), search('s2', 'FIXME'), true);
  assert.deepEqual(kindsAt(different, 10), []);
});

test('Appel terminé : plus de silence ni de commande longue', () => {
  const events = [callStart(), toolStart(0, tool('t1', 'command', 'npm test')),
    event('call_end', 5, { status: 'ok', usage: { total: 10 } })];
  assert.deepEqual(kindsAt(events, 1000), []);
  const state = buildState(events, CONFIG);
  assert.equal(state.calls.c1.status, 'ok');
  assert.equal(state.calls.c1.endedAt, T0 + 5000);
  assert.deepEqual(state.calls.c1.currentTools, {});
});

test('Appel terminé en erreur : l’alerte d’échecs reste', () => {
  const failing = (n) => [toolStart(n * 2, tool(`t${n}`, 'command', `cmd ${n}`)),
    toolEnd(n * 2 + 1, tool(`t${n}`, 'command', `cmd ${n}`), false)];
  const events = [callStart(), ...failing(1), ...failing(2), ...failing(3),
    event('call_end', 20, { status: 'error', error: 'échec' })];
  assert.deepEqual(kindsAt(events, 1000), ['echecs']);
});

test('Un événement sans call_start crée quand même l’appel', () => {
  const state = buildState([toolStart(7, tool('t1', 'command', 'ls'))], CONFIG);
  const call = state.calls.c1;
  assert.equal(call.status, 'running');
  assert.equal(call.agent, 'sol');
  assert.equal(call.feature, 'alertes');
  assert.equal(call.startedAt, T0 + 7000);
  assert.equal(sortedOpenTools(call.currentTools).length, 1);
});

test('applyEvent ne modifie pas l’état reçu', () => {
  const before = buildState([callStart()], CONFIG);
  const snapshot = JSON.stringify(before);
  applyEvent(before, toolStart(1, tool('t1', 'command', 'ls')), CONFIG);
  applyEvent(emptyState(), callStart(), CONFIG);
  assert.equal(JSON.stringify(before), snapshot);
});

test('tool_end sans identifiant ferme le plus ancien outil de même kind et target', () => {
  const anonymous = tool(undefined, 'command', 'sleep 1');
  const state = buildState([toolStart(0, anonymous), toolStart(5, anonymous), toolEnd(6, anonymous)], CONFIG);
  const open = sortedOpenTools(state.calls.c1.currentTools);
  assert.equal(open.length, 1);
  assert.equal(open[0].startedAt, T0 + 5000);
  assert.equal(state.calls.c1.toolCount, 2);
});

test('L’historique est borné par historyMax', () => {
  const config = { ...CONFIG, historyMax: 2 };
  const events = [1, 2, 3, 4].flatMap((n) => [toolStart(n, tool(`t${n}`, 'read', `f${n}`)),
    toolEnd(n, tool(`t${n}`, 'read', `f${n}`))]);
  const { history } = buildState(events, config).calls.c1;
  assert.deepEqual(history.map((entry) => entry.target), ['f3', 'f4']);
});

test('Les événements invalides sont ignorés', () => {
  const state = buildState([{ kind: 'tool_start' }, { ...callStart(), ts: 'pas une date' }], CONFIG);
  assert.deepEqual(state, emptyState());
});

test('formatDuration : secondes, minutes, heures', () => {
  assert.equal(formatDuration(45_000), '45 s');
  assert.equal(formatDuration(120_000), '2 min');
  assert.equal(formatDuration(3_900_000), '1 h 05');
});

const collect = (events, event) => [...events, event];

test('reduceEvents ignore les lignes illisibles et renvoie la valeur initiale si le fichier manque', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'nay-monitor-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, '2026-11-17.jsonl');
  await writeFile(file, `${JSON.stringify(callStart())}\n{pas du json\n\n[1,2]\n${JSON.stringify(toolStart(1, tool('t1', 'read', 'a')))}\n`);
  const events = await reduceEvents(file, collect, []);
  assert.deepEqual(events.map((e) => e.kind), ['call_start', 'tool_start']);
  assert.deepEqual(await reduceEvents(join(dir, 'absent.jsonl'), collect, []), []);
});

test('reduceEvents réduit à la volée un gros fichier sans garder les événements', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'nay-monitor-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, '2026-11-17.jsonl');
  const lines = Array.from({ length: 5_000 }, (_, n) => JSON.stringify(toolEnd(n % 100, tool(`t${n}`, 'read', `f${n}`))));
  await writeFile(file, `${lines.join('\n')}\n`);
  const count = await reduceEvents(file, (total) => total + 1, 0);
  assert.equal(count, 5_000);
  const state = await reduceEvents(file, (acc, e) => applyEvent(acc, e, CONFIG), emptyState());
  assert.equal(state.calls.c1.toolCount, 5_000);
  assert.equal(state.calls.c1.history.length, CONFIG.historyMax);
});

test('Commande relancée après échec : un edit entre les deux efface le soupçon', () => {
  const npm = (id) => tool(id, 'command', 'npm test');
  const edit = tool('e1', 'edit', 'src/autre.js');
  const withEdit = [callStart(), toolStart(1, npm('t1')), toolEnd(2, npm('t1'), false),
    toolStart(3, edit), toolEnd(4, edit), toolStart(5, npm('t2')), toolEnd(6, npm('t2'), false)];
  assert.deepEqual(kindsAt(withEdit, 10), []);
  const failedAgain = [...withEdit, toolStart(7, npm('t3')), toolEnd(8, npm('t3'), true)];
  assert.deepEqual(kindsAt(failedAgain, 10), ['travail_repete']);
});

test('Recherche répétée : un edit entre deux recherches identiques efface le soupçon', () => {
  const search = (id) => tool(id, 'search', 'TODO');
  const edit = tool('e1', 'edit', 'src/a.js');
  const events = [callStart(), toolStart(1, search('s1')), toolEnd(2, search('s1')),
    toolStart(3, edit), toolEnd(4, edit), toolStart(5, search('s2')), toolEnd(6, search('s2'))];
  assert.deepEqual(kindsAt(events, 10), []);
});

test('Appel terminé : échecs gardés pour error et timeout, travail répété gardé après call_end', () => {
  const failing = (n) => [toolStart(n * 2, tool(`t${n}`, 'command', `cmd ${n}`)),
    toolEnd(n * 2 + 1, tool(`t${n}`, 'command', `cmd ${n}`), false)];
  const failures = [callStart(), ...failing(1), ...failing(2), ...failing(3)];
  assert.deepEqual(kindsAt([...failures, event('call_end', 20, { status: 'timeout' })], 1000), ['echecs']);
  assert.deepEqual(kindsAt([...failures, event('call_end', 20, { status: 'error' })], 1000), ['echecs']);
  assert.deepEqual(kindsAt([...failures, event('call_end', 20, { status: 'ok' })], 1000), []);
  const read = (id) => tool(id, 'read', 'a.js');
  const repeated = [...runTwice(read('r1'), read('r2'), true), event('call_end', 9, { status: 'ok' })];
  assert.deepEqual(kindsAt(repeated, 1000), ['travail_repete']);
});

test('tool_end avec un identifiant inconnu ne ferme pas un autre outil', () => {
  const state = buildState([toolStart(0, tool('t1', 'command', 'npm test')),
    toolEnd(1, tool('zz', 'command', 'npm test'))], CONFIG);
  assert.deepEqual(sortedOpenTools(state.calls.c1.currentTools).map((open) => open.id), ['t1']);
  assert.equal(state.calls.c1.toolCount, 2);
});

test('Un outil reçu après call_end n’ouvre pas d’outil', () => {
  const events = [callStart(), event('call_end', 5, { status: 'ok' }),
    toolStart(6, tool('t1', 'command', 'npm test'))];
  const call = buildState(events, CONFIG).calls.c1;
  assert.deepEqual(call.currentTools, {});
  assert.equal(call.toolCount, 0);
  assert.equal(call.lastEventAt, T0 + 6000);
});

test('tool_end avant son tool_start : un seul outil, pas de fantôme', () => {
  const t = tool('t1', 'command', 'npm test');
  const call = buildState([callStart(), toolEnd(5, t, false), toolStart(4, t)], CONFIG).calls.c1;
  assert.deepEqual(call.currentTools, {});
  assert.equal(call.toolCount, 1);
  assert.equal(call.failures, 1);
  assert.deepEqual(call.earlyEnds, []);
});

test('Événements hors ordre : maxima et historique trié par ts', () => {
  const events = [callStart(), toolEnd(9, tool('a', 'read', 'f9'), false), toolEnd(3, tool('b', 'read', 'f3'), false),
    toolEnd(6, tool('c', 'read', 'f6'))];
  const call = buildState(events, CONFIG).calls.c1;
  assert.equal(call.lastFailureAt, T0 + 9000);
  assert.equal(call.lastEventAt, T0 + 9000);
  assert.deepEqual(call.history.map((entry) => entry.target), ['f3', 'f6', 'f9']);
});

test('historyMax 0 : historique vide ; targetMaxChars 0 : cible vide', () => {
  const read = tool('t1', 'read', 'a.js');
  const noHistory = { ...CONFIG, historyMax: 0 };
  const state = buildState([toolStart(0, read), toolEnd(1, read)], noHistory);
  assert.deepEqual(state.calls.c1.history, []);
  assert.equal(shorten('abc', 0), '');
  const noTarget = { ...CONFIG, targetMaxChars: 0 };
  const running = buildState([callStart(), toolStart(0, tool('t1', 'command', 'npm test'))], noTarget);
  const [alert] = computeAlerts(running, T0 + 61_000, noTarget);
  assert.equal(alert.detail, 'Une commande tourne depuis 1 min');
});

test('Config du moniteur : valeurs négatives ou absentes refusées avec un message clair', () => {
  assert.doesNotThrow(() => validateMonitorConfig({ ...CONFIG, eventsDir: 'x', historyMax: 0 }));
  assert.throws(() => validateMonitorConfig({ ...CONFIG, eventsDir: 'x', historyMax: -1 }), /« historyMax » doit être un nombre >= 0/);
  assert.throws(() => validateMonitorConfig({ ...CONFIG, eventsDir: 'x', silenceSec: '180' }), /silenceSec/);
  assert.throws(() => validateMonitorConfig({ eventsDir: 'x' }), /longCommandSec.*targetMaxChars/);
  assert.throws(() => validateMonitorConfig({ ...CONFIG }), /eventsDir/);
  assert.doesNotThrow(() => loadMonitorConfig());
});

test('Échecs consécutifs : un succès remet le compteur à zéro, le cumul est gardé', () => {
  const step = (n, ok) => [toolStart(n * 2, tool(`t${n}`, 'command', `cmd ${n}`)),
    toolEnd(n * 2 + 1, tool(`t${n}`, 'command', `cmd ${n}`), ok)];
  const scattered = [callStart(), ...step(1, false), ...step(2, false), ...step(3, true),
    ...step(4, false), ...step(5, false)];
  const call = buildState(scattered, CONFIG).calls.c1;
  assert.equal(call.failures, 4);
  assert.equal(call.consecutiveFailures, 2);
  assert.deepEqual(kindsAt(scattered, 20), []);
  const [alert] = alertsAt([...scattered, ...step(6, false)], 20);
  assert.equal(alert.kind, 'echecs');
  assert.equal(alert.detail, '3 outils en échec de suite');
});

test('failuresAlertAt doit valoir au moins 1 ; à 0 aucune fausse alerte sans échec', () => {
  assert.throws(() => validateMonitorConfig({ ...CONFIG, eventsDir: 'x', failuresAlertAt: 0 }), /« failuresAlertAt » doit être un nombre >= 1/);
  assert.doesNotThrow(() => validateMonitorConfig({ ...CONFIG, eventsDir: 'x', failuresAlertAt: 1 }));
  const lax = { ...CONFIG, failuresAlertAt: 0 };
  const state = buildState([callStart(), toolEnd(1, tool('a', 'read', 'f1'))], lax);
  assert.deepEqual(computeAlerts(state, T0 + 2000, lax), []);
});

test('Échecs consécutifs : un vieux succès arrivé en retard ne remet pas à zéro des échecs récents', () => {
  const events = [callStart(), toolEnd(10, tool('a', 'read', 'f10'), false), toolEnd(11, tool('b', 'read', 'f11'), false),
    toolEnd(12, tool('c', 'read', 'f12'), false), toolEnd(2, tool('d', 'read', 'f2'))];
  assert.equal(buildState(events, CONFIG).calls.c1.consecutiveFailures, 3);
  assert.deepEqual(kindsAt(events, 13), ['echecs']);
});

test('Échecs consécutifs : un vieil échec arrivé en retard ne s’ajoute pas après un succès plus récent', () => {
  const events = [callStart(), toolEnd(1, tool('a', 'read', 'f1'), false), toolEnd(2, tool('b', 'read', 'f2'), false),
    toolEnd(10, tool('c', 'read', 'f10')), toolEnd(3, tool('d', 'read', 'f3'), false)];
  assert.equal(buildState(events, CONFIG).calls.c1.consecutiveFailures, 0);
  assert.deepEqual(kindsAt(events, 11), []);
});

test('Échecs consécutifs : bornés par historyMax', () => {
  const bounded = { ...CONFIG, historyMax: 2 };
  const events = [1, 2, 3, 4].map((n) => toolEnd(n, tool(`t${n}`, 'read', `f${n}`), false));
  assert.equal(buildState(events, bounded).calls.c1.consecutiveFailures, 2);
});

test('latestEventsFile choisit le fichier du jour le plus récent, hors rotation', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'nay-monitor-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const name of ['2026-11-15.jsonl', '2026-11-16.jsonl', '2026-11-16.1.jsonl', '2026-11-17.1.jsonl', 'notes.txt']) {
    await writeFile(join(dir, name), '');
  }
  assert.equal(await latestEventsFile(dir), join(dir, '2026-11-16.jsonl'));
  assert.equal(await latestEventsFile(join(dir, 'absent')), null);
});
