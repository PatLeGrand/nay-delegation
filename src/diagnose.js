// `nay diagnose` : chronologie et diagnostic d'une story ou d'un appel, tirés du journal d'événements.
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadEventConfig, readConfig, repositoryRoot } from './config.js';
import { chooseAgent } from './delegation.js';
import { maskSecrets } from './eventLog.js';
import { applyJobEvent, emptyJobs, failureCause, jobStatus, loadLifecycleConfig } from './lifecycle.js';
import { loadMonitorConfig } from './monitor/config.js';
import { formatDuration, shorten } from './monitor/format.js';
import { reduceEvents } from './monitor/readEvents.js';
import { applyEvent, emptyState } from './monitor/state.js';
import { journalFiles } from './wait.js';

const DAY_MS = 86_400_000;
const USAGE = 'Usage : nay diagnose <storyId|callId> [--explain]';
const POSITIVE = ['daysBack', 'maxExplainChars', 'errorMaxChars', 'messageMaxChars'];
const NO_VALUE = '-';

export function loadDiagnoseConfig() {
  const config = readConfig('diagnose');
  if (!POSITIVE.every((key) => Number.isSafeInteger(config?.[key]) && config[key] > 0)
    || typeof config.explainFeature !== 'string' || !config.explainFeature) {
    throw new Error('config/diagnose.json invalide');
  }
  return config;
}

function emptyJournal() {
  return { jobs: emptyJobs(), details: emptyState(), messages: {}, storyEnds: {} };
}

// Mêmes réducteurs que `nay wait` (états) et `nay status` (rôle, mode, outils) ; on garde en plus
// le dernier message de chaque appel et le story_end brut (contrôles).
function journalReducer(monitorConfig) {
  return (journal, event) => {
    if (event.kind === 'message' && typeof event.callId === 'string') journal.messages[event.callId] = event.text;
    if (event.kind === 'story_end' && typeof event.storyId === 'string') journal.storyEnds[event.storyId] = event;
    return { ...journal, jobs: applyJobEvent(journal.jobs, event),
      details: applyEvent(journal.details, event, monitorConfig) };
  };
}

export async function readJournal(directory, { since, monitorConfig }) {
  let names;
  try { names = await readdir(directory); } catch (error) {
    if (error.code === 'ENOENT') return emptyJournal();
    throw error;
  }
  const reduce = journalReducer(monitorConfig);
  let journal = emptyJournal();
  for (const name of journalFiles(names, since)) journal = await reduceEvents(join(directory, name), reduce, journal);
  return journal;
}

const clock = (ms) => new Date(ms).toISOString().slice(11, 19);
const byStart = (a, b) => a.startedAt - b.startedAt;

function context(journal, config, eventConfig, quotaPattern) {
  const mask = (text) => maskSecrets(String(text ?? ''), eventConfig);
  return { journal, config, quotaPattern,
    error: (text) => shorten(mask(text), config.errorMaxChars),
    message: (callId) => shorten(mask(journal.messages[callId]), config.messageMaxChars) };
}

function callCause(end, ctx) {
  return end.cause ?? failureCause(end, ctx.quotaPattern);
}

function outcome(end, ctx) {
  if (!end) return 'sans fin';
  if (end.status === 'ok') return end.question ? 'ok, question' : 'ok';
  return `${end.status} (${callCause(end, ctx)})${end.retrying ? ', reprise automatique' : ''}`;
}

function callLines(call, ctx) {
  const detail = ctx.journal.details.calls[call.id] ?? {};
  const duration = call.end?.durationMs ?? call.lastEventAt - call.startedAt;
  const parts = [`${clock(call.startedAt)} appel ${call.id}`, call.agent ?? NO_VALUE, detail.role ?? NO_VALUE,
    detail.mode ?? NO_VALUE, formatDuration(duration), outcome(call.end, ctx), `outils ${detail.toolCount ?? 0}`];
  if (detail.failures) parts.push(`échecs d'outils ${detail.failures}`);
  if (call.resumedFrom) parts.push(`reprise de ${call.resumedFrom}`);
  const lines = [`  ${parts.join(' · ')}`];
  if (call.end?.error) lines.push(`      erreur : ${ctx.error(call.end.error)}`);
  return lines;
}

function storyEndLines(story, ctx) {
  const { end } = story;
  if (!end) return [`  ${clock(story.lastEventAt)} pas de story_end (dernier événement)`];
  const raw = ctx.journal.storyEnds[story.id] ?? {};
  const reviews = end.reviews.map(({ agent, round, verdict }) => `${agent} ${ctx.error(verdict)} (tour ${round})`);
  const lines = [`  ${clock(story.lastEventAt)} fin · ${end.status} (${end.cause ?? NO_VALUE}) · code ${end.code}`
    + ` · ${formatDuration(story.lastEventAt - story.startedAt)}`,
  `      dev : ${end.dev ?? 'aucun'} · revues : ${reviews.join(' ; ') || 'aucune'}`,
  `      contrôles : ${raw.checks ?? 'non rapportés'}${raw.checksBy ? ` (${raw.checksBy})` : ''}`
    + ` · commits : ${end.commits.join(' ; ') || 'aucun'}`];
  if (end.detail) lines.push(`      détail : ${ctx.error(end.detail)}`);
  return lines;
}

function storyCalls(journal, storyId) {
  return Object.values(journal.jobs.calls).filter((call) => call.storyId === storyId).sort(byStart);
}

// L'appel et ses reprises (automatique ou `nay resume`), dans l'ordre.
function callChain(journal, callId) {
  const chain = [journal.jobs.calls[callId]];
  for (;;) {
    const next = Object.values(journal.jobs.calls).filter((call) => call.resumedFrom === chain.at(-1).id)
      .sort(byStart).at(-1);
    if (!next || chain.includes(next)) return chain;
    chain.push(next);
  }
}

function roleOf(call, ctx) {
  return ctx.journal.details.calls[call.id]?.role ?? null;
}

// Un appel en échec suivi d'un autre appel du même rôle a été sauté (quota, réponse vide…).
function failedCallLines(calls, ctx) {
  return calls.filter((call) => call.end && call.end.status !== 'ok' && !call.end.retrying).map((call) => {
    const later = calls.some((other) => other.startedAt > call.startedAt && roleOf(other, ctx) === roleOf(call, ctx));
    const head = later ? 'Sauté' : 'Échec';
    return `${head} : ${call.agent ?? NO_VALUE} (${roleOf(call, ctx) ?? 'rôle ?'}, ${callCause(call.end, ctx)})`
      + `${call.end.error ? ` — ${ctx.error(call.end.error)}` : ''}`;
  });
}

function sinceLast(job, now) {
  return `dernier événement il y a ${formatDuration(now - job.lastEventAt)}`;
}

function storyDiagnosis(story, calls, status, ctx, now) {
  const { end } = story;
  const lines = [];
  if (!end) lines.push(`Pas de story_end : story ${status.state}, ${sinceLast(story, now)} (interrompue ou en cours).`);
  else if (status.state === 'done') lines.push('Story terminée sans erreur (OK).');
  else if (end.question) {
    const dev = calls.filter((call) => roleOf(call, ctx) === 'dev').at(-1);
    lines.push(`Arrêt : le dev pose une question${dev ? ` : « ${ctx.message(dev.id)} »` : ''}.`);
  } else lines.push(`Arrêt : ${end.status} (${end.cause ?? NO_VALUE})${end.detail ? ` — ${ctx.error(end.detail)}` : ''}.`);
  if (end?.cause === 'checks') lines.push(`Contrôles en échec : ${ctx.journal.storyEnds[story.id]?.checks ?? 'non rapportés'}.`);
  return [...lines, ...failedCallLines(calls, ctx)];
}

// L'état vient de l'appel lui-même ou de sa reprise automatique (`via`) ; une reprise manuelle
// (`nay resume`) est un autre travail, seulement signalé.
function callDiagnosis(chain, status, ctx, now) {
  const last = ctx.journal.jobs.calls[status.via ?? status.id];
  const later = chain.slice(chain.indexOf(last) + 1);
  const lines = [];
  if (status.state === 'done') lines.push('Appel terminé sans erreur.');
  else if (status.state === 'needs_input') lines.push(`L'agent finit sur une question : « ${ctx.message(last.id)} ».`);
  else if (status.state === 'failed') {
    lines.push(`Échec (${status.cause})${last.end?.error ? ` : ${ctx.error(last.end.error)}` : ''}.`);
  } else lines.push(`Pas de call_end : appel ${status.state}, ${sinceLast(last, now)} (interrompu ou en cours).`);
  if (status.via) lines.push(`Suivi à travers la reprise ${status.via}.`);
  for (const call of later) lines.push(`Repris ensuite par ${call.id} : ${outcome(call.end, ctx)}.`);
  return lines;
}

// Rapport sans IA : chronologie puis diagnostic mécanique. Null si l'identifiant est inconnu.
export function diagnose(journal, id, { now, config, eventConfig, lifecycleConfig, silenceSec }) {
  const ctx = context(journal, config, eventConfig, lifecycleConfig.quotaPattern);
  const status = jobStatus(journal.jobs, id, now, { ...lifecycleConfig, silenceSec });
  if (!status) return null;
  if (status.kind === 'story') {
    const story = status.job;
    const calls = storyCalls(journal, id);
    return { feature: story.feature, lines: [
      `Story ${id} · feature ${story.feature ?? NO_VALUE} · état ${status.state}${status.cause ? ` (${status.cause})` : ''}`,
      `  ${new Date(story.startedAt).toISOString().slice(0, 10)} ${clock(story.startedAt)} début`,
      ...calls.flatMap((call) => callLines(call, ctx)), ...storyEndLines(story, ctx),
      '', 'Diagnostic :', ...storyDiagnosis(story, calls, status, ctx, now).map((line) => `- ${line}`)] };
  }
  const chain = callChain(journal, id);
  return { feature: status.job.feature, lines: [
    `Appel ${id} · feature ${status.job.feature ?? NO_VALUE} · état ${status.state}${status.cause ? ` (${status.cause})` : ''}`
      + `${status.job.storyId ? ` · story ${status.job.storyId}` : ''}`,
    `  ${new Date(status.job.startedAt).toISOString().slice(0, 10)}`,
    ...chain.flatMap((call) => callLines(call, ctx)),
    '', 'Diagnostic :', ...callDiagnosis(chain, status, ctx, now).map((line) => `- ${line}`)] };
}

// La fin du rapport porte l'arrêt et le diagnostic : c'est elle qu'on garde si c'est trop long.
function lastChars(text, maxChars) {
  return text.length > maxChars ? `[… début tronqué]\n${text.slice(-maxChars)}` : text;
}

export function explainPrompt(report) {
  return `Tu diagnostiques un travail de Nay (orchestrateur multi-agents) qui a peut-être mal tourné.
Voici sa chronologie et un premier diagnostic, tirés du journal d'événements. Réponds à partir
de ce texte seul, sans ouvrir de fichier ni lancer de commande. En quelques lignes, en français :
1. Explication : ce qui s'est passé et pourquoi.
2. Action conseillée : ce que l'utilisateur doit faire maintenant.

\`\`\`text
${report}
\`\`\``;
}

// Lecture seule : en cas d'échec, on passe à l'explorateur suivant, comme `nay role`.
async function explain(report, { execute, isAvailable, config }) {
  const prompt = explainPrompt(lastChars(report, config.maxExplainChars));
  const failed = new Set();
  for (;;) {
    const { agent } = chooseAgent('explorateur', { isAvailable: (name) => !failed.has(name) && isAvailable(name) });
    const result = await execute(agent, prompt, { mode: 'read', feature: config.explainFeature, role: 'explorateur' });
    if (result.status === 'ok') return { agent, text: result.text ?? '' };
    failed.add(agent);
  }
}

export async function diagnoseCommand(args, { output, execute, availability, now = Date.now,
  config = loadDiagnoseConfig(), monitorConfig = loadMonitorConfig(),
  directory = resolve(repositoryRoot(), monitorConfig.eventsDir) }) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true,
    options: { explain: { type: 'boolean', default: false } } });
  if (positionals.length !== 1) throw new Error(USAGE);
  const [id] = positionals;
  const current = now();
  const since = new Date(current - config.daysBack * DAY_MS).toISOString().slice(0, 10);
  const journal = await readJournal(directory, { since, monitorConfig });
  const result = diagnose(journal, id, { now: current, config, eventConfig: loadEventConfig(),
    lifecycleConfig: loadLifecycleConfig(), silenceSec: monitorConfig.silenceSec });
  if (!result) throw new Error(`Inconnu dans le journal des ${config.daysBack} derniers jours : ${id}`);
  const report = result.lines.join('\n');
  output.write(`${report}\n`);
  if (!values.explain) return 0;
  const { agent, text } = await explain(report, { execute, isAvailable: await availability(), config });
  output.write(`\nExplication (${agent}) :\n${text}${text.endsWith('\n') ? '' : '\n'}`);
  return 0;
}
