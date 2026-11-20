// Points d'accès /api/models et /api/agents : catalogue des CLI et agents du dev.
// Les ajouts et modifications vont dans sa config perso ; config/agents.json n'est pas modifié.
import { rolesUsing, validateAgent, validateName } from '../agents.js';
import { readLayered, savePersonal } from './delegation.js';
import { httpError } from './paths.js';

async function readAgents(root, userDir) {
  return (await readLayered(root, userDir, 'agents')).merged;
}

function sources({ repo, personal }) {
  return Object.fromEntries(Object.keys({ ...repo, ...personal }).map((name) => [name,
    !Object.hasOwn(personal, name) ? 'depot' : Object.hasOwn(repo, name) ? 'modifie' : 'perso']));
}

function usage(agents, delegation) {
  return Object.fromEntries(Object.keys(agents).map((name) => [name, rolesUsing(delegation, name)]));
}

export async function listAgents(root, userDir) {
  const layers = await readLayered(root, userDir, 'agents');
  const delegation = (await readLayered(root, userDir, 'delegation')).merged;
  return { agents: layers.merged, roles: usage(layers.merged, delegation), sources: sources(layers) };
}

// Chaque modèle indique les agents qui l'utilisent déjà ; les autres sont « nouveaux » dans l'interface.
export async function readModels(root, catalog, userDir) {
  const [data, agents] = await Promise.all([catalog.get(), readAgents(root, userDir)]);
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

async function save(root, userDir, name, agent) {
  const { personal } = await readLayered(root, userDir, 'agents');
  savePersonal(userDir, 'agents', { ...personal, [name]: agent });
  return listAgents(root, userDir);
}

export async function addAgent(root, userDir, body, { catalog, config }) {
  const agents = await readAgents(root, userDir);
  const { name, agent } = agentFields(body);
  check([...validateName(name, agents),
    ...validateAgent(agent, { catalog: await catalog.get(), maxTimeoutMin: config.maxTimeoutMin })]);
  return { ok: true, name, ...await save(root, userDir, name, agent) };
}

export async function updateAgent(root, userDir, name, body, { catalog, config }) {
  const agents = await readAgents(root, userDir);
  if (!Object.hasOwn(agents, name)) throw httpError(404, `Agent inconnu : ${name}`);
  const { name: renamed, agent } = agentFields(body);
  if (renamed !== undefined && renamed !== name) throw httpError(400, 'Renommer un agent n’est pas possible');
  check(validateAgent(agent, { catalog: await catalog.get(), previous: agents[name],
    maxTimeoutMin: config.maxTimeoutMin }));
  return { ok: true, name, ...await save(root, userDir, name, agent) };
}

// Seuls les agents perso se suppriment ; un agent du dépôt modifié revient à sa version d'origine.
export async function deleteAgent(root, userDir, name) {
  const { repo, personal } = await readLayered(root, userDir, 'agents');
  if (!Object.hasOwn(personal, name)) {
    if (Object.hasOwn(repo, name)) {
      throw httpError(409, `${name} vient du dépôt : retire-le plutôt de ta délégation (Aiguillage)`);
    }
    throw httpError(404, `Agent inconnu : ${name}`);
  }
  if (!Object.hasOwn(repo, name)) {
    const roles = rolesUsing((await readLayered(root, userDir, 'delegation')).merged, name);
    if (roles.length) throw httpError(409, `${name} est encore utilisé dans la délégation`, roles);
  }
  const { [name]: _removed, ...rest } = personal;
  savePersonal(userDir, 'agents', rest);
  return { ok: true, name, ...await listAgents(root, userDir) };
}
