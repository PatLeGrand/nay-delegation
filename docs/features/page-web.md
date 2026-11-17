# Fonctionnalité : page web de l'interface

- **Branche :** feature/page-web
- **Créé par :** orchestrateur
- **Tâche :** page web sans dépendance ni étape de construction (`ui/`) qui affiche le tableau de bord des jetons et quotas, ce qui attend la décision de l'utilisateur, les fonctionnalités, les agents en direct, la fiche d'un agent, la frise et les paramètres de délégation.

## Explorateur

Explorateur non lancé : l'orchestrateur connaît la zone.

- Aucun fichier existant : nouveau dossier `ui/`. Confiance haute.
- Contrat commun : `docs/api.md`. Confiance haute.

## Développeur

- Ce qui a été fait : page unique `ui/index.html` + `ui/app.js` (ES modules) + `ui/style.css`, modules dans `ui/js/` (`config.js` pour toutes les constantes, `dom.js`, `api.js`, `format.js`) et une vue par fichier dans `ui/js/views/` (tableau de bord, fonctionnalités + « À décider », agents en direct, fiche d'agent en `<dialog>`, frise, paramètres). Navigation par ancres (`#dashboard`, `#features`, `#live`, `#timeline`, `#settings`). Rafraîchissement complet toutes les 15 s (nouvel essai à 5 s si le serveur ne répond pas, bandeau « serveur injoignable »), flux SSE `/api/events/stream` qui relit `/api/status` au plus toutes les 2 s, reconnexion automatique. Aucun `innerHTML` ; les `PUT` envoient `Content-Type: application/json`. Thèmes clair/sombre, focus visible, mise en page testée en principe jusqu'à 375 px (non vérifiée dans un navigateur : aucune commande lancée).
- Commits (proposés) :
  1. « Socle de la page : constantes, DOM sûr, appels API » (`ui/index.html`, `ui/app.js`, `ui/js/config.js|dom.js|api.js|format.js`, `ui/style.css`)
  2. « Tableau de bord, fonctionnalités et À décider » (`ui/js/views/dashboard.js`, `features.js`)
  3. « Agents en direct, fiche d'agent et frise » (`ui/js/views/live.js`, `agentDialog.js`, `timeline.js`)
  4. « Paramètres : ordre de délégation réordonnable » (`ui/js/views/settings.js`)
  5. « Fiche page-web : section développeur » (ce fichier)
- Points d'attention pour le reviewer :
  - Rien n'a été exécuté : à tester avec le vrai serveur (module `import` relatifs, `Array.prototype.findLast`, `structuredClone`, navigateur récent requis).
  - Les « 50 derniers appels » de `/api/usage` n'ont pas de `callId` (contrat) : ils ne sont donc pas cliquables ; seuls les appels de `/api/status` ouvrent la fiche.
  - La frise s'appuie sur `startedAt`/`endedAt` de `/api/status` (équivalents de `call_start`/`call_end`), sans appel supplémentaire par appel.
  - Les rôles sont reconnus via `ROLE_TREE` et `ROLE_ALIASES` dans `config.js` (ex. `dev` → développeur) ; tout autre rôle va dans « Autres rôles ».
  - Les paramètres permettent de réordonner uniquement (pas d'ajout ni de retrait d'agent). Les listes `relecteur.selonAuteur` ont chacune leur section ; les erreurs 400 (`error` + `errors`) sont affichées.
  - Le quota d'un fournisseur est dit « inconnu » quand `status` n'est pas `ok` ou sans fenêtre ; l'agent n'est alors pas présenté comme bloqué.

## Reviewer

- Relecteur : Hydrogen (gemini-4-hydrogen-medium), lecture seule, 82 s.
- Verdict (tour 1) : APPROUVÉ. Aucun bloquant ni point à corriger ; sécurité (aucun HTML construit depuis les données) et contrat d'API respectés.
- Suggestions : frise qui affiche « aucun appel » quand l'API échoue ; réponse 200 non JSON qui donne une erreur brute ; `dragged` non remis à zéro au dépôt ; course entre deux ouvertures de la fiche d'agent.

## Tests

- Tests unitaires : aucun test automatique de la page ; syntaxe vérifiée (`node --check`).
- Essai réel (orchestrateur, navigateur intégré, avec le serveur) : tableau de bord, À décider, agents en direct (Hydrogen suivi pendant sa relecture), fiche d'agent, frise, paramètres (enregistrement vérifié), écran de 375 px sans défilement horizontal, reconnexion après redémarrage du serveur. Corrections de l'orchestrateur (suggestions + chargement visible) relues par Hydrogen : APPROUVÉ.
- Ma décision : confirmation de la fusion (2026-11-17).

## Décision finale

- Fusionné dans `main` le 2026-11-17.
