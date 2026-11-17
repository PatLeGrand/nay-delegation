export function isSessionId(id) {
  return typeof id === 'string' && id.length >= 1 && id.length <= 200
    && !id.startsWith('-') && !/[^A-Za-z0-9_.:-]/.test(id);
}
