// Commandes des rôles perso : `nay role` (lancer), `nay guide` (consignes de l'orchestrateur)
// et `nay usage` (enregistrer la règle choisie par l'utilisateur).
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readConfig } from './config.js';
import { COMMIT_INSTRUCTIONS } from './commit.js';
import { chooseAgent } from './delegation.js';
import { USAGES, getRole, loadRoles, formatGuide, rolePrompt } from './roles.js';
import { gitOps } from './story.js';
import { readLayer, userConfigDir, writeLayer } from './userConfig.js';

const MAX_DIFF_CHARS = 60_000;

export function guideCommand(args, output) {
  if (args.length) throw new Error('Usage : nay guide');
  output.write(formatGuide(loadRoles(), readConfig('delegation')));
  return 0;
}

// `demander` efface la règle : l'orchestrateur reposera la question.
export function usageCommand(args, output, { dir = userConfigDir() } = {}) {
  const choices = [...Object.keys(USAGES), 'demander'];
  if (args.length !== 2 || !choices.includes(args[1])) throw new Error(`Usage : nay usage <rôle> ${choices.join('|')}`);
  const [id, usage] = args;
  const role = getRole(id);
  const personal = readLayer(dir, 'roles');
  writeLayer(dir, 'roles', { ...personal, [id]: { ...role, usage: usage === 'demander' ? null : usage } });
  output.write(`Règle de ${id} : ${usage === 'demander' ? 'à demander' : USAGES[usage]}\n`);
  return 0;
}

// Un rôle en lecture seule passe au modèle suivant en cas d'échec ; en écriture, on s'arrête
// pour ne pas laisser deux agents modifier le même dossier.
export async function roleCommand(args, { input, output, errorOutput, execute, isAvailable, readStdin, finish, committer }) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    cwd: { type: 'string' }, feature: { type: 'string' }, commit: { type: 'boolean', default: false },
    diff: { type: 'string' },
  } });
  if (positionals.length !== 2) {
    throw new Error('Usage : nay role <rôle> <brief.md|-> [--cwd <dossier>] [--feature <nom>] [--diff <révision>] [--commit]');
  }
  const [id, brief] = positionals;
  const role = getRole(id);
  if (values.commit && role.mode === 'read') throw new Error(`--commit impossible : ${id} est en lecture seule`);
  const cwd = resolve(values.cwd ?? process.cwd());
  const briefText = brief === '-' ? await readStdin(input) : await readFile(brief, 'utf8');
  const diff = values.diff ? `\n\nDiff à examiner (${values.diff}) :\n\n\`\`\`diff\n${
    await gitOps.show(cwd, values.diff, MAX_DIFF_CHARS)}\n\`\`\`` : '';
  const prompt = `${rolePrompt(role, briefText)}${diff}${values.commit ? COMMIT_INSTRUCTIONS : ''}`;
  const unavailable = new Set();
  for (;;) {
    const { agent, skipped } = chooseAgent(id, { isAvailable: (name) => !unavailable.has(name) && isAvailable(name) });
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
