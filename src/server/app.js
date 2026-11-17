import { randomUUID } from 'node:crypto';
import { findResumableCall, resumeCall } from '../resume.js';
import { createServer as httpServer } from 'node:http';
import { readConfig, repositoryRoot } from '../config.js';
import { readUsage } from '../usageLog.js';
import { readQuotas, isAgentAvailable, quotaAgentConfig } from '../quota/index.js';
import { loadMonitorConfig } from '../monitor/config.js';
import { aggregateUsage } from './usage.js';
import { readStatus } from './status.js';
import { readCall } from './calls.js';
import { readFeatures } from './features.js';
import { readDelegation, writeDelegation } from './delegation.js';
import { serveStatic } from './static.js';
import { startStream } from './stream.js';
import { safePath, httpError } from './paths.js';

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  if (Number(request.headers['content-length']) > limit) throw httpError(413, 'Corps trop volumineux');
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) throw httpError(413, 'Corps trop volumineux');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw httpError(400, 'JSON invalide'); }
}

function requestPath(request) {
  let pathname;
  try { pathname = decodeURIComponent(request.url.split('?')[0]); }
  catch { throw httpError(400, 'Chemin invalide'); }
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0')
    || pathname.split('/').includes('..')) throw httpError(403, 'Chemin interdit');
  return pathname;
}

async function readApi(pathname, params, context) {
  const { root, dataRoot, config, now, quotasReader, agentsConfig, monitorConfig, usagePath, todayFile } = context;
  const feature = params.has('feature') ? params.get('feature') : undefined;
  if (pathname === '/api/usage') {
    const since = params.has('since') ? params.get('since') : undefined;
    if (since !== undefined && !Number.isFinite(Date.parse(since))) throw httpError(400, 'Date invalide');
    return aggregateUsage(await readUsage(await safePath(dataRoot, usagePath)),
      { feature, since, recent: config.recentCalls });
  }
  if (pathname === '/api/quota') {
    const providers = await quotasReader();
    return { providers, agents: Object.entries(agentsConfig.agents).map(([name, agent]) =>
      ({ name, provider: agent.cli, ...isAgentAvailable(name, providers, agentsConfig) })) };
  }
  if (pathname === '/api/status') return readStatus(await todayFile(), monitorConfig, now(), feature);
  if (pathname.startsWith('/api/calls/')) {
    const call = await readCall(dataRoot, monitorConfig.eventsDir, pathname.slice('/api/calls/'.length));
    if (!call) throw httpError(404, 'Appel inconnu');
    return call;
  }
  if (pathname === '/api/features') return readFeatures(root, config.featuresDir);
  if (pathname === '/api/delegation') return readDelegation(root);
  throw httpError(404, 'Route inconnue');
}

function checkWriteHeaders(request) {
  if (request.headers.origin !== `http://${request.headers.host}`
    || request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw httpError(403, 'Origine ou type de contenu interdit');
  }
}

async function route(request, response, context) {
  const { root, config, todayFile, streams } = context;
  const pathname = requestPath(request);
  const params = new URL(request.url, `http://${request.headers.host}`).searchParams;
  if (pathname === '/api/delegation' && request.method === 'PUT') {
    checkWriteHeaders(request);
    return json(response, 200, await writeDelegation(root, await readBody(request, config.maxBodyBytes)));
  }
  const resumeMatch = /^\/api\/calls\/([^/]+)\/resume$/.exec(pathname);
  if (resumeMatch && request.method === 'POST') {
    checkWriteHeaders(request);
    const body = await readBody(request, config.maxBodyBytes);
    return json(response, 202, await startResume(resumeMatch[1], body, context));
  }
  if (request.method !== 'GET') throw httpError(405, 'Méthode interdite');
  if (pathname === '/api/events/stream') {
    streams.add(response);
    response.on('close', () => streams.delete(response));
    const feature = params.has('feature') ? params.get('feature') : undefined;
    return startStream(request, response, { fileForToday: todayFile, config, feature });
  }
  if (pathname.startsWith('/api/')) return json(response, 200, await readApi(pathname, params, context));
  return serveStatic(root, config.uiDir, pathname, response);
}

export function createServer({ root = repositoryRoot(), config = readConfig('ui'), now = Date.now,
  dataRoot = root, resumer = resumeCall, quotasReader = readQuotas, agentsConfig = quotaAgentConfig(),
  monitorConfig = loadMonitorConfig(), usagePath = readConfig('engine').usageLogPath } = {}) {
  if (config.host !== '127.0.0.1') throw new Error('Le serveur doit écouter sur 127.0.0.1');
  const todayFile = () => safePath(dataRoot,
    `${monitorConfig.eventsDir}/${new Date(now()).toISOString().slice(0, 10)}.jsonl`);
  const streams = new Set();
  const context = { root, dataRoot, config, now, quotasReader, agentsConfig, monitorConfig, usagePath, todayFile, streams, resumer, resuming: new Set() };
  const server = httpServer(async (request, response) => {
    try {
      const port = server.address()?.port;
      if (![`${config.host}:${port}`, `localhost:${port}`].includes(request.headers.host)) {
        throw httpError(403, 'Hôte interdit');
      }
      await route(request, response, context);
    } catch (error) {
      if (response.headersSent) return response.destroy();
      json(response, error.status ?? 500, { error: error.status ? error.message : 'Erreur interne du serveur',
        ...(error.errors ? { errors: error.errors } : {}) });
      request.resume();
    }
  });
  const close = server.close.bind(server);
  server.close = (callback) => { for (const response of streams) response.destroy(); return close(callback); };
  return server;
}

export async function startServer({ root, output = process.stdout, ...options } = {}) {
  const config = options.config ?? readConfig('ui');
  const server = createServer({ root, ...options, config });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => { server.off('error', reject); resolve(); });
  });
  output.write(`Interface Nay : http://${config.host}:${server.address().port}\n`);
  return server;
}

async function startResume(resumedFrom, body, context) {
  if (typeof body?.message !== 'string' || !body.message.trim()) throw httpError(400, 'Message vide');
  const { dataRoot, usagePath, monitorConfig, resumer, resuming } = context;
  const options = { journalRoot: dataRoot, usagePath };
  const entry = await findResumableCall(resumedFrom, options);
  const call = await readCall(dataRoot, monitorConfig.eventsDir, resumedFrom);
  if (!call?.events.some((event) => event.kind === 'call_end')) throw httpError(409, 'Appel non terminé');
  const sessionKey = entry.sessionId;
  if (resuming.has(sessionKey)) throw httpError(409, 'Reprise de cette session déjà en cours');
  resuming.add(sessionKey);
  const callId = randomUUID();
  Promise.resolve().then(() => resumer(resumedFrom, body.message, { ...options, callId }))
    .catch(() => {})
    .finally(() => resuming.delete(sessionKey));
  return { callId, resumedFrom };
}
