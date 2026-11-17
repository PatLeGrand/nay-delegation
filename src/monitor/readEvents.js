import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

// Fichier du jour uniquement : les fichiers de rotation (AAAA-MM-JJ.1.jsonl) sont exclus.
const DAILY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

function parseLine(line) {
  try {
    const event = JSON.parse(line);
    return event !== null && typeof event === 'object' && !Array.isArray(event) ? [event] : [];
  } catch {
    return [];
  }
}

// Lecture en flux, ligne par ligne : seul l'accumulateur reste en mémoire, jamais le fichier entier.
export async function reduceEvents(path, reduce, initial) {
  const stream = createReadStream(path, { encoding: 'utf8' });
  try {
    await once(stream, 'open');
  } catch (error) {
    if (error.code === 'ENOENT') return initial;
    throw error;
  }
  let accumulator = initial;
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    for (const event of parseLine(line)) accumulator = reduce(accumulator, event);
  }
  return accumulator;
}

export async function latestEventsFile(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const latest = names.filter((name) => DAILY_FILE.test(name)).sort().at(-1);
  return latest ? join(dir, latest) : null;
}
