export function emptyUsage() {
  return { input: 0, cachedInput: 0, output: 0, thinking: 0, total: 0 };
}

export function failResult(message, result) {
  throw Object.assign(new Error(message), { result });
}
