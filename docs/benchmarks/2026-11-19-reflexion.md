# Benchmark — raisonnement : Hydrogen, Haiku, Luna (19/11/2026)

Défi de raisonnement pur, sans outil ni fichier : chaque réponse est exacte et vérifiée par
programme avant le lancement. Même prompt pour tous, effort `medium`, lecture seule,
lancement en parallèle avec `nay run … &`, attente avec `nay wait --feature … --all`.
Luna a été lancée bien que son quota Codex soit sous son seuil habituel (accord de l'utilisateur).

Sources dans [2026-11-19-reflexion/](2026-11-19-reflexion/) : prompt (`brief.md`), corrigé et
barème (`corrige.txt`), réponses brutes (`reponse-*.txt`) et scripts de vérification (`verif*`).

## Manche 1 — 7 énigmes, 12 points

Logique (chevaliers et fripons), ordonnancement avec 2 ouvriers, probabilité, trace de code JS,
dénombrement, choix d'un relecteur selon les règles de Nay, jeu de retrait de jetons.

| | Hydrogen | Haiku | Luna |
|---|---|---|---|
| **Score** | **12/12** | **12/12** | 9/12 |
| Durée | 27 s | 43 s | **21 s** |
| Entrée (dont cache) | 11,7 k | 41,4 k (21,8 k) | 16,7 k |
| Sortie (dont réflexion) | 6,4 k (5,4 k) | 7,9 k | 0,7 k |
| Total | 18,1 k | 49,3 k | **17,4 k** |

Erreurs de Luna : P1 (raisonnement contradictoire, réponse BD = l'exemple du format), P4
(compte `0` comme vrai), P5 (6 multiples de 105 au lieu de 9).

## Manche 2 — 8 problèmes difficiles, 15 points

Grille logique à solution unique (12 indices), mots sans triple lettre, espérance exacte
(fraction sur 6⁹), ordre des tâches et microtâches en JS, plus court chemin avec péages,
états `nay wait` déduits d'événements, n! et puissance modulaire, Nim à retraits limités.

| | Hydrogen | Haiku | Luna |
|---|---|---|---|
| **Score** | **15/15** | **15/15** | 4/15 |
| Durée | 52 s | 67 s | **10 s** |
| Entrée (dont cache) | 12,3 k | 42,0 k (21,8 k) | 17,2 k (14,8 k) |
| Sortie (dont réflexion) | 14,5 k (12,6 k) | 14,6 k | 0,2 k |
| Total | 26,8 k | 56,6 k | **17,4 k** |

Luna : seuls H6 (états de Nay) et la moitié de H8 sont justes ; 180 jetons de sortie et
aucun raisonnement écrit malgré la consigne.

## Cumul (27 points)

| | Hydrogen | Haiku | Luna |
|---|---|---|---|
| Score | **27/27** | **27/27** | 13/27 |
| Durée | 1 min 19 | 1 min 50 | **31 s** |
| Jetons | 44,8 k | 105,9 k | **34,8 k** |

## Conclusions

- **Hydrogen** : aussi juste que Haiku, ~30 % plus rapide, 2,4 fois moins de jetons. Meilleur
  choix pour les tâches de raisonnement et de relecture.
- **Haiku** : sans faute, y compris sur les pièges (microtâches JS, grille logique). Environ
  21 k jetons de prompt système du CLI Claude par appel (en partie en cache).
- **Luna** : très rapide mais ne raisonne quasiment pas en effort `medium` ; à garder pour
  l'exploration, pas pour ce qui doit être vérifié.

## Limites

- Une seule passe par agent et par manche : la régularité n'est pas mesurée.
- Les deux manches ne départagent pas Hydrogen et Haiku ; il faudrait des tâches plus longues
  ou ouvertes (preuve, débogage d'un vrai code) et plusieurs passes.
- Codex ne rapporte pas les jetons de réflexion de Luna (`thinking: 0`) ; Claude non plus pour
  Haiku. Seul agy les détaille.
