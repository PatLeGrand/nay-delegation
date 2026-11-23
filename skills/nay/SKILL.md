---
name: nay
description: Déléguer du code, de l'exploration ou de la relecture à d'autres agents IA (Sol, Terra, Luna, Hydrogen, Argon, Gemini Flash, Sonnet, Haiku…) avec la commande `nay` installée sur la machine. À utiliser quand l'utilisateur demande de déléguer une tâche, de lancer une story ou un plan, de faire relire par un autre modèle, de suivre ou d'attendre des agents, ou de passer par Nay.
---

# Nay : déléguer à d'autres agents

Tu es l'**orchestrateur** : tu découpes, tu écris les briefs, tu lances Nay, tu lis ses comptes
rendus et tu décides. Nay fait le reste : choix des agents selon les quotas, appel de leurs CLI,
commits, relecture par un autre modèle, contrôles du projet, journal.

`nay` est une commande installée dans le `PATH` (lien vers `<dépôt Nay>/bin/nay.js`). Si elle est
introuvable, utilise `node <dépôt Nay>/bin/nay.js` ; le dépôt est d'habitude
`~/Documents/Projets/nay-delegation`. Une seule copie de Nay par machine.

## Au début d'une session

Lance `nay guide --cwd <projet>` et suis-le. Il liste les rôles perso de l'utilisateur (adversaire,
sécurité, UI…), les rôles du projet (ses sous-agents `.claude/agents`) et la règle de chacun :
- `toujours` : lancé sans demander ; `sur-demande` : seulement si l'utilisateur le demande ;
  `proposer` : le proposer en une ligne après le travail concerné ; `selon-diff` (rôles de projet) :
  comme `toujours`, si le diff touche les chemins indiqués.
- Règle pas encore fixée : pose la question avec les réponses proposées, enregistre le choix avec
  `nay usage <rôle> <règle> --cwd <projet>`, et ne lance pas le rôle avant.
- Sans rôle perso, rien ne change.

## Commande par défaut : `nay story`

```bash
nay story <brief.md|-> --cwd <projet> --feature <nom>
```

Choisit un développeur selon les quotas, lance les contrôles du projet (`.nay/checks.json`)
avant et après, fait committer, contrôle la conformité au brief, fait relire par un **autre
modèle**, renvoie les défauts au dev (2 tours par défaut, `--rounds <n>`), puis lance les rôles
perso `toujours`. Codes de sortie : `0` OK, `1` bloqué ou défauts restants (constats affichés),
`2` aucun agent disponible.

Options utiles : `--dev <agent>` (imposer le dev), `--id <storyId>` (pour `nay wait`),
`--skip-baseline` (contrôles déjà rouges avant le travail), `--no-roles`, `--no-conformity`.

## Autres commandes

| Besoin | Commande |
|---|---|
| Plusieurs tâches liées | `nay plan <plan.md> --cwd <projet> [--parallel <n>]` : un titre `## id : titre` par tâche, ligne `Après : a, b` pour les dépendances ; en parallèle, une branche et un worktree par tâche, fusion manuelle |
| Un seul appel | `nay run <agent> <brief\|-> [--read-only] [--commit] --cwd <projet> --feature <nom> --role <rôle>` |
| Reprendre un appel | `nay resume <callId> <retours\|-> [--commit]` (même session, contexte gardé) |
| Lancer un rôle perso | `nay role <rôle> <brief> --cwd <projet> [--diff HEAD] [--feature <nom>]` |
| Attendre sans sonder | `nay wait <storyId\|callId>...` ou `nay wait --feature <nom> [--since 10m]` |
| Comprendre un échec | `nay diagnose <storyId\|callId> [--explain]` |
| État en cours | `nay status [--project <nom>] [--feature <nom>]` |
| Quotas, choix d'agent | `nay quota`, `nay choose <rôle> [--author <agent>]` |
| Interface | `nay ui` → http://127.0.0.1:4318 |

`--read-only` pour explorer ou relire. `--commit` pour que Nay committe : l'agent ne peut
souvent pas écrire dans `.git` depuis son sandbox.

## Projets et branches

Nay déduit tout seul le **projet** (le dépôt Git du `--cwd`, même depuis un worktree) et la
**branche** de chaque appel : rien à déclarer. Passe quand même `--feature <nom>` : c'est ce qui
regroupe les appels d'une même fonctionnalité dans `nay wait`, `nay status` et l'interface. Pour
renommer un projet : `{"name": "…"}` dans `<dépôt>/.nay/project.json`.

## Règles

- **Brief autonome** : objectif, fichiers concernés, contraintes, critère de fin, message de
  commit attendu. L'agent ne voit pas ta conversation.
- **Briefs hors du dépôt** (dossier temporaire), jamais committés.
- **En arrière-plan** si ton harness le permet : une story dure de quelques minutes à plus de
  dix. Puis `nay wait <id>` plutôt que de relire le journal en boucle. Ne relance pas une
  commande qui tourne encore.
- **Lis le compte rendu**, pas le diff : lignes `Commit :`, `Revue :`, `Contrôles :`, `Statut :`.
  Ne relance pas les tests que Nay a déjà passés. Ne committe pas ce que Nay a déjà committé.
- **Un seul dev par lot de fichiers** ; en parallèle, seulement sur des fichiers disjoints
  (ou `nay plan --parallel`, qui isole chaque tâche dans un worktree).
- Statut `1` après les tours de correction : tranche toi-même ou demande à l'utilisateur.
- Push, PR et fusion seulement à la demande de l'utilisateur.

## Selon le harness

- **Codex** : Nay écrit son journal hors du dossier courant et lance d'autres CLI ; lance
  **chaque** commande `nay` hors sandbox (`sandbox_permissions: "require_escalated"`,
  justification « Délégation via Nay »). La règle `prefix_rule(pattern = ["nay"], decision = "allow")`
  dans `~/.codex/rules/nay.rules` l'approuve sans question.
- **Antigravity** : lance `nay` par `run_command` avec `WaitMsBeforeAsync: 10000`, laisse les
  appels longs continuer en arrière-plan et attends-les avec `nay wait`.
- **Claude Code** : `run_in_background` pour `nay story` / `nay plan`, puis `nay wait`.
