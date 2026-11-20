import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../src/command.js';
import { candidatesFor } from '../src/delegation.js';
import { loadDiagnoseConfig } from '../src/diagnose.js';

const T0 = Date.parse('2026-11-19T10:00:00Z');
const at = (sec) => new Date(T0 + sec * 1000).toISOString();
const NOW = T0 + 3600 * 1000;
const story = (kind, sec, extra = {}) => ({ v: 1, ts: at(sec), kind, storyId: 's1', feature: 'f', ...extra });
const call = (callId, agent, role, kind, sec, extra = {}) => ({ v: 1, ts: at(sec), callId, agent, role,
  feature: 'f', storyId: 's1', kind, ...extra });

async function journal(t, events, day = '2026-11-19') {
  const dir = await mkdtemp(join(tmpdir(), 'nay-diagnose-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, `${day}.jsonl`), `${events.map((event) => JSON.stringify(event)).join('\n')}\nligne illisible\n`);
  return dir;
}

async function diagnoseRun(args, directory, options = {}) {
  let out = '';
  let err = '';
  const code = await runCommand(['diagnose', ...args], {
    output: { write: (text) => { out += text; } }, errorOutput: { write: (text) => { err += text; } },
    now: () => NOW, execute: options.execute ?? (async () => { throw new Error('aucun agent en test'); }),
    diagnoseOptions: { directory, availability: async () => () => true, ...options.diagnoseOptions } });
  return { code, out, err };
}

// Dev sauté pour quota, second dev, relecteur CHANGES jusqu'au dernier tour.
const DEFECTS = [
  story('story_start', 0, { cwd: '/projet' }),
  call('d1', 'sol', 'dev', 'call_start', 1, { mode: 'write', resumedFrom: null }),
  call('d1', 'sol', 'dev', 'call_end', 3, { status: 'error', cause: 'quota', durationMs: 2000,
    error: 'You have hit your usage limit token=abcd1234secret' }),
  call('d2', 'sonnet', 'dev', 'call_start', 4, { mode: 'write', resumedFrom: null }),
  call('d2', 'sonnet', 'dev', 'tool_start', 5, { tool: { id: 't1', kind: 'command', target: 'npm test' } }),
  call('d2', 'sonnet', 'dev', 'tool_end', 6, { tool: { id: 't1', kind: 'command' }, ok: false }),
  call('d2', 'sonnet', 'dev', 'call_end', 60, { status: 'ok', durationMs: 56000 }),
  call('r1', 'hydrogen', 'relecteur', 'call_start', 61, { mode: 'read', resumedFrom: null }),
  call('r1', 'hydrogen', 'relecteur', 'call_end', 70, { status: 'ok', durationMs: 9000 }),
  story('story_end', 71, { status: 'DÉFAUTS', code: 1, question: false, detail: 'Défauts restants après 1 tours de revue',
    dev: 'sonnet', reviews: [{ agent: 'hydrogen', round: 1, verdict: 'CHANGES' }], commits: ['abc1234 Ajout'],
    checks: 'tests ok', checksBy: 'nay' }),
];

test('Story en défauts : chronologie, agent sauté pour quota, erreur masquée', async (t) => {
  const { code, out } = await diagnoseRun(['s1'], await journal(t, DEFECTS));
  assert.equal(code, 0);
  assert.match(out, /^Story s1 · feature f · état failed \(defects\)/);
  assert.match(out, /10:00:01 appel d1 · sol · dev · write · 2 s · error \(quota\)/);
  assert.match(out, /appel d2 · sonnet · dev · write · 56 s · ok · outils 1 · échecs d'outils 1/);
  assert.match(out, /revues : hydrogen CHANGES \(tour 1\)/);
  assert.match(out, /contrôles : tests ok \(nay\) · commits : abc1234 Ajout/);
  assert.match(out, /- Arrêt : DÉFAUTS \(defects\) — Défauts restants/);
  assert.match(out, /- Sauté : sol \(dev, quota\) — You have hit your usage limit token=\[masqué\]/);
  assert.doesNotMatch(out, /abcd1234secret/);
});

test('Story arrêtée sur une question du dev : la question est citée', async (t) => {
  const events = [story('story_start', 0),
    call('d1', 'sol', 'dev', 'call_start', 1, { mode: 'write' }),
    call('d1', 'sol', 'dev', 'message', 5, { text: 'Fait en partie.\nOn garde l’ancien nom ?' }),
    call('d1', 'sol', 'dev', 'call_end', 6, { status: 'ok', question: true }),
    story('story_end', 7, { status: 'BLOQUÉ', code: 1, question: true, detail: 'Le dev pose une question', dev: 'sol' })];
  const { out } = await diagnoseRun(['s1'], await journal(t, events));
  assert.match(out, /état needs_input/);
  assert.match(out, /- Arrêt : le dev pose une question : « Fait en partie\. On garde l’ancien nom \? »/);
});

test('Story sans story_end : signalée interrompue ou en cours', async (t) => {
  const { out } = await diagnoseRun(['s1'], await journal(t, DEFECTS.slice(0, 5)));
  assert.match(out, /pas de story_end/);
  assert.match(out, /- Pas de story_end : story stalled, dernier événement il y a 59 min/);
});

test('Appel avec reprise automatique : la reprise est suivie jusqu’à son échec', async (t) => {
  const events = [
    call('a', 'luna', 'explorateur', 'call_start', 0, { mode: 'read', storyId: undefined }),
    call('a', 'luna', 'explorateur', 'call_end', 5, { status: 'error', cause: 'shell_blocked', retrying: true,
      error: 'Shell bloqué en mode plan' }),
    call('b', 'luna', 'explorateur', 'call_start', 6, { mode: 'read', resumedFrom: 'a' }),
    call('b', 'luna', 'explorateur', 'call_end', 600, { status: 'timeout', error: 'Délai dépassé' })];
  const { code, out } = await diagnoseRun(['a'], await journal(t, events));
  assert.equal(code, 0);
  assert.match(out, /^Appel a · feature f · état failed \(timeout\)/);
  assert.match(out, /appel a · luna · explorateur · read · 5 s · error \(shell_blocked\), reprise automatique/);
  assert.match(out, /appel b · .* · timeout \(timeout\) · outils 0 · reprise de a/);
  assert.match(out, /- Échec \(timeout\) : Délai dépassé\./);
  assert.match(out, /- Suivi à travers la reprise b\./);
});

test('Appel repris à la main : l’état reste celui de l’appel, la reprise est signalée', async (t) => {
  const events = [
    call('a', 'neon', 'dev', 'call_start', 0, { mode: 'write' }),
    call('a', 'neon', 'dev', 'call_end', 5, { status: 'error', cause: 'crash', error: 'CLI terminé avec le code 3' }),
    call('b', 'neon', 'dev', 'call_start', 60, { mode: 'write', resumedFrom: 'a' }),
    call('b', 'neon', 'dev', 'call_end', 90, { status: 'ok' })];
  const { out } = await diagnoseRun(['a'], await journal(t, events));
  assert.match(out, /- Échec \(crash\) : CLI terminé avec le code 3\./);
  assert.match(out, /- Repris ensuite par b : ok\./);
});

test('Identifiant inconnu, ou plus ancien que la fenêtre du journal : code 1', async (t) => {
  const recent = await diagnoseRun(['zzz'], await journal(t, DEFECTS));
  assert.equal(recent.code, 1);
  assert.match(recent.err, /Inconnu dans le journal des \d+ derniers jours : zzz/);
  const old = await diagnoseRun(['s1'], await journal(t, DEFECTS, '2026-09-01'));
  assert.equal(old.code, 1);
  assert.equal((await diagnoseRun([], await journal(t, DEFECTS))).code, 1);
});

test('--explain : chronologie seule envoyée à un explorateur en lecture, repli si échec', async (t) => {
  const [first, second] = candidatesFor('explorateur');
  const calls = [];
  const execute = async (agent, prompt, options) => {
    calls.push({ agent, prompt, options });
    return agent === first ? { status: 'error', error: 'quota' } : { status: 'ok', text: 'Quota épuisé. Relancer demain.' };
  };
  const config = { ...loadDiagnoseConfig(), maxExplainChars: 300 };
  const { code, out } = await diagnoseRun(['s1', '--explain'], await journal(t, DEFECTS),
    { execute, diagnoseOptions: { config } });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((entry) => entry.agent), [first, second]);
  assert.deepEqual(calls[1].options, { mode: 'read', feature: config.explainFeature, role: 'explorateur' });
  const { prompt } = calls[1];
  assert.match(prompt, /\[… début tronqué\]/);
  assert.match(prompt, /Sauté : sol \(dev, quota\)/);
  assert.doesNotMatch(prompt, /abcd1234secret|\/projet/);
  assert.match(out, new RegExp(`Diagnostic :[\\s\\S]*\\nExplication \\(${second}\\) :\\nQuota épuisé\\. Relancer demain\\.\\n$`));
});
