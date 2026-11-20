// Vérification du corrigé de la manche 1 : node verif.mjs (P4 : node verif-p4.js).
// P1 : chevaliers / fripons, recherche exhaustive.
const p1 = [];
for (let m = 0; m < 32; m++) {
  const [A, B, C, D, E] = [0, 1, 2, 3, 4].map((i) => Boolean(m >> i & 1));
  const claims = [[A, !B], [B, C === E], [C, !A || D], [D, [A, B, C, D, E].filter(Boolean).length === 1], [E, !C]];
  if (claims.every(([who, claim]) => who === claim)) p1.push('ABCDE'.split('').filter((_, i) => m >> i & 1).join(''));
}
console.log('P1', p1);

// P2 : ordonnancement exact (ouvriers illimités, puis 2 ouvriers).
const durations = { A: 3, B: 1, C: 1, D: 5, E: 5, F: 1, G: 1, H: 3 };
const deps = { A: [], B: ['A'], C: ['A'], D: ['B'], E: ['B', 'C'], F: ['D', 'E'], G: [], H: ['G', 'C'] };
const names = Object.keys(deps);
const finish = {};
const ef = (t) => finish[t] ??= durations[t] + Math.max(0, ...deps[t].map(ef));
function makespan(workers) {
  let best = Infinity;
  const memo = new Map();
  (function go(done, running, time) {
    if (time >= best) return;
    if (done.size === names.length) { best = time; return; }
    const key = `${[...done].sort().join('')}|${running.map((r) => r.t + (r.end - time)).sort()}`;
    if (memo.has(key) && memo.get(key) <= time) return;
    memo.set(key, time);
    const ready = names.filter((t) => !done.has(t) && !running.some((r) => r.t === t) && deps[t].every((d) => done.has(d)));
    const subsets = [[]];
    for (const t of ready) for (const s of [...subsets]) if (s.length < workers - running.length) subsets.push([...s, t]);
    for (const s of subsets) {
      const run = [...running, ...s.map((t) => ({ t, end: time + durations[t] }))];
      if (!run.length) continue;
      const next = Math.min(...run.map((r) => r.end));
      const nextDone = new Set(done);
      for (const r of run) if (r.end === next) nextDone.add(r.t);
      go(nextDone, run.filter((r) => r.end !== next), next);
    }
  })(new Set(), [], 0);
  return best;
}
console.log('P2', Math.max(...names.map(ef)), makespan(2));

// P3 : urne 4R 3B 2V, trois tirages sans remise de couleurs différentes.
const urn = 'RRRRBBBVV';
let ok = 0, all = 0;
for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) for (let k = 0; k < 9; k++) {
  if (i === j || j === k || i === k) continue;
  all++;
  if (new Set([urn[i], urn[j], urn[k]]).size === 3) ok++;
}
console.log('P3', `${ok}/${all}`, '= 2/7 :', ok / all === 2 / 7);

// P5 : 1..1000 divisibles par 3 ou 5, pas par 7.
let p5 = 0;
for (let x = 1; x <= 1000; x++) if ((x % 3 === 0 || x % 5 === 0) && x % 7 !== 0) p5++;
console.log('P5', p5);

// P6 : avec chooseAgent de Nay (à lancer depuis la racine du dépôt).
const { chooseAgent } = await import(new URL('../../../../src/delegation.js', import.meta.url));
const delegation = { developpeur: ['sol'], relecteur: { parDefaut: ['hydrogen', 'terra', 'sonnet', 'gemini-flash'],
  selonAuteur: { hydrogen: ['terra', 'gemini-flash'], terra: ['hydrogen', 'sonnet', 'gemini-flash'] } } };
for (const [author, off] of [['terra', ['hydrogen', 'sonnet']], ['hydrogen', ['terra']], ['sol', ['hydrogen']], ['sonnet', ['hydrogen', 'terra']]]) {
  console.log('P6', author, chooseAgent('relecteur', { author, delegation, isAvailable: (a) => !off.includes(a) }).agent);
}

// P7 : jeu à 2026 jetons, retraits 1, 2 ou 4.
const win = [false];
for (let n = 1; n <= 2026; n++) win[n] = [1, 2, 4].some((m) => m <= n && !win[n - m]);
console.log('P7', win[2026] ? 'premier' : 'second', [1, 2, 4].filter((m) => !win[2026 - m]));
