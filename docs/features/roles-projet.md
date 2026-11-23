# Fonctionnalité : rôles de projet

- **Branche :** feature/roles-projet
- **Créé par :** orchestrateur (session déléguée)
- **Tâche :** importer les sous-agents Claude Code d'un projet (`.claude/agents/*.md`) comme rôles perso visibles seulement dans ce projet, sans copie, avec une règle d'usage « selon le diff ».

## Explorateur

Explorateur non lancé : périmètre lu directement (`src/roles.js`, `src/config.js`, `src/project.js`, `src/roleCommands.js`, `src/story.js`, serveur et vue Aiguillage), plus les 6 agents de hacksorel-2 sur `origin/develop`.

## Décisions

- **Conflit d'id** (validé par l'utilisateur) : le plus précis gagne. Ordre, du plus faible au plus fort : rôles globaux `~/.config/nay/roles.json` < agents `.claude/agents` du checkout visé < réglages `.nay/roles.json` du projet. Le rôle global de même id est masqué dans ce projet ; `check-config` et `nay guide` le signalent.
- **Où lire** : les agents dans le checkout visé par `--cwd` (sa branche, worktrees compris) ; `.nay/roles.json` à la racine du checkout principal (dossier Git commun), car `.nay/` est souvent exclu de Git et absent des worktrees.
- **Pas de copie** : `loadRoles({ cwd })` relit les fichiers à chaque appel ; la consigne suit la branche tout de suite.
- **Mode** : `read` si l'agent n'a ni `Edit` ni `Write` (`tools` sans eux, ou `disallowedTools` qui contient les deux), sinon `write`. Ex. `qa-attacker` (interdit Edit seulement) est en écriture.
- **`model:`** : gardé comme indication (`claudeModel`), affiché, jamais utilisé pour choisir l'agent.
- **Chaîne d'agents** : `agents` de `.nay/roles.json`, sinon `relecteur.parDefaut`. La chaîne d'un rôle global masqué ne s'applique pas.
- **`selon-diff`** : réservé aux rôles de projet, exige `paths`. Dans `nay story`, les chemins touchés sont cumulés sur toute la story (commits de Nay ou modifications en cours) ; un rôle non concerné est noté « non concerné ». Chemins inconnus (hors Git, erreur git) : le rôle est lancé.
- **Erreurs** : fichier d'agent invalide, réglage invalide, id inconnu, JSON cassé → ignorés et listés, jamais bloquants.

## Développeur

Écrit directement par la session.

- `src/projectRoles.js` : localisation du projet (checkout et racine), lecture du frontmatter, mode, réglages `.nay/roles.json` (lecture, validation, écriture atomique), motifs de chemin, chaînes d'agents, `saveProjectUsage`.
- `src/roles.js` : règle `selon-diff`, `loadRolesReport({ cwd })` (fusion, masqués, erreurs), `roleDelegation`, guide avec section « Rôles du projet », règles par chemins et rôles masqués.
- `src/roleCommands.js` : `nay guide [--cwd]`, `nay usage <rôle> <règle> [motifs…] [--cwd]` (écrit dans le projet pour un rôle de projet), `nay role` avec les rôles et chaînes du projet.
- `src/command.js` : `nay check-config [--cwd]` liste les rôles du projet, les rôles globaux masqués et les fichiers ignorés.
- `src/story.js` : rôles du projet de `--cwd`, chaînes ajoutées à la délégation, `gitOps.changedFiles`, règle `selon-diff`.
- Serveur : `GET /api/project-roles?project=<nom>` (checkout principal retrouvé via le journal de consommation, jamais un chemin envoyé), `PUT /api/project-roles/<id>?project=<nom>` (règle dans `.nay/roles.json`). `/api/delegation` ne propose plus `selon-diff` pour les rôles globaux.
- Interface (Aiguillage) : sous « Rôles perso », section « Rôles du projet <nom> » pour le projet choisi en haut : badge « projet », badge « masque le global », chaîne d'agents, chemins, `model:` indicatif, règle modifiable, fichiers ignorés.
- Config hacksorel-2 (hors dépôt Nay, `.nay/roles.json` exclu de Git) : `conventions-reviewer` et `security-reviewer` toujours ; `db-reviewer` selon le diff (`scripts-sql/**`, `app/**/Models/**`, `app/**/Repositories/**`, `Docs/DB.md`) ; `ui-ux-reviewer` selon le diff (`**/*.vue`) ; `test-runner` et `qa-attacker` sur demande.

## Reviewer

- Pas encore relu par un autre modèle.

## Tests

- `test/projectRoles.test.js` : frontmatter, mode, motifs, lecture avec fichiers invalides et réglages, consigne relue après changement, worktree (agents de sa branche, réglages du principal), fusion et masquage, chaînes, guide (et rien depuis un autre projet), `nay usage` dans le projet, `nay role`, story `selon-diff`, API `/api/project-roles`.
- `node --test "test/*.test.js"` : 320 réussis, 0 échec.
- Essai réel : `nay guide` lancé depuis un worktree de `origin/develop` de hacksorel-2 liste les 6 rôles avec leurs règles ; depuis le dépôt Nay, aucun. Interface sur une fixture des 6 agents : section affichée, règle enregistrée dans `.nay/roles.json`, pas de défilement horizontal à 375 px.
- Limite : l'interface lit les agents du checkout principal ; tant qu'il n'est pas sur une branche qui contient `.claude/agents`, la section est vide pour ce projet.

## Décision finale

- En attente.
