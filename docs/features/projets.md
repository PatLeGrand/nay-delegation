# Fonctionnalité : projets

- **Branche :** feature/projets
- **Créé par :** orchestrateur
- **Tâche :** regrouper les appels Nay par dépôt Git et journaliser leur branche.

## Développeur

- Détection via le dossier Git commun, avec nom personnalisable dans `.nay/project.json`.
- Projet et branche dans le journal de consommation, les événements des appels et ceux des stories.
- Repli sur les chemins historiques configurable et regroupement des appels sans projet.
- Liste des projets et consommation par projet via l'API, avec filtre cumulable dans l'API et la commande `nay status`.

## Reviewer

- Relecture en attente.

## Tests

- Tests unitaires : détection Git simulée, chemins historiques, métadonnées des appels et stories, agrégats, routes HTTP et filtre CLI.
- Ma décision : en attente.

## Décision finale

- En attente.
