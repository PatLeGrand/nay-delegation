import { randomUUID } from 'node:crypto';
import childProcess from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createEventSink } from './eventLog.js';
import { writeClaudeQuota } from './quota/claude.js';
import { getAgent, loadEngineConfig, loadEventConfig, repositoryRoot } from './config.js';
import { appendUsage, readUsage } from './usageLog.js';
import { emptyUsage, subtractUsage } from './cli/usage.js';
import * as codex from './cli/codex.js';
import * as agy from './cli/agy.js';
import * as claude from './cli/claude.js';

const adapters = { codex, agy, claude };
const MS_PER_MINUTE = 60_000;

function killProcess(child) {
  if (child.pid === undefined) return;
  try {
    // Le groupe inclut les outils lancés par l'agent, qui doivent aussi s'arrêter.
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') child.kill('SIGKILL');
  }
}

function execute(binary, args, { cwd, input, timeoutMin, onLine }) {
  return new Promise((resolveRun, reject) => {
    const child = childProcess.spawn(binary, args, {
      cwd, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let processError;
    let timedOut = false;
    let partial = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
      const lines = (partial + chunk).split('\n');
      partial = lines.pop();
      for (const line of lines) onLine(line);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { processError = error; });
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') processError = error;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killProcess(child);
    }, timeoutMin * MS_PER_MINUTE);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (partial) onLine(partial);
      resolveRun({ stdout, stderr, code, signal, timedOut, processError });
    });
    try {
      child.stdin.end(input);
    } catch (error) {
      clearTimeout(timer);
      killProcess(child);
      reject(error);
    }
  });
}

async function prepareCall(agent, prompt, options, engine) {
  const directory = await mkdtemp(join(options.cwd, engine.tempDirPrefix));
  try {
    const outputFile = join(directory, 'response.md');
    let argumentPrompt = prompt;
    if (agent.cli === 'agy' && agy.requiresBriefFile(prompt, engine.agyPromptMaxBytes)) {
      const briefFile = join(directory, 'brief.md');
      await writeFile(briefFile, prompt, { mode: 0o600 });
      argumentPrompt = `Lis le fichier ${JSON.stringify(briefFile)} et suis ses instructions.`;
    }
    const args = adapters[agent.cli].buildArgs({ ...agent, ...options, prompt: argumentPrompt, outputFile });
    return { directory, outputFile, args, input: agent.cli === 'agy' ? undefined : prompt };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function collectResult(agent, call, execution) {
  let outputText = '';
  let fileError;
  if (agent.cli === 'codex') {
    try {
      outputText = await readFile(call.outputFile, 'utf8');
    } catch (error) {
      fileError = error;
    }
  }
  const result = adapters[agent.cli].parseResult(execution.stdout, outputText);
  if (fileError && execution.code === 0 && !execution.timedOut) {
    throw Object.assign(new Error(`Réponse Codex indisponible : ${fileError.message}`), { result });
  }
  return result;
}

function executionError(execution) {
  if (execution.timedOut) return 'Délai maximal dépassé';
  if (execution.processError) return execution.processError.message;
  if (execution.code !== 0) {
    return `CLI terminé avec ${execution.signal ?? `le code ${execution.code}`} : ${execution.stderr.trim()}`;
  }
}

function configuredModel(name) {
  try { return getAgent(name).model; } catch { return null; }
}

function callEvents(name, { feature, role, mode, onEvent, journalRoot, callId, resumedFrom, onSession }) {
  let config;
  try { config = loadEventConfig(); } catch (error) {
    process.stderr.write(`Journal d’événements désactivé : ${error.message}\n`);
    return { sink: { emit() {} }, onLine(line, agent) {
      try { onSession(adapters[agent.cli].sessionIdFrom(JSON.parse(line))); } catch {}
    }, flush: async () => {} };
  }
  const sink = createEventSink({ callId, agent: name, model: configuredModel(name),
    feature: feature ?? null, role: role ?? null }, resolve(journalRoot, config.directory), config, onEvent);
  sink.emit({ kind: 'call_start', mode, resumedFrom });
  let quotaPending = Promise.resolve();
  function onLine(line, agent) {
    try {
      const raw = JSON.parse(line);
      onSession(adapters[agent.cli].sessionIdFrom(raw));
      for (const event of adapters[agent.cli].toEvents(raw, config)) sink.emit(event);
      if (agent.cli === 'claude' && raw?.type === 'rate_limit_event') {
        quotaPending = quotaPending.then(() => writeClaudeQuota(raw, undefined, journalRoot)).catch(() => {});
      }
    } catch { /* Les sorties de diagnostic ne sont pas des événements. */ }
  }
  return { sink, onLine, flush: () => Promise.all([sink.flush(), quotaPending]) };
}

export async function runAgent(name, prompt, { mode = 'write', cwd = process.cwd(), feature, role, onEvent, journalRoot = repositoryRoot(),
  resume, resumedFrom = null, callId = randomUUID(), usagePath } = {}) {
  const started = performance.now();
  const engine = loadEngineConfig();
  const workDir = resolve(cwd);
  const result = { callId, sessionId: null, agent: name, model: null, effort: null, mode, status: 'error',
    text: '', usage: emptyUsage(), durationMs: 0 };
  const events = callEvents(name, { feature, role, mode, onEvent, journalRoot, callId, resumedFrom,
    onSession(id) { if (id) result.sessionId = id; } });
  let call;
  let cumulativeUsage = false;
  let usageBaseline = emptyUsage();
  try {
    const agent = getAgent(name);
    Object.assign(result, { model: agent.model, effort: agent.effort });
    cumulativeUsage = engine.cumulativeUsageOnResume?.includes(agent.cli) ?? false;
    if (cumulativeUsage && resume && resumedFrom) {
      const parent = (await readUsage(resolve(journalRoot, usagePath ?? engine.usageLogPath)))
        .findLast((entry) => entry.callId === resumedFrom);
      usageBaseline = parent?.usageCumulative ?? parent?.usage ?? emptyUsage();
    }
    if (!['write', 'read'].includes(mode)) throw new Error(`Mode inconnu : ${mode}`);
    if (typeof prompt !== 'string') throw new Error('Le prompt doit être une chaîne de caractères');
    call = await prepareCall(agent, prompt, { mode, cwd: workDir, resume }, engine);
    const execution = await execute(engine[`${agent.cli}Bin`], call.args,
      { cwd: workDir, input: call.input, timeoutMin: agent.timeoutMin, onLine: (line) => events.onLine(line, agent) });
    result.status = execution.timedOut ? 'timeout' : 'error';
    let failure = executionError(execution);
    try {
      Object.assign(result, await collectResult(agent, call, execution));
    } catch (error) {
      Object.assign(result, error.result);
      if (!failure) throw error;
      failure = `${failure}; ${error.message}`;
    }
    // Un agent qui s'arrête sans rien répondre n'a pas fait son travail : ne pas le compter comme réussi.
    if (!failure && !result.text.trim()) failure = 'Réponse vide de l’agent';
    if (failure) result.error = failure;
    else result.status = 'ok';
  } catch (error) {
    Object.assign(result, error.result);
    result.error = error.message;
  } finally {
    if (call) {
      try {
        await rm(call.directory, { recursive: true, force: true });
      } catch (error) {
        result.status = result.status === 'timeout' ? 'timeout' : 'error';
        result.error = `${result.error ? `${result.error}; ` : ''}Nettoyage : ${error.message}`;
      }
    }
    if (cumulativeUsage) {
      result.usageCumulative = { ...result.usage };
      result.usage = subtractUsage(result.usageCumulative, usageBaseline);
    }
    result.durationMs = Math.round(performance.now() - started);
    events.sink.emit({ kind: 'call_end', sessionId: result.sessionId, status: result.status, usage: result.usage, durationMs: result.durationMs,
      ...(result.usageCumulative ? { usageCumulative: result.usageCumulative } : {}),
      ...(result.error ? { error: result.error } : {}) });
    await events.flush();
    // Le journal conserve les métadonnées, sans dupliquer les réponses des agents.
    const { text, ...entry } = result;
    await appendUsage({ ...entry, feature, role, resumedFrom, cwd: workDir }, resolve(journalRoot, usagePath ?? engine.usageLogPath));
  }
  return result;
}
