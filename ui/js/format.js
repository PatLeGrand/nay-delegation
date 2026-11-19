import { AGENT_COLORS, AGENT_FALLBACK_COLORS, ROLE_ALIASES } from './config.js';

const numberFormat = new Intl.NumberFormat('fr-FR');
const percentFormat = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });
const compactFormat = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export const formatPercent = (n) => percentFormat.format(n ?? 0);
export const formatInt = (n) => numberFormat.format(n ?? 0);
export const formatCompact = (n) => compactFormat.format(n ?? 0);

export function formatDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m) return `${m} min ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}

function parseDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTime(iso) {
  const date = iso ? parseDate(iso) : null;
  return date ? timeFormat.format(date) : '—';
}

export function formatDateTime(iso) {
  const date = iso ? parseDate(iso) : null;
  return date ? dateTimeFormat.format(date) : '—';
}

export const toMs = (iso) => (iso ? parseDate(iso)?.getTime() ?? null : null);

export function agentColor(agent) {
  if (AGENT_COLORS[agent]) return AGENT_COLORS[agent];
  let hash = 0;
  for (const char of String(agent)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AGENT_FALLBACK_COLORS[hash % AGENT_FALLBACK_COLORS.length];
}

export function normalizeRole(role) {
  const clean = String(role ?? '').trim().toLowerCase();
  return ROLE_ALIASES[clean] ?? clean;
}

export const orDash = (value) => (value === null || value === undefined || value === '' ? '—' : String(value));
