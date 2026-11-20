# Fonctionnalité : contrôles des stories dans la vue Relais

- **Branche :** feature/ui-controles
- **Tâche :** afficher le résumé des contrôles, leur provenance et les échecs dans Relais.

## Développeur

Relais regroupe les résultats par fonctionnalité et identifie chaque exécution par son
identifiant de story. À l’ouverture de la vue, l’interface lit les résultats des événements
`story_end` dans les journaux disponibles, rotations comprises. Elle les actualise quand
une story se termine et à la reconnexion du flux.

La ligne « Contrôles » apparaît si la story fournit un résumé. Le badge « vérifiés par Nay »
indique que Nay a lancé les contrôles. « déclarés, non vérifiés » signale un compte rendu du
développeur. Si l’origine est inconnue, seul le résumé apparaît. Le statut `CONTRÔLES`
affiche « Contrôles en échec », même en l’absence de résumé.

## Reviewer

- En attente de relecture.

## Tests

- Tests unitaires : journal archivé, rattachement de plusieurs exécutions à une fiche, story sans fiche et filtre par fonctionnalité.

## Décision finale

- En attente.
