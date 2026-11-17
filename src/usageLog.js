import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function appendUsage(entry, path) {
  await mkdir(dirname(path), { recursive: true });
  const record = { ...entry, feature: entry.feature ?? null, role: entry.role ?? null,
    timestamp: new Date().toISOString() };
  await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
}

export async function readUsage(path) {
  let contents;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return contents.split('\n').flatMap((line) => {
    try {
      const entry = JSON.parse(line);
      return entry && typeof entry === 'object' && !Array.isArray(entry) ? [entry] : [];
    } catch {
      return [];
    }
  });
}
