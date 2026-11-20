# Fonctionnalité : config perso et rôles perso

- **Branche :** feature/config-perso
- **Créé par :** orchestrateur
- **Tâche :** (1) que chaque dev règle ses agents et son ordre de délégation sans committer dans le dépôt ; (2) pouvoir ajouter depuis l'interface des rôles à soi (UI, adversaire, sécurité…) avec une règle d'usage que l'orchestrateur suit ou demande.

## Explorateur

Explorateur non lancé : périmètre lu par l'orchestrateur (`src/config.js`, `src/delegation.js`, `src/server/`, vue Aiguillage et Hangar, consignes d'orchestrateur des projets).

## Développeur

Écrit directement par l'orchestrateur.

- `src/userConfig.js` : dossier perso (`NAY_CONFIG_DIR`, `$XDG_CONFIG_HOME/nay`, `~/.config/nay` ; aucun sous `node --test`), lecture, écriture atomique, fusion clé par clé, différence avec le dépôt.
- `src/config.js` : `readConfig` fusionne `agents`, `delegation` et `roles` ; `readRepoConfig` lit le dépôt seul.
- `src/roles.js` : rôles intégrés, validation des rôles perso, règles d'usage, consigne ajoutée au brief, texte de `nay guide`.
- `src/roleCommands.js` : `nay role`, `nay guide`, `nay usage`. `check-config` valide aussi les rôles et liste la config perso.
- Serveur : délégation, agents et rôles écrits dans la config perso ; `DELETE /api/delegation/perso` ; `/api/roles` (POST, PUT, DELETE) ; `/api/agents` indique la source de chaque agent.
- Interface : bandeau « config perso » et retour aux valeurs du dépôt (Aiguillage), section « Rôles perso » (cartes, règle, formulaire), simulateur avec les rôles perso ; Hangar : agents du dépôt marqués, version perso abandonnable.
- Consignes d'orchestrateur (hors dépôt) : règle « lancer `nay guide` en début de session » ajoutée à `docs/installation.md` et aux fichiers d'instructions locaux.

## Reviewer

- Pas encore relu.

## Tests

- `test/roles.test.js` : dossier perso, calques, différence, validation des rôles, guide, `nay role` (bascule en lecture seule), `nay usage`, API `/api/roles`.
- Tests serveur et Hangar adaptés : écritures dans la config perso, dépôt intact, retour aux valeurs du dépôt.
- Essai réel de l'interface sur une config temporaire : création d'un rôle, puis `nay guide` et `nay usage`.
- `node --test "test/*.test.js"` : 250 réussis, 0 échec.

## Décision finale

- En attente.
