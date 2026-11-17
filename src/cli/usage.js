export function emptyUsage() {
  return { input: 0, cachedInput: 0, output: 0, thinking: 0, total: 0 };
}

export function failResult(message, result) {
  throw Object.assign(new Error(message), { result });
}

export function subtractUsage(usage, baseline) {
  return Object.fromEntries(Object.keys(emptyUsage()).map((field) =>
    [field, Math.max(0, (usage[field] ?? 0) - (baseline[field] ?? 0))]));
}
