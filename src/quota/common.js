export function remainingPct(window, now = Date.now()) {
  return Date.parse(window.resetsAt) <= now ? 100 : window.remainingPct;
}

export function unknown(reason) {
  return { status: 'unknown', reason };
}
