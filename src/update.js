import childProcess from 'node:child_process';

export const SERVICE = 'nay-ui';

export function runProcess(command, args, cwd) {
  return new Promise((resolveRun) => {
    childProcess.execFile(command, args, { cwd }, (error, stdout, stderr) => {
      resolveRun({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        stdout: String(stdout ?? ''), stderr: String(stderr ?? error?.message ?? '') });
    });
  });
}

// Met à jour le dépôt Nay sur place : main propre → pull --ff-only → check-config (nouveau code)
// → redémarrage du service nay-ui s'il tourne. Retourne { code, lines }.
export async function runUpdate({ root, run = runProcess, nodeBin = process.execPath, branch = 'main' }) {
  const lines = [];
  const git = async (...args) => {
    const result = await run('git', ['-C', root, ...args], root);
    if (result.code !== 0) throw new Error(`git ${args.join(' ')} : ${(result.stderr || result.stdout).trim()}`);
    return result.stdout.trim();
  };
  try {
    const current = await git('branch', '--show-current');
    if (current !== branch) {
      return { code: 1, lines: [`Refus : le dépôt Nay est sur « ${current || 'HEAD détachée'} », pas sur ${branch}.`,
        `Travaille sur Nay dans un worktree séparé, puis : git -C ${root} switch ${branch}`] };
    }
    const dirty = await git('status', '--porcelain', '--untracked-files=no');
    if (dirty) {
      return { code: 1, lines: ['Refus : modifications non committées dans le dépôt Nay :', dirty] };
    }
    const before = await git('rev-parse', '--short', 'HEAD');
    await git('pull', '--ff-only', '--quiet');
    const after = await git('rev-parse', '--short', 'HEAD');
    if (before === after) {
      lines.push(`Déjà à jour (${after}).`);
    } else {
      lines.push(`Mise à jour ${before} → ${after} :`);
      lines.push(...(await git('log', '--oneline', `${before}..${after}`)).split('\n').map((line) => `  ${line}`));
    }
    // Le nouveau code est validé par un processus neuf, pas par celui-ci (chargé avant le pull).
    const check = await run(nodeBin, [`${root}/bin/nay.js`, 'check-config'], root);
    if (check.code !== 0) {
      lines.push(`Configuration invalide après mise à jour : ${(check.stderr || check.stdout).trim()}`);
      return { code: 1, lines };
    }
    lines.push(check.stdout.trim());
    const active = await run('systemctl', ['--user', 'is-active', SERVICE], root);
    if (active.stdout.trim() !== 'active') {
      lines.push(`Service ${SERVICE} non actif : rien à redémarrer.`);
    } else if (before === after) {
      lines.push(`Service ${SERVICE} actif, inchangé.`);
    } else {
      const restart = await run('systemctl', ['--user', 'restart', SERVICE], root);
      if (restart.code !== 0) {
        lines.push(`Échec du redémarrage de ${SERVICE} : ${restart.stderr.trim()}`);
        return { code: 1, lines };
      }
      lines.push(`Service ${SERVICE} redémarré.`);
    }
    return { code: 0, lines };
  } catch (error) {
    return { code: 1, lines: [...lines, error.message] };
  }
}
