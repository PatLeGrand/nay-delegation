import { isSessionId } from './session.js';
import { resolve } from 'node:path';
import { loadEngineConfig, repositoryRoot } from './config.js';
import { readUsage } from './usageLog.js';
import { runAgent } from './runAgent.js';

export async function findResumableCall(callId, { journalRoot = repositoryRoot(),
  usagePath = loadEngineConfig().usageLogPath } = {}) {
  const entry = (await readUsage(resolve(journalRoot, usagePath))).findLast((call) => call.callId === callId);
  if (!entry) throw Object.assign(new Error(`Appel inconnu : ${callId}`), { status: 404 });
  if (!isSessionId(entry.sessionId)) throw Object.assign(new Error(`Appel sans session : ${callId}`), { status: 404 });
  return entry;
}

export async function resumeCall(callId, prompt, { execute = runAgent, ...options } = {}) {
  const entry = await findResumableCall(callId, options);
  return execute(entry.agent, prompt, { mode: entry.mode, feature: entry.feature, role: entry.role,
    cwd: options.cwd ?? entry.cwd, resume: entry.sessionId, resumedFrom: callId,
    ...(options.callId ? { callId: options.callId } : {}),
    ...(options.journalRoot ? { journalRoot: options.journalRoot } : {}),
    ...(options.usagePath !== undefined ? { usagePath: options.usagePath } : {}) });
}
