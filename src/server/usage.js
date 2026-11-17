const metrics = ['input', 'cachedInput', 'output', 'durationMs'];
const empty = () => ({ calls: 0, input: 0, cachedInput: 0, output: 0, durationMs: 0 });

function add(total, entry) {
  total.calls++;
  for (const metric of metrics) {
    const value = metric === 'durationMs' ? entry[metric] : entry.usage?.[metric];
    total[metric] += Number.isFinite(value) ? value : 0;
  }
  return total;
}

export function aggregateUsage(entries, { feature, since, recent = entries.length } = {}) {
  const selected = entries.filter((entry) => (feature === undefined || entry.feature === feature)
    && (since === undefined || Date.parse(entry.timestamp) >= Date.parse(since)));
  const result = { totals: selected.reduce(add, empty()) };
  for (const field of ['agent', 'model', 'feature', 'role']) {
    const groups = new Map();
    for (const entry of selected) {
      const key = entry[field] ?? null;
      if (!groups.has(key)) groups.set(key, { key, ...empty() });
      add(groups.get(key), entry);
    }
    result[`by${field[0].toUpperCase()}${field.slice(1)}`] = [...groups.values()]
      .sort((a, b) => (b.input + b.output) - (a.input + a.output));
  }
  result.recent = [...selected].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, recent);
  return result;
}
