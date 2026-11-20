# Fonctionnalité : relecture en deux temps, TDD vérifié, contestation par le dev

- **Branche :** feature/revue-avancee
- **Créé par :** développeur
- **Tâche :** dans `nay story`, ajouter un contrôle de conformité au brief avant la relecture qualité, vérifier que les nouveaux tests d'un commit échouent sans le changement (TDD), et permettre au dev de contester une remarque de relecture (`NAY-DISPUTE`) avec arrêt en `DÉSACCORD` s'il ne change rien.

## Explorateur

Explorateur non lancé : périmètre décrit dans le brief (`src/story.js`, `src/checks.js`, `src/delegation.js`, `config/delegation.json`, `src/lifecycle.js`, `docs/cycle-de-vie.md`, `test/story.test.js`).

## Développeur

- `src/story.js` : `storyRounds` découpé en étapes courtes (`prepare`, `startDev`, `reviewRound`, `reviewSubject`, `projectChecks`, `provenByTests`, `conformityReview`, `qualityReview`, `runAutoRoles`, `correct`, `giveUp`). Ordre d'un tour : commit → contrôles → preuve TDD → conformité → relecture qualité → rôles « toujours ».
  - **Conformité** : rôle intégré `conformite`, lecture seule, auteur exclu, bascule sur le modèle suivant. `CHANGES` renvoie au dev (un tour) sans relecteur qualité ; au dernier tour → `DÉFAUTS` avec « Écarts au brief (contrôle de conformité) : ». Rôle absent ou aucun modèle : noté sauté. `report.conformity`, ligne `Conformité :`, option `skipConformity`.
  - **TDD** : si le projet marque un contrôle `"tdd": true` et que le dev a committé, `checker.tdd` relance ce contrôle sur le parent avec les nouveaux tests. Non prouvé → avertissement dans le prompt du relecteur qualité. `report.tdd`, ligne `TDD :`.
  - **Contestation** : consigne `NAY-DISPUTE` ajoutée aux corrections de relecture (pas aux contrôles en échec). Contestations sans changement (empreinte de l'arbre inchangée) → `DÉSACCORD`, « Désaccords à trancher : » ; avec changements → transmises au relecteur suivant (« Le dev conteste : … ; tranche »). `report.disputes`, `parseDisputes`.
  - `story_end` porte `conformity`, `tdd` et `disputes`.
- `src/tdd.js` (nouveau) : motifs glob (`globToRegExp`, `isTestFile`), fichiers ajoutés/modifiés d'un commit, worktree git détaché sur le parent sous `.nay/worktrees`, nouveaux tests copiés, suppression en `finally` (repli `rm` + `git worktree prune`). La commande reçoit `NAY_TEST_FILES`.
- `src/checks.js` : champ `tdd` (booléen) des contrôles projet ; `testPatterns` et `tddWorktreesDir` validés dans `config/checks.json` ; `runChecks` accepte `extraEnv`.
- `config/delegation.json` : rôle `conformite` (`haiku`, `luna`, `gemini-flash`) ; `validateDelegation` le valide déjà comme liste simple.
- `src/roles.js` (`BUILTIN_ROLES`), `ui/js/config.js` (`ROLE_LABELS`, `DELEGATION_SIMPLE_ROLES`) : rôle intégré visible et réglable dans Aiguillage.
- `src/lifecycle.js` : cause `dispute` pour `DÉSACCORD` ; `src/eventLog.js` : masquage des nouveaux champs.
- `src/command.js` : option `--no-conformity`.
- `README.md`, `docs/cycle-de-vie.md`, `docs/evenements.md` : documentation.

## Reviewer

- En attente.

## Tests

- `test/story.test.js` : conformité PASS avant la qualité (auteur exclu, lecture seule, `story_end`), conformité `CHANGES` (retour au dev sans relecteur qualité, `DÉFAUTS` au dernier tour), étape sautée (rôle absent, aucun modèle, `--no-conformity`), CLI ; TDD prouvé / non prouvé (avertissement au relecteur) / erreur / sauté ; `parseDisputes`, `DÉSACCORD` sans changement, contestation transmise avec changements, pas de contestation pour les contrôles.
- `test/tdd.test.js` : motifs glob ; vrai dépôt git temporaire : tests rouges sur le parent (prouvé), déjà verts (non prouvé), rien à prouver, worktree supprimé même si le contrôle lève une erreur.
- `test/checks.test.js` : champ `tdd`, réglages TDD de la config, `extraEnv`.
- `test/lifecycle.test.js` : cause `dispute`, masquage des nouveaux champs de `story_end`.

## Décision finale

- En attente.
