// H1 : grille logique — 4 personnes, langage, couleur, ordre de passage (1..4).
const perms = (a) => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
const P = ['Ana', 'Bao', 'Cyd', 'Dov'];
const sols = [];
for (const lang of perms(['Go', 'Rust', 'Python', 'Java']))
  for (const col of perms(['rouge', 'vert', 'bleu', 'jaune']))
    for (const pos of perms([1, 2, 3, 4])) {
      const p = (name) => P.indexOf(name);
      const by = (arr, v) => arr.indexOf(v);
      const c = [
        pos[by(lang, 'Rust')] === pos[by(col, 'vert')] + 1,          // Rust passe juste après le vert
        lang[p('Ana')] !== 'Python' && col[p('Ana')] !== 'bleu',
        pos[p('Bao')] < pos[p('Dov')],                                 // Bao avant Dov
        col[by(pos, 1)] !== 'jaune',                                   // le premier n'est pas jaune
        lang[by(col, 'bleu')] === 'Java',                              // le bleu fait du Java
        Math.abs(pos[p('Cyd')] - pos[by(lang, 'Go')]) === 2,           // Cyd et le Go à 2 rangs
        pos[by(lang, 'Python')] === 4 || pos[by(lang, 'Python')] === 1,
        col[p('Dov')] !== 'rouge',
        pos[p('Ana')] === 2,
        !(lang[by(col, 'vert')] === 'Go'),                             // le Go n'est pas vert
        pos[p('Bao')] !== 1,
        col[p('Ana')] !== 'jaune',
      ];
      if (c.every(Boolean)) sols.push(P.map((n, i) => `${n}:${lang[i]}/${col[i]}/${pos[i]}`).join(' '));
    }
console.log('H1', sols.length, sols);

// H2 : mots de longueur 12 sur {a,b} sans trois lettres identiques consécutives, avec exactement 5 'a'.
const memo = new Map();
const words = (n, a, last, run) => {
  if (a < 0) return 0;
  if (n === 0) return a === 0 ? 1 : 0;
  const k = `${n},${a},${last},${run}`; if (memo.has(k)) return memo.get(k);
  let t = 0;
  for (const ch of ['a', 'b']) {
    const r = ch === last ? run + 1 : 1; if (r > 2) continue;
    t += words(n - 1, ch === 'a' ? a - 1 : a, ch, r);
  }
  memo.set(k, t); return t;
};
console.log('H2', words(12, 5, '', 0));

// H3 : dé équilibré, on lance jusqu'à ce que la somme atteigne au moins 10 ; espérance du nombre de lancers.
const gcd = (a, b) => b ? gcd(b, a % b) : a;
const bgcd = (a, b) => b ? bgcd(b, a % b) : a;
// E[s] en fractions exactes (BigInt).
const E = {};
for (let s = 9; s >= 0; s--) {
  let num = 6n, den = 6n; // E = 1 + (1/6) Σ E[s+k] pour s+k<10
  let acc = [0n, 1n];
  for (let k = 1; k <= 6; k++) if (s + k < 10) { const [n2, d2] = E[s + k]; acc = [acc[0] * d2 + n2 * acc[1], acc[1] * d2]; }
  // E = 1 + acc/6
  let n3 = acc[1] * 6n + acc[0], d3 = acc[1] * 6n; const g = bgcd(n3, d3);
  E[s] = [n3 / g, d3 / g];
}
console.log('H3', `${E[0][0]}/${E[0][1]}`, Number(E[0][0]) / Number(E[0][1]));

// H7 : plus petit n tel que n! se termine par au moins 500 zéros ; 3^2026 mod 1000.
const z = (n) => { let c = 0; for (let p = 5; p <= n; p *= 5) c += Math.floor(n / p); return c; };
let n = 1; while (z(n) < 500) n++;
let m = 1n; for (let i = 0; i < 2026; i++) m = m * 3n % 1000n;
console.log('H7', n, z(n), m);

// H8 : piles (3, 5, 7), on retire 1 à 3 jetons d'une seule pile ; le dernier jeton gagne.
const key = (s) => s.join(',');
const win = new Map();
const isWin = (s) => {
  const k = key(s); if (win.has(k)) return win.get(k);
  let w = false;
  for (let i = 0; i < 3 && !w; i++) for (let r = 1; r <= 3 && r <= s[i]; r++) { const t = [...s]; t[i] -= r; if (!isWin(t)) { w = true; break; } }
  win.set(k, w); return w;
};
const start = [3, 5, 7]; const moves = [];
for (let i = 0; i < 3; i++) for (let r = 1; r <= 3 && r <= start[i]; r++) { const t = [...start]; t[i] -= r; if (!isWin(t)) moves.push(`pile ${start[i]} -${r}`); }
console.log('H8', isWin(start), moves);
