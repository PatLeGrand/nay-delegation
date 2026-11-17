# Fonctionnalité : quotas

- **Branche :** feature/quotas
- **Créé par :** orchestrateur
- **Tâche :** lire le quota restant de chaque fournisseur (Codex, Gemini/agy, Claude) sans consommer de jetons, et dire si un agent est disponible selon des seuils configurables.

## Explorateur

Explorateur non lancé : dépôt de 850 lignes que l'orchestrateur vient de relire.

- `src/config.js` (`readConfig`, `getAgent`) : chargement des configs ; le champ `cli` d'un agent donne son fournisseur. Confiance haute.
- `config/engine.json` : binaires `codexBin`, `agyBin`. Confiance haute.
- `src/command.js` : CLI `nay`, pour une sous-commande `nay quota`. Confiance moyenne.
- Référence externe : `../../../../workflow-code-1/.claude/scripts/delegate.mjs` (`codexQuota`, `geminiQuota`). Confiance haute.
- Tests existants liés : aucun dans cette zone.

## Développeur

- Ce qui a été fait : lecture des sessions Codex, analyse de `/usage` agy, état Claude inconnu, cache, seuils par agent et commande `nay quota`. Les fenêtres Argon portent `scope: argon`.
- Commits : voir le rapport de livraison.
- Points d'attention pour le reviewer : les relevés Codex peuvent être périmés ; les quotas inconnus restent disponibles. La réinitialisation est prise en compte au moment de l'évaluation, même pour un relevé en cache.

Tour 2 : seuils appliqués par fenêtre, lecture Codex bornée et robuste, analyse agy configurable et tolérante, cache actualisé et arrêt du groupe de processus au timeout.

## Reviewer

- Fusion avec ordre-delegation : conflit `src/command.js` résolu et `nay choose` branché sur les quotas réels par l'orchestrateur ; relu par Hydrogen : APPROUVÉ (26 s).

- Relecteur : Hydrogen (gemini-4-hydrogen-medium), lecture seule, 69 s.
- Verdict (tour 1) : À CORRIGER.
- Remarques :
  - Bloquant : le seuil 5h de sol remplace le seuil par défaut, donc un 7j à 0 % laisse sol disponible (`src/quota/index.js`).
  - Gestion d'erreurs : fichiers de session Codex lus en entier en mémoire ; entrée corrompue qui masque les relevés valides ; une erreur sur un fichier fait échouer toute la lecture (`src/quota/codex.js`).
  - Gestion d'erreurs : une ligne agy inconnue rend tout le quota Gemini inconnu (`src/quota/agy.js`).
  - Suggestions : libellés agy codés en dur, `stale` figé dans le cache, config illisible non capturée, timeout agy sans arrêt du groupe de processus.
- Renvoyé au développeur (Terra) pour correction.
- Verdict (tour 2) : APPROUVÉ (46 s). Remarque mineure (`stderr.trim() ?? code` → `||`) corrigée par l'orchestrateur.

## Tests

- Tests unitaires : 70/70 réussis après intégration de main (`npm test`). Essai réel de `nay quota` et `nay choose` : Codex et agy lus, Claude inconnu.
- Ma décision : confirmation de la fusion (2026-11-17), après résolution du conflit et relecture.

## Décision finale

- Fusionné dans `main` le 2026-11-17.
