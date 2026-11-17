# Fonctionnalité : flux d'événements

- **Branche :** feature/flux-evenements
- **Créé par :** orchestrateur
- **Tâche :** suivre chaque agent pendant qu'il travaille : lire les événements JSON des trois CLI au fil de l'eau, les convertir au format commun et les écrire dans un journal central ; centraliser aussi le journal de consommation ; relever le quota Claude envoyé pendant les appels.

## Explorateur

Explorateur non lancé : l'orchestrateur connaît la zone et a capturé des sorties réelles des trois CLI.

- `src/runAgent.js` (`execute`, `collectResult`, `runAgent`) : lecture de stdout, à passer ligne par ligne. Confiance haute.
- `src/cli/codex.js`, `src/cli/agy.js`, `src/cli/claude.js` (`buildArgs`, `parseResult`) : à compléter par la conversion des événements. Confiance haute.
- `src/usageLog.js`, `config/engine.json` (`usageLogPath`) : chemin à résoudre depuis la racine de Nay. Confiance haute.
- `src/quota/claude.js` : à brancher sur le dernier relevé de quota Claude. Confiance haute.
- Tests existants liés : `test/cli.test.js`, `test/runAgent.test.js`, `test/usageLog.test.js`, `test/quota.test.js`.
- Contrat commun : `docs/evenements.md`. Confiance haute.

## Développeur

- Ce qui a été fait : adaptateurs purs `toEvents` pour Codex, agy et Claude ; sortie `stream-json` pour agy et Claude (`--verbose`) ; résultat et consommation finale extraits du flux. Correspondances d'outils et limites dans `config/events.json`.
- Journalisation : lecture incrémentale de stdout, métadonnées communes et identifiant unique, `call_start`/`call_end`, callback `onEvent`, troncature, rotation quotidienne UTC avec rétention. Les écritures d'événements et les callbacks défaillants sont isolés ; une erreur du journal de consommation rejette toujours la promesse.
- Centralisation : racine commune Git du dépôt Nay depuis le worktree, indépendante du `cwd` de l'agent. L'option API `journalRoot` permet d'isoler les journaux dans les tests.
- Quota Claude : dernier relevé valide persisté par remplacement atomique, fenêtres `5h`/`7j`, pourcentage restant et péremption configurable ; état inconnu en l'absence de relevé lisible.
- Commits prévus (Git en lecture seule : création de `.git/worktrees/flux-evenements/index.lock` refusée ; aucun commit créé) :
  - `Normaliser les flux pour suivre les outils des agents`
  - `Centraliser les journaux pour survivre aux worktrees`
  - `Conserver le quota Claude sans appel supplémentaire`
  - `Documenter le suivi et sa validation`
  Chaque message sera suivi d'une ligne vide puis de `Co-Authored-By: GPT-6.1-Sol <noreply@openai.com>`.
- Points d'attention pour le reviewer : les résultats Claude portent seulement l'identifiant d'outil ; `runAgent` réutilise le descripteur du lancement dans le même appel. Les rotations sont sérialisées entre appels d'un même processus ; plusieurs processus Nay indépendants ne disposent pas d'un verrou partagé. Le cache de quotas conserve son délai `cacheTtlSec`. Les anciens résultats JSON uniques restent acceptés pour compatibilité. Aucun changement de permission CLI, aucun agent réel lancé.


**Tour 2** — Les sept retours sont corrigés : rotation sous verrou fichier exclusif partagé (`lockWaitMs`, `lockRetryMs`, `lockMaxAgeMs`), sans réinitialisation du journal ; expiration de l’attente sans perdre l’événement et reprise d’un verrou abandonné ; masquage configurable de `tool.target`, `output` et `text` avant troncature et callback, sans modifier `result.text` ; outils Codex limités à la configuration ; appariement sans identifiant par `(kind, target)` dans l’ordre de lancement, avec `id: null` pour agy sans `step_index` ; chargement et validation de la config par appel, désactivation du journal avec avertissement si elle est illisible ou invalide, sans interrompre l’agent ni `usage.jsonl` ; fenêtres de quota Claude issues de la config et pourcentage arrondi à une décimale ; messages Claude réservés au texte assistant. Validation : `npm test` indisponible (`npm: command not found`) ; commande exacte du script exécutée directement, `node --test "test/*.test.js"` : 8 fichiers réussis, 0 échec ; détail avec `--test-isolation=none` : 94 tests réussis, 0 échec. Les nouveaux tests utilisent des appels simulés et deux processus Node écrivant pendant les rotations ; aucun agent réel lancé, aucune option de permission modifiée. Attention pour la relecture : rotation avant l’ajout, dépassement temporaire de taille possible si le verrou reste occupé ; `maxRotatedFiles: 0` désactive la rotation pour conserver les événements. Aucun commit : Git refuse `index.lock` (système de fichiers en lecture seule), sans nouvelle tentative. Messages prévus, un par point : « Préserver les événements des processus concurrents » ; « Masquer les secrets avant leur diffusion » ; « Écarter les faux outils Codex » ; « Relier les outils même sans identifiant » ; « Préserver les appels sans config événements » ; « Respecter les fenêtres Claude configurées » ; « Réserver les messages au texte assistant ». Chaque message sera suivi d’une ligne vide puis de `Co-Authored-By: GPT-6.1-Sol <noreply@openai.com>`.

**Tour 3** — Les trois retours sont corrigés : masquage limité aux segments de noms (séparateurs et camelCase), jetons Bearer d’au moins 16 caractères, préfixes de clés sensibles à la casse et longueurs minimales réalistes ; drapeaux de regex définis et validés par motif ; valeurs d’affectation entre guillemets consommant les caractères échappés, sans laisser de suffixe secret ; récupération d’un verrou périmé sérialisée par un répertoire exclusif `.lock.reclaim`, avec nouvelle vérification de péremption, renommage atomique vers un nom unique puis suppression de ce seul fichier. Le test de concurrence suspend deux processus Node après leur observation du même verrou périmé et vérifie que le second préserve le verrou recréé par le premier. Validation réelle : `npm test` échoue avec `npm: command not found` (code 127) ; commande exacte du script `node --test "test/*.test.js"` réussie (8 fichiers, 0 échec) ; détail avec `--test-isolation=none` : 98 tests réussis, 0 échec ; `git diff --check` réussi. Aucun agent réel lancé. Aucun commit : une tentative de `git add` refuse la création d’`index.lock` (Read-only file system), sans insister. Messages prévus, un par point : « Limiter le masquage aux noms et jetons sensibles » ; « Masquer entièrement les valeurs aux guillemets échappés » ; « Préserver les verrous recréés pendant leur récupération ». Point d’attention : un arrêt brutal pendant la récupération peut laisser un répertoire `.lock.reclaim` ; après vérification qu’aucun récupérateur ne travaille, sa suppression permet de reprendre les récupérations. Tant qu’il reste présent avec un verrou périmé, l’attente reste bornée et l’ajout des événements continue sans rotation.

## Reviewer

- Essai réel par l'orchestrateur (avant relecture) : Haiku et Gemini Flash en lecture seule ; séquence call_start → outil → message → usage → call_end écrite dans le journal central ; Haiku tourne bien sur claude-haiku-5-5.
- Relecteur : Hydrogen (gemini-4-hydrogen-medium), lecture seule, 86 s.
- Verdict (tour 1) : À CORRIGER. Pas de bloquant.
- Remarques :
  - Rotation non protégée entre processus `nay run` parallèles : événements écrasés.
  - Secrets (jetons, clés) écrits en clair dans les commandes et sorties journalisées.
  - Items Codex `reasoning` journalisés comme des outils.
  - Outils sans identifiant mal appariés.
  - Config d'événements illisible qui fait échouer l'appel de l'agent.
  - Suggestions : fenêtres Claude codées en dur et arrondi ; blocs texte des messages `user` pris pour des messages de l'agent.
- Renvoyé au développeur (Sol) pour correction.
- Verdict (tour 2) : À CORRIGER. Les 7 points sont corrigés ; nouveaux problèmes : masquage trop large (mots courants masqués), `NOM="…\"…"` mal masqué, course sur la suppression d'un verrou abandonné. Renvoyé au développeur (tour 3, dernier avant arrêt).
- Verdict (tour 3) : À CORRIGER. Les 3 points sont corrigés ; une garde `.lock.reclaim` laissée par un processus tué bloquait la rotation jusqu'au changement de date. Troisième échec : arrêt, décision de l'utilisateur de laisser l'orchestrateur corriger.
- Correctif de l'orchestrateur, 1re version (garde périmée supprimée) : relu par Hydrogen, À CORRIGER (nouvelles courses entre processus sur la garde).
- Correctif de l'orchestrateur, 2e version : verrou supprimé. La rotation renomme atomiquement le fichier du jour vers une archive au nom unique (`AAAA-MM-JJ.<ms>-<séquence>-<aléa>.jsonl`) puis supprime les archives au-delà de `maxRotatedFiles`. Deux processus simultanés produisent au pire une archive de plus, sans perte de ligne. −150 lignes.
- Verdict (2e version) : APPROUVÉ (32 s).

## Tests

- Tests unitaires : 97/97 réussis (`npm test`, trois exécutions). Essai réel Haiku et Gemini Flash : événements écrits dans le journal central.
- Ma décision : confirmation de la fusion (2026-11-17).

## Décision finale

- Fusionné dans `main` le 2026-11-17.
