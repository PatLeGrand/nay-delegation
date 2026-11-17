import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodex } from '../src/quota/codex.js';
import { parseAgyUsage } from '../src/quota/agy.js';
import { isAgentAvailable, readQuotas } from '../src/quota/index.js';

const now = Date.parse('2026-11-17T09:00:00Z');
const usage = `Gemini Models\tWeekly Limit Remaining\t99%\t2026-11-22T15:38:34Z
Gemini Models\tFive Hour Limit Remaining\t99%\t2026-11-17T10:03:11Z
Claude and GPT models\tWeekly Limit Remaining\t50%\t2026-11-18T14:29:28Z
Gemini 4 Argon\tGemini 4 Argon Weekly Limit\t0%\t2026-11-22T15:54:08Z`;

test('Codex lit le dernier relevé, les fenêtres réinitialisées et son ancienneté', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nay-quota-'));
  try {
    const config = { codexSessionsDir: dir, codexMaxSessionFiles: 20, codexStaleAfterMin: 30, codexReadBlockBytes: 32, codexMaxReadBytes: 10000 };
    assert.equal((await readCodex(config, now)).status, 'unknown');
    await mkdir(join(dir, 'nested'));
    const entry = { timestamp: '2026-11-17T08:00:00Z', payload: { rate_limits: {
      primary: { used_percent: 4, window_minutes: 300, resets_at: now / 1000 - 1 },
      secondary: { used_percent: 6, window_minutes: 10080, resets_at: now / 1000 + 1000 }, credits: {} } } };
    await writeFile(join(dir, 'nested', 'session.jsonl'), `${JSON.stringify(entry)}\n{invalide\n`);
    const result = await readCodex(config, now);
    assert.equal(result.status, 'ok');
    assert.equal(result.stale, true);
    assert.deepEqual(result.windows.map(({ label, remainingPct }) => [label, remainingPct]), [['5h', 100], ['7j', 94]]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('agy analyse les quotas Gemini et refuse une sortie inconnue', () => {
  const result = parseAgyUsage(usage, now);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.windows.map(({ label, remainingPct, scope }) => [label, remainingPct, scope]),
    [['7j', 99, undefined], ['5h', 99, undefined], ['7j', 0, 'argon']]);
  for (const text of ['', 'sortie inattendue', 'Gemini Models\tWeekly\t?\t?']) assert.equal(parseAgyUsage(text, now).status, 'unknown');
});

test('Les seuils et les fenêtres propres déterminent la disponibilité', () => {
  const config = { agents: { sol: { cli: 'codex' }, luna: { cli: 'codex' }, argon: { cli: 'agy' } },
    thresholds: { default: { minRemainingPct: 5 }, sol: { window: '5h', minRemainingPct: 25 }, luna: { minRemainingPct: 0 } } };
  const window = (label, pct) => ({ label, remainingPct: pct, resetsAt: '2099-01-01T00:00:00Z' });
  const quotas = { codex: { status: 'ok', windows: [window('5h', 20), window('7j', 80)] }, agy: parseAgyUsage(usage, now) };
  assert.equal(isAgentAvailable('sol', quotas, config).available, false);
  quotas.codex.windows = [window('5h', 80), window('7j', 0)];
  assert.equal(isAgentAvailable('sol', quotas, config).available, false);
  quotas.codex.windows = [window('5h', 80), window('7j', 20)];
  assert.equal(isAgentAvailable('sol', quotas, config).available, true);
  quotas.codex.windows = [window('5h', 1)];
  assert.equal(isAgentAvailable('luna', quotas, config).available, true);
  quotas.agy.windows.find((w) => w.scope).resetsAt = '2099-01-01T00:00:00Z';
  assert.equal(isAgentAvailable('argon', quotas, config).available, false);
  quotas.codex = { status: 'unknown', reason: 'absent' };
  assert.deepEqual(isAgentAvailable('sol', quotas, config), { available: true, reason: 'absent' });
});


test('La commande quota affiche les fournisseurs et les agents indisponibles', async () => {
  const { runCommand } = await import('../src/command.js');
  let text = '';
  const quotasReader = async () => ({ codex: { status: 'ok', windows: [
    { label: '5h', remainingPct: 20, resetsAt: '2099-01-01T00:00:00Z' }] },
    agy: { status: 'unknown', reason: 'absent' }, claude: { status: 'unknown', reason: 'absent' } });
  const code = await runCommand(['quota'], { output: { write: (s) => { text += s; } }, quotasReader });
  assert.equal(code, 0);
  assert.match(text, /codex : 5h 20 %/);
  assert.match(text, /agy : inconnu \(absent\)/);
  assert.match(text, /Agents indisponibles : sol/);
});


test('Codex ignore les entrées invalides et les fichiers inaccessibles', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nay-quota-'));
  try {
    const config = { codexSessionsDir: dir, codexMaxSessionFiles: 20, codexStaleAfterMin: 30, codexReadBlockBytes: 17, codexMaxReadBytes: 10000 };
    const good = { timestamp: '2026-11-17T08:50:00Z', rate_limits: { primary: { used_percent: 10, window_minutes: 300, resets_at: now / 1000 + 1000 } } };
    const bad = [{ rate_limits: good.rate_limits }, { timestamp: '2026-11-17T08:59:00Z', rate_limits: null },
      { timestamp: '2026-11-17T08:59:00Z', rate_limits: { primary: {} } }];
    await writeFile(join(dir, 'session.jsonl'), [good, ...bad].map(JSON.stringify).join('\n'));
    const inaccessible = join(dir, 'inaccessible.jsonl');
    await writeFile(inaccessible, '{}');
    const { open } = await import('node:fs/promises');
    let attempted = false;
    const result = await readCodex(config, now, (path, flags) => {
      if (path === inaccessible) { attempted = true; throw Object.assign(new Error('accès refusé'), { code: 'EACCES' }); }
      return open(path, flags);
    });
    assert.equal(attempted, true);
    assert.equal(result.status, 'ok');
    assert.equal(result.measuredAt, good.timestamp.replace('Z', '.000Z'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('agy ignore les lignes et fenêtres inconnues', () => {
  assert.equal(parseAgyUsage(`En-tête\nGemini Models\tNouvelle fenêtre\t?\t?\n${usage}`, now).windows.length, 3);
});

test('Une configuration illisible renvoie des quotas inconnus', async () => {
  const quotas = await readQuotas({ loadConfig: () => { throw new Error('accès refusé'); } });
  assert.match(quotas.codex.reason, /accès refusé/);
  assert.equal(quotas.agy.status, 'unknown');
});

test('Le cache réévalue l’ancienneté à chaque lecture', async () => {
  let time = now;
  let calls = 0;
  const options = { loadConfig: () => ({ cacheTtlSec: 3600, codexStaleAfterMin: 30 }), clock: () => time,
    engineLoader: () => ({}), codexReader: async () => { calls++; return { status: 'ok', windows: [], measuredAt: new Date(now).toISOString(), stale: false }; },
    agyReader: async () => ({ status: 'unknown' }), claudeReader: async () => ({ status: 'unknown' }) };
  assert.equal((await readQuotas(options)).codex.stale, false);
  time += 31 * 60000;
  assert.equal((await readQuotas(options)).codex.stale, true);
  assert.equal(calls, 1);
});
