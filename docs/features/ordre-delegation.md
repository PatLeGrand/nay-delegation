# Fonctionnalité : ordre de délégation

- **Branche :** feature/ordre-delegation
- **Créé par :** orchestrateur
- **Tâche :** rendre l'ordre des modèles configurable par rôle (`config/delegation.json`) et choisir l'agent à appeler : premier de la liste, en sautant l'auteur du code pour la relecture et les agents indisponibles (quota).

## Explorateur

Explorateur non lancé : dépôt de 850 lignes que l'orchestrateur vient de relire.

- `src/config.js` (`getAgent`, `readConfig`) : chargement des configs, à étendre pour `delegation.json`. Confiance haute.
- `config/agents.json` : noms d'agents valides, à vérifier contre les listes. Confiance haute.
- `src/command.js` : CLI `nay`, pour une sous-commande `nay choose`. Confiance moyenne.
- Tests existants liés : `test/config.test.js`.

## Développeur

- Ce qui a été fait : ordre configurable dans `config/delegation.json`, validation
  réutilisable, sélection par rôle avec exclusion de l’auteur et disponibilités
  injectées. Ajout de `choose` et `check-config`, sans appel d’agent ni lecture de
  quotas. La configuration peut être injectée dans les fonctions de sélection.
- Commits prévus (`.git` en lecture seule, création de `index.lock` refusée) :
  `Permettre de configurer les priorités de délégation` ;
  `Exposer le choix des agents et la validation en CLI` ;
  `Documenter la délégation et rendre la suite exécutable par dossier`.
  Chaque message sera suivi d’une ligne vide puis de
  `Co-Authored-By: GPT-6.1-Sol <noreply@openai.com>`.
- Points d'attention pour le reviewer : `candidatesFor` exclut l’auteur ;
  `chooseAgent` conserve la liste initiale pour expliquer les sauts `auteur` et
  `indisponible`. La liste spécifique à l’auteur remplace la liste par défaut.
  Commande de test : `npm test` (motif `test/*.test.js`, correctif de l’orchestrateur).

**Tour 2 :** correction des six retours Hydrogen : clés `selonAuteur` connues
(ou `orchestrateur`), auteur non vide obligatoire pour choisir un relecteur,
refus des listes limitées à leur auteur, fichier identifié dans les erreurs JSON,
validation des configurations injectées et disponibilité strictement booléenne.
Un test couvre chaque point, avec vérification CLI du code 1 sans auteur.
Validation sous Node 24.22.1 : `npm test` termine avec le code 0
(`tests 6`, `pass 6`, `fail 0`, comptage par fichier) ;
`node --test --test-isolation=none "test/*.test.js"` détaille 59 tests réussis,
aucun échec. `npm` étant absent du PATH initial, son installation locale existante
a été ajoutée au PATH pour lancer `npm test`. Aucun agent réel lancé.
Commits prévus, création de `index.lock` refusée car Git est en lecture seule :
`Refuser les auteurs inconnus pour éviter les replis silencieux` ;
`Exiger un auteur pour empêcher une relecture sans exclusion` ;
`Refuser les listes sans relecteur distinct de l’auteur` ;
`Identifier le fichier pour diagnostiquer les erreurs JSON` ;
`Valider les configurations injectées avant la sélection` ;
`Exiger un booléen pour éviter les disponibilités implicites`.
Chaque message sera suivi d’une ligne vide puis de
`Co-Authored-By: GPT-6.1-Sol <noreply@openai.com>`.
Attention pour le relecteur : la validation porte sur toute la configuration
injectée ; l’auteur est toujours exclu avant l’appel à `isAvailable`, dont le
futur branchement quotas devra extraire `.available` de façon synchrone.

## Reviewer

- Relecteur : Hydrogen (gemini-4-hydrogen-medium), lecture seule, 54 s.
- Verdict (tour 1) : À CORRIGER.
- Remarques :
  - Bogue de logique : `nay choose relecteur` sans auteur choisit hydrogen sans filtrer l'auteur ; un modèle peut se relire.
  - Bogue de logique : une faute de frappe dans une clé `selonAuteur` passe la validation et fait basculer sur `parDefaut`.
  - Suggestions : liste `selonAuteur` réduite à l'auteur acceptée ; erreur JSON sans nom de fichier ; config injectée non validée ; `isAvailable` asynchrone pris pour « disponible ».
- Renvoyé au développeur (Sol) pour correction.
- Verdict (tour 2) : APPROUVÉ (37 s). Risque mineur (auteur entouré d'espaces non reconnu) corrigé par l'orchestrateur, avec un test.

## Tests

- Tests unitaires : 60/60 réussis (`npm test`).
  (`tests 1`, `pass 1`, `fail 0` : résultat global du dossier dans cet environnement).
  `node scripts/runTests.js` détaille les 52 tests : `pass 52`, `fail 0`.
- Ma décision : confirmation de la fusion (2026-11-17).

## Décision finale

- Fusionné dans `main` le 2026-11-17.
