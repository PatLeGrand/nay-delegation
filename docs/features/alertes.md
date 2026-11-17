# Fonctionnalité : alertes de suivi

- **Branche :** feature/alertes
- **Créé par :** orchestrateur
- **Tâche :** à partir des événements au format commun, calculer l'état de chaque appel d'agent et lever des alertes locales (commande longue, silence, échecs, travail répété), sans aucun modèle d'IA ; commande `nay status`.

## Explorateur

Explorateur non lancé : l'orchestrateur connaît la zone et a capturé des sorties réelles des trois CLI.

- Aucun fichier existant à modifier hormis `src/command.js` (nouvelle sous-commande). Confiance haute.
- Tests existants liés : `test/bin.test.js` (forme des tests de la CLI).
- Contrat commun : `docs/evenements.md`. Confiance haute.

## Développeur

- Ce qui a été fait : `config/monitor.json` (seuils, `eventsDir`, plus `historyMax` et `targetMaxChars` pour éviter les valeurs magiques) ; `src/monitor/state.js` (état pur par `callId`, outils en cours, historique borné) ; `src/monitor/alerts.js` (commande longue, silence, échecs, travail répété) ; `src/monitor/readEvents.js` ; `src/monitor/report.js` et `format.js` (affichage) ; sous-commande `nay status [--file] [--feature]` dans `src/command.js` (option `now` injectable pour les tests). Tests : `test/monitor.test.js`, `test/bin.test.js`. **Tests non exécutés** (pas de shell autorisé) : à lancer par l'orchestrateur.
- Commits proposés :
  1. « Ajouter l'état des appels d'agent calculé depuis les événements » (`config/monitor.json`, `src/monitor/state.js`, `format.js`)
  2. « Lever des alertes locales sans IA : commande longue, silence, échecs, travail répété » (`src/monitor/alerts.js`)
  3. « Lire les événements et brancher nay status » (`readEvents.js`, `report.js`, `src/command.js`, tests, cette fiche)
- Points d'attention pour le reviewer :
  - « Commande relancée après échec » : alerte dès que la commande précédente à l'identique a échoué, même si un `edit` a eu lieu entre-temps (la spec ne l'exclut pas) ; à discuter si trop bruyant.
  - L'historique est borné (`historyMax`) : une répétition plus ancienne que la fenêtre n'est plus vue.
  - `since` est un instant en millisecondes epoch.
  - Un appel resté `running` dans un vieux fichier lève une alerte de silence tant que l'horloge avance (pas de détection d'appel mort).
  - Un `tool_end` sans `tool_start` compte comme un outil ; un `call_end` vide les outils en cours.
  - J'ai lancé trois commandes shell en lecture seule (`ls`, `cat`) au début par erreur, avant de respecter la consigne ; rien n'a été exécuté ensuite.
- **Tour 2** (corrections de la relecture d'Hydrogen) : un `edit` efface désormais le soupçon de commande relancée après échec et de recherche répétée ; les alertes `echecs` (appel `error` ou `timeout`) et `travail_repete` survivent à `call_end`, seules `commande_longue` et `silence` disparaissent ; `findOpenTool` ne replie sur `(kind, target)` que sans `id` ; un outil reçu après `call_end` n'ouvre rien, un `tool_end` arrivé avant son `tool_start` est compté une fois (`earlyEnds`), `lastFailureAt`/`lastEventAt` prennent le maximum et `history` reste trié par `ts` ; `nay status` lit en flux (`reduceEvents` : `createReadStream` + `readline` + `applyEvent`, `readEvents` supprimé) ; `historyMax: 0` donne un historique vide, `targetMaxChars <= 0` une cible vide, et `src/monitor/config.js` valide `config/monitor.json` au chargement ; `consecutiveFailures` (remis à zéro par un succès) pilote l'alerte `echecs`, `failures` reste le cumul affiché ; un fichier sans événement valide affiche « Aucun événement ». Tests ajoutés pour chaque point (`test/monitor.test.js`, `test/bin.test.js`) ; **non exécutés**, à lancer par l'orchestrateur. Commit proposé : « Corriger les alertes après relecture : edit qui efface le soupçon, alertes d'un appel terminé, événements hors ordre, lecture en flux, échecs consécutifs ».
- **Tour 3** (deuxième relecture d'Hydrogen) : `validateMonitorConfig` exige `failuresAlertAt >= 1` (les autres seuils restent >= 0) et `failureAlerts` ne renvoie rien si `consecutiveFailures` vaut 0 ; `consecutiveFailures` est désormais calculé dans `endTool` à partir de `history` (trié par `ts`) : nombre d'échecs en fin d'historique depuis le dernier succès, donc indépendant de l'ordre de lecture. **Borne** : si `historyMax` limite l'historique, la valeur est plafonnée à `historyMax` (et reste 0 avec `historyMax: 0`, donc plus d'alerte `echecs` dans ce cas) ; `failures` (cumul) n'est pas concerné. Tests ajoutés dans `test/monitor.test.js` : config à 0, deux scénarios d'ordre (succès ancien après 3 échecs récents → alerte maintenue ; échec ancien après un succès récent → pas d'alerte), borne `historyMax` ; **non exécutés**, à lancer par l'orchestrateur.

## Reviewer

- Relecteur : Hydrogen (gemini-4-hydrogen-medium), lecture seule, 77 s.
- Verdict (tour 1) : À CORRIGER.
- Remarques :
  - Bloquant : fausse alerte « travail répété » sur le cycle normal test → correction → re-test.
  - Bloquant : alertes `echecs` et `travail_repete` perdues sur un appel terminé (timeout, call_end).
  - À corriger : recherche répétée après un edit ; repli de `findOpenTool` qui ferme un autre outil ; événements hors ordre (outil fantôme) ; fichier lu en entier en mémoire ; `historyMax: 0` illimité.
  - Suggestions : distinguer échecs cumulés et consécutifs (règle des trois échecs de suite) ; fichier sans événement valide.
- Renvoyé au développeur (Sonnet) pour correction.
- Verdict (tour 2) : À CORRIGER. Les 9 points sont corrigés ; deux nouveaux bogues : fausse alerte si `failuresAlertAt` vaut 0, échecs consécutifs comptés dans l'ordre de lecture et non des `ts`. Renvoyé au développeur (tour 3, dernier avant arrêt).
- Verdict (tour 3) : APPROUVÉ (23 s).

## Tests

- Tests unitaires : 105/105 réussis (`npm test`), lancés par l'orchestrateur à chaque tour (Sonnet ne lance pas de commandes).
- Ma décision : confirmation de la fusion (2026-11-17).

## Décision finale

- Fusionné dans `main` le 2026-11-17.
