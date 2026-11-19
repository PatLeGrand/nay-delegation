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

export const putJson = (path, payload) => request(path, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

export const fetchUsage = ({ feature, since } = {}) => getJson(`${API.usage}${buildQuery({ feature, since })}`);
export const fetchQuota = () => getJson(API.quota);
export const fetchStatus = ({ feature } = {}) => getJson(`${API.status}${buildQuery({ feature })}`);
export const fetchFeatures = () => getJson(API.features);
export const fetchDelegation = () => getJson(API.delegation);
export const saveDelegation = (payload) => putJson(API.delegation, payload);
export const fetchCall = (callId) => getJson(API.call(callId));
export const resumeCall = (callId, message) => request(`${API.call(callId)}/resume`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message }),
});
