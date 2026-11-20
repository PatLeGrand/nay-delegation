# Fonctionnalité : base saine et rôles « toujours » dans `nay story`

- **Branche :** feature/story-auto
- **Créé par :** développeur
- **Tâche :** vérifier que les contrôles du projet passent avant d'appeler le dev (statut `BASE ROUGE`, `--skip-baseline`), et lancer automatiquement après une relecture `PASS` les rôles perso lecture seule réglés sur `toujours` (`--no-roles`).

## Explorateur

Explorateur non lancé : périmètre déjà décrit (`src/story.js`, `src/checks.js`, `src/roles.js`, `src/lifecycle.js`, `src/command.js`, `config/checks.json`).

## Développeur

- `config/checks.json` et `src/checks.js` : réglage booléen `baseline` (`true` par défaut), validé par `loadChecksConfig`.
- `src/story.js` :
  - si le projet déclare `.nay/checks.json` et `baseline` est actif (sans `--skip-baseline`), lance les contrôles avant le dev ; un échec arrête sans appel d'agent en `BASE ROUGE` (code 1), constats sous « Contrôles déjà en échec avant le travail : » ;
  - après un verdict `PASS` du relecteur, lance chaque rôle perso `usage: 'toujours'` et `mode: 'read'` (hors auteur du code, même diff et consignes `NAY-VERDICT`, bascule sur modèle suivant, sauté sans bloquer si aucun modèle disponible) ;
  - un verdict `CHANGES` d'un rôle renvoie au dev (même session, compte pour `--rounds`) puis relance une relecture complète ;
  - ajoute `report.roles`, la ligne `Rôles :` dans `formatStory` (absente sans rôle), le champ `roles` dans `story_end`, ainsi que les options `roles`, `skipBaseline`, `baseline` et `skipRoles` sur `runStory`.
- `src/lifecycle.js` et `docs/cycle-de-vie.md` : cause `red_base` pour `BASE ROUGE`, champ `roles` dans `story_end` (verdicts masqués dans `src/eventLog.js`).
- `src/command.js` : options `--skip-baseline` et `--no-roles` sur `nay story`.
- `src/roles.js` : `formatGuide` indique qu'un rôle lecture seule `toujours` est lancé automatiquement par `nay story` après la relecture, et par `nay role` hors story.
- `README.md` : documentation des options et comportements.

## Reviewer

- En attente.

## Tests

- `test/checks.test.js` : validation de `baseline` dans `config/checks.json`.
- `test/story.test.js` : base rouge avant le dev, `--skip-baseline` et `baseline: false`, rôles lecture seule `toujours` (hors auteur, rôles écriture/autres ignorés), bascule et saut sans bloquer, verdict `CHANGES` d'un rôle (reprise dev puis nouvelle relecture, `DÉFAUTS` au dernier tour), `--no-roles` et transmission CLI.
- `test/roles.test.js` : wording de `formatGuide` pour les rôles `toujours` lecture seule vs écriture.
- `test/lifecycle.test.js` : cause `red_base` pour `BASE ROUGE`.

## Décision finale

- En attente.
