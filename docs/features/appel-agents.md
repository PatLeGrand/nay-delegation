# Fonctionnalité : appel des agents

- **Branche :** feature/appel-agents
- **Créé par :** orchestrateur
- **Tâche :** appeler chaque agent (Codex, agy, claude -p) depuis une config, en mode écriture ou lecture seule, et enregistrer chaque appel avec sa consommation de jetons dans un journal JSONL.

## Explorateur

Pas d'explorateur : dépôt neuf, aucun code existant.

- Fichiers repérés : aucun.
- Référence externe : `../workflow-code-1/.claude/scripts/delegate.mjs` (appel Codex/agy, lecture de l'usage Codex), confiance haute.
- Tests existants liés : aucun.

## Développeur

- Ce qui a été fait : configurations des neuf agents, adaptateurs purs Codex/agy/Claude, exécution asynchrone avec timeout, journal JSONL et commande `nay run`. Documentation de l’API et des conventions de comptage dans le README.
- Commits : aucun ; la tentative de création du premier commit a échoué (`.git/index.lock: Read-only file system`). Branche `feature/appel-agents` conservée.
- Étapes de commit prévues (avec la signature demandée) :
  - `Configurer les agents et normaliser leurs réponses CLI`
  - `Tracer chaque appel même en cas d’échec ou de timeout`
  - `Exposer les appels depuis la commande nay`
- Points d'attention pour le reviewer : le journal est relatif au dossier de travail ; une impossibilité d’écrire le journal rejette la promesse ; les erreurs d’agent sont renvoyées dans le résultat. Les fichiers temporaires sont nettoyés. Sous Unix, le timeout arrête le groupe de processus ; sous Windows, seul le processus direct est arrêté.

**Tour 2** — Correction des cinq retours Hydrogen : Codex échoue explicitement sans `turn.completed` et conserve les consommations déjà reçues lors des erreurs ; les prompts agy commençant par `-` passent par le même `brief.md` temporaire que les prompts longs ; aucun signal n'est envoyé sans PID ; les motifs d'erreur JSON sont ajoutés au code de sortie et à stderr ; `.nay-call-*/` est ignoré. Huit tests ajoutés, avec processus, flux et horloges simulés, sans lancer de vrai CLI. Validation réelle : `npm test` réussit (5 fichiers annoncés) ; avec `NODE_OPTIONS=--test-isolation=none`, les 33 cas passent, 0 échec, 0 ignoré. npm a été rendu accessible par un lien temporaire dans le PATH, sans changer le dépôt. `git diff --check` est propre. Attention pour la relecture : vérifier les deux événements d'échec Codex (`turn.failed` et `error`), la conservation des jetons et du motif dans le journal, ainsi que le nettoyage du brief. Aucune nouvelle relecture par un agent n'a été lancée. La préparation du premier commit a échoué avec `.git/index.lock: Read-only file system` ; aucune nouvelle tentative. Commits prévus, un par point :

- `Refuser les réponses Codex sans tour terminé`
- `Éviter de traiter les prompts agy comme des options`
- `Éviter un signal sans processus démarré`
- `Conserver le motif JSON des échecs CLI`
- `Ignorer les dossiers temporaires des appels`

Chaque message sera suivi d'une ligne vide puis de `Co-Authored-By: GPT-6.1-Sol <noreply@openai.com>`. Cette mise à jour de la fiche accompagne le dernier commit prévu. Branche `feature/appel-agents` conservée, aucun push.

## Reviewer

- Relecteur : Hydrogen (gemini-4-hydrogen-medium), lecture seule, 78 s, lancé via `nay run`.
- Verdict (tour 1) : À CORRIGER. Aucun bloquant ; options de sandbox et de permissions conformes.
- Remarques :
  - Bogue de logique : une sortie Codex sans `turn.completed` est acceptée comme `ok` avec 0 jeton (`src/cli/codex.js`).
  - Gestion d'erreurs : prompt agy commençant par `-` passé après `-p`, risque d'être lu comme une option (`src/cli/agy.js`).
  - Gestion d'erreurs : `killProcess` appelle `process.kill(NaN)` si le processus n'a pas démarré (`src/runAgent.js`).
  - Suggestion : le motif d'erreur JSON du CLI est perdu quand le code de sortie est non nul (`src/runAgent.js`).
  - Suggestion : dossiers `.nay-call-*` à ignorer dans Git.
- Renvoyé au développeur (Sol) pour correction.
- Verdict (tour 2) : APPROUVÉ. Les cinq points sont corrigés et testés, aucun nouveau problème (27 s).

## Tests

- Tests unitaires : 33/33 réussis (`node --test`, relancé par l'orchestrateur après le tour 2). Aucun vrai CLI appelé dans les tests.
- Essai réel : trois appels via `nay run` (Hydrogen ×2, Sol ×1), tous enregistrés dans `.nay/state/usage.jsonl`.
- Ma décision : confirmation de la fusion (2026-11-17).

## Décision finale

- Fusionné dans `main` le 2026-11-17.
