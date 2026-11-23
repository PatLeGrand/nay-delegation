# Fonctionnalité : skill Nay dans le dépôt et installation sur macOS

- **Branche :** feature/skill-mac
- **Créé par :** orchestrateur
- **Tâche :** une seule skill à jour dans le dépôt (`skills/nay/SKILL.md`) pour Claude Code, Codex et Antigravity, installée par lien ; installation possible sur macOS sans modifier le dépôt.

## Explorateur

Explorateur non lancé. Constats de l'orchestrateur : les skills Codex (`~/.codex/skills/nay`) et Antigravity (`~/.gemini/config/skills/nay-delegation`) étaient des copies hors dépôt, avec des chemins propres à une machine et sans `nay plan`, `nay wait`, `nay diagnose` ni les projets. Sur macOS, `codexBin` pointe vers un chemin Linux, et corriger `config/engine.json` fait refuser `nay update` ; le service de l'interface est systemd.

## Développeur

- Neon (`nay story`) : `loadEngineConfig` remplace un chemin absolu de CLI introuvable par le nom de repli de `binFallbacks` (`config/engine.json`), la variable `<CLI>_BIN` restant prioritaire ; `nay check-config` signale le repli.
- Orchestrateur : `skills/nay/SKILL.md` (commandes à jour, règles, rôles perso, projets, consignes par harness), section 6 de `docs/installation.md` (installation de la skill par lien), section 3 (ne plus modifier `config/engine.json`), section macOS (Homebrew, `PATH`, launchd, redémarrage après `nay update`), README.

## Reviewer

- Conformité Haiku : CHANGES sur 5 points, tous contestés par Neon avec raison (un seul commit par tour imposé par Nay, injection `engineLoader` nécessaire au test, test `bin` à adapter à la nouvelle ligne, champ `fallbacks` minimal, une seule phrase au README). Tranché par l'orchestrateur en faveur de Neon.
- Relecture Hydrogen de toute la branche (code, et docs comparées aux vraies commandes) : PASS. Remarque mineure corrigée : la règle d'installation autorisait encore à modifier les chemins de `config/`.

## Tests

- `test/config.test.js` : variable d'environnement prioritaire, chemin absolu absent → repli, chemin présent → gardé, nom nu → gardé, ligne de `check-config`.
- `nay update` simulé sans `systemctl` : code 0, « Service nay-ui non actif : rien à redémarrer. »
- `node --test "test/*.test.js"` : 308 réussis, 0 échec.
- Non testé sur un vrai Mac.
- Ma décision : en attente.

## Décision finale

- En attente.
