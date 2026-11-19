import { isSessionId } from '../session.js';
import { readConfig } from '../config.js';
import { finalRecord, toolDescriptor, outputText } from './events.js';
import { failResult } from './usage.js';

export function requiresBriefFile(prompt, maxBytes) {
  return prompt.startsWith('-') || Buffer.byteLength(prompt, 'utf8') > maxBytes;
}

// skipPermissions : en écriture seulement, et contrôlé en amont (worktree Git lié uniquement).
export function buildArgs({ model, effort, prompt, timeoutMin, mode = 'write', resume, skipPermissions = false }) {
  return ['-p', prompt, '--model', model.replaceAll('{effort}', effort),
    '--output-format', 'stream-json', '--print-timeout', `${timeoutMin}m`,
    '--mode', mode === 'write' ? 'accept-edits' : 'plan', ...(resume ? ['--conversation', resume] : []),
    ...(skipPermissions && mode === 'write' ? ['--dangerously-skip-permissions'] : [])];
}

export function parseResult(stdout) {
  const record = finalRecord(stdout, (event) => event.event === 'result', (event) => 'status' in event, 'agy');
  const data = record.event === 'result' ? record.result : record;
  const tokens = data.usage ?? {};
  const input = tokens.input_tokens ?? 0;
  const output = tokens.output_tokens ?? 0;
  const thinking = tokens.thinking_tokens ?? 0;
  const result = {
    text: data.response ?? '',
    usage: { input, cachedInput: tokens.cache_read_tokens ?? 0, output, thinking,
      total: tokens.total_tokens ?? input + output + thinking },
  };
  if (data.status !== 'SUCCESS') {
    failResult(`Échec agy (${data.status ?? 'statut absent'}) : ${data.error ?? result.text}`, result);
  }
  return result;
}

export function toEvents(rawEvent, config = readConfig('events')) {
  if (rawEvent?.event === 'result') return [{ kind: 'usage', usage: parseResult(JSON.stringify({ ...rawEvent, result: { ...rawEvent.result, status: 'SUCCESS' } })).usage }];
  if (rawEvent?.event !== 'step_update') return [];
  const step = rawEvent.step_update;
  if (!step) return [];
  const events = [];
  if (step.step_type === 'tool') {
    const info = step.tool_info ?? {};
    const tool = toolDescriptor(step.step_index == null ? null : String(step.step_index), step.tool_name ?? info.name, info.parameters, config);
    if (step.state === 'ACTIVE') events.push({ kind: 'tool_start', tool });
    if (['DONE', 'ERROR', 'FAILED'].includes(step.state)) {
      const exitCode = info.exit_code ?? step.exit_code;
      events.push({ kind: 'tool_end', tool,
        ok: step.state === 'DONE' && !info.is_error && !info.error && (exitCode == null || exitCode === 0),
        ...(exitCode != null ? { exitCode } : {}),
        ...(step.duration_seconds != null ? { durationMs: Math.round(step.duration_seconds * 1000) } : {}),
        output: outputText(info.output) });
    }
  }
  if (step.step_type === 'agent_response' && step.text_delta) events.push({ kind: 'message', text: step.text_delta });
  if (step.usage) {
    const result = parseResult(JSON.stringify({ status: 'SUCCESS', usage: step.usage }));
    events.push({ kind: 'usage', usage: result.usage });
  }
  return events;
}

export function sessionIdFrom(event) {
  const id = event?.event === 'init' ? event.conversation_id : undefined;
  return isSessionId(id) ? id : undefined;
}
