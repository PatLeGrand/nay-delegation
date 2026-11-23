// Commandes des rôles perso : `nay role` (lancer), `nay guide` (consignes de l'orchestrateur)
// et `nay usage` (enregistrer la règle choisie par l'utilisateur).
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { COMMIT_INSTRUCTIONS } from './commit.js';
import { chooseAgent } from './delegation.js';
import { PATH_USAGE, saveProjectUsage } from './projectRoles.js';
import { getRole, loadRolesReport, formatGuide, roleDelegation, rolePrompt, usagesFor } from './roles.js';
import { gitOps } from './story.js';
import { readLayer, userConfigDir, writeLayer } from './userConfig.js';

const MAX_DIFF_CHARS = 60_000;

// Le projet du dossier courant (ou de --cwd) ajoute ses sous-agents aux rôles listés.
export function guideCommand(args, output, { locate } = {}) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { cwd: { type: 'string' } } });
  if (positionals.length) throw new Error('Usage : nay guide [--cwd <projet>]');
  const report = loadRolesReport({ cwd: resolve(values.cwd ?? process.cwd()), locate });
  output.write(formatGuide(report.roles, roleDelegation(report.roles), report));
  return 0;
}

// `demander` efface la règle : l'orchestrateur reposera la question. Un rôle de projet garde sa
// règle dans `.nay/roles.json` du projet ; `selon-diff` prend ensuite les motifs de chemin.
export function usageCommand(args, output, { dir = userConfigDir(), locate } = {}) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { cwd: { type: 'string' } } });
  const { roles, project } = loadRolesReport({ cwd: resolve(values.cwd ?? process.cwd()), locate });
  const [id, usage, ...paths] = positionals;
  const role = id ? getRole(id, roles) : null;
  const usages = usagesFor(role);
  const choices = [...Object.keys(usages), 'demander'];
  if (!role || !choices.includes(usage) || (paths.length && usage !== PATH_USAGE)) {
    throw new Error(`Usage : nay usage <rôle> ${choices.join('|')} [--cwd <projet>]${
      Object.hasOwn(usages, PATH_USAGE) ? ` ; ${PATH_USAGE} <motif>…` : ''}`);
  }
  const value = usage === 'demander' ? null : usage;
  if (role.source === 'projet') {
    const entry = saveProjectUsage(project.root, id, value, paths);
    const where = entry.paths?.length && value === PATH_USAGE ? ` (${entry.paths.join(', ')})` : '';
    output.write(`Règle de ${id} (projet ${project.name}) : ${value ? usages[value] : 'à demander'}${where}\n`);
    return 0;
  }
  const personal = readLayer(dir, 'roles');
  writeLayer(dir, 'roles', { ...personal, [id]: { ...role, usage: value } });
  output.write(`Règle de ${id} : ${value ? usages[value] : 'à demander'}\n`);
  return 0;
}

// Un rôle en lecture seule passe au modèle suivant en cas d'échec ; en écriture, on s'arrête
// pour ne pas laisser deux agents modifier le même dossier.
export async function roleCommand(args, { input, output, errorOutput, execute, isAvailable, readStdin, finish, committer,
  locate }) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    cwd: { type: 'string' }, feature: { type: 'string' }, commit: { type: 'boolean', default: false },
    diff: { type: 'string' },
  } });
  if (positionals.length !== 2) {
    throw new Error('Usage : nay role <rôle> <brief.md|-> [--cwd <dossier>] [--feature <nom>] [--diff <révision>] [--commit]');
  }
  const [id, brief] = positionals;
  const cwd = resolve(values.cwd ?? process.cwd());
  const roles = loadRolesReport({ cwd, locate }).roles;
  const role = getRole(id, roles);
  const delegation = roleDelegation(roles);
  if (values.commit && role.mode === 'read') throw new Error(`--commit impossible : ${id} est en lecture seule`);
  const briefText = brief === '-' ? await readStdin(input) : await readFile(brief, 'utf8');
  const diff = values.diff ? `\n\nDiff à examiner (${values.diff}) :\n\n\`\`\`diff\n${
    await gitOps.show(cwd, values.diff, MAX_DIFF_CHARS)}\n\`\`\`` : '';
  const prompt = `${rolePrompt(role, briefText)}${diff}${values.commit ? COMMIT_INSTRUCTIONS : ''}`;
  const unavailable = new Set();
  for (;;) {
    const { agent, skipped } = chooseAgent(id, { delegation, isAvailable: (name) => !unavailable.has(name) && isAvailable(name) });
    const skips = skipped.map(({ agent: name, reason }) => `${name} (${reason})`).join(', ');
    output.write(`Rôle : ${id} · agent ${agent}${skips ? ` · sautés : ${skips}` : ''}\n`);
    const result = await execute(agent, prompt, { mode: role.mode, cwd, feature: values.feature, role: id });
    if (result.status === 'ok' || role.mode === 'write') {
      return finish(result, { commit: values.commit, cwd, output, errorOutput, committer,
        meta: { feature: values.feature ?? null, role: id } });
    }
    errorOutput.write(`${agent} a échoué : ${(result.error ?? result.status).split('\n')[0]}\n`);
    unavailable.add(agent);
  }
}
