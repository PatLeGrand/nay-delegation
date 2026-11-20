// Points d'accès /api/models et /api/agents : catalogue des CLI et édition de config/agents.json.
import { formatAgents, rolesUsing, validateAgent, validateName } from '../agents.js';
import { readJson, writeAtomic } from './delegation.js';
import { httpError } from './paths.js';

const AGENTS = 'config/agents.json';

async function readAgents(root) {
  return readJson(root, AGENTS);
}

function usage(agents, delegation) {
  return Object.fromEntries(Object.keys(agents).map((name) => [name, rolesUsing(delegation, name)]));
}

export async function listAgents(root) {
  const agents = await readAgents(root);
  return { agents, roles: usage(agents, await readJson(root, 'config/delegation.json')) };
}

// Chaque modèle indique les agents qui l'utilisent déjà ; les autres sont « nouveaux » dans l'interface.
export async function readModels(root, catalog) {
  const [data, agents] = await Promise.all([catalog.get(), readAgents(root)]);
  const providers = Object.fromEntries(Object.entries(data.providers).map(([cli, provider]) => [cli, {
    ...provider,
    models: provider.models.map((entry) => ({ ...entry, usedBy: Object.entries(agents)
      .filter(([, agent]) => agent.cli === cli && agent.model === entry.model).map(([name]) => name) })),
  }]));
  return { fetchedAt: data.fetchedAt, refreshing: catalog.refreshing(), providers };
}

function agentFields(body) {
  const { name, ...agent } = body ?? {};
  return { name, agent };
}

function check(errors) {
  if (errors.length) throw httpError(400, 'Agent invalide', errors);
}

async function save(root, agents) {
  await writeAtomic(root, AGENTS, formatAgents(agents));
  return listAgents(root);
}

export async function addAgent(root, body, { catalog, config }) {
  const agents = await readAgents(root);
  const { name, agent } = agentFields(body);
  check([...validateName(name, agents),
    ...validateAgent(agent, { catalog: await catalog.get(), maxTimeoutMin: config.maxTimeoutMin })]);
  return { ok: true, name, ...await save(root, { ...agents, [name]: agent }) };
}

export async function updateAgent(root, name, body, { catalog, config }) {
  const agents = await readAgents(root);
  if (!Object.hasOwn(agents, name)) throw httpError(404, `Agent inconnu : ${name}`);
  const { name: renamed, agent } = agentFields(body);
  if (renamed !== undefined && renamed !== name) throw httpError(400, 'Renommer un agent n’est pas possible');
  check(validateAgent(agent, { catalog: await catalog.get(), previous: agents[name],
    maxTimeoutMin: config.maxTimeoutMin }));
  return { ok: true, name, ...await save(root, { ...agents, [name]: agent }) };
}

export async function deleteAgent(root, name) {
  const agents = await readAgents(root);
  if (!Object.hasOwn(agents, name)) throw httpError(404, `Agent inconnu : ${name}`);
  const roles = rolesUsing(await readJson(root, 'config/delegation.json'), name);
  if (roles.length) throw httpError(409, `${name} est encore utilisé dans la délégation`, roles);
  const { [name]: _removed, ...rest } = agents;
  return { ok: true, name, ...await save(root, rest) };
}
