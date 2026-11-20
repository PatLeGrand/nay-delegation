import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile, readlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { COMMIT_INSTRUCTIONS, commitAndRecord, lastMarker, parseCommitRequest } from './commit.js';
import { readConfig } from './config.js';
import { chooseAgent } from './delegation.js';
import { runAgent } from './runAgent.js';
import { endsWithQuestion } from './lifecycle.js';
import { checksFailures, checksNotice, formatChecks, loadChecks, loadChecksConfig, runChecks } from './checks.js';
import { loadRoles, rolePrompt } from './roles.js';
import { verifyTdd } from './tdd.js';

const run = promisify(execFile);
const MAX_DIFF_CHARS = 60_000;

// Codes de sortie de `nay story`.
export const EXIT = { ok: 0, blocked: 1, noAgent: 2 };

export const CONFORMITY_ROLE = 'conformite';

const CHECKS_INSTRUCTIONS = `
Ajoute aussi une ligne résumant les contrôles lancés et leur résultat :
NAY-CHECKS: <ex. ruff ok · mypy ok · pytest 42 passés>`;

const VERDICT_LINES = `Termine par exactement une ligne :
NAY-VERDICT: PASS      (aucun défaut bloquant)
NAY-VERDICT: CHANGES   (défauts bloquants listés au-dessus)`;

const VERDICT_INSTRUCTIONS = `

---
Tu es le relecteur, en lecture seule. Sois bref : constats bloquants seulement, chacun avec
emplacement et correction minimale. ${VERDICT_LINES}`;

const CONFORMITY_INSTRUCTIONS = `

---
Tu contrôles la conformité au brief, en lecture seule. Une seule question : le changement fait-il
ce que demande le brief, ni plus ni moins ? Ne juge pas la qualité du code : un autre relecteur
s'en charge ensuite. Liste seulement les écarts (demande non faite, ajout hors brief), un par
ligne. ${VERDICT_LINES}`;

const DISPUTE_INSTRUCTIONS = `

Si tu juges une remarque fausse, ne la corrige pas : ajoute à la place une ligne par remarque contestée
NAY-DISPUTE: <remarque contestée> — <raison>
Corrige normalement les autres remarques.`;

const TDD_WARNING = '\n\nAttention (contrôle TDD de Nay) : les nouveaux tests passent sans le changement : '
  + 'ils ne prouvent peut-être rien. Vérifie qu’ils testent vraiment ce qui a changé.';

const TDD_LABELS = { 'prouvé': 'tests rouges avant, verts après', 'non prouvé': 'non prouvé (les nouveaux tests passent sans le changement)' };

const MAX_BUFFER = 64 * 1024 * 1024;
const IGNORED_DIRS = new Set(['.git', 'node_modules']);
const PASSED = Symbol('passed');

async function hashFile(path) {
  try {
    return createHash('sha256').update(await readFile(path)).digest('hex');
  } catch {
    return 'illisible';
  }
}

// Empreinte hors git : chemins et contenus des fichiers, cibles des liens symboliques.
// Les dossiers ignorés sont écartés avant d'y descendre ; un dossier illisible compte comme tel.
async function hashTree(root) {
  const hash = createHash('sha256');
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      hash.update(`${relative(root, dir)}\0dossier illisible\n`);
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      const rel = relative(root, path);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(path);
      } else if (entry.isSymbolicLink()) {
        let target;
        try { target = await readlink(path); } catch { target = 'illisible'; }
        hash.update(`${rel}\0lien\0${target}\n`);
      } else if (entry.isFile()) {
        hash.update(`${rel}\0${await hashFile(path)}\n`);
      }
    }
  }
  await walk(root);
  return hash.digest('hex');
}

export const gitOps = {
  async isRepo(cwd) {
    try {
      const { stdout } = await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  },
  async status(cwd) {
    const { stdout } = await run('git', ['status', '--porcelain'], { cwd });
    return stdout;
  },
  // Empreinte du contenu de l'arbre : détecte aussi la retouche d'un fichier déjà modifié.
  async snapshot(cwd, isGit) {
    if (!isGit) return hashTree(cwd);
    const { stdout: diff } = await run('git', ['diff', 'HEAD', '--binary'], { cwd, maxBuffer: MAX_BUFFER });
    const { stdout: untracked } = await run('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd });
    const hash = createHash('sha256').update(diff);
    for (const file of untracked.split('\0').filter(Boolean).sort()) {
      hash.update(`${file}\0${await hashFile(join(cwd, file))}\n`);
    }
    return hash.digest('hex');
  },
  // Diff fourni au relecteur : il n'a pas à lancer git (le shell est bloqué chez agy en lecture seule).
  async show(cwd, commit, maxChars) {
    const { stdout } = await run('git', ['show', '--stat', '--patch', '--format=%h %s', commit],
      { cwd, maxBuffer: MAX_BUFFER });
    return truncate(stdout, maxChars);
  },
  // Modifications non committées : diff des fichiers suivis et liste des nouveaux fichiers.
  async uncommitted(cwd, maxChars) {
    const { stdout: diff } = await run('git', ['diff', 'HEAD', '--stat', '--patch'], { cwd, maxBuffer: MAX_BUFFER });
    const { stdout: untracked } = await run('git', ['ls-files', '--others', '--exclude-standard'], { cwd });
    // La liste des nouveaux fichiers reste entière : seul le diff est tronqué.
    const added = untracked.trim() ? `\n\nNouveaux fichiers non suivis (à ouvrir) :\n${untracked.trim()}` : '';
    return `${truncate(diff, maxChars)}${added}`;
  },
};

function truncate(text, maxChars) {
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}\n[… tronqué à ${maxChars} caractères : ouvre les fichiers pour la suite]`
    : text;
}

export const parseLine = lastMarker;

// Le verdict doit être la dernière ligne non vide ; toute autre forme vaut CHANGES.
export function parseVerdict(text = '') {
  const last = text.trim().split('\n').at(-1)?.trim() ?? '';
  const verdict = last.match(/^NAY-VERDICT:[ \t]*(PASS|CHANGES)[ \t]*$/i)?.[1].toUpperCase();
  return verdict === 'PASS' ? 'PASS' : 'CHANGES';
}

// Lignes `NAY-DISPUTE: <remarque> — <raison>` ; la raison suit le dernier tiret cadratin.
export function parseDisputes(text = '') {
  return text.split('\n').map((line) => line.trim().match(/^NAY-DISPUTE:[ \t]*(.+)$/)?.[1].trim())
    .filter(Boolean).map((dispute) => {
      const cut = dispute.lastIndexOf(' — ');
      return cut < 0 ? { remark: dispute, reason: '' }
        : { remark: dispute.slice(0, cut).trim(), reason: dispute.slice(cut + 3).trim() };
    });
}

function formatDispute({ remark, reason }) {
  return `${remark}${reason ? ` — ${reason}` : ''}`;
}

function disputeNote(disputes) {
  if (!disputes.length) return '';
  const list = disputes.map(({ remark, reason }) => `« ${remark} » (raison : ${reason || 'non donnée'})`).join(' ; ');
  return `\n\nLe dev conteste : ${list} ; tranche : maintiens une remarque contestée seulement si sa raison ne tient pas.`;
}

function shortError(result) {
  return (result.error ?? result.status ?? 'échec').split('\n')[0].slice(0, 160);
}

// Les lignes NAY-* sont des métadonnées : on ne les remonte pas dans les constats.
function withoutMarkers(text = '') {
  return text.split('\n').filter((line) => !/^NAY-[A-Z]+:/.test(line)).join('\n').trim();
}

// Les événements story_start / story_end permettent à `nay wait` de suivre la story entière ;
// `journal` est fourni par la CLI pour que les tests n'écrivent pas dans le journal réel.
export async function runStory(brief, { storyId = newStoryId(), journal = () => {}, ...options } = {}) {
  const { cwd = process.cwd(), feature = null } = options;
  journal({ kind: 'story_start', storyId, feature, cwd });
  let report;
  try {
    report = await storyRounds(brief, { ...options, storyId });
  } catch (error) {
    // Sans story_end, `nay wait` verrait la story finir en `stalled` au lieu de `failed`.
    journal({ kind: 'story_end', storyId, feature, status: 'BLOQUÉ', code: EXIT.blocked, cause: 'crash',
      question: false, detail: error.message, dev: null, reviews: [], conformity: [], roles: [], commits: [] });
    throw error;
  }
  journal({ kind: 'story_end', storyId, feature, status: report.status, code: report.code,
    question: report.question, detail: report.detail, dev: report.dev, reviews: report.reviews,
    conformity: report.conformity, roles: report.roles, commits: report.commits, checks: report.checks,
    checksBy: report.checksBy, tdd: report.tdd, disputes: report.disputes });
  return { ...report, storyId };
}

export function newStoryId() {
  return randomBytes(4).toString('hex');
}

// Preuve TDD : le contrôle marqué `tdd` est relancé sur le parent du commit avec ses nouveaux tests.
async function proveTdd(check, cwd, commit) {
  const config = loadChecksConfig();
  return verifyTdd({ cwd, commit, check, patterns: config.testPatterns, dir: config.tddWorktreesDir,
    runCheck: async (one, dir, extraEnv) => (await runChecks([one], { cwd: dir, config, extraEnv }))[0] });
}

// Contrôles du projet : chargés depuis son dossier et lancés par Nay (injectables pour les tests).
export const checkOps = { load: (cwd) => loadChecks(cwd), run: (checks, cwd) => runChecks(checks, { cwd }), tdd: proveTdd };

function createContext(brief, { cwd = process.cwd(), feature, maxRounds = 2, execute = runAgent,
  isAvailable = () => true, delegation = readConfig('delegation'), git = gitOps, committer = commitAndRecord,
  checker = checkOps, dev = null, skipBaseline = false, baseline, roles, skipRoles = false,
  skipConformity = false, storyId } = {}) {
  const report = { dev: null, devSkipped: [], commits: [], reviews: [], conformity: [], roles: [], tdd: [],
    disputes: [], checks: null, checksBy: null, status: 'OK', code: EXIT.ok, detail: null, findings: null,
    question: false };
  const unavailable = new Set();
  const availability = (agent) => !unavailable.has(agent) && isAvailable(agent);
  return { brief, cwd, feature, maxRounds, git, committer, checker, delegation, forcedDev: dev, skipBaseline,
    baseline, roleConfig: roles, skipRoles, skipConformity, report, unavailable,
    isGit: false, checks: null, checksPrompt: '', autoRoles: [], dev: null, disputeNote: '',
    run: (agent, prompt, options) => execute(agent, prompt, { ...options, storyId }),
    choose: (role, author) => chooseAgent(role, { author, isAvailable: availability, delegation }),
    // Rôles hors relecteur : l'auteur du code est exclu explicitement.
    chooseForRole: (role, author) => chooseAgent(role, { delegation,
      isAvailable: (agent) => agent !== author && availability(agent) }),
    stop(status, code, detail) {
      Object.assign(report, { status, code, detail });
      return null;
    } };
}

async function storyRounds(brief, options) {
  const ctx = createContext(brief, options);
  if (!(await prepare(ctx)) || !(await startDev(ctx))) return ctx.report;
  for (let round = 1; ; round += 1) {
    const outcome = await reviewRound(ctx, round);
    if (!outcome?.changes) return ctx.report;
    if (round >= ctx.maxRounds) return giveUp(ctx, outcome);
    if (!(await correct(ctx, outcome, round))) {
      if (ctx.report.status !== 'DÉSACCORD') setFindings(ctx.report, outcome);
      return ctx.report;
    }
  }
}

// Rôles « toujours », contrôles du projet et base saine : tout ce qui précède l'appel du dev.
async function prepare(ctx) {
  const { report } = ctx;
  ctx.isGit = await ctx.git.isRepo(ctx.cwd);
  if (!ctx.skipRoles) {
    try {
      ctx.autoRoles = Object.entries(ctx.roleConfig ?? loadRoles())
        .filter(([, role]) => role.usage === 'toujours' && role.mode === 'read');
    } catch (error) {
      return ctx.stop('BLOQUÉ', EXIT.blocked, `Rôles perso illisibles : ${error.message}`);
    }
  }
  try {
    ctx.checks = await ctx.checker.load(ctx.cwd);
  } catch (error) {
    return ctx.stop('BLOQUÉ', EXIT.blocked, `Contrôles du projet illisibles : ${error.message}`);
  }
  // Base saine : inutile de lancer un dev si les contrôles du projet échouent déjà.
  if (ctx.checks && !ctx.skipBaseline && (ctx.baseline ?? loadChecksConfig().baseline)) {
    const results = await ctx.checker.run(ctx.checks, ctx.cwd);
    if (results.some((result) => !result.ok)) {
      Object.assign(report, { checks: formatChecks(results), checksBy: 'nay', checksFailed: true });
      report.findings = checksFailures(results);
      return ctx.stop('BASE ROUGE', EXIT.blocked, 'Contrôles déjà en échec avant le travail');
    }
  }
  // Sans contrôles déclarés, on garde le compte rendu du dev, signalé comme non vérifié.
  ctx.checksPrompt = ctx.checks ? checksNotice(ctx.checks) : CHECKS_INSTRUCTIONS;
  return true;
}

// Dev : on passe au suivant tant que l'agent qui a échoué n'a rien modifié.
async function startDev(ctx) {
  const { report, git, cwd, isGit, forcedDev } = ctx;
  const devPrompt = `${ctx.brief}${isGit ? COMMIT_INSTRUCTIONS : ''}${ctx.checksPrompt}`;
  for (;;) {
    let agent;
    try {
      // `--dev` impose l'agent : pas de bascule vers un autre dev s'il échoue.
      if (forcedDev && ctx.unavailable.has(forcedDev)) throw new Error(`${forcedDev} (imposé par --dev) a échoué`);
      ({ agent } = forcedDev ? { agent: forcedDev } : ctx.choose('developpeur'));
    } catch (error) {
      return ctx.stop('AUCUN AGENT', EXIT.noAgent, error.message);
    }
    const before = await git.snapshot(cwd, isGit);
    const result = await ctx.run(agent, devPrompt, { mode: 'write', cwd, feature: ctx.feature, role: 'dev' });
    if (result.status === 'ok') {
      ctx.dev = result;
      report.dev = agent;
      return true;
    }
    if ((await git.snapshot(cwd, isGit)) !== before) {
      report.dev = agent;
      return ctx.stop('BLOQUÉ', EXIT.blocked, `${agent} a échoué après avoir modifié des fichiers : ${shortError(result)}`);
    }
    ctx.unavailable.add(agent);
    report.devSkipped.push({ agent, reason: shortError(result) });
  }
}

// Un tour : commit, contrôles, preuve TDD, conformité au brief, relecture qualité, rôles « toujours ».
// Rend null (story arrêtée), PASSED, ou { changes, from, findings, feedback, disputable }.
async function reviewRound(ctx, round) {
  const subject = await reviewSubject(ctx, round);
  if (!subject) return null;
  const checked = await projectChecks(ctx);
  if (checked.changes) return checked;
  const tddNote = await provenByTests(ctx, round, subject.commit);
  const conformity = await conformityReview(ctx, round, subject.target);
  if (conformity) return conformity;
  const notes = `${checked.line}${tddNote}${ctx.disputeNote}`;
  const review = await qualityReview(ctx, round, subject.target, notes);
  ctx.disputeNote = '';
  if (review !== PASSED) return review;
  return (await runAutoRoles(ctx, round, subject.target, notes)) ?? PASSED;
}

// Ce que les relecteurs lisent : le commit de Nay, les modifications non committées ou les fichiers.
async function reviewSubject(ctx, round) {
  const { report, git, cwd, dev } = ctx;
  if (!ctx.checks) {
    report.checks = parseLine(dev.text, 'NAY-CHECKS') ?? report.checks;
    if (report.checks) report.checksBy = 'dev';
  }
  if (!ctx.isGit) return { target: 'les fichiers modifiés par le dev', commit: null };
  const request = parseCommitRequest(dev.text);
  if (request) {
    try {
      const line = await ctx.committer(request, { cwd, call: { callId: dev.callId, agent: dev.agent,
        model: dev.model, feature: ctx.feature, role: 'dev' } });
      report.commits.push(line);
      const hash = line.split(' ')[0];
      return { commit: hash, target: `le commit ${hash}, dont voici le diff complet (ouvre les fichiers si tu `
        + `as besoin de plus de contexte) :\n\n\`\`\`diff\n${await git.show(cwd, hash, MAX_DIFF_CHARS)}\n\`\`\`` };
    } catch (error) {
      return ctx.stop('BLOQUÉ', EXIT.blocked, `Commit impossible : ${error.stderr?.trim() || error.message}`);
    }
  }
  if (round === 1 && !(await git.status(cwd)).trim()) {
    // Un dev qui s'arrête sur une question attend une réponse : `nay wait` le signale (needs_input).
    report.question = endsWithQuestion(dev.text);
    if (report.question) report.findings = withoutMarkers(dev.text);
    return ctx.stop('BLOQUÉ', EXIT.blocked, report.question ? 'Le dev pose une question'
      : 'Le dev n’a rien modifié ni demandé de commit');
  }
  return { commit: null, target: `les modifications non committées, dont voici le diff (ouvre les fichiers si `
    + `tu as besoin de plus de contexte) :\n\n\`\`\`diff\n${await git.uncommitted(cwd, MAX_DIFF_CHARS)}\n\`\`\`` };
}

// Contrôles : un échec repart directement au dev, sans dépenser de relecture.
async function projectChecks(ctx) {
  const { report } = ctx;
  if (!ctx.checks) return { line: '' };
  const results = await ctx.checker.run(ctx.checks, ctx.cwd);
  Object.assign(report, { checks: formatChecks(results), checksBy: 'nay',
    checksFailed: results.some((result) => !result.ok) });
  if (!report.checksFailed) return { line: `\n\nContrôles lancés par Nay, tous réussis : ${report.checks}.` };
  const failures = checksFailures(results);
  return { changes: true, from: 'checks', findings: failures, disputable: false,
    feedback: `Contrôles lancés par Nay en échec, à corriger :\n\n${failures}` };
}

// Non bloquant : un test qui passe déjà sans le changement est signalé au relecteur qualité.
async function provenByTests(ctx, round, commit) {
  const check = ctx.checks?.find((one) => one.tdd);
  if (!commit || !check) return '';
  let proof;
  try {
    proof = await ctx.checker.tdd(check, ctx.cwd, commit);
  } catch (error) {
    ctx.report.tdd.push({ round, commit, verdict: 'erreur', detail: shortError({ error: error.message }) });
    return '';
  }
  if (!proof) return '';
  ctx.report.tdd.push({ round, commit, verdict: proof.proved ? 'prouvé' : 'non prouvé', files: proof.files });
  return proof.proved ? '' : TDD_WARNING;
}

// Premier temps de la relecture : le changement fait-il ce que demande le brief, ni plus ni moins ?
// Rôle absent ou aucun modèle disponible : étape notée comme sautée, sans bloquer.
async function conformityReview(ctx, round, target) {
  const { report } = ctx;
  if (ctx.skipConformity) return null;
  const record = (agent, verdict) => report.conformity.push({ agent, round, verdict });
  if (!Object.hasOwn(ctx.delegation, CONFORMITY_ROLE)) {
    record(null, 'sauté (rôle absent de la délégation)');
    return null;
  }
  const prompt = `Brief de la tâche :\n${ctx.brief}\n\nVérifie ${target}.${ctx.disputeNote}${CONFORMITY_INSTRUCTIONS}`;
  const result = await askReadOnly(ctx, CONFORMITY_ROLE, prompt, record);
  if (!result) return null;
  const verdict = parseVerdict(result.text);
  record(result.agent, verdict);
  if (verdict === 'PASS') return null;
  const findings = withoutMarkers(result.text);
  return { changes: true, from: 'conformity', findings, disputable: true,
    feedback: `Écarts au brief relevés par le contrôle de conformité, à corriger (seulement ceux-ci) :\n${findings}` };
}

// Second temps : qualité du code. En lecture seule, on peut toujours passer au relecteur suivant.
async function qualityReview(ctx, round, target, notes) {
  const { report } = ctx;
  const prompt = `Brief de la tâche relue :\n${ctx.brief}\n\nRelis ${target}.${notes}${VERDICT_INSTRUCTIONS}`;
  for (;;) {
    let agent;
    try {
      ({ agent } = ctx.choose('relecteur', ctx.dev.agent));
    } catch (error) {
      return ctx.stop('AUCUN AGENT', EXIT.noAgent, error.message);
    }
    const result = await ctx.run(agent, prompt, { mode: 'read', cwd: ctx.cwd, feature: ctx.feature, role: 'relecteur' });
    if (result.status !== 'ok') {
      ctx.unavailable.add(agent);
      report.reviews.push({ agent, round, verdict: `sauté (${shortError(result)})` });
      continue;
    }
    const verdict = parseVerdict(result.text);
    report.reviews.push({ agent: result.agent, round, verdict });
    if (verdict === 'PASS') return PASSED;
    const findings = withoutMarkers(result.text);
    return { changes: true, from: 'review', findings, disputable: true,
      feedback: `Retours de revue à corriger (seulement ceux-ci) :\n${findings}` };
  }
}

// Rôle en lecture seule hors auteur, avec bascule sur le modèle suivant ; null si aucun n'a répondu.
async function askReadOnly(ctx, role, prompt, record) {
  let tried = false;
  for (;;) {
    let agent;
    try {
      ({ agent } = ctx.chooseForRole(role, ctx.dev.agent));
    } catch {
      if (!tried) record(null, 'sauté');
      return null;
    }
    tried = true;
    const attempt = await ctx.run(agent, prompt, { mode: 'read', cwd: ctx.cwd, feature: ctx.feature, role });
    if (attempt.status === 'ok') return attempt;
    ctx.unavailable.add(agent);
    record(agent, `sauté (${shortError(attempt)})`);
  }
}

// Rôles perso lecture seule « toujours » : même diff que le relecteur, jamais par l'auteur du code.
// Rend les constats au premier CHANGES ; un rôle sans agent disponible est sauté sans bloquer.
async function runAutoRoles(ctx, round, target, notes) {
  for (const [id, role] of ctx.autoRoles) {
    const record = (agent, verdict) => ctx.report.roles.push({ role: id, agent, round, verdict });
    const prompt = `${rolePrompt(role, ctx.brief)}\n\nRelis ${target}.${notes}${VERDICT_INSTRUCTIONS}`;
    const result = await askReadOnly(ctx, id, prompt, record);
    if (!result) continue;
    const verdict = parseVerdict(result.text);
    record(result.agent, verdict);
    if (verdict === 'CHANGES') {
      const findings = withoutMarkers(result.text);
      return { changes: true, from: 'role', findings, disputable: true,
        feedback: `Retours de ${role.label} à corriger (seulement ceux-ci) :\n${findings}` };
    }
  }
  return null;
}

function setFindings(report, { findings, from }) {
  Object.assign(report, { findings, findingsFrom: from });
}

function giveUp(ctx, outcome) {
  setFindings(ctx.report, outcome);
  if (outcome.from === 'checks') ctx.stop('CONTRÔLES', EXIT.blocked, `Contrôles en échec après ${ctx.maxRounds} tours`);
  else ctx.stop('DÉFAUTS', EXIT.blocked, `Défauts restants après ${ctx.maxRounds} tours de revue`);
  return ctx.report;
}

// Correction : on reprend la conversation du dev quand c'est possible. Faux si la story s'arrête.
// Le dev peut contester une remarque de relecture (NAY-DISPUTE) ; sans aucun changement,
// c'est un désaccord que l'orchestrateur tranche.
async function correct(ctx, { feedback, disputable }, round) {
  const { report, git, cwd, isGit, dev } = ctx;
  const before = disputable ? await git.snapshot(cwd, isGit) : null;
  const fixPrompt = `${feedback}${disputable ? DISPUTE_INSTRUCTIONS : ''}${isGit ? COMMIT_INSTRUCTIONS : ''}${ctx.checksPrompt}`;
  const fix = await ctx.run(dev.agent, dev.sessionId ? fixPrompt : `${ctx.brief}\n\n${fixPrompt}`, {
    mode: 'write', cwd, feature: ctx.feature, role: 'dev',
    ...(dev.sessionId ? { resume: dev.sessionId, resumedFrom: dev.callId } : {}) });
  if (fix.status !== 'ok') {
    ctx.stop('BLOQUÉ', EXIT.blocked, `Correction par ${dev.agent} échouée : ${shortError(fix)}`);
    return false;
  }
  ctx.dev = { ...fix, agent: dev.agent, sessionId: fix.sessionId ?? dev.sessionId };
  const disputes = disputable ? parseDisputes(fix.text) : [];
  if (!disputes.length) return true;
  report.disputes.push(...disputes.map((dispute) => ({ round, ...dispute })));
  if ((await git.snapshot(cwd, isGit)) !== before) {
    ctx.disputeNote = disputeNote(disputes);
    return true;
  }
  setFindings(report, { findings: disputes.map((dispute) => `- ${formatDispute(dispute)}`).join('\n'), from: 'dispute' });
  ctx.stop('DÉSACCORD', EXIT.blocked, `${dev.agent} conteste ${disputes.length} remarque(s) sans rien modifier`);
  return false;
}

function findingsTitle(report) {
  if (report.question) return 'Question du dev :';
  if (report.status === 'BASE ROUGE') return 'Contrôles déjà en échec avant le travail :';
  if (report.status === 'DÉSACCORD') return 'Désaccords à trancher :';
  if (report.findingsFrom === 'conformity') return 'Écarts au brief (contrôle de conformité) :';
  // Une story arrêtée pendant la correction des contrôles n'a pas de constats de relecteur.
  return report.checksFailed ? 'Contrôles en échec :' : 'Constats du relecteur :';
}

function verdictList(entries, name = () => '') {
  return entries.map((entry) => `${name(entry)}${entry.agent ? `${entry.agent} ` : ''}${entry.verdict} (tour ${entry.round})`)
    .join(' ; ');
}

function tddLabel({ verdict, detail }) {
  return TDD_LABELS[verdict] ?? `non vérifié (${detail})`;
}

export function formatStory(report) {
  const skipped = report.devSkipped.length
    ? ` (sauté : ${report.devSkipped.map(({ agent, reason }) => `${agent} — ${reason}`).join(' ; ')})` : '';
  const disputes = report.disputes?.length && report.status !== 'DÉSACCORD'
    ? [`Contestations : ${report.disputes.map((dispute) => `${formatDispute(dispute)} (tour ${dispute.round})`).join(' ; ')}`] : [];
  const lines = [`Dev : ${report.dev ?? 'aucun'}${skipped}`,
    `Commit : ${report.commits.length ? report.commits.join(' ; ') : 'aucun'}`,
    ...(report.tdd?.length ? [`TDD : ${report.tdd.map((entry) => `${tddLabel(entry)} (tour ${entry.round})`).join(' ; ')}`] : []),
    ...(report.conformity?.length ? [`Conformité : ${verdictList(report.conformity)}`] : []),
    `Revue : ${report.reviews.length ? verdictList(report.reviews) : 'aucune'}`,
    ...(report.roles?.length ? [`Rôles : ${verdictList(report.roles, ({ role }) => `${role} `)}`] : []),
    ...disputes,
    `Contrôles : ${report.checks ?? 'non rapportés'}${report.checksBy === 'dev' ? ' (déclarés par le dev, non vérifiés)' : ''}`,
    `Statut : ${report.status}${report.detail ? ` — ${report.detail}` : ''}`];
  if (report.storyId) lines.unshift(`Story : ${report.storyId}`);
  if (report.findings) lines.push('', findingsTitle(report), report.findings);
  return `${lines.join('\n')}\n`;
}
