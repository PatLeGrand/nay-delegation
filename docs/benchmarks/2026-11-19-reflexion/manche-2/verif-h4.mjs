const log = [];
setTimeout(() => log.push('T1'), 0);
const p = new Promise((resolve) => { log.push('P'); resolve('R'); });
queueMicrotask(() => log.push('M1'));
p.then((v) => { log.push(v); return Promise.resolve('X'); }).then((v) => log.push(v));
(async () => {
  log.push('A1');
  await null;
  log.push('A2');
  await p;
  log.push('A3');
})();
p.then(() => log.push('Q'));
setTimeout(() => { log.push('T2'); console.log(log.join(' ')); }, 0);
log.push('S');
