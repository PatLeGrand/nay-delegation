import { applyEvent, emptyState, sortedOpenTools } from '../monitor/state.js';
import { computeAlerts } from '../monitor/alerts.js';
import { reduceEvents } from '../monitor/readEvents.js';

const iso = (value) => value == null ? null : new Date(value).toISOString();

function serializeCall(call) {
  const { callId, agent, model, feature, role, mode, status, toolCount, failures, consecutiveFailures } = call;
  return { callId, agent, model, feature, role, mode, status, toolCount, failures, consecutiveFailures,
    startedAt: iso(call.startedAt), lastEventAt: iso(call.lastEventAt), endedAt: iso(call.endedAt),
    currentTools: sortedOpenTools(call.currentTools).map(({ name, kind, target, startedAt }) =>
      ({ name, kind, target, startedAt: iso(startedAt) })),
    usage: call.usage ?? { input: 0, cachedInput: 0, output: 0 } };
}

export async function readStatus(file, config, now, feature) {
  const state = await reduceEvents(file, (state, event) => feature === undefined || event.feature === feature
    ? applyEvent(state, event, config) : state, emptyState());
  return { now: iso(now), calls: Object.values(state.calls).map(serializeCall),
    alerts: computeAlerts(state, now, config).map((alert) => ({ ...alert, since: iso(alert.since) })) };
}
