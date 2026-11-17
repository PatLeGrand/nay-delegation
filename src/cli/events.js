import { readConfig } from '../config.js';

export function toolDescriptor(id, name, parameters = {}, config = readConfig('events')) {
  const mapping = config.tools[name];
  let target = mapping?.targets.map((key) => parameters?.[key]).find((value) => value !== undefined) ?? null;
  if (Array.isArray(target)) target = target.map((change) => change.path ?? change).join(', ');
  if (typeof target !== 'string' && target !== null) target = JSON.stringify(target);
  return { id: id == null || id === 'undefined' ? null : id, name, kind: mapping?.kind ?? 'other', target };
}

export function jsonLines(stdout) {
  return stdout.split('\n').flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }).filter((value) => value && typeof value === 'object');
}

export function finalRecord(stdout, matches, legacy, label) {
  const records = jsonLines(stdout);
  const result = records.findLast(matches) ?? (records.length === 1 && legacy(records[0]) ? records[0] : undefined);
  if (result) return result;
  if (!records.length && stdout.trim()) throw new SyntaxError(`Sortie ${label} invalide`);
  throw new Error(`Réponse ${label} incomplète : aucun résultat final`);
}

export function outputText(value) {
  return typeof value === 'string' ? value : JSON.stringify(value ?? '');
}
