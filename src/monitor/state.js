const ENDED_STATUSES = ['ok', 'error', 'timeout'];

export function emptyState() {
  return { calls: {} };
}

function newCall(event, ts) {
  return {
    callId: event.callId, agent: null, model: null, feature: null, project: null, branch: null, role: null, mode: null,
    status: 'running', startedAt: ts, lastEventAt: ts, endedAt: null,
    currentTools: {}, toolCount: 0, failures: 0, consecutiveFailures: 0, lastFailureAt: null,
    earlyEnds: [], history: [], usage: null,
  };
}

// Un fichier ouvert en cours de route peut ne pas contenir call_start : l'identité vient de chaque événement.
function withIdentity(call, event, ts) {
  return {
    ...call,
    agent: call.agent ?? event.agent ?? null,
    model: call.model ?? event.model ?? null,
    feature: call.feature ?? event.feature ?? null,
    project: call.project ?? event.project ?? null,
    branch: call.branch ?? event.branch ?? null,
    role: call.role ?? event.role ?? null,
    startedAt: Math.min(call.startedAt, ts),
    lastEventAt: Math.max(call.lastEventAt, ts),
  };
}

function normalizeTool(tool) {
  return {
    id: tool?.id ?? null, name: tool?.name ?? null,
    kind: tool?.kind ?? 'other', target: tool?.target ?? null,
  };
}

export function sortedOpenTools(currentTools) {
  return Object.values(currentTools).sort((a, b) => a.seq - b.seq);
}

// Un identifiant fourni mais inconnu ne doit jamais fermer un autre outil : le repli sur
// (kind, target) ne sert que pour les CLI qui ne donnent pas d'identifiant.
function findOpenTool(currentTools, tool) {
  if (tool.id !== null) return currentTools[String(tool.id)] ?? null;
  return sortedOpenTools(currentTools)
    .find((open) => open.kind === tool.kind && open.target === tool.target) ?? null;
}

function withoutTool(currentTools, open) {
  if (open === null) return currentTools;
  const rest = { ...currentTools };
  delete rest[open.key];
  return rest;
}

function addToHistory(history, entry, max) {
  if (max <= 0) return [];
  return [...history, entry].sort((a, b) => a.ts - b.ts).slice(-max);
}

// Calculé sur l'historique trié par ts : l'ordre de lecture des événements ne compte pas.
function trailingFailures(history) {
  const lastSuccess = history.findLastIndex((entry) => entry.ok);
  return history.length - 1 - lastSuccess;
}

function startTool(call, event, ts) {
  if (call.status !== 'running') return call;
  const tool = normalizeTool(event.tool);
  const id = tool.id === null ? null : String(tool.id);
  // Son tool_end est déjà arrivé et déjà compté : ne pas rouvrir un outil fantôme.
  if (id !== null && call.earlyEnds.includes(id)) {
    return { ...call, earlyEnds: call.earlyEnds.filter((early) => early !== id) };
  }
  const seq = call.toolCount;
  const key = tool.id === null ? `#${seq}` : String(tool.id);
  const open = { ...tool, key, startedAt: ts, seq };
  return { ...call, toolCount: seq + 1, currentTools: { ...call.currentTools, [key]: open } };
}

function endTool(call, event, ts, config) {
  const ended = normalizeTool(event.tool);
  const open = findOpenTool(call.currentTools, ended);
  const failed = event.ok === false;
  const entry = {
    kind: open?.kind ?? ended.kind, target: open?.target ?? ended.target, ok: !failed, ts,
  };
  // Un tool_end sans tool_start (fichier ouvert en cours de route, ou événements hors ordre)
  // compte quand même comme un outil, sauf sur un appel terminé dont l'outil a déjà été compté.
  const orphan = open === null && call.status === 'running';
  const history = addToHistory(call.history, entry, config.historyMax);
  return {
    ...call,
    toolCount: orphan ? call.toolCount + 1 : call.toolCount,
    currentTools: withoutTool(call.currentTools, open),
    earlyEnds: orphan && ended.id !== null ? [...call.earlyEnds, String(ended.id)] : call.earlyEnds,
    failures: failed ? call.failures + 1 : call.failures,
    consecutiveFailures: trailingFailures(history),
    lastFailureAt: failed ? Math.max(call.lastFailureAt ?? ts, ts) : call.lastFailureAt,
    history,
  };
}

function endCall(call, event, ts) {
  return {
    ...call,
    status: ENDED_STATUSES.includes(event.status) ? event.status : 'error',
    endedAt: ts, currentTools: {}, usage: event.usage ?? call.usage,
  };
}

function reduceEvent(call, event, ts, config) {
  switch (event.kind) {
    case 'call_start': return { ...call, mode: event.mode ?? call.mode };
    case 'tool_start': return startTool(call, event, ts);
    case 'tool_end': return endTool(call, event, ts, config);
    case 'usage': return { ...call, usage: event.usage ?? call.usage };
    case 'call_end': return endCall(call, event, ts);
    default: return call;
  }
}

export function applyEvent(state, event, config) {
  const ts = Date.parse(event?.ts);
  if (typeof event?.callId !== 'string' || !Number.isFinite(ts)) return state;
  const known = Object.hasOwn(state.calls, event.callId)
    ? state.calls[event.callId] : newCall(event, ts);
  const call = reduceEvent(withIdentity(known, event, ts), event, ts, config);
  return { ...state, calls: { ...state.calls, [event.callId]: call } };
}

export function buildState(events, config) {
  return events.reduce((state, event) => applyEvent(state, event, config), emptyState());
}
