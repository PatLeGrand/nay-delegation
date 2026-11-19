// Formatage pur en français (sans dépendance DOM, testable sous Node).
import { AGENT_META, FALLBACK_COLORS, ROLE_ALIASES, ROLE_LABELS, DAY_MS, PERIODS } from './config.js';

const INT_FMT = new Intl.NumberFormat('fr-FR');
const DEC1_FMT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const USD_FMT = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function agentColor(name) {
  if (!name) return FALLBACK_COLORS[0];
  if (AGENT_META[name]) return AGENT_META[name].color;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

export function agentGlyph(name) {
  return AGENT_META[name]?.glyph ?? (name ? name[0].toUpperCase() : '•');
}

export function agentLabel(name) {
  return AGENT_META[name]?.label ?? (name || 'Inconnu');
}

export function normalizeRole(role) {
  if (!role) return null;
  const key = String(role).trim().toLowerCase();
  return ROLE_ALIASES[key] ?? role;
}

export function roleLabel(role) {
  const norm = normalizeRole(role);
  return ROLE_LABELS[norm] ?? norm ?? 'Sans rôle';
}

export function formatTokens(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${DEC1_FMT.format(n / 1_000_000)} M`;
  if (n >= 1_000) return `${DEC1_FMT.format(n / 1_000)} k`;
  return INT_FMT.format(Math.round(n));
}

export function formatInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? INT_FMT.format(Math.round(n)) : '0';
}

export function formatPct(ratio) {
  const n = Number(ratio);
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n * 100)} %`;
}

export function formatUsd(amount) {
  const n = Number(amount);
  return Number.isFinite(n) ? USD_FMT.format(n) : '—';
}

export function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return `${Math.round(n)} ms`;
  const sec = Math.round(n / 1000);
  if (sec < 60) return `${sec} s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return remSec ? `${min} min ${remSec} s` : `${min} min`;
  const h = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin ? `${h} h ${remMin} min` : `${h} h`;
}

export function formatTimeUtc(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toISOString().slice(11, 19);
}

export function formatShortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

export function formatRelative(iso, nowMs = Date.now()) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const diff = nowMs - t;
  if (diff < 0) return `dans ${formatDuration(-diff)}`;
  if (diff < 5000) return 'à l’instant';
  if (diff < 60_000) return `il y a ${Math.floor(diff / 1000)} s`;
  if (diff < 3_600_000) return `il y a ${Math.floor(diff / 60_000)} min`;
  if (diff < DAY_MS) return `il y a ${Math.floor(diff / 3_600_000)} h`;
  return `il y a ${Math.floor(diff / DAY_MS)} j`;
}

export function formatCountdown(iso, nowMs = Date.now()) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = t - nowMs;
  if (diff <= 0) return 'imminent';
  if (diff < 3_600_000) return `${Math.ceil(diff / 60_000)} min`;
  if (diff < DAY_MS) {
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    return m ? `${h} h ${m} m` : `${h} h`;
  }
  const d = Math.floor(diff / DAY_MS);
  const h = Math.floor((diff % DAY_MS) / 3_600_000);
  return h ? `${d} j ${h} h` : `${d} j`;
}

export function computeSinceIso(periodValue, nowMs = Date.now()) {
  const period = PERIODS.find((p) => p.value === periodValue);
  if (!period || period.days == null) return undefined;
  const now = new Date(nowMs);
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startMs = utcMidnight - (period.days - 1) * DAY_MS;
  return new Date(startMs).toISOString();
}

export function cacheRatio(input, cachedInput) {
  const inp = Number(input) || 0;
  const cached = Number(cachedInput) || 0;
  const denom = Math.max(inp, cached);
  if (denom <= 0) return 0;
  return Math.min(1, cached / (inp + cached > 0 && cached > inp ? inp + cached : Math.max(inp, 1)));
}

export function truncate(text, max = 100) {
  if (!text) return '';
  const str = String(text).trim();
  return str.length <= max ? str : `${str.slice(0, max - 1)}…`;
}
