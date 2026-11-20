const fns = [];
for (var i = 0; i < 3; i++) fns.push(() => i);
let total = fns.reduce((acc, f) => acc + f(), 0);
const nums = [10, 9, 1, 100].sort();
const obj = { n: 1, inc() { this.n++; return this; } };
obj.inc().inc();
const { n } = obj;
console.log(total, nums.join(','), n, [0, '', null, 'a'].filter(Boolean).length, typeof NaN, 0.1 + 0.2 === 0.3);
