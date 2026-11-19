import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEvent, emptyState } from './monitor/state.js';
import { computeAlerts } from './monitor/alerts.js';
import { loadMonitorConfig } from './monitor/config.js';
import { reduceEvents, latestEventsFile } from './monitor/readEvents.js';
import { formatReport } from './monitor/report.js';
import { resumeCall } from './resume.js';
import { COMMIT_INSTRUCTIONS, commitRequest, parseCommitRequest } from './commit.js';
import { formatStory, runStory } from './story.js';
import { runAgent } from './runAgent.js';
import { candidatesFor, chooseAgent, validateDelegation } from './delegation.js';
import { readConfig, repositoryRoot } from './config.js';
import { startServer } from './server/app.js';
import { readQuotas, isAgentAvailable, quotaAgentConfig } from './quota/index.js';
import { remainingPct } from './quota/common.js';

const USAGE = `Usage :
  nay run <agent> <brief.md|-> [--read-only] [--feature <nom>] [--role <rôle>] [--cwd <dossier>] [--commit] [--effort low|medium|high|xhigh]
      [--skip-permissions]   (agy en écriture, worktree Git lié uniquement)
  nay resume <callId> <brief.md|-> [--cwd <dossier>] [--commit]
  nay story <brief.md|-> [--cwd <dossier>] [--feature <nom>] [--rounds <n>]
  nay choose <rôle> [--author <agent>] [--unavailable a,b]   (sans --unavailable : quotas réels)
  nay check-config
  nay quota
  nay ui
  nay status [--file <events.jsonl>] [--feature <nom>]`;

// Racine du dépôt Nay : le dossier qui contient config/.
const NAY_ROOT = fileURLToPath(new URL('..', import.meta.url));

function featureReducer(feature, config) {
  return (state, event) => (feature === undefined || event.feature === feature
    ? applyEvent(state, event, config) : state);
}

async function statusCommand(args, output, now) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    file: { type: 'string' }, feature: { type: 'string' },
  } });
  if (positionals.length) throw new Error(USAGE);
  const config = loadMonitorConfig();
  const file = values.file ?? await latestEventsFile(resolve(NAY_ROOT, config.eventsDir));
  const state = file ? await reduceEvents(file, featureReducer(values.feature, config), emptyState())
    : emptyState();
  // Un fichier sans aucun événement valide donne le même résultat qu'un fichier vide.
  if (!Object.keys(state.calls).length) {
    output.write('Aucun événement\n');
    return 0;
  }
  const nowMs = now();
  output.write(`${formatReport(state, computeAlerts(state, nowMs, config), nowMs, config).join('\n')}\n`);
  return 0;
}

async function chooseCommand(args, output, quotasReader) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    author: { type: 'string' }, unavailable: { type: 'string' },
  } });
  if (positionals.length !== 1) throw new Error(USAGE);
  const [role] = positionals;
  // Valider rôle et auteur avant de lancer la lecture des quotas, qui démarre agy.
  candidatesFor(role, { author: values.author });
  const isAvailable = values.unavailable === undefined
    ? await quotaAvailability(quotasReader) : simulatedAvailability(values.unavailable);
  const result = chooseAgent(role, { author: values.author, isAvailable });
  output.write(`Agent choisi : ${result.agent}\n`);
  for (const { agent, reason } of result.skipped) output.write(`Sauté : ${agent} (${reason})\n`);
  return 0;
}

async function quotaAvailability(quotasReader) {
  const quotas = await quotasReader();
  const config = quotaAgentConfig();
  return (agent) => isAgentAvailable(agent, quotas, config).available;
}

function simulatedAvailability(list) {
  const unavailable = new Set(list.split(',').map((agent) => agent.trim()));
  return (agent) => !unavailable.has(agent);
}

// Boucle complète dev → commit → revue → correction, rendue en quelques lignes.
async function storyCommand(args, { input, output, execute, quotasReader, storyRunner }) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    cwd: { type: 'string' }, feature: { type: 'string' }, rounds: { type: 'string', default: '2' },
  } });
  if (positionals.length !== 1) throw new Error(USAGE);
  const rounds = Number(values.rounds);
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error('--rounds doit être un entier ≥ 1');
  const [brief] = positionals;
  const text = brief === '-' ? await readStdin(input) : await readFile(brief, 'utf8');
  const cwd = resolve(values.cwd ?? process.cwd());
  const report = await storyRunner(text, { cwd, feature: values.feature ?? basename(cwd), maxRounds: rounds,
    execute, isAvailable: await quotaAvailability(quotasReader) });
  output.write(formatStory(report));
  return report.code;
}

function checkConfigCommand(args, output) {
  if (args.length) throw new Error(USAGE);
  const errors = validateDelegation(readConfig('delegation'), Object.keys(readConfig('agents')));
  if (errors.length) throw new Error(errors.join('\n'));
  output.write('Configuration de délégation valide\n');
  return 0;
}

async function readStdin(stream) {
  stream.setEncoding('utf8');
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}

export async function runCommand(args, { input = process.stdin, output = process.stdout,
  errorOutput = process.stderr, execute = runAgent, resumer = resumeCall, quotasReader = readQuotas, now = Date.now,
  committer = commitRequest, storyRunner = runStory } = {}) {
  try {
    if (args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) {
      output.write(`${USAGE}\n`);
      return 0;
    }
    if (args[0] === 'ui') {
      if (args.length !== 1) throw new Error(USAGE);
      await startServer({ root: NAY_ROOT, dataRoot: repositoryRoot(), output, quotasReader, now });
      return 0;
    }
    if (args[0] === 'resume') return await resumeCommand(args.slice(1), { input, output, errorOutput, resumer, committer });
    if (args[0] === 'status') return await statusCommand(args.slice(1), output, now);
    if (args[0] === 'story') return await storyCommand(args.slice(1), { input, output, execute, quotasReader, storyRunner });
    if (args[0] === 'choose') return await chooseCommand(args.slice(1), output, quotasReader);
    if (args[0] === 'check-config') return checkConfigCommand(args.slice(1), output);
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      'read-only': { type: 'boolean', default: false },
      feature: { type: 'string' }, role: { type: 'string' }, cwd: { type: 'string' },
      commit: { type: 'boolean', default: false }, effort: { type: 'string' },
      'skip-permissions': { type: 'boolean', default: false },
    } });
    const [command, agent, brief] = positionals;
    if (command === 'quota' && positionals.length === 1 && args.length === 1) {
      printQuotas(await quotasReader(), quotaAgentConfig(), output);
      return 0;
    }
    if (command !== 'run' || positionals.length !== 3) throw new Error(USAGE);
    if (values.commit && values['read-only']) throw new Error('--commit est incompatible avec --read-only');
    const briefText = brief === '-' ? await readStdin(input) : await readFile(brief, 'utf8');
    const prompt = values.commit ? `${briefText}${COMMIT_INSTRUCTIONS}` : briefText;
    const result = await execute(agent, prompt, { mode: values['read-only'] ? 'read' : 'write',
      cwd: values.cwd, feature: values.feature, role: values.role,
      ...(values.effort ? { effort: values.effort } : {}),
      ...(values['skip-permissions'] ? { skipPermissions: true } : {}) });
    return await finish(result, { commit: values.commit, cwd: values.cwd, output, errorOutput, committer });
  } catch (error) {
    errorOutput.write(`${error.message}\n`);
    return 1;
  }
}

// Après un appel réussi avec --commit, Nay committe hors sandbox les fichiers annoncés par l'agent.
async function finish(result, { commit, cwd, output, errorOutput, committer }) {
  printResult(result, output);
  if (result.status !== 'ok') {
    errorOutput.write(`${result.error ?? result.status}\n`);
    return 1;
  }
  if (!commit) return 0;
  const request = parseCommitRequest(result.text);
  if (!request) {
    output.write('Commit : aucun (pas de lignes NAY-COMMIT / NAY-FILES)\n');
    return 0;
  }
  try {
    output.write(`Commit : ${await committer(request, { cwd: cwd ?? process.cwd() })}\n`);
    return 0;
  } catch (error) {
    errorOutput.write(`Commit : échec — ${error.stderr?.trim() || error.message}\n`);
    return 1;
  }
}

function printResult(result, output) {
  const duration = `${(result.durationMs / 1000).toFixed(1)}s`;
  output.write(`[${result.agent} · ${result.model ?? '?'}/${result.effort ?? '?'} · ${duration} · in ${result.usage.input} / out ${result.usage.output}]\n`);
  output.write(`callId : ${result.callId ?? '?'}\nsession : ${result.sessionId ?? 'inconnue'}\n`);
  if (result.text) output.write(`${result.text}${result.text.endsWith('\n') ? '' : '\n'}`);
}

function printQuotas(quotas, config, output) {
  for (const [provider, quota] of Object.entries(quotas)) {
    if (quota.status !== 'ok') {
      output.write(`${provider} : inconnu (${quota.reason})\n`);
      continue;
    }
    const windows = quota.windows.map((window) =>
      `${window.label}${window.scope ? ` ${window.scope}` : ''} ${remainingPct(window)} %`).join(' · ');
    const age = quota.measuredAt ? ` (relevé il y a ${Math.max(0, Math.floor((Date.now() - Date.parse(quota.measuredAt)) / 60000))} min${quota.stale ? ', périmé' : ''})` : '';
    output.write(`${provider} : ${windows}${age}\n`);
  }
  const unavailable = Object.keys(config.agents).map((name) => [name, isAgentAvailable(name, quotas, config)])
    .filter(([, result]) => !result.available);
  if (unavailable.length) output.write(`Agents indisponibles : ${unavailable.map(([name, result]) => `${name} (${result.reason})`).join(', ')}\n`);
}

async function resumeCommand(args, { input, output, errorOutput, resumer, committer }) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true,
    options: { cwd: { type: 'string' }, commit: { type: 'boolean', default: false } } });
  if (positionals.length !== 2) throw new Error(USAGE);
  const [callId, brief] = positionals;
  const text = brief === '-' ? await readStdin(input) : await readFile(brief, 'utf8');
  const prompt = values.commit ? `${text}${COMMIT_INSTRUCTIONS}` : text;
  const result = await resumer(callId, prompt, { cwd: values.cwd });
  return finish(result, { commit: values.commit, cwd: result.cwd ?? values.cwd, output, errorOutput, committer });
}
