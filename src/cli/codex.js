import { readConfig } from '../config.js';
import { toolDescriptor } from './events.js';
import { emptyUsage, failResult } from './usage.js';

export function buildArgs({ model, effort, mode = 'write', cwd, outputFile }) {
  return ['exec', '--json', '--skip-git-repo-check', '-C', cwd, '-m', model,
    '-c', `model_reasoning_effort=${effort}`, '-s',
    mode === 'write' ? 'workspace-write' : 'read-only', '-o', outputFile, '-'];
}

export function parseResult(stdout, outputText = '') {
  const usage = emptyUsage();
  let failure;
  let completed = false;
  for (const line of stdout.split('\n').filter((line) => line.trim())) {
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      usage.total = usage.input + usage.output;
      throw Object.assign(error, { result: { text: outputText, usage } });
    }
    if (event.type === 'turn.failed' || event.type === 'error') {
      failure = event.error?.message || event.message || 'Échec Codex';
    }
    if (event.type !== 'turn.completed') continue;
    completed = true;
    const tokens = event.usage ?? {};
    usage.input += tokens.input_tokens ?? 0;
    usage.cachedInput += tokens.cached_input_tokens ?? 0;
    usage.output += tokens.output_tokens ?? 0;
    usage.thinking += tokens.reasoning_output_tokens ?? 0;
  }
  // Le cache est inclus dans input, et la réflexion dans output chez Codex.
  usage.total = usage.input + usage.output;
  const result = { text: outputText, usage };
  if (failure) failResult(failure, result);
  if (!completed) failResult('Réponse Codex incomplète : aucun événement turn.completed reçu', result);
  return result;
}

export function toEvents(rawEvent, config = readConfig('events')) {
  if (rawEvent?.type === 'turn.completed') {
    return [{ kind: 'usage', usage: parseResult(JSON.stringify(rawEvent)).usage }];
  }
  const item = rawEvent?.item;
  if (!item) return [];
  if (item.type === 'agent_message' && rawEvent.type === 'item.completed') return [{ kind: 'message', text: item.text }];
  if (!Object.hasOwn(config.tools, item.type) || !['item.started', 'item.completed'].includes(rawEvent.type)) return [];
  const tool = toolDescriptor(item.id, item.type, item, config);
  if (rawEvent.type === 'item.started') return [{ kind: 'tool_start', tool }];
  return [{ kind: 'tool_end', tool, ok: item.status !== 'failed' && (item.exit_code == null || item.exit_code === 0),
    ...(item.exit_code != null ? { exitCode: item.exit_code } : {}), output: item.aggregated_output ?? '' }];
}
