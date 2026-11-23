import { loadProjectConfig } from '../config.js';
import { matchesProject, projectFromPath } from '../project.js';

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

export function usageProject(entry, config) {
  return Object.hasOwn(entry, 'project') ? entry.project : projectFromPath(entry.cwd, config);
}

export function aggregateUsage(entries, { feature, project, since, recent = entries.length } = {}) {
  const config = loadProjectConfig();
  const selected = entries.filter((entry) => (feature === undefined || entry.feature === feature)
    && (!project || matchesProject(usageProject(entry, config), project))
    && (since === undefined || Date.parse(entry.timestamp) >= Date.parse(since)));
  const result = { totals: selected.reduce(add, empty()) };
  for (const field of ['agent', 'model', 'feature', 'role', 'project']) {
    const groups = new Map();
    for (const entry of selected) {
      const key = (field === 'project' ? usageProject(entry, config) : entry[field]) ?? null;
      if (!groups.has(key)) groups.set(key, { key, ...empty() });
      add(groups.get(key), entry);
    }
    result[`by${field[0].toUpperCase()}${field.slice(1)}`] = [...groups.values()]
      .sort((a, b) => (b.input + b.output) - (a.input + a.output));
  }
  const days = new Map();
  const agents = new Map();
  for (const entry of selected) {
    const timestamp = Date.parse(entry.timestamp);
    if (Number.isFinite(timestamp)) {
      const day = new Date(timestamp).toISOString().slice(0, 10);
      if (!days.has(day)) days.set(day, { day, calls: 0, input: 0, cachedInput: 0, output: 0 });
      const daily = days.get(day);
      daily.calls++;
      for (const metric of ['input', 'cachedInput', 'output']) {
        daily[metric] += Number.isFinite(entry.usage?.[metric]) ? entry.usage[metric] : 0;
      }
    }
    const key = entry.agent ?? null;
    if (!agents.has(key)) agents.set(key, { key, calls: 0, failures: 0, durations: [], errors: new Map() });
    const agent = agents.get(key);
    agent.calls++;
    if (Number.isFinite(entry.durationMs) && entry.durationMs >= 0) agent.durations.push(entry.durationMs);
    if (entry.status !== 'ok') {
      agent.failures++;
      const error = String(entry.error ?? 'Cause inconnue').split(/\r?\n/, 1)[0].slice(0, 120);
      agent.errors.set(error, (agent.errors.get(error) ?? 0) + 1);
    }
  }
  result.byDay = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  result.reliability = [...agents.values()].map(({ key, calls, failures, durations, errors }) => {
    durations.sort((a, b) => a - b);
    const middle = Math.floor(durations.length / 2);
    const medianDurationMs = !durations.length ? null : durations.length % 2
      ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2;
    return { key, calls, failures, failureRate: failures / calls, medianDurationMs,
      topErrors: [...errors].map(([error, count]) => ({ error, count }))
        .sort((a, b) => b.count - a.count || a.error.localeCompare(b.error)).slice(0, 3) };
  }).sort((a, b) => String(a.key).localeCompare(String(b.key)));
  result.recent = [...selected].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, recent);
  return result;
}

export function summarizeProjects(entries) {
  const config = loadProjectConfig();
  const group = () => ({ calls: 0, latest: -Infinity, features: new Set(), branches: new Set() });
  const projects = new Map([[null, group()]]);
  for (const entry of entries) {
    const name = usageProject(entry, config) ?? null;
    if (!projects.has(name)) projects.set(name, group());
    const project = projects.get(name);
    project.calls++;
    const timestamp = Date.parse(entry.timestamp);
    if (timestamp > project.latest) project.latest = timestamp;
    if (entry.feature) project.features.add(entry.feature);
    if (entry.branch) project.branches.add(entry.branch);
  }
  return [...projects].sort(([, a], [, b]) => b.latest - a.latest)
    .map(([name, { calls, latest, features, branches }]) => ({
      name, calls, lastActivity: Number.isFinite(latest) ? new Date(latest).toISOString() : null,
      features: [...features].sort(), branches: [...branches].sort(),
    }));
}
