# Benchmark — réinventer l'interface de Nay (19/11/2026)

Même prompt pour tous (`concours` : originalité, grille sur 100, maquettes avec contrat d'API),
effort `medium`, tous les droits dans un worktree jetable (`--skip-permissions`), base `a6f36ec`.
Branches : `bench/ui-sol`, `bench/ui-neon`, `bench/ui-astra`, `bench/ui-hydrogen`.

## Mesures

| | Hydrogen | Astra | Sol | Neon |
|---|---|---|---|---|
| Durée | **7 min 20 s** | 9 min 19 s | 13 min 6 s | 16 min 41 s |
| Entrée non cachée | 539 k | 87 k | **70 k** | 198 k |
| Entrée en cache | 2,47 M | 1,93 M | 1,98 M | 4,50 M |
| Sortie (dont réflexion) | 55,2 k (9,8 k) | **19,5 k** (2,4 k) | 34,5 k (7,7 k) | 89,5 k (14,2 k) |
| Lignes + / − | +3 748 / −1 286 | **+488** / −87 | +2 699 / −314 | +4 701 / −1 386 |
| Tests | 205/205 | 203/203 | **210/210** | 208/208 |
| Maquettes | 3 | 1 | 1 | **4** |

Codex (Sol, Astra) inclut le cache dans l'entrée ; agy (Neon, Hydrogen) le compte à part.

## Notes (grille sur 100)

| Critère | Pts | Neon | Sol | Astra | Hydrogen |
|---|---|---|---|---|---|
| Originalité | 25 | 19 | 17 | 18 | 16 |
| Utilité | 20 | 18 | 16 | 16 | 15 |
| Finition | 15 | 12 | 14 | 14 | 11 |
| Interactivité | 15 | 14 | 11 | 11 | 12 |
| Code et tests | 10 | 7 | 8 | 7 | 7 |
| Robustesse | 10 | 8 | 9 | 9 | 8 |
| Maquettes | 5 | 5 | 3 | 3 | 4 |
| **Total** | 100 | **83** | 78 | 78 | 73 |

## Retour de l'utilisateur
- **Neon** : grand favori ; « du Hydrogen en meilleur ».
- **Hydrogen** : vraies nouvelles vues et fonctionnalités, couleurs réussies, statut des stories
  (dev, relecture, fusion) ; accueil peu soigné.
- **Sol** : accueil réussi, mais les autres vues reprennent l'existant avec du CSS.
- **Astra** : peu d'effort, l'existant restylé.
- Les modèles Gemini ont été nettement plus créatifs ; appréciés : les avatars d'agents.
- Convergence par fournisseur : OpenAI → ferroviaire, Google → orbital.

## Suite
- Même benchmark avec **Sonnet, Terra et Argon**.
- Candidats au backend : maquettes de Neon (arrêt d'urgence, budget et économies de cache,
  simulateur d'aiguillage, décision de fusion).
