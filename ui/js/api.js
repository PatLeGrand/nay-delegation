// Client HTTP minimal pour l'API locale de Nay.
import { API } from './config.js';

export class ApiError extends Error {
  constructor(message, { status = 0, errors = [], unreachable = false } = {}) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.unreachable = unreachable;
  }
}

async function request(path, init) {
  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('Serveur Nay injoignable.', { unreachable: true });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(body?.error ?? `Erreur HTTP ${response.status}`, {
      status: response.status,
      errors: body?.errors ?? [],
    });
  }
  if (body === null) throw new ApiError('Réponse JSON invalide du serveur.', { status: response.status });
  return body;
}

export function buildQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value != null && value !== '') search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

export const getJson = (path) => request(path);

// Le serveur exige Content-Type JSON sur toute écriture, même sans corps (protection CSRF).
export const sendJson = (method, path, payload) => request(path, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: payload === undefined ? undefined : JSON.stringify(payload),
});

export const putJson = (path, payload) => sendJson('PUT', path, payload);

export const fetchUsage = ({ feature, project, since } = {}) => getJson(`${API.usage}${buildQuery({ feature, project, since })}`);
export const fetchQuota = () => getJson(API.quota);
export const fetchStatus = ({ feature, project } = {}) => getJson(`${API.status}${buildQuery({ feature, project })}`);
export const fetchProjects = () => getJson(API.projects);
export const fetchFeatures = () => getJson(API.features);
export const fetchDelegation = () => getJson(API.delegation);
export const saveDelegation = (payload) => putJson(API.delegation, payload);
export const fetchCall = (callId) => getJson(API.call(callId));
export const resumeCall = (callId, message) => request(`${API.call(callId)}/resume`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message }),
});
export const fetchModels = () => getJson(API.models);
export const refreshModels = () => sendJson('POST', API.modelsRefresh);
export const fetchAgents = () => getJson(API.agents);
export const createAgent = (agent) => sendJson('POST', API.agents, agent);
export const updateAgent = (name, agent) => sendJson('PUT', API.agent(name), agent);
export const deleteAgent = (name) => sendJson('DELETE', API.agent(name));
export const resetDelegation = () => sendJson('DELETE', API.delegationPerso);
export const createRole = (role) => sendJson('POST', API.roles, role);
export const updateRole = (id, role) => sendJson('PUT', API.role(id), role);
export const deleteRole = (id) => sendJson('DELETE', API.role(id));
export const fetchProjectRoles = (project) => getJson(`${API.projectRoles}${buildQuery({ project })}`);
export const setProjectRoleUsage = (project, id, rule) =>
  putJson(`${API.projectRole(id)}${buildQuery({ project })}`, rule);
