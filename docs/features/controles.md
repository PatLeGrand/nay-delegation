# Fonctionnalité : contrôles lancés par Nay

- **Branche :** feature/controles
- **Créé par :** orchestrateur
- **Tâche :** dans `nay story`, lancer soi-même les contrôles du projet (tests, lint) au lieu de croire la ligne `NAY-CHECKS` écrite par le dev. Idée reprise du skill *verification-before-completion* de Superpowers : des preuves plutôt que des affirmations.

## Explorateur

Explorateur non lancé : périmètre déjà lu par l'orchestrateur (`src/story.js`, `test/story.test.js`, `src/lifecycle.js`).

## Développeur

Écrit directement par l'orchestrateur.

- `src/checks.js` : lecture et validation de `.nay/checks.json` dans le dossier de la story, exécution séquentielle (shell, groupe de processus tué au délai), résumé et texte d'échec (fin de sortie seulement).
- `config/checks.json` : chemin du fichier projet, délai par défaut, taille de sortie gardée, `CI=1`.
- `src/story.js` : contrôles après chaque travail du dev, avant la relecture. Un échec renvoie au dev (même session) sans relecture et compte comme un tour ; au dernier tour → `CONTRÔLES`. Si tout passe, le résultat est joint au prompt du relecteur. Sans fichier, comportement précédent, affiché « déclarés par le dev, non vérifiés ».
- `src/lifecycle.js` : cause `checks` pour `CONTRÔLES` ; `story_end` porte `checks` et `checksBy`.
- `.nay/checks.json` : Nay se contrôle lui-même avec `node --test`.

## Reviewer

- Pas encore relu.

## Tests

- `test/checks.test.js` : fichier absent, valeurs par défaut, fichiers invalides, vraies commandes (codes, sortie tronquée, variables d'env), délai dépassé.
- `test/story.test.js` : échec puis correction puis revue, échec au dernier tour (`CONTRÔLES` sans relecteur), fichier invalide (aucun appel), affichage « non vérifiés ».
- `node --test "test/*.test.js"` : 252 réussis, 0 échec.

## Décision finale

- En attente.
