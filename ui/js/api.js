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
    throw new ApiError('Serveur injoignable.', { unreachable: true });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(body?.error ?? `Erreur ${response.status}`, { status: response.status, errors: body?.errors ?? [] });
  }
  if (body === null) throw new ApiError('Réponse invalide du serveur.', { status: response.status });
  return body;
}

export const getJson = (path) => request(path);

export const putJson = (path, payload) =>
  request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const fetchCall = (callId) => getJson(API.call(callId));

export const resumeCall = (callId, message) => request(`${API.call(callId)}/resume`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message }),
});
