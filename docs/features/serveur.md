# Fonctionnalité : serveur de l'interface

- **Branche :** feature/serveur
- **Créé par :** orchestrateur
- **Tâche :** serveur HTTP localhost sans dépendance qui expose la consommation, les quotas, l'état des agents, les fiches et l'ordre de délégation, plus un flux en direct des événements ; commande `nay ui`.

## Explorateur

Explorateur non lancé : l'orchestrateur connaît la zone.

- `src/usageLog.js` (`readUsage`), `src/quota/index.js` (`readQuotas`, `isAgentAvailable`, `quotaAgentConfig`), `src/monitor/` (`reduceEvents`, `latestEventsFile`, `applyEvent`, `computeAlerts`, `loadMonitorConfig`), `src/delegation.js` (`validateDelegation`), `src/config.js` (`readConfig`, `repositoryRoot`), `src/command.js` (sous-commande `ui`). Confiance haute.
- Tests existants liés : `test/monitor.test.js`, `test/delegation.test.js`, `test/bin.test.js`.
- Contrat commun : `docs/api.md`. Confiance haute.

## Développeur

- Ce qui a été fait : serveur HTTP Node sans dépendance et fabrique testable `createServer({ root, config, now })` ; routes du contrat `docs/api.md`, garde Host et garde Origin/JSON du PUT, corps borné, validation existante et remplacement atomique de la délégation ; statiques confinés sans liens symboliques ; agrégation depuis `usage.jsonl`, quotas avec le cache existant et lecteur injectable ; état et alertes via le moniteur en flux, événements d'un appel recherchés aussi dans les rotations et les jours précédents ; analyse tolérante des fiches ; flux SSE incrémental avec filtre, heartbeat, renommage et changement de jour UTC ; commande `nay ui`, configuration et page provisoire unique.
- Commits : aucun. Une tentative de `git add` a échoué : `Unable to create .../.git/worktrees/serveur/index.lock: Read-only file system`. Aucune nouvelle tentative.
- Messages prévus : `Exposer le suivi local des agents avec une API protégée` ; `Permettre de lancer et documenter l’interface Nay`. Chaque message sera suivi d’une ligne vide puis de `Co-Authored-By: GPT-6.1-Sol <noreply@openai.com>`.
- Validation : `node --test "test/*.test.js"` termine avec le code 0, 10 fichiers réussis, aucun échec. Le détail avec `--test-isolation=none` donne 138 tests, 136 réussis, 0 échec, 2 ignorés : le bac à sable refuse l’écoute locale (`listen EPERM: operation not permitted 127.0.0.1`). Les mêmes gestionnaires HTTP et SSE sont testés en mémoire, y compris les corps trop gros, les écritures, les filtres, les lignes fragmentées, les rotations et le changement de date. Aucun agent réel ni relevé agy lancé.
- Points d'attention pour le reviewer : relancer les deux tests réseau et essayer `nay ui` hors du bac à sable ; les tests réseau ne sont ignorés que pour EPERM. Les journaux viennent du dépôt central en worktree, la page, les fiches et la délégation du worktree actif. Les dates internes du moniteur sont converties en ISO UTC. Le SSE commence à la fin du fichier à l’abonnement (nouveaux événements seulement), conserve le descripteur renommé jusqu’au drainage et coupe les clients qui ne consomment plus le flux. Le cache des quotas n’est pas contourné. La page provisoire est à remplacer par `feature/page-web`. Les modules interdits n’ont pas été modifiés.

## Reviewer

- Relecteur : Hydrogen (gemini-4-hydrogen-medium), lecture seule, 76 s.
- Verdict (tour 1) : APPROUVÉ. Sécurité (Host, Origin, taille, chemins, écriture atomique) et contrat respectés.
- Suggestions appliquées par l'orchestrateur : flux SSE maintenu pendant une rotation ; fusion détectée seulement par « Fusionné dans main » ; outils en cours dans l'ordre d'ouverture. Relu par Hydrogen : APPROUVÉ.

## Tests

- Tests unitaires : 138/138 réussis (`npm test`), dont les tests réseau, avec la page web combinée.
- Essai réel (orchestrateur) : `nay ui`, Host étranger → 403, sortie du dossier → 404, PUT sans Origin → 403, enregistrement de la délégation depuis la page vérifié avec `nay choose`, reconnexion du flux après redémarrage.
- Ma décision : confirmation de la fusion (2026-11-17).

## Décision finale

- Fusionné dans `main` le 2026-11-17.
