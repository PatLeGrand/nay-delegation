import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile, readlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { COMMIT_INSTRUCTIONS, commitAndRecord, lastMarker, parseCommitRequest } from './commit.js';
import { chooseAgent } from './delegation.js';
import { readConfig } from './config.js';
import { runAgent } from './runAgent.js';
import { endsWithQuestion } from './lifecycle.js';
import { checksFailures, checksNotice, formatChecks, loadChecks, runChecks } from './checks.js';

const run = promisify(execFile);
const MAX_DIFF_CHARS = 60_000;

// Codes de sortie de `nay story`.
export const EXIT = { ok: 0, blocked: 1, noAgent: 2 };

const CHECKS_INSTRUCTIONS = `
Ajoute aussi une ligne résumant les contrôles lancés et leur résultat :
NAY-CHECKS: <ex. ruff ok · mypy ok · pytest 42 passés>`;

const VERDICT_INSTRUCTIONS = `

---
Tu es le relecteur, en lecture seule. Sois bref : constats bloquants seulement, chacun avec
emplacement et correction minimale. Termine par exactement une ligne :
NAY-VERDICT: PASS      (aucun défaut bloquant)
NAY-VERDICT: CHANGES   (défauts bloquants listés au-dessus)`;

const MAX_BUFFER = 64 * 1024 * 1024;
const IGNORED_DIRS = new Set(['.git', 'node_modules']);

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
      question: false, detail: error.message, dev: null, reviews: [], commits: [] });
    throw error;
  }
  journal({ kind: 'story_end', storyId, feature, status: report.status, code: report.code,
    question: report.question, detail: report.detail, dev: report.dev, reviews: report.reviews,
    commits: report.commits, checks: report.checks, checksBy: report.checksBy });
  return { ...report, storyId };
}

export function newStoryId() {
  return randomBytes(4).toString('hex');
}

// Contrôles du projet : chargés depuis son dossier et lancés par Nay (injectables pour les tests).
export const checkOps = { load: (cwd) => loadChecks(cwd), run: (checks, cwd) => runChecks(checks, { cwd }) };

async function storyRounds(brief, { cwd = process.cwd(), feature, maxRounds = 2, execute = runAgent,
  isAvailable = () => true, delegation, git = gitOps, committer = commitAndRecord, checker = checkOps, dev: forcedDev,
  storyId } = {}) {
  const report = { dev: null, devSkipped: [], commits: [], reviews: [], checks: null, checksBy: null,
    status: 'OK', code: EXIT.ok, detail: null, findings: null, question: false };
  const run = (agent, prompt, options) => execute(agent, prompt, { ...options, storyId });
  const isGit = await git.isRepo(cwd);
  const unavailable = new Set();
  const availability = (agent) => !unavailable.has(agent) && isAvailable(agent);
  const choose = (role, author) => chooseAgent(role, { author, isAvailable: availability,
    ...(delegation ? { delegation } : {}) });
  const stop = (status, code, detail) => Object.assign(report, { status, code, detail });

  let checks;
  try {
    checks = await checker.load(cwd);
  } catch (error) {
    return stop('BLOQUÉ', EXIT.blocked, `Contrôles du projet illisibles : ${error.message}`);
  }
  // Sans contrôles déclarés, on garde le compte rendu du dev, signalé comme non vérifié.
  const checksPrompt = checks ? checksNotice(checks) : CHECKS_INSTRUCTIONS;

  // Dev : on passe au suivant tant que l'agent qui a échoué n'a rien modifié.
  const devPrompt = `${brief}${isGit ? COMMIT_INSTRUCTIONS : ''}${checksPrompt}`;
  let dev;
  for (;;) {
    let agent;
    try {
      // `--dev` impose l'agent : pas de bascule vers un autre dev s'il échoue.
      if (forcedDev && unavailable.has(forcedDev)) throw new Error(`${forcedDev} (imposé par --dev) a échoué`);
      // Un agent imposé hors quota ou inconnu s'arrête ici, avant tout appel.
      if (forcedDev && !availability(forcedDev)) throw new Error(`${forcedDev} (imposé par --dev) est indisponible`);
      if (forcedDev && !Object.hasOwn(readConfig('agents'), forcedDev)) throw new Error(`--dev : agent inconnu : ${forcedDev}`);
      ({ agent } = forcedDev ? { agent: forcedDev } : choose('developpeur'));
    } catch (error) {
      return stop('AUCUN AGENT', EXIT.noAgent, error.message);
    }
    const before = await git.snapshot(cwd, isGit);
    const result = await run(agent, devPrompt, { mode: 'write', cwd, feature, role: 'dev' });
    if (result.status === 'ok') {
      dev = result;
      break;
    }
    const touched = (await git.snapshot(cwd, isGit)) !== before;
    if (touched) {
      report.dev = agent;
      return stop('BLOQUÉ', EXIT.blocked, `${agent} a échoué après avoir modifié des fichiers : ${shortError(result)}`);
    }
    unavailable.add(agent);
    report.devSkipped.push({ agent, reason: shortError(result) });
  }
  report.dev = dev.agent;

  for (let round = 1; ; round += 1) {
    if (!checks) {
      report.checks = parseLine(dev.text, 'NAY-CHECKS') ?? report.checks;
      if (report.checks) report.checksBy = 'dev';
    }
    let target = 'les fichiers modifiés et non committés du dossier';
    if (isGit) {
      const request = parseCommitRequest(dev.text);
      if (request) {
        try {
          const line = await committer(request, { cwd, call: { callId: dev.callId, agent: dev.agent,
            model: dev.model, feature, role: 'dev' } });
          report.commits.push(line);
          const hash = line.split(' ')[0];
          target = `le commit ${hash}, dont voici le diff complet (ouvre les fichiers si tu as besoin `
            + `de plus de contexte) :\n\n\`\`\`diff\n${await git.show(cwd, hash, MAX_DIFF_CHARS)}\n\`\`\``;
        } catch (error) {
          return stop('BLOQUÉ', EXIT.blocked, `Commit impossible : ${error.stderr?.trim() || error.message}`);
        }
      } else if (round === 1 && !(await git.status(cwd)).trim()) {
        // Un dev qui s'arrête sur une question attend une réponse : `nay wait` le signale (needs_input).
        report.question = endsWithQuestion(dev.text);
        if (report.question) report.findings = withoutMarkers(dev.text);
        return stop('BLOQUÉ', EXIT.blocked, report.question ? 'Le dev pose une question'
          : 'Le dev n’a rien modifié ni demandé de commit');
      } else {
        target = `les modifications non committées, dont voici le diff (ouvre les fichiers si tu as `
          + `besoin de plus de contexte) :\n\n\`\`\`diff\n${await git.uncommitted(cwd, MAX_DIFF_CHARS)}\n\`\`\``;
      }
    } else {
      target = 'les fichiers modifiés par le dev';
    }

    // Contrôles : un échec repart directement au dev, sans dépenser de relecture.
    let checksLine = '';
    if (checks) {
      const results = await checker.run(checks, cwd);
      Object.assign(report, { checks: formatChecks(results), checksBy: 'nay',
        checksFailed: results.some((result) => !result.ok) });
      if (report.checksFailed) {
        const failures = checksFailures(results);
        if (round >= maxRounds) {
          report.findings = failures;
          return stop('CONTRÔLES', EXIT.blocked, `Contrôles en échec après ${maxRounds} tours`);
        }
        const fixed = await fixRound(`Contrôles lancés par Nay en échec, à corriger :\n\n${failures}`);
        if (!fixed) {
          report.findings = failures;
          return report;
        }
        continue;
      }
      checksLine = `\n\nContrôles lancés par Nay, tous réussis : ${report.checks}.`;
    }

    // Revue : en lecture seule, on peut toujours passer au relecteur suivant.
    const reviewPrompt = `Brief de la tâche relue :\n${brief}\n\nRelis ${target}.${checksLine}${VERDICT_INSTRUCTIONS}`;
    let review;
    for (;;) {
      let agent;
      try {
        ({ agent } = choose('relecteur', dev.agent));
      } catch (error) {
        return stop('AUCUN AGENT', EXIT.noAgent, error.message);
      }
      const result = await run(agent, reviewPrompt, { mode: 'read', cwd, feature, role: 'relecteur' });
      if (result.status === 'ok') {
        review = result;
        break;
      }
      unavailable.add(agent);
      report.reviews.push({ agent, round, verdict: `sauté (${shortError(result)})` });
    }
    const verdict = parseVerdict(review.text);
    report.reviews.push({ agent: review.agent, round, verdict });
    if (verdict === 'PASS') return report;
    if (round >= maxRounds) {
      report.findings = withoutMarkers(review.text);
      return stop('DÉFAUTS', EXIT.blocked, `Défauts restants après ${maxRounds} tours de revue`);
    }

    if (!(await fixRound(`Retours de revue à corriger (seulement ceux-ci) :\n${withoutMarkers(review.text)}`))) {
      report.findings = withoutMarkers(review.text);
      return report;
    }
  }

  // Correction : on reprend la conversation du dev quand c'est possible. Faux si elle a échoué.
  async function fixRound(feedback) {
    const fixPrompt = `${feedback}${isGit ? COMMIT_INSTRUCTIONS : ''}${checksPrompt}`;
    const fix = await run(dev.agent, dev.sessionId ? fixPrompt : `${brief}\n\n${fixPrompt}`, {
      mode: 'write', cwd, feature, role: 'dev',
      ...(dev.sessionId ? { resume: dev.sessionId, resumedFrom: dev.callId } : {}) });
    if (fix.status !== 'ok') {
      stop('BLOQUÉ', EXIT.blocked, `Correction par ${dev.agent} échouée : ${shortError(fix)}`);
      return false;
    }
    dev = { ...fix, agent: dev.agent, sessionId: fix.sessionId ?? dev.sessionId };
    return true;
  }
}

function findingsTitle(report) {
  if (report.question) return 'Question du dev :';
  // Une story arrêtée pendant la correction des contrôles n'a pas de constats de relecteur.
  return report.checksFailed ? 'Contrôles en échec :' : 'Constats du relecteur :';
}

export function formatStory(report) {
  const skipped = report.devSkipped.length
    ? ` (sauté : ${report.devSkipped.map(({ agent, reason }) => `${agent} — ${reason}`).join(' ; ')})` : '';
  const lines = [`Dev : ${report.dev ?? 'aucun'}${skipped}`,
    `Commit : ${report.commits.length ? report.commits.join(' ; ') : 'aucun'}`,
    `Revue : ${report.reviews.length
      ? report.reviews.map(({ agent, round, verdict }) => `${agent} ${verdict} (tour ${round})`).join(' ; ') : 'aucune'}`,
    `Contrôles : ${report.checks ?? 'non rapportés'}${report.checksBy === 'dev' ? ' (déclarés par le dev, non vérifiés)' : ''}`,
    `Statut : ${report.status}${report.detail ? ` — ${report.detail}` : ''}`];
  if (report.storyId) lines.unshift(`Story : ${report.storyId}`);
  if (report.findings) lines.push('', findingsTitle(report), report.findings);
  return `${lines.join('\n')}\n`;
}
