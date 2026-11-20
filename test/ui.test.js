import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  formatTokens, formatDuration, formatPct, computeSinceIso, cacheRatio, normalizeRole,
} from '../ui/js/format.js';
import {
  buildOrreryModel, describeArc, buildDailySpectrum, buildStoryRelays,
  simulateDelegation, estimateMockBudget,
} from '../ui/js/model.js';

test('format : jetons, durées, ratios de cache et périodes UTC', () => {
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(850), '850');
  assert.match(formatTokens(15_400), /15,4\s*k/);
  assert.match(formatTokens(2_600_000), /2,6\s*M/);

  assert.equal(formatDuration(450), '450 ms');
  assert.equal(formatDuration(12_000), '12 s');
  assert.equal(formatDuration(125_000), '2 min 5 s');
  assert.equal(formatDuration(3_660_000), '1 h 1 min');

  assert.equal(formatPct(0.554), '55 %');
  assert.equal(cacheRatio(1000, 800), 0.8);
  assert.equal(normalizeRole('dev'), 'developpeur');
  assert.equal(normalizeRole('reviewer'), 'relecteur');

  const now = Date.parse('2026-11-19T14:30:00Z');
  assert.equal(computeSinceIso('today', now), '2026-11-19T00:00:00.000Z');
  assert.equal(computeSinceIso('week', now), '2026-11-13T00:00:00.000Z');
  assert.equal(computeSinceIso('all', now), undefined);
});

test('orrery : place les agents sur les 3 orbites et détecte vols actifs et alertes', () => {
  const model = buildOrreryModel({
    quota: {
      providers: {
        codex: { status: 'ok', windows: [{ label: '5h', remainingPct: 42 }] },
        agy: { status: 'ok', windows: [{ label: '5h', remainingPct: 80 }] },
        claude: { status: 'unknown', windows: [] },
      },
      agents: [
        { name: 'sol', provider: 'codex', available: true },
        { name: 'neon', provider: 'agy', available: true },
        { name: 'sonnet', provider: 'claude', available: false, reason: 'Quota épuisé' },
      ],
    },
    usage: {
      byAgent: [{ key: 'sol', calls: 5, input: 1_000_000, cachedInput: 800_000, output: 20_000, durationMs: 60_000 }],
      reliability: [{ key: 'sol', calls: 5, failures: 1, failureRate: 0.2, medianDurationMs: 10_000 }],
    },
    status: {
      calls: [{ callId: 'c1', agent: 'neon', status: 'running', feature: 'ui' }],
      alerts: [{ callId: 'c1', agent: 'neon', kind: 'commande_longue', detail: 'long' }],
    },
    delegation: { agents: ['sol', 'neon', 'sonnet'] },
  });

  assert.equal(model.orbits.length, 3);
  assert.equal(model.orbits[0].remainingPct, 42);
  assert.equal(model.nodes.length, 3);
  assert.equal(model.activeCount, 1);
  assert.equal(model.alertCount, 1);

  const neon = model.nodes.find((n) => n.name === 'neon');
  assert.equal(neon.isRunning, true);
  assert.equal(neon.hasAlert, true);

  const sonnet = model.nodes.find((n) => n.name === 'sonnet');
  assert.equal(sonnet.available, false);
  assert.equal(sonnet.unavailableReason, 'Quota épuisé');

  assert.equal(describeArc(270, 270, 100, 0), '');
  assert.match(describeArc(270, 270, 100, 50), /^M 270 170 A 100 100 0 0 1/);
  assert.match(describeArc(270, 270, 100, 100), /^M 270 170 A 100 100 0 1 1/);
});

test('spectre 14 jours : complète les jours UTC manquants', () => {
  const now = Date.parse('2026-11-19T10:00:00Z');
  const series = buildDailySpectrum([
    { day: '2026-11-18', calls: 3, input: 1000, cachedInput: 600, output: 100 },
  ], now, 5);
  assert.equal(series.length, 5);
  assert.equal(series[0].day, '2026-11-15');
  assert.equal(series[4].day, '2026-11-19');
  assert.equal(series[3].freshInput, 400);
  assert.equal(series[3].cachedInput, 600);
  assert.equal(series[0].total, 0);
});

test('relais : priorise les fiches en attente de décision et relie les appels', () => {
  const relays = buildStoryRelays({
    features: [
      { name: 'done', title: 'Done', state: 'fusionnee', waitingForUser: false, verdicts: ['APPROUVÉ'] },
      { name: 'wait', title: 'Wait', state: 'attend_decision', waitingForUser: true, verdicts: ['APPROUVÉ'] },
    ],
    usage: {
      recent: [
        { callId: 'a1', agent: 'sol', feature: 'wait', role: 'dev', status: 'ok', timestamp: '2026-11-19T01:00:00Z', usage: { input: 500, output: 50 } },
        { callId: 'a2', agent: 'hydrogen', feature: 'wait', role: 'relecteur', status: 'ok', timestamp: '2026-11-19T02:00:00Z', usage: { input: 300, output: 40 } },
      ],
    },
    status: { calls: [] },
  });
  assert.equal(relays[0].name, 'wait');
  assert.equal(relays[0].calls.length, 2);
  assert.equal(relays[0].calls[0].agent, 'sol');
  assert.equal(relays[0].calls[1].agent, 'hydrogen');
  assert.equal(relays[1].name, 'done');
});

test('simulateur d’aiguillage : exclut auteur, indisponibles simulés et quotas sous seuil', () => {
  const delegation = {
    developpeur: ['sol', 'sonnet'],
    relecteur: {
      parDefaut: ['hydrogen', 'terra', 'sonnet'],
      selonAuteur: { hydrogen: ['terra', 'gemini-flash'] },
    },
  };
  const r1 = simulateDelegation(delegation, {
    role: 'relecteur',
    author: 'hydrogen',
    unavailable: ['terra'],
    quotaAgents: [],
  });
  assert.equal(r1.chosen, 'gemini-flash');
  assert.equal(r1.steps[0].status, 'skipped');

  const r2 = simulateDelegation(delegation, {
    role: 'developpeur',
    unavailable: [],
    quotaAgents: [{ name: 'sol', available: false, reason: 'Quota 5h < 25%' }],
  });
  assert.equal(r2.chosen, 'sonnet');
});

test('budget maquette : calcule coût estimé et économie liée au cache', () => {
  const budget = estimateMockBudget({
    byAgent: [{ key: 'sol', calls: 2, input: 1_000_000, cachedInput: 900_000, output: 100_000 }],
  });
  assert.equal(budget.rows.length, 1);
  assert.ok(budget.totalUsd > 0);
  assert.ok(budget.savedUsd > 2);
});

test('sécurité UI : aucun usage de innerHTML dans ui/', async () => {
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...(await walk(full)));
      else if (entry.name.endsWith('.js') || entry.name.endsWith('.html')) files.push(full);
    }
    return files;
  }
  const files = await walk(new URL('../ui', import.meta.url).pathname);
  assert.ok(files.length >= 8);
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    assert.ok(!/\.innerHTML\b/.test(content), `innerHTML interdit trouvé dans ${file}`);
  }
});

test('Hangar : nom suggéré, effort par défaut, tri des nouveaux modèles', async () => {
  const { suggestAgentName, defaultEffort, sortedModels, countNew, agentChanged } = await import('../ui/js/hangar-model.js');
  assert.equal(suggestAgentName('gpt-6.2-sol', ['terra']), 'sol');
  assert.equal(suggestAgentName('gpt-6.2-sol', ['sol']), 'sol-6.2');
  assert.equal(suggestAgentName('gpt-6.2-sol', ['sol', 'sol-6.2']), 'sol-6.2-2');
  assert.equal(suggestAgentName('gemini-4-neon-{effort}', ['neon']), 'neon-4');
  assert.equal(suggestAgentName('claude-opus-5-5', ['opus']), 'opus-5-5');
  assert.equal(suggestAgentName('claude-fable-5-2', []), 'fable');
  assert.equal(suggestAgentName('gpt-oss-120b-{effort}', []), 'oss');
  assert.equal(defaultEffort({ efforts: ['low', 'medium'], defaultEffort: 'low' }), 'medium');
  assert.equal(defaultEffort({ efforts: ['low', 'high'], defaultEffort: 'high' }), 'high');
  assert.equal(defaultEffort({ efforts: [] }), 'medium');
  const provider = { models: [{ model: 'a', usedBy: ['x'] }, { model: 'b', usedBy: [] }] };
  assert.deepEqual(sortedModels(provider).map((m) => m.model), ['b', 'a']);
  assert.deepEqual(sortedModels(provider, { onlyNew: true }).map((m) => m.model), ['b']);
  assert.equal(countNew({ providers: { codex: provider, agy: provider } }), 2);
  assert.equal(agentChanged({ effort: 'low', timeoutMin: 5 }, { effort: 'low' }), false);
  assert.equal(agentChanged({ effort: 'low', timeoutMin: 5 }, { timeoutMin: 6 }), true);
});
