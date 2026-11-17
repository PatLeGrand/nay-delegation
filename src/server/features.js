import { readdir, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { safePath } from './paths.js';

function field(text, label) {
  const line = text.split('\n').find((value) => new RegExp(`^\\s*-?\\s*(?:\\*\\*)?${label}\\s*:`, 'i').test(value));
  return line?.replace(/^.*?:\s*(?:\*\*)?\s*/, '').trim() || null;
}

function section(text, name) {
  return text.match(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'))?.[1].trim() || null;
}

export function parseFeature(text, name) {
  const reviewer = section(text, 'Reviewer');
  const tests = section(text, 'Tests') ?? '';
  const final = section(text, 'Décision finale')?.replace(/^[-\s]+/, '') || null;
  const verdicts = [...(reviewer ?? '').matchAll(/APPROUVÉ|À CORRIGER/gu)].map((match) => match[0]);
  const lastVerdict = verdicts.at(-1) ?? null;
  const decision = field(tests, 'Ma décision');
  // Seule la mention écrite par l'orchestrateur à la fusion compte, pas « non fusionné ».
  const merged = /^Fusionné dans `?main`?/u.test(final ?? '');
  const waitingForUser = !merged && lastVerdict === 'APPROUVÉ'
    && (!decision || /^en attente\b/iu.test(decision));
  return {
    name, title: text.match(/^# Fonctionnalité\s*:\s*(.+)$/m)?.[1].trim() ?? null,
    branch: field(text, 'Branche'), task: field(text, 'Tâche'),
    developer: section(text, 'Développeur'), reviewer, verdicts, lastVerdict,
    tests: field(tests, 'Tests unitaires'), decision, final,
    state: merged ? 'fusionnee' : waitingForUser ? 'attend_decision' : reviewer ? 'en_relecture' : 'en_cours',
    waitingForUser,
  };
}

export async function readFeatures(root, directory) {
  const dir = await safePath(root, directory);
  let names;
  try { names = await readdir(dir); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return Promise.all(names.filter((name) => name.endsWith('.md')).sort().map(async (name) =>
    parseFeature(await readFile(await safePath(root, `${directory}/${name}`), 'utf8'), basename(name, '.md'))));
}
