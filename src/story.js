import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, readlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { COMMIT_INSTRUCTIONS, commitRequest, lastMarker, parseCommitRequest } from './commit.js';
import { chooseAgent } from './delegation.js';
import { runAgent } from './runAgent.js';

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

export async function runStory(brief, { cwd = process.cwd(), feature, maxRounds = 2, execute = runAgent,
  isAvailable = () => true, delegation, git = gitOps, committer = commitRequest } = {}) {
  const report = { dev: null, devSkipped: [], commits: [], reviews: [], checks: null, status: 'OK',
    code: EXIT.ok, detail: null, findings: null };
  const isGit = await git.isRepo(cwd);
  const unavailable = new Set();
  const availability = (agent) => !unavailable.has(agent) && isAvailable(agent);
  const choose = (role, author) => chooseAgent(role, { author, isAvailable: availability,
    ...(delegation ? { delegation } : {}) });
  const stop = (status, code, detail) => Object.assign(report, { status, code, detail });

  // Dev : on passe au suivant tant que l'agent qui a échoué n'a rien modifié.
  const devPrompt = `${brief}${isGit ? COMMIT_INSTRUCTIONS : ''}${CHECKS_INSTRUCTIONS}`;
  let dev;
  for (;;) {
    let agent;
    try {
      ({ agent } = choose('developpeur'));
    } catch (error) {
      return stop('AUCUN AGENT', EXIT.noAgent, error.message);
    }
    const before = await git.snapshot(cwd, isGit);
    const result = await execute(agent, devPrompt, { mode: 'write', cwd, feature, role: 'dev' });
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
    report.checks = parseLine(dev.text, 'NAY-CHECKS') ?? report.checks;
    let target = 'les fichiers modifiés et non committés du dossier';
    if (isGit) {
      const request = parseCommitRequest(dev.text);
      if (request) {
        try {
          const line = await committer(request, { cwd });
          report.commits.push(line);
          const hash = line.split(' ')[0];
          target = `le commit ${hash}, dont voici le diff complet (ouvre les fichiers si tu as besoin `
            + `de plus de contexte) :\n\n\`\`\`diff\n${await git.show(cwd, hash, MAX_DIFF_CHARS)}\n\`\`\``;
        } catch (error) {
          return stop('BLOQUÉ', EXIT.blocked, `Commit impossible : ${error.stderr?.trim() || error.message}`);
        }
      } else if (round === 1 && !(await git.status(cwd)).trim()) {
        return stop('BLOQUÉ', EXIT.blocked, 'Le dev n’a rien modifié ni demandé de commit');
      } else {
        target = `les modifications non committées, dont voici le diff (ouvre les fichiers si tu as `
          + `besoin de plus de contexte) :\n\n\`\`\`diff\n${await git.uncommitted(cwd, MAX_DIFF_CHARS)}\n\`\`\``;
      }
    } else {
      target = 'les fichiers modifiés par le dev';
    }

    // Revue : en lecture seule, on peut toujours passer au relecteur suivant.
    const reviewPrompt = `Brief de la tâche relue :\n${brief}\n\nRelis ${target}.${VERDICT_INSTRUCTIONS}`;
    let review;
    for (;;) {
      let agent;
      try {
        ({ agent } = choose('relecteur', dev.agent));
      } catch (error) {
        return stop('AUCUN AGENT', EXIT.noAgent, error.message);
      }
      const result = await execute(agent, reviewPrompt, { mode: 'read', cwd, feature, role: 'relecteur' });
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

    // Correction : on reprend la conversation du dev quand c'est possible.
    const fixPrompt = `Retours de revue à corriger (seulement ceux-ci) :\n${withoutMarkers(review.text)}`
      + `${isGit ? COMMIT_INSTRUCTIONS : ''}${CHECKS_INSTRUCTIONS}`;
    const fix = await execute(dev.agent, dev.sessionId ? fixPrompt : `${brief}\n\n${fixPrompt}`, {
      mode: 'write', cwd, feature, role: 'dev',
      ...(dev.sessionId ? { resume: dev.sessionId, resumedFrom: dev.callId } : {}) });
    if (fix.status !== 'ok') {
      report.findings = withoutMarkers(review.text);
      return stop('BLOQUÉ', EXIT.blocked, `Correction par ${dev.agent} échouée : ${shortError(fix)}`);
    }
    dev = { ...fix, agent: dev.agent, sessionId: fix.sessionId ?? dev.sessionId };
  }
}

export function formatStory(report) {
  const skipped = report.devSkipped.length
    ? ` (sauté : ${report.devSkipped.map(({ agent, reason }) => `${agent} — ${reason}`).join(' ; ')})` : '';
  const lines = [`Dev : ${report.dev ?? 'aucun'}${skipped}`,
    `Commit : ${report.commits.length ? report.commits.join(' ; ') : 'aucun'}`,
    `Revue : ${report.reviews.length
      ? report.reviews.map(({ agent, round, verdict }) => `${agent} ${verdict} (tour ${round})`).join(' ; ') : 'aucune'}`,
    `Contrôles : ${report.checks ?? 'non rapportés'}`,
    `Statut : ${report.status}${report.detail ? ` — ${report.detail}` : ''}`];
  if (report.findings) lines.push('', 'Constats du relecteur :', report.findings);
  return `${lines.join('\n')}\n`;
}
