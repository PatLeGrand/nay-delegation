import test from 'node:test';
import assert from 'node:assert/strict';
import { runUpdate } from '../src/update.js';
import { runCommand } from '../src/command.js';

// Faux exécutant : répond selon la commande, enregistre les appels.
function fakeRun({ branch = 'main', dirty = '', heads = ['aaa', 'aaa'], log = '', check = { code: 0, stdout: 'Configuration de délégation valide' },
  active = 'active', restart = { code: 0 }, pull = { code: 0 }, committedAt = '1000', startedAt = '@2000' } = {}) {
  const calls = [];
  let head = 0;
  const run = async (command, args) => {
    calls.push([command, ...args].join(' '));
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    if (command === 'git') {
      const sub = args.slice(2);
      if (sub[0] === 'branch') return ok(`${branch}\n`);
      if (sub[0] === 'status') return ok(dirty);
      if (sub[0] === 'rev-parse') return ok(`${heads[Math.min(head++, heads.length - 1)]}\n`);
      if (sub[0] === 'pull') return { stdout: '', stderr: 'diverge', ...pull };
      if (sub[0] === 'log') return ok(sub.includes('--format=%ct') ? `${committedAt}\n` : log);
    }
    if (command === 'systemctl' && args[1] === 'is-active') return { code: active === 'active' ? 0 : 3, stdout: `${active}\n`, stderr: '' };
    if (command === 'systemctl' && args[1] === 'show') return ok(`${startedAt}\n`);
    if (command === 'systemctl' && args[1] === 'restart') return { stdout: '', stderr: 'échec', ...restart };
    if (args[1] === 'check-config') return { stderr: '', ...check };
    return ok();
  };
  return { run, calls };
}

const base = { root: '/nay', nodeBin: 'node' };

test('update refuse une autre branche que main, sans pull', async () => {
  const fake = fakeRun({ branch: 'feature/x' });
  const result = await runUpdate({ ...base, run: fake.run });
  assert.equal(result.code, 1);
  assert.match(result.lines[0], /feature\/x/);
  assert.ok(!fake.calls.some((call) => call.includes('pull')));
});

test('update refuse des modifications non committées', async () => {
  const fake = fakeRun({ dirty: ' M src/a.js' });
  const result = await runUpdate({ ...base, run: fake.run });
  assert.equal(result.code, 1);
  assert.match(result.lines.join('\n'), /src\/a\.js/);
  assert.ok(!fake.calls.some((call) => call.includes('pull')));
});

test('update récupère les commits, valide avec un processus neuf et redémarre le service', async () => {
  const fake = fakeRun({ heads: ['aaa', 'bbb'], log: 'bbb Nouveauté' });
  const result = await runUpdate({ ...base, run: fake.run });
  assert.equal(result.code, 0);
  assert.deepEqual(result.lines.slice(0, 2), ['Mise à jour aaa → bbb :', '  bbb Nouveauté']);
  assert.ok(fake.calls.includes('git -C /nay pull --ff-only --quiet'));
  assert.ok(fake.calls.includes('node /nay/bin/nay.js check-config'));
  assert.ok(fake.calls.includes('systemctl --user restart nay-ui'));
});

test('update déjà à jour : pas de redémarrage', async () => {
  const fake = fakeRun();
  const result = await runUpdate({ ...base, run: fake.run });
  assert.equal(result.code, 0);
  assert.equal(result.lines[0], 'Déjà à jour (aaa).');
  assert.ok(!fake.calls.some((call) => call.includes('restart')));
});

test('update déjà à jour : redémarre un service démarré avant le dernier commit (pull fait à la main)', async () => {
  for (const startedAt of ['@500', '', 'n/a']) {
    const fake = fakeRun({ startedAt });
    const result = await runUpdate({ ...base, run: fake.run });
    assert.equal(result.code, 0);
    assert.ok(fake.calls.includes('systemctl --user restart nay-ui'), startedAt);
    assert.equal(result.lines.at(-1), 'Service nay-ui redémarré (démarré avant le dernier commit).');
  }
});

test('update : service inactif ignoré, config invalide et pull impossible en échec', async () => {
  const inactive = await runUpdate({ ...base, run: fakeRun({ heads: ['aaa', 'bbb'], active: 'inactive' }).run });
  assert.equal(inactive.code, 0);
  assert.match(inactive.lines.at(-1), /non actif/);
  const invalid = fakeRun({ heads: ['aaa', 'bbb'], check: { code: 1, stdout: '', stderr: 'agent inconnu' } });
  const bad = await runUpdate({ ...base, run: invalid.run });
  assert.equal(bad.code, 1);
  assert.match(bad.lines.at(-1), /agent inconnu/);
  assert.ok(!invalid.calls.some((call) => call.includes('restart')));
  const diverged = await runUpdate({ ...base, run: fakeRun({ pull: { code: 1 } }).run });
  assert.equal(diverged.code, 1);
  assert.match(diverged.lines.at(-1), /diverge/);
});

test('nay update passe par l’updater et refuse les arguments', async () => {
  const out = [];
  const err = [];
  const streams = { output: { write: (text) => out.push(text) }, errorOutput: { write: (text) => err.push(text) } };
  assert.equal(await runCommand(['update'], { ...streams, updater: async () => ({ code: 0, lines: ['ok'] }) }), 0);
  assert.equal(out.join(''), 'ok\n');
  assert.equal(await runCommand(['update', 'x'], { ...streams, updater: () => assert.fail('appel interdit') }), 1);
});
