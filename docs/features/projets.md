# Fonctionnalité : projets

- **Branche :** feature/projets
- **Créé par :** orchestrateur
- **Tâche :** regrouper les appels Nay par dépôt Git et journaliser leur branche.

## Développeur

- Détection via le dossier Git commun, avec nom personnalisable dans `.nay/project.json`.
- Projet et branche dans le journal de consommation, les événements des appels et ceux des stories.
- Repli sur les chemins historiques configurable et regroupement des appels sans projet.
- Liste des projets et consommation par projet via l'API, avec filtre cumulable dans l'API et la commande `nay status`.
- Dans `nay ui`, le premier sélecteur filtre la consommation, le statut, le flux SSE, les fiches et les rapports de contrôles. Le navigateur mémorise le choix et revient à « Tous les projets » si ce projet disparaît de la liste.
- Changer de projet réinitialise le filtre de fonctionnalité. Les options proviennent de l'historique du projet et des données visibles sur ce périmètre.
- Les fiches de `docs/features/` portent le nom du projet détecté au démarrage du serveur à la racine de Nay. Pour un appel sans fonctionnalité, l'interface affiche sa branche si elle est connue.

## Reviewer

- Partie 1 (serveur, `nay story` projets-a, dev Sol 6.2) : conformité Haiku CHANGES puis PASS ; relecture Hydrogen PASS au tour 2.
- Partie 2 (interface, `nay story` projets-b) : la conformité Haiku a signalé au tour 2 des « retraits » qui n'étaient que l'annulation d'ajouts hors brief du tour 1 (diff final comparé à `main` : rien de perdu). Seule la doc de `/api/features` et du flux SSE manquait, complétée par l'orchestrateur.
- Relecture Hydrogen dédiée de l'interface (`nay run --role relecteur`) : PASS.

## Tests

- Tests unitaires : détection Git simulée, chemins historiques, métadonnées des appels et stories, agrégats, routes HTTP et filtre CLI.
- `test/server.test.js` couvre le cumul des filtres SSE, les événements historiques sans projet, le projet des fiches et les métadonnées des contrôles.
- `test/ui.test.js` couvre l'ordre des projets, l'option « Essais hors Git », les fonctionnalités par projet et le filtrage des fiches et des contrôles.
- `node --test "test/*.test.js"` : 306 réussis, 0 échec.
- Essai réel (`nay ui` de la branche sur les vrais journaux) : 13 projets listés, worktrees regroupés sous leur dépôt ; weather-source-benchmark → 35 appels et ses seules fonctionnalités ; choix gardé après rechargement ; pas de défilement horizontal à 375 px.
- Ma décision : en attente.

## Décision finale

- En attente.
