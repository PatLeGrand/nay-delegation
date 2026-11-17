import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEvent, emptyState } from './monitor/state.js';
import { computeAlerts } from './monitor/alerts.js';
import { loadMonitorConfig } from './monitor/config.js';
import { reduceEvents, latestEventsFile } from './monitor/readEvents.js';
import { formatReport } from './monitor/report.js';
import { runAgent } from './runAgent.js';
import { candidatesFor, chooseAgent, validateDelegation } from './delegation.js';
import { readConfig, repositoryRoot } from './config.js';
import { startServer } from './server/app.js';
import { readQuotas, isAgentAvailable, quotaAgentConfig } from './quota/index.js';
import { remainingPct } from './quota/common.js';

const USAGE = `Usage :
  nay run <agent> <brief.md|-> [--read-only] [--feature <nom>] [--role <rôle>] [--cwd <dossier>]
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
  errorOutput = process.stderr, execute = runAgent, quotasReader = readQuotas, now = Date.now } = {}) {
  try {
    if (args[0] === 'ui') {
      if (args.length !== 1) throw new Error(USAGE);
      await startServer({ root: NAY_ROOT, dataRoot: repositoryRoot(), output, quotasReader, now });
      return 0;
    }
    if (args[0] === 'status') return await statusCommand(args.slice(1), output, now);
    if (args[0] === 'choose') return await chooseCommand(args.slice(1), output, quotasReader);
    if (args[0] === 'check-config') return checkConfigCommand(args.slice(1), output);
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      'read-only': { type: 'boolean', default: false },
      feature: { type: 'string' }, role: { type: 'string' }, cwd: { type: 'string' },
    } });
    const [command, agent, brief] = positionals;
    if (command === 'quota' && positionals.length === 1 && args.length === 1) {
      printQuotas(await quotasReader(), quotaAgentConfig(), output);
      return 0;
    }
    if (command !== 'run' || positionals.length !== 3) throw new Error(USAGE);
    const prompt = brief === '-' ? await readStdin(input) : await readFile(brief, 'utf8');
    const result = await execute(agent, prompt, { mode: values['read-only'] ? 'read' : 'write',
      cwd: values.cwd, feature: values.feature, role: values.role });
    printResult(result, output);
    if (result.status === 'ok') return 0;
    errorOutput.write(`${result.error ?? result.status}\n`);
    return 1;
  } catch (error) {
    errorOutput.write(`${error.message}\n`);
    return 1;
  }
}

function printResult(result, output) {
  const duration = `${(result.durationMs / 1000).toFixed(1)}s`;
  output.write(`[${result.agent} · ${result.model ?? '?'}/${result.effort ?? '?'} · ${duration} · in ${result.usage.input} / out ${result.usage.output}]\n`);
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
