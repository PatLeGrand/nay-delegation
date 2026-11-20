import { randomUUID } from 'node:crypto';
import { findResumableCall, resumeCall } from '../resume.js';
import { createServer as httpServer } from 'node:http';
import { loadModelsConfig, readConfig, repositoryRoot } from '../config.js';
import { readUsage } from '../usageLog.js';
import { readQuotas, isAgentAvailable, quotaAgentConfig } from '../quota/index.js';
import { loadMonitorConfig } from '../monitor/config.js';
import { aggregateUsage } from './usage.js';
import { readStatus } from './status.js';
import { readCall, readStoryChecks } from './calls.js';
import { readFeatures } from './features.js';
import { readDelegation, readLayered, resetDelegation, writeDelegation } from './delegation.js';
import { addRole, deleteRole, updateRole } from './roles.js';
import { userConfigDir } from '../userConfig.js';
import { addAgent, deleteAgent, listAgents, readModels, updateAgent } from './agents.js';
import { createCatalog } from '../models/catalog.js';
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
  const { root, dataRoot, config, now, quotasReader, monitorConfig, usagePath, todayFile, catalog, userDir } = context;
  const feature = params.has('feature') ? params.get('feature') : undefined;
  if (pathname === '/api/usage') {
    const since = params.has('since') ? params.get('since') : undefined;
    if (since !== undefined && !Number.isFinite(Date.parse(since))) throw httpError(400, 'Date invalide');
    return aggregateUsage(await readUsage(await safePath(dataRoot, usagePath)),
      { feature, since, recent: config.recentCalls });
  }
  if (pathname === '/api/quota') {
    const [providers, agentsConfig] = await Promise.all([quotasReader(), context.agentsConfig()]);
    return { providers, agents: Object.entries(agentsConfig.agents).map(([name, agent]) =>
      ({ name, provider: agent.cli, ...isAgentAvailable(name, providers, agentsConfig) })) };
  }
  if (pathname === '/api/status') return readStatus(await todayFile(), monitorConfig, now(), feature);
  if (pathname.startsWith('/api/calls/')) {
    const call = await readCall(dataRoot, monitorConfig.eventsDir, pathname.slice('/api/calls/'.length));
    if (!call) throw httpError(404, 'Appel inconnu');
    return call;
  }
  if (pathname === '/api/story-checks') return readStoryChecks(dataRoot, monitorConfig.eventsDir);
  if (pathname === '/api/features') return readFeatures(root, config.featuresDir);
  if (pathname === '/api/delegation') return readDelegation(root, userDir);
  if (pathname === '/api/agents') return listAgents(root, userDir);
  if (pathname === '/api/models') return readModels(root, catalog, userDir);
  throw httpError(404, 'Route inconnue');
}

function checkWriteHeaders(request) {
  if (request.headers.origin !== `http://${request.headers.host}`
    || request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw httpError(403, 'Origine ou type de contenu interdit');
  }
}

// Les écritures de config passent une à une : la suppression d'un agent relit la délégation
// sans qu'un PUT /api/delegation simultané puisse s'intercaler.
function serialized(context, task) {
  const next = context.writes.then(task, task);
  context.writes = next.catch(() => {});
  return next;
}

async function writeApi(request, pathname, context) {
  const { root, config, catalog, modelsConfig, userDir } = context;
  const body = () => readBody(request, config.maxBodyBytes);
  const agentMatch = /^\/api\/agents\/([^/]+)$/.exec(pathname);
  const roleMatch = /^\/api\/roles\/([^/]+)$/.exec(pathname);
  const options = { catalog, config: modelsConfig };
  if (pathname === '/api/delegation' && request.method === 'PUT') {
    const delegation = await body();
    return [200, await serialized(context, () => writeDelegation(root, userDir, delegation))];
  }
  if (pathname === '/api/delegation/perso' && request.method === 'DELETE') {
    return [200, await serialized(context, () => resetDelegation(root, userDir))];
  }
  if (pathname === '/api/models/refresh' && request.method === 'POST') {
    await catalog.refresh();
    return [200, await readModels(root, catalog, userDir)];
  }
  if (pathname === '/api/agents' && request.method === 'POST') {
    const agent = await body();
    return [201, await serialized(context, () => addAgent(root, userDir, agent, options))];
  }
  if (agentMatch && request.method === 'PUT') {
    const agent = await body();
    return [200, await serialized(context, () => updateAgent(root, userDir, agentMatch[1], agent, options))];
  }
  if (agentMatch && request.method === 'DELETE') {
    return [200, await serialized(context, () => deleteAgent(root, userDir, agentMatch[1]))];
  }
  if (pathname === '/api/roles' && request.method === 'POST') {
    const role = await body();
    return [201, await serialized(context, () => addRole(root, userDir, role))];
  }
  if (roleMatch && request.method === 'PUT') {
    const role = await body();
    return [200, await serialized(context, () => updateRole(root, userDir, roleMatch[1], role))];
  }
  if (roleMatch && request.method === 'DELETE') {
    return [200, await serialized(context, () => deleteRole(root, userDir, roleMatch[1]))];
  }
  return null;
}

async function route(request, response, context) {
  const { root, config, todayFile, streams } = context;
  const pathname = requestPath(request);
  const params = new URL(request.url, `http://${request.headers.host}`).searchParams;
  if (request.method !== 'GET' && pathname.startsWith('/api/') && !pathname.endsWith('/resume')) {
    checkWriteHeaders(request);
    const result = await writeApi(request, pathname, context);
    if (result) return json(response, ...result);
    throw httpError(405, 'Méthode interdite');
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
  dataRoot = root, userDir = userConfigDir(), resumer = resumeCall, quotasReader = readQuotas, agentsConfig,
  monitorConfig = loadMonitorConfig(), usagePath = readConfig('engine').usageLogPath,
  modelsConfig = loadModelsConfig(), catalog = createCatalog({ root: dataRoot, config: modelsConfig }) } = {}) {
  if (config.host !== '127.0.0.1') throw new Error('Le serveur doit écouter sur 127.0.0.1');
  const todayFile = () => safePath(dataRoot,
    `${monitorConfig.eventsDir}/${new Date(now()).toISOString().slice(0, 10)}.jsonl`);
  const streams = new Set();
  // Relu à chaque requête : un agent ajouté depuis l'interface apparaît sans redémarrage.
  const readAgentsConfig = agentsConfig ? async () => agentsConfig
    : async () => ({ ...quotaAgentConfig(), agents: (await readLayered(root, userDir, 'agents')).merged });
  const context = { root, userDir, dataRoot, config, now, quotasReader, agentsConfig: readAgentsConfig, monitorConfig,
    usagePath, todayFile, streams, resumer, resuming: new Set(), catalog, modelsConfig, writes: Promise.resolve() };
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
  server.catalog = catalog;
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
  // Catalogue relu à chaque démarrage, sans retarder l'ouverture de l'interface.
  server.catalog?.refresh().catch((error) => process.stderr.write(`Catalogue des modèles : ${error.message}\n`));
  return server;
}

async function startResume(resumedFrom, body, context) {
  if (typeof body?.message !== 'string' || !body.message.trim()) throw httpError(400, 'Message vide');
  const { dataRoot, usagePath, monitorConfig, resumer, resuming } = context;
  const options = { journalRoot: dataRoot, usagePath };
  // Verrou posé avant le premier await : deux requêtes simultanées sur le même appel ne
  // peuvent plus passer toutes les deux.
  const callKey = `appel:${resumedFrom}`;
  if (resuming.has(callKey)) throw httpError(409, 'Reprise de cette session déjà en cours');
  resuming.add(callKey);
  let sessionKey;
  try {
    const entry = await findResumableCall(resumedFrom, options);
    const call = await readCall(dataRoot, monitorConfig.eventsDir, resumedFrom);
    if (!call?.events.some((event) => event.kind === 'call_end')) throw httpError(409, 'Appel non terminé');
    if (resuming.has(entry.sessionId)) throw httpError(409, 'Reprise de cette session déjà en cours');
    sessionKey = entry.sessionId;
    resuming.add(sessionKey);
  } finally {
    if (!sessionKey) resuming.delete(callKey);
  }
  const callId = randomUUID();
  Promise.resolve().then(() => resumer(resumedFrom, body.message, { ...options, callId }))
    .catch((error) => process.stderr.write(`Reprise ${resumedFrom} échouée : ${error.message}\n`))
    .finally(() => { resuming.delete(sessionKey); resuming.delete(callKey); });
  return { callId, resumedFrom };
}
