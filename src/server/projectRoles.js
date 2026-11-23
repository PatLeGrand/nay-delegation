// Points d'accès /api/project-roles : rôles importés des sous-agents `.claude/agents` d'un projet.
// Le projet est désigné par son nom (celui du filtre de l'interface) : le serveur retrouve son
// checkout principal dans le journal de consommation, jamais à partir d'un chemin envoyé.
import { loadProjectConfig } from '../config.js';
import { locateProject, PATH_USAGE, readProjectRoles, saveProjectUsage, withRoleChains } from '../projectRoles.js';
import { USAGES, validateRoleId } from '../roles.js';
import { readUsage } from '../usageLog.js';
import { readLayered } from './delegation.js';
import { safePath, httpError } from './paths.js';
import { usageProject } from './usage.js';

// Dernier dossier de travail connu du projet, ramené à son checkout principal.
async function projectCwd(context, name) {
  const entries = await readUsage(await safePath(context.dataRoot, context.usagePath));
  const config = loadProjectConfig();
  const entry = entries.filter((one) => one.cwd && usageProject(one, config) === name)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
  if (!entry) return null;
  return locateProject(entry.cwd)?.root ?? null;
}

export async function readProjectRolesApi(context, name) {
  const { root, userDir } = context;
  const empty = { project: null, roles: {}, chains: {}, errors: [], masked: [], usages: USAGES };
  if (!name) return empty;
  const cwd = await projectCwd(context, name);
  if (!cwd) return { ...empty, project: { name, root: null } };
  const [roles, agents, delegation] = await Promise.all(['roles', 'agents', 'delegation']
    .map((layer) => readLayered(root, userDir, layer)));
  const report = readProjectRoles(cwd, { validateId: validateRoleId, usages: USAGES,
    agentNames: Object.keys(agents.merged) });
  const chains = withRoleChains(delegation.merged, report.roles);
  return {
    project: { name, root: report.project?.root ?? cwd },
    roles: report.roles,
    chains: Object.fromEntries(Object.keys(report.roles).map((id) => [id, chains[id]])),
    errors: report.errors,
    masked: Object.keys(report.roles).filter((id) => Object.hasOwn(roles.merged, id)),
    usages: USAGES,
  };
}

// La règle va dans `.nay/roles.json` du projet, comme `nay usage`.
export async function setProjectRoleUsage(context, name, id, body) {
  const current = await readProjectRolesApi(context, name);
  if (!current.project?.root) throw httpError(404, `Projet inconnu : ${name}`);
  if (!Object.hasOwn(current.roles, id)) throw httpError(404, `Rôle de projet inconnu : ${id}`);
  const usage = body?.usage ?? null;
  const paths = body?.paths;
  if (usage !== null && !Object.hasOwn(USAGES, usage)) throw httpError(400, 'Règle d’usage invalide');
  if (paths !== undefined && (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string' && path.trim()))) {
    throw httpError(400, 'paths : liste de motifs');
  }
  if (usage === PATH_USAGE && !(paths?.length || current.roles[id].paths?.length)) {
    throw httpError(400, `${PATH_USAGE} : ajoute d’abord des motifs de chemin`,
      [`nay usage ${id} ${PATH_USAGE} "<motif>" --cwd <projet>`]);
  }
  try {
    saveProjectUsage(current.project.root, id, usage, paths);
  } catch (error) {
    throw httpError(500, `Réglage non enregistré : ${error.message}`);
  }
  return { ok: true, id, ...await readProjectRolesApi(context, name) };
}
