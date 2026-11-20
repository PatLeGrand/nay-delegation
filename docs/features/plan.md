# Fonctionnalité : enchaîner plusieurs stories

- **Branche** `feature/plan`
- **Créé par** Codex
- **Tâche** Exécuter un plan Markdown validé, avec dépendances et parallélisme borné.

## Explorateur

La commande `story` fournit le choix des agents selon les quotas et le journal utilisé par `nay wait`.

## Développeur

- `src/command.js` raccorde `nay plan` à la CLI et transmet à chaque story sa feature, son identifiant et le journal.
- `src/plan.js` lit les sections, valide le graphe avant exécution et planifie les tâches prêtes. Un échec se propage aux dépendants.
- `config/plan.json` fixe le parallélisme par défaut et le dossier des worktrees.

## Reviewer

Relecture externe en attente.

## Tests

`test/plan.test.js` exerce la CLI avec des stories simulées. Les cas couvrent le rejet avant tout appel,
les dépendances déclarées dans le désordre, le blocage transitif, le rapport et la limite de concurrence
dans des worktrees Git distincts.

## Décision finale

En mode série, les stories partagent le dossier du projet. En mode parallèle, l’orchestrateur reçoit
les noms des branches à fusionner et conserve les worktrees pour examiner les résultats.
