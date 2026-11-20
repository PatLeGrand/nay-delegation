import { readdir } from 'node:fs/promises';
import { reduceEvents } from '../monitor/readEvents.js';
import { safePath } from './paths.js';

async function collectEvents(root, directory, collect) {
  const dir = await safePath(root, directory);
  let files;
  try { files = await readdir(dir); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const events = [];
  for (const name of files.filter((name) => /^\d{4}-\d{2}-\d{2}(?:\.[\w-]+)?\.jsonl$/.test(name)).sort()) {
    await reduceEvents(await safePath(root, `${directory}/${name}`), (result, event) => {
      collect(result, event);
      return result;
    }, events);
  }
  return events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

export async function readCall(root, directory, callId) {
  const events = await collectEvents(root, directory, (result, event) => {
    if (event.callId === callId) result.push(event);
  });
  return events.length ? { callId, events } : null;
}

export function readStoryChecks(root, directory) {
  return collectEvents(root, directory, (result, event) => {
    if (event.kind !== 'story_end' || (!event.checks && event.status !== 'CONTRÔLES')) return;
    const { ts, storyId, feature, project, branch, status, checks, checksBy } = event;
    result.push({ ts, storyId, feature, project, branch, status, checks, checksBy });
  });
}
