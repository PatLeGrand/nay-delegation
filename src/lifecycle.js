// États des appels et des stories, déduits des événements (contrat : docs/cycle-de-vie.md).
import { readConfig } from './config.js';

export const STATES = ['accepted', 'working', 'stalled', 'needs_input', 'done', 'failed'];
export const TERMINAL = ['needs_input', 'done', 'failed'];
const STORY_CAUSES = { 'AUCUN AGENT': 'no_agent', 'BLOQUÉ': 'blocked', 'DÉFAUTS': 'defects' };
const ACTIVE_KINDS = ['tool_start', 'tool_end', 'message'];

export function loadLifecycleConfig() {
  const config = readConfig('lifecycle');
  const positive = ['pollMs', 'defaultTimeoutMin', 'appearGraceSec'];
  if (!positive.every((key) => Number.isFinite(config[key]) && config[key] > 0)
    || !Array.isArray(config.defaultUntil) || !config.defaultUntil.every((state) => STATES.includes(state))
    || typeof config.quotaPattern !== 'string') {
    throw new Error('config/lifecycle.json invalide');
  }
  new RegExp(config.quotaPattern, 'i');
  return config;
}

// Dernière ligne utile (hors marqueurs NAY-) terminée par « ? », sans demande de commit.
export function endsWithQuestion(text = '') {
  if (/^NAY-COMMIT:/m.test(text)) return false;
  const last = text.split('\n').map((line) => line.trim())
    .filter((line) => line && !/^NAY-[A-Z]+:/.test(line)).at(-1) ?? '';
  return /[?？][\s*_)»"'`]*$/.test(last);
}

export function failureCause({ status, error = '', shellBlocked = false }, quotaPattern) {
  if (status === 'timeout') return 'timeout';
  if (shellBlocked || /Shell bloqué/.test(error)) return 'shell_blocked';
  if (/Réponse vide/.test(error)) return 'empty';
  if (quotaPattern && new RegExp(quotaPattern, 'i').test(error)) return 'quota';
  return 'crash';
}

export function emptyJobs() {
  return { calls: {}, stories: {} };
}

function touch(job, ts) {
  return { ...job, startedAt: Math.min(job.startedAt, ts), lastEventAt: Math.max(job.lastEventAt, ts) };
}

function reduceCall(calls, event, ts) {
  const known = calls[event.callId] ?? { id: event.callId, startedAt: ts, lastEventAt: ts, active: false,
    end: null, resumedFrom: null };
  const call = { ...touch(known, ts), agent: known.agent ?? event.agent ?? null,
    feature: known.feature ?? event.feature ?? null, storyId: known.storyId ?? event.storyId ?? null };
  if (event.kind === 'call_start') call.resumedFrom = event.resumedFrom ?? null;
  if (ACTIVE_KINDS.includes(event.kind)) call.active = true;
  if (event.kind === 'call_end') {
    call.end = { status: event.status, cause: event.cause ?? null, error: event.error ?? null,
      question: event.question === true, retrying: event.retrying === true, durationMs: event.durationMs ?? null };
  }
  return { ...calls, [event.callId]: call };
}

function reduceStory(stories, event, ts) {
  const known = stories[event.storyId] ?? { id: event.storyId, startedAt: ts, lastEventAt: ts, end: null };
  const story = { ...touch(known, ts), feature: known.feature ?? event.feature ?? null };
  if (event.kind === 'story_end') {
    const { status, code, cause, question, detail, dev, reviews, commits } = event;
    story.end = { status, code, cause: cause ?? STORY_CAUSES[status] ?? null, question: question === true,
      detail: detail ?? null, dev: dev ?? null, reviews: reviews ?? [], commits: commits ?? [] };
  }
  return { ...stories, [event.storyId]: story };
}

export function applyJobEvent(jobs, event) {
  const ts = Date.parse(event?.ts);
  if (!Number.isFinite(ts)) return jobs;
  let { calls, stories } = jobs;
  if (typeof event.callId === 'string') calls = reduceCall(calls, event, ts);
  if (typeof event.storyId === 'string') {
    if (['story_start', 'story_end'].includes(event.kind)) stories = reduceStory(stories, event, ts);
    else if (stories[event.storyId]) stories = { ...stories, [event.storyId]: touch(stories[event.storyId], ts) };
  }
  return calls === jobs.calls && stories === jobs.stories ? jobs : { calls, stories };
}

function runningState(job, active, now, silenceSec) {
  if (now - job.lastEventAt > silenceSec * 1000) return 'stalled';
  return active ? 'working' : 'accepted';
}

function retryOf(jobs, callId) {
  return Object.values(jobs.calls).filter((call) => call.resumedFrom === callId)
    .sort((a, b) => a.startedAt - b.startedAt).at(-1) ?? null;
}

// Pour une reprise automatique, l'appel suit l'état de la reprise (voir docs/cycle-de-vie.md).
function callStatus(jobs, call, now, config, depth = 0) {
  const { end } = call;
  if (!end) return { state: runningState(call, call.active, now, config.silenceSec) };
  if (end.retrying && depth < 5) {
    const retry = retryOf(jobs, call.id);
    return retry ? { ...callStatus(jobs, retry, now, config, depth + 1), via: retry.id } : { state: 'working' };
  }
  if (end.status === 'ok') return { state: end.question ? 'needs_input' : 'done' };
  return { state: 'failed', cause: end.cause ?? failureCause(end, config.quotaPattern) };
}

function storyStatus(jobs, story, now, config) {
  const { end } = story;
  if (end) {
    if (end.question) return { state: 'needs_input' };
    return end.code === 0 ? { state: 'done' } : { state: 'failed', cause: end.cause };
  }
  const calls = Object.values(jobs.calls).filter((call) => call.storyId === story.id);
  const lastEventAt = Math.max(story.lastEventAt, ...calls.map((call) => call.lastEventAt));
  return { state: runningState({ lastEventAt }, calls.some((call) => call.active), now, config.silenceSec) };
}

export function jobStatus(jobs, id, now, config) {
  if (jobs.stories[id]) {
    const story = jobs.stories[id];
    return { kind: 'story', id, job: story, ...storyStatus(jobs, story, now, config) };
  }
  if (jobs.calls[id]) {
    const call = jobs.calls[id];
    return { kind: 'call', id, job: call, ...callStatus(jobs, call, now, config) };
  }
  return null;
}

// Travaux d'une fonctionnalité : stories et appels hors story, sans les reprises automatiques
// (suivies à travers l'appel qui les a déclenchées).
export function featureJobs(jobs, feature) {
  const retries = new Set(Object.values(jobs.calls)
    .filter((call) => call.end?.retrying).map((call) => retryOf(jobs, call.id)?.id).filter(Boolean));
  return [
    ...Object.values(jobs.stories).filter((story) => story.feature === feature),
    ...Object.values(jobs.calls).filter((call) => call.feature === feature && !call.storyId && !retries.has(call.id)),
  ].map((job) => job.id);
}
