# Fonctionnalité : catalogue-modeles

- **Branche :** feature/catalogue-modeles
- **Créé par :** orchestrateur
- **Tâche :** lire au démarrage les modèles proposés par chaque CLI et créer, régler ou retirer des agents depuis l'interface.

## Explorateur

- Codex : `codex debug models` renvoie le catalogue JSON (`slug`, `visibility`, `supported_reasoning_levels`), environ 800 Ko.
- agy : `agy models` liste une ligne `id<TAB>nom` par variante d'effort, précédée de « Fetching available models... ».
- Claude : aucune commande de liste dans le CLI ; liste fixe dans `config/models.json`.

## Développeur

- `src/models/catalog.js` : analyse des sorties, regroupement agy en `modele-{effort}`, efforts limités à ceux de Nay, lecture parallèle avec délai, cache `.nay/state/models.json`, repli sur le dernier catalogue en cas d'échec.
- `src/agents.js` : validation d'un agent et de son nom, rôles qui citent un agent, écriture une ligne par agent (identique au fichier écrit à la main).
- Serveur : `GET /api/models`, `POST /api/models/refresh`, `GET|POST /api/agents`, `PUT|DELETE /api/agents/:nom` ; écritures de configuration sérialisées ; `/api/quota` relit les agents à chaque requête. Catalogue relu au démarrage de `nay ui` sans retarder l'écoute.
- CLI : `nay models [--refresh]`.
- Interface : vue Hangar (`6`), flotte éditable et catalogue par CLI, badge « nouveau », nom suggéré (`gpt-6.2-sol` → `sol` ou `sol-6.2`), focus conservé pendant les rafraîchissements.
- Deux tests de délégation rendus indépendants de la liste des développeurs configurée.

## Reviewer

- Relecture externe : en attente.

## Tests

- Analyse des sorties réelles enregistrées (`test/fixtures/models/`), repli et cache du catalogue, validation, routes HTTP (201, 400, 403, 404, 409), commande `nay models`, logique pure du Hangar.
- Essai manuel sur une copie de `config/` : ajout de `sol-6.2`, présence dans l'Aiguillage, modification du délai, retrait ; retrait de `sol` refusé ; fichier revenu identique à l'original.
- `node --test "test/*.test.js"` : 226 réussis, 0 échec.
- Ma décision : en attente.

## Décision finale

- En attente.
