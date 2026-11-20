// Logique pure de l'Observatoire : géométrie orbitale, relais de stories, spectre 14 jours,
// simulateur d'aiguillage et estimation de budget (testable sous Node).
import {
  AGENT_META, PROVIDER_ORBITS, HISTOGRAM_DAYS, DAY_MS,
  MOCK_PRICING_PER_M, MOCK_DAILY_BUDGET_USD, NO_FEATURE_LABEL, SCRATCH_PROJECT_LABEL,
} from './config.js';
import { agentColor, agentGlyph, agentLabel, normalizeRole } from './format.js';

export function projectOptions(projects) {
  const options = [{ value: '', label: 'Tous les projets' }];
  for (const { name } of projects) {
    if (name) options.push({ value: name, label: name });
  }
  if (projects.some(({ name, calls }) => name === null && calls > 0)) {
    options.push({ value: '-', label: SCRATCH_PROJECT_LABEL });
  }
  return options;
}

export function filterByProject(items, project) {
  return project ? items.filter((item) => project === '-' ? item.project == null : item.project === project) : items;
}

export function featureNames({ project, projects, allFeaturesList, storyChecks, features, usage, status }) {
  const names = [
    ...allFeaturesList,
    ...projects.filter(({ name }) => !project || (name ?? '-') === project).flatMap((entry) => entry.features),
    ...storyChecks.map((story) => story.feature),
    ...features.map((entry) => entry.name),
    ...(usage?.byFeature ?? []).map((row) => row.key),
    ...(status?.calls ?? []).map((call) => call.feature),
  ];
  return [...new Set(names.filter(Boolean))].sort();
}

/**
 * Construit le modèle complet du Planétarium Orbital (Orrery).
 * Regroupe les agents par fournisseur, calcule leur position angulaire, taille proportionnelle
 * aux jetons, taux de réussite, statut temps réel, alertes et arcs de quota.
 */
export function buildOrreryModel({ quota, usage, status, delegation }) {
  const agentNames = new Set([
    ...(quota?.agents ?? []).map((a) => a.name),
    ...(usage?.byAgent ?? []).map((a) => a.key).filter(Boolean),
    ...(status?.calls ?? []).map((c) => c.agent).filter(Boolean),
    ...(delegation?.agents ?? []),
  ]);

  const usageByAgent = new Map((usage?.byAgent ?? []).map((row) => [row.key, row]));
  const reliabilityByAgent = new Map((usage?.reliability ?? []).map((row) => [row.key, row]));
  const quotaByAgent = new Map((quota?.agents ?? []).map((row) => [row.name, row]));

  const callsByAgent = new Map();
  for (const call of status?.calls ?? []) {
    if (!call.agent) continue;
    if (!callsByAgent.has(call.agent)) callsByAgent.set(call.agent, []);
    callsByAgent.get(call.agent).push(call);
  }

  const alertsByAgent = new Map();
  for (const alert of status?.alerts ?? []) {
    if (!alert.agent) continue;
    if (!alertsByAgent.has(alert.agent)) alertsByAgent.set(alert.agent, []);
    alertsByAgent.get(alert.agent).push(alert);
  }

  const maxTokens = Math.max(
    1,
    ...[...usageByAgent.values()].map((u) => (u.input ?? 0) + (u.output ?? 0)),
  );

  // Répartition des agents sur les 3 anneaux de fournisseurs.
  const byProvider = new Map(PROVIDER_ORBITS.map((o) => [o.id, []]));
  for (const name of [...agentNames].sort()) {
    const q = quotaByAgent.get(name);
    const provider = q?.provider ?? AGENT_META[name]?.provider ?? 'codex';
    const bucket = byProvider.get(provider) ?? byProvider.get('codex');
    bucket.push(name);
  }

  const cx = 270;
  const cy = 270;
  const orbits = [];
  const nodes = [];

  for (let oi = 0; oi < PROVIDER_ORBITS.length; oi++) {
    const orbit = PROVIDER_ORBITS[oi];
    const providerQuota = quota?.providers?.[orbit.id] ?? { status: 'unknown', windows: [] };
    const members = byProvider.get(orbit.id) ?? [];
    const primaryWindow = pickPrimaryWindow(providerQuota.windows);
    orbits.push({
      ...orbit,
      cx,
      cy,
      quota: providerQuota,
      remainingPct: primaryWindow?.remainingPct ?? null,
      resetsAt: primaryWindow?.resetsAt ?? null,
      windowLabel: primaryWindow?.label ?? null,
      stale: Boolean(providerQuota.stale),
    });

    // Angle de départ décalé par anneau pour éviter les alignements verticaux.
    const startAngle = -Math.PI / 2 + oi * 0.52;
    const step = members.length ? (Math.PI * 2) / members.length : 0;

    members.forEach((name, idx) => {
      const angle = startAngle + idx * step;
      const x = cx + Math.cos(angle) * orbit.radius;
      const y = cy + Math.sin(angle) * orbit.radius;
      const u = usageByAgent.get(name) ?? { calls: 0, input: 0, cachedInput: 0, output: 0, durationMs: 0 };
      const rel = reliabilityByAgent.get(name);
      const q = quotaByAgent.get(name);
      const todayCalls = callsByAgent.get(name) ?? [];
      const runningCalls = todayCalls.filter((c) => c.status === 'running');
      const alerts = alertsByAgent.get(name) ?? [];
      const tokens = (u.input ?? 0) + (u.output ?? 0);
      const tokenRatio = Math.sqrt(tokens / maxTokens);
      const radius = 15 + Math.round(tokenRatio * 12);

      nodes.push({
        name,
        label: agentLabel(name),
        glyph: agentGlyph(name),
        color: agentColor(name),
        provider: orbit.id,
        angle,
        x,
        y,
        radius,
        tokens,
        usage: u,
        successRate: rel ? 1 - (rel.failureRate ?? 0) : null,
        medianDurationMs: rel?.medianDurationMs ?? null,
        available: q ? Boolean(q.available) : true,
        unavailableReason: q && !q.available ? q.reason : null,
        runningCalls,
        todayCalls,
        alerts,
        isRunning: runningCalls.length > 0,
        hasAlert: alerts.length > 0,
      });
    });
  }

  return {
    cx,
    cy,
    size: 540,
    orbits,
    nodes,
    activeCount: nodes.reduce((sum, n) => sum + n.runningCalls.length, 0),
    alertCount: (status?.alerts ?? []).length,
  };
}

export function pickPrimaryWindow(windows) {
  if (!Array.isArray(windows) || !windows.length) return null;
  const globalWindows = windows.filter((w) => !w.scope);
  const pool = globalWindows.length ? globalWindows : windows;
  const fiveHour = pool.find((w) => w.label === '5h');
  if (fiveHour) return fiveHour;
  return [...pool].sort((a, b) => (a.remainingPct ?? 100) - (b.remainingPct ?? 100))[0];
}

/**
 * Construit le chemin SVG d'un arc circulaire (de -90° dans le sens horaire).
 */
export function describeArc(cx, cy, radius, pct) {
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
  if (clamped <= 0) return '';
  if (clamped >= 99.9) {
    return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.01} ${cy - radius}`;
  }
  const angleRad = ((clamped / 100) * 360 - 90) * (Math.PI / 180);
  const endX = cx + radius * Math.cos(angleRad);
  const endY = cy + radius * Math.sin(angleRad);
  const largeArc = clamped > 50 ? 1 : 0;
  return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 ${largeArc} 1 ${endX.toFixed(2)} ${endY.toFixed(2)}`;
}

/**
 * Complète les 14 derniers jours UTC pour le spectre de consommation.
 */
export function buildDailySpectrum(byDay = [], nowMs = Date.now(), days = HISTOGRAM_DAYS) {
  const map = new Map(byDay.map((d) => [d.day, d]));
  const now = new Date(nowMs);
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(todayUtc - i * DAY_MS).toISOString().slice(0, 10);
    const row = map.get(day);
    const input = row?.input ?? 0;
    const cachedInput = row?.cachedInput ?? 0;
    const output = row?.output ?? 0;
    const freshInput = Math.max(0, input - Math.min(input, cachedInput));
    series.push({
      day,
      calls: row?.calls ?? 0,
      input,
      freshInput,
      cachedInput,
      output,
      total: input + output,
    });
  }
  return series;
}

/**
 * Corrèle les fiches de fonctionnalités (/api/features) avec les appels récents (/api/usage)
 * et les appels du jour (/api/status) pour raconter le passage de relais de chaque story.
 */
export function buildStoryRelays({ features = [], storyChecks = [], usage, status, featureFilter = '' }) {
  const byName = new Map();

  for (const f of features) {
    byName.set(f.name, {
      name: f.name,
      title: f.title ?? f.name,
      branch: f.branch,
      task: f.task,
      developer: f.developer,
      reviewer: f.reviewer,
      verdicts: f.verdicts ?? [],
      lastVerdict: f.lastVerdict,
      tests: f.tests,
      decision: f.decision,
      final: f.final,
      state: f.state ?? 'en_cours',
      waitingForUser: Boolean(f.waitingForUser),
      hasDoc: true,
      storyChecks: [],
      calls: [],
      tokens: 0,
      durationMs: 0,
    });
  }

  const relayFor = (key) => {
    if (!byName.has(key)) {
      byName.set(key, {
        name: key,
        title: key,
        branch: null,
        task: null,
        developer: null,
        reviewer: null,
        verdicts: [],
        lastVerdict: null,
        tests: null,
        decision: null,
        final: null,
        state: 'en_cours',
        waitingForUser: false,
        hasDoc: false,
        storyChecks: [],
        calls: [],
        tokens: 0,
        durationMs: 0,
      });
    }
    return byName.get(key);
  };

  for (const report of storyChecks) {
    relayFor(report.feature || NO_FEATURE_LABEL).storyChecks.push(report);
  }

  const seenCallIds = new Set();
  const attachCall = (raw, isLive = false) => {
    const key = raw.feature || NO_FEATURE_LABEL;
    if (featureFilter && raw.feature !== featureFilter) return;
    if (raw.callId && seenCallIds.has(raw.callId)) return;
    if (raw.callId) seenCallIds.add(raw.callId);

    const entry = relayFor(key);
    const u = raw.usage ?? {};
    const callTokens = (u.input ?? 0) + (u.output ?? 0);
    entry.tokens += callTokens;
    entry.durationMs += raw.durationMs ?? 0;
    entry.calls.push({
      callId: raw.callId ?? null,
      agent: raw.agent,
      model: raw.model,
      branch: raw.feature ? null : raw.branch ?? null,
      role: normalizeRole(raw.role),
      status: raw.status,
      resumedFrom: raw.resumedFrom ?? null,
      sessionId: raw.sessionId ?? null,
      timestamp: raw.startedAt ?? raw.timestamp ?? null,
      durationMs: raw.durationMs ?? null,
      tokens: callTokens,
      isLive,
    });
  };

  for (const c of status?.calls ?? []) attachCall(c, true);
  for (const c of usage?.recent ?? []) attachCall(c, false);

  const list = [...byName.values()]
    .filter((item) => !featureFilter || item.name === featureFilter)
    .map((item) => {
      item.calls.sort((a, b) => Date.parse(a.timestamp ?? 0) - Date.parse(b.timestamp ?? 0));
      return item;
    });

  // Priorité : 1) attend décision, 2) en cours / actif, 3) en relecture, 4) fusionnée.
  const weight = { attend_decision: 0, en_cours: 1, en_relecture: 2, fusionnee: 3 };
  list.sort((a, b) => {
    const wa = a.waitingForUser ? 0 : (weight[a.state] ?? 2);
    const wb = b.waitingForUser ? 0 : (weight[b.state] ?? 2);
    if (wa !== wb) return wa - wb;
    const ta = Date.parse(a.calls.at(-1)?.timestamp ?? 0) || 0;
    const tb = Date.parse(b.calls.at(-1)?.timestamp ?? 0) || 0;
    if (ta !== tb) return tb - ta;
    return a.name.localeCompare(b.name);
  });

  return list;
}

/**
 * Simulateur d'aiguillage (maquette interactive alignée sur src/delegation.js).
 * Renvoie le gagnant et la liste complète des candidats évalués avec la raison de chaque saut.
 */
export function simulateDelegation(delegation, { role, author = '', unavailable = [], quotaAgents = [] }) {
  if (!delegation) return { chosen: null, steps: [], error: 'Configuration de délégation absente.' };
  const unavailableSet = new Set(unavailable);
  const quotaMap = new Map(quotaAgents.map((a) => [a.name, a]));

  let list;
  if (role === 'relecteur') {
    list = (author && delegation.relecteur?.selonAuteur?.[author])
      ? [...delegation.relecteur.selonAuteur[author]]
      : [...(delegation.relecteur?.parDefaut ?? [])];
  } else {
    list = [...(delegation[role] ?? [])];
  }

  const steps = [];
  let chosen = null;

  for (const agent of list) {
    if (role === 'relecteur' && author && agent === author) {
      steps.push({ agent, status: 'skipped', reason: 'Auteur du code (auto-relecture interdite)' });
      continue;
    }
    if (unavailableSet.has(agent)) {
      steps.push({ agent, status: 'skipped', reason: 'Marqué indisponible dans la simulation' });
      continue;
    }
    const q = quotaMap.get(agent);
    if (q && q.available === false) {
      steps.push({ agent, status: 'skipped', reason: q.reason || 'Quota sous le seuil configuré' });
      continue;
    }
    if (!chosen) {
      chosen = agent;
      steps.push({ agent, status: 'chosen', reason: 'Premier candidat disponible' });
    } else {
      steps.push({ agent, status: 'standby', reason: 'Secours en attente' });
    }
  }

  return {
    chosen,
    steps,
    error: chosen ? null : 'Aucun agent disponible pour ce rôle avec ces contraintes.',
  };
}

/**
 * Estime le coût simulé en USD (maquette Budget) à partir de /api/usage.
 * Met en évidence l'économie réalisée grâce au cache de contexte.
 */
export function estimateMockBudget(usage) {
  const rows = (usage?.byAgent ?? []).map((row) => {
    const rate = MOCK_PRICING_PER_M[row.key] ?? MOCK_PRICING_PER_M.default;
    const input = row.input ?? 0;
    const cached = row.cachedInput ?? 0;
    const output = row.output ?? 0;
    const fresh = Math.max(0, input - Math.min(input, cached));
    const billedCached = Math.min(input, cached);
    const costFresh = (fresh / 1_000_000) * rate.input;
    const costCached = (billedCached / 1_000_000) * rate.cached;
    const costOutput = (output / 1_000_000) * rate.output;
    const totalUsd = costFresh + costCached + costOutput;
    const withoutCacheUsd = (input / 1_000_000) * rate.input + costOutput;
    const savedUsd = Math.max(0, withoutCacheUsd - totalUsd);
    return {
      agent: row.key ?? 'inconnu',
      calls: row.calls ?? 0,
      totalUsd,
      savedUsd,
      costFresh,
      costCached,
      costOutput,
    };
  }).sort((a, b) => b.totalUsd - a.totalUsd);

  const totalUsd = rows.reduce((s, r) => s + r.totalUsd, 0);
  const savedUsd = rows.reduce((s, r) => s + r.savedUsd, 0);
  const budgetPct = Math.min(100, (totalUsd / MOCK_DAILY_BUDGET_USD) * 100);

  return {
    rows,
    totalUsd,
    savedUsd,
    budgetCapUsd: MOCK_DAILY_BUDGET_USD,
    budgetPct,
  };
}
