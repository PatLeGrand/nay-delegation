import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyJobEvent, emptyJobs, endsWithQuestion, failureCause, featureJobs, jobStatus, loadLifecycleConfig,
} from '../src/lifecycle.js';
import { createEventTail, waitCommand, WAIT_EXIT } from '../src/wait.js';
import { runStory } from '../src/story.js';

const T0 = Date.parse('2026-11-19T10:00:00Z');
const at = (sec) => new Date(T0 + sec * 1000).toISOString();
const config = { silenceSec: 60, quotaPattern: loadLifecycleConfig().quotaPattern };
const build = (events) => events.reduce(applyJobEvent, emptyJobs());
const state = (jobs, id, sec) => jobStatus(jobs, id, T0 + sec * 1000, config);
const call = (callId, kind, sec, extra = {}) => ({ v: 1, ts: at(sec), callId, agent: 'sol', feature: 'f', kind, ...extra });

test('Question finale : dernière ligne utile en « ? », jamais avec une demande de commit', () => {
  assert.equal(endsWithQuestion('Fait.\nTu veux que je garde l’ancien nom ?\n\nNAY-CHECKS: ok'), true);
  assert.equal(endsWithQuestion('**On part sur Postgres ?**'), true);
  assert.equal(endsWithQuestion('Pourquoi ? Parce que.\nFait.'), false);
  assert.equal(endsWithQuestion('Une question ?\nNAY-COMMIT: msg\nNAY-FILES: a'), false);
  assert.equal(endsWithQuestion(''), false);
});

test('Causes d’échec : timeout, shell bloqué, réponse vide, quota, crash', () => {
  const quota = config.quotaPattern;
  assert.equal(failureCause({ status: 'timeout', error: 'Réponse vide' }, quota), 'timeout');
  assert.equal(failureCause({ status: 'error', shellBlocked: true }, quota), 'shell_blocked');
  assert.equal(failureCause({ status: 'error', error: 'Réponse vide de l’agent' }, quota), 'empty');
  for (const error of ['You have hit your usage limit', 'HTTP 429', 'RESOURCE_EXHAUSTED', 'rate_limit_error']) {
    assert.equal(failureCause({ status: 'error', error }, quota), 'quota', error);
  }
  assert.equal(failureCause({ status: 'error', error: 'CLI terminé avec le code 3' }, quota), 'crash');
});

test('Appel : accepted → working → stalled → done, needs_input et failed', () => {
  const start = call('a', 'call_start', 0, { mode: 'write', resumedFrom: null });
  assert.equal(state(build([start]), 'a', 1).state, 'accepted');
  const working = build([start, call('a', 'message', 5, { text: 'je regarde' })]);
  assert.equal(state(working, 'a', 10).state, 'working');
  assert.equal(state(working, 'a', 70).state, 'stalled');
  assert.equal(state(build([start, call('a', 'call_end', 9, { status: 'ok' })]), 'a', 9).state, 'done');
  assert.equal(state(build([start, call('a', 'call_end', 9, { status: 'ok', question: true })]), 'a', 9).state, 'needs_input');
  const failed = state(build([start, call('a', 'call_end', 9, { status: 'error', cause: 'quota' })]), 'a', 9);
  assert.deepEqual([failed.state, failed.cause], ['failed', 'quota']);
  // Ancien événement sans cause : déduite du message d'erreur.
  assert.equal(state(build([start, call('a', 'call_end', 9, { status: 'error', error: 'Réponse vide' })]), 'a', 9).cause, 'empty');
  assert.equal(state(build([start]), 'inconnu', 1), null);
});

test('Reprise automatique : l’appel suit sa reprise, working tant qu’elle n’a pas commencé', () => {
  const first = [call('a', 'call_start', 0), call('a', 'call_end', 5, { status: 'error', cause: 'shell_blocked', retrying: true })];
  assert.equal(state(build(first), 'a', 6).state, 'working');
  const retried = build([...first, call('b', 'call_start', 6, { resumedFrom: 'a' }), call('b', 'call_end', 9, { status: 'ok' })]);
  assert.deepEqual([state(retried, 'a', 9).state, state(retried, 'a', 9).via], ['done', 'b']);
  assert.deepEqual(featureJobs(retried, 'f'), ['a']);
});

test('Story : état tiré de ses appels puis de story_end', () => {
  const story = (kind, sec, extra = {}) => ({ v: 1, ts: at(sec), kind, storyId: 's1', feature: 'f', ...extra });
  const base = [story('story_start', 0), call('d', 'call_start', 1, { storyId: 's1' })];
  assert.equal(state(build(base), 's1', 2).state, 'accepted');
  const working = [...base, call('d', 'tool_start', 3, { storyId: 's1', tool: { kind: 'read' } })];
  assert.equal(state(build(working), 's1', 50).state, 'working');
  assert.equal(state(build(working), 's1', 64).state, 'stalled');
  const ok = build([...working, story('story_end', 90, { status: 'OK', code: 0, dev: 'sol', reviews: [{ agent: 'terra', verdict: 'PASS' }] })]);
  assert.equal(state(ok, 's1', 90).state, 'done');
  const defects = state(build([...working, story('story_end', 90, { status: 'DÉFAUTS', code: 1 })]), 's1', 90);
  assert.deepEqual([defects.state, defects.cause], ['failed', 'defects']);
  assert.equal(state(build([...working, story('story_end', 90, { status: 'BLOQUÉ', code: 1, question: true })]), 's1', 90).state, 'needs_input');
  assert.deepEqual(featureJobs(ok, 'f'), ['s1']);
});

test('runStory écrit story_start / story_end et transmet le storyId à ses appels', async () => {
  const events = [];
  const seen = [];
  const execute = async (agent, prompt, options) => {
    seen.push(options.storyId);
    return { agent, status: 'ok', callId: 'c', sessionId: null, text: 'Quel nom de table ?' };
  };
  const git = { isRepo: async () => true, snapshot: async () => 'x', status: async () => '' };
  const report = await runStory('brief', { storyId: 'abc', journal: (event) => events.push(event), execute, git,
    feature: 'f', delegation: { developpeur: ['sol'], relecteur: { parDefaut: ['terra'] } } });
  assert.deepEqual(events.map((event) => event.kind), ['story_start', 'story_end']);
  assert.deepEqual(seen, ['abc']);
  assert.equal(report.storyId, 'abc');
  assert.deepEqual([events[1].status, events[1].question, events[1].feature], ['BLOQUÉ', true, 'f']);
  assert.match(report.detail, /question/);
});

async function journal(t) {
  const dir = await mkdtemp(join(tmpdir(), 'nay-wait-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(dir, { recursive: true });
  const write = (name, events) => appendFile(join(dir, name), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
  return { dir, write };
}

test('Lecture incrémentale : lignes partielles, rotation et veille', async (t) => {
  const { dir, write } = await journal(t);
  await write('2026-11-18.jsonl', [call('veille', 'call_start', -3600)]);
  await writeFile(join(dir, '2026-11-19.jsonl'), `${JSON.stringify(call('a', 'call_start', 0))}\n{"v":1,"ts":"${at(1)}","callId":"a","ki`);
  const tail = createEventTail(dir, { since: '2026-11-18' });
  let jobs = await tail.poll();
  assert.ok(jobs.calls.veille);
  assert.equal(jobs.calls.a.active, false);
  await appendFile(join(dir, '2026-11-19.jsonl'), 'nd":"message","text":"x"}\n');
  await rename(join(dir, '2026-11-19.jsonl'), join(dir, '2026-11-19.1795-000001-abcd.jsonl'));
  await write('2026-11-19.jsonl', [call('a', 'call_end', 5, { status: 'ok' })]);
  jobs = await tail.poll();
  assert.equal(jobs.calls.a.active, true);
  assert.equal(jobs.calls.a.end.status, 'ok');
  const fresh = await createEventTail(dir, { since: '2026-11-19' }).poll();
  assert.deepEqual(Object.keys(fresh.calls), ['a']);
  assert.equal(fresh.calls.a.end.status, 'ok');
});

function waitHarness(dir, { onPause = async () => {} } = {}) {
  let clock = T0;
  const out = { stdout: '', stderr: '' };
  const options = {
    output: { write: (text) => { out.stdout += text; } }, errorOutput: { write: (text) => { out.stderr += text; } },
    now: () => clock, directory: dir, monitorConfig: { silenceSec: 60 },
    lifecycleConfig: { ...loadLifecycleConfig(), pollMs: 1000, appearGraceSec: 30, defaultTimeoutMin: 5 },
    pause: async (ms) => { clock += ms; await onPause(clock); },
  };
  return { out, options };
}

test('nay wait : attend la fin, --all, --until, identifiant inconnu et délai dépassé', async (t) => {
  const { dir, write } = await journal(t);
  await write('2026-11-19.jsonl', [call('a', 'call_start', 0), call('b', 'call_start', 0)]);
  let step = 0;
  const { out, options } = waitHarness(dir, { onPause: async () => {
    step += 1;
    if (step === 3) await write('2026-11-19.jsonl', [call('a', 'call_end', 3, { status: 'error', cause: 'quota' })]);
  } });
  assert.equal(await waitCommand(['a', 'b'], options), WAIT_EXIT.reached);
  assert.match(out.stdout, /^appel a · failed \(quota\) · sol · feature f · 3 s\nappel b · /);
  assert.equal(step, 3);

  const all = waitHarness(dir);
  assert.equal(await waitCommand(['a', 'b', '--all', '--timeout', '0.1'], all.options), WAIT_EXIT.timeout);
  assert.match(all.out.stderr, /Délai dépassé/);

  const working = waitHarness(dir);
  assert.equal(await waitCommand(['b', '--until', 'accepted'], working.options), WAIT_EXIT.reached);

  const unknown = waitHarness(dir);
  assert.equal(await waitCommand(['zzz'], unknown.options), WAIT_EXIT.error);
  assert.match(unknown.out.stderr, /Inconnu dans le journal : zzz/);
  assert.match(unknown.out.stdout, /^$/);

  for (const args of [[], ['a', '--feature', 'f'], ['a', '--until', 'fini'], ['a', '--timeout', '0']]) {
    assert.equal(await waitCommand(args, waitHarness(dir).options), WAIT_EXIT.error, args.join(' '));
  }
});

test('nay wait --feature : ignore les travaux déjà finis et attend celui qui commence ensuite', async (t) => {
  const { dir, write } = await journal(t);
  await write('2026-11-19.jsonl', [call('ancien', 'call_start', 0), call('ancien', 'call_end', 1, { status: 'ok' })]);
  let step = 0;
  const story = (kind, sec, extra = {}) => ({ v: 1, ts: at(sec), kind, storyId: 'neuve', feature: 'f', ...extra });
  const { out, options } = waitHarness(dir, { onPause: async () => {
    step += 1;
    if (step === 2) await write('2026-11-19.jsonl', [story('story_start', 2)]);
    if (step === 4) await write('2026-11-19.jsonl', [story('story_end', 4, { status: 'OK', code: 0, dev: 'sol', reviews: [{ agent: 'terra', verdict: 'PASS' }] })]);
  } });
  assert.equal(await waitCommand(['--feature', 'f'], options), WAIT_EXIT.reached);
  assert.equal(out.stdout, 'story neuve · done · feature f · dev sol · revue terra PASS · 2 s\n');

  const empty = waitHarness(dir);
  assert.equal(await waitCommand(['--feature', 'autre'], empty.options), WAIT_EXIT.error);
  assert.match(empty.out.stderr, /Aucun travail/);
});
