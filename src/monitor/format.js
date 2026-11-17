const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const MINUTES_PAD = 2;

export function formatDuration(ms) {
  const safeMs = Math.max(0, ms);
  if (safeMs < MINUTE_MS) return `${Math.floor(safeMs / SECOND_MS)} s`;
  if (safeMs < HOUR_MS) return `${Math.floor(safeMs / MINUTE_MS)} min`;
  const minutes = String(Math.floor((safeMs % HOUR_MS) / MINUTE_MS)).padStart(MINUTES_PAD, '0');
  return `${Math.floor(safeMs / HOUR_MS)} h ${minutes}`;
}

// Une commande peut contenir des retours à la ligne : on les aplatit pour tenir sur une ligne.
export function shorten(text, maxChars) {
  if (maxChars <= 0) return '';
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > maxChars ? `${flat.slice(0, maxChars - 1)}…` : flat;
}
