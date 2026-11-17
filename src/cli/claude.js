import { isSessionId } from '../session.js';
import { readConfig } from '../config.js';
import { finalRecord, toolDescriptor, outputText } from './events.js';
import { failResult } from './usage.js';

export function buildArgs({ model, effort, mode = 'write', resume }) {
  return ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--effort', effort,
    '--permission-mode', mode === 'write' ? 'acceptEdits' : 'plan', ...(resume ? ['--resume', resume] : [])];
}

export function parseResult(stdout) {
  const data = finalRecord(stdout, (event) => event.type === 'result', (event) => 'result' in event || 'is_error' in event, 'Claude');
  const tokens = data.usage ?? {};
  const cachedInput = tokens.cache_read_input_tokens ?? 0;
  const input = (tokens.input_tokens ?? 0) + cachedInput + (tokens.cache_creation_input_tokens ?? 0);
  const output = tokens.output_tokens ?? 0;
  const result = { text: data.result ?? '',
    usage: { input, cachedInput, output, thinking: 0, total: input + output } };
  if (data.is_error) failResult(`Échec Claude : ${data.result || (data.errors ?? []).join('; ')}`, result);
  return result;
}

export function toEvents(rawEvent, config = readConfig('events')) {
  if (rawEvent?.type === 'result') {
    const data = { ...rawEvent, is_error: false };
    return [{ kind: 'usage', usage: parseResult(JSON.stringify(data)).usage }];
  }
  if (!['assistant', 'user'].includes(rawEvent?.type)) return [];
  const content = rawEvent.message?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (block.type === 'tool_use') return [{ kind: 'tool_start', tool: toolDescriptor(block.id, block.name, block.input, config) }];
    if (block.type === 'tool_result') return [{ kind: 'tool_end',
      tool: toolDescriptor(block.tool_use_id, 'unknown', {}, config), ok: !block.is_error, output: outputText(block.content) }];
    if (rawEvent.type === 'assistant' && block.type === 'text') return [{ kind: 'message', text: block.text }];
    return [];
  });
}

export function sessionIdFrom(event) {
  const id = event?.type === 'result' || (event?.type === 'system' && event.subtype === 'init') ? event.session_id : undefined;
  return isSessionId(id) ? id : undefined;
}
