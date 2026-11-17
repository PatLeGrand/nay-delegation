import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { safePath, httpError } from './paths.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

export async function serveStatic(root, directory, pathname, response) {
  const dir = await safePath(root, directory);
  const file = await safePath(dir, pathname === '/' ? 'index.html' : pathname.slice(1));
  let body;
  try { body = await readFile(file); } catch (error) {
    if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) throw httpError(404, 'Fichier inconnu');
    throw error;
  }
  response.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff' });
  response.end(body);
}
