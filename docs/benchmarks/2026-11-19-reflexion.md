# Benchmark — raisonnement : Hydrogen, Haiku, Luna, Terra, Gemini Flash (19/11/2026)

Défi de raisonnement pur, sans outil ni fichier : chaque réponse est exacte et vérifiée par
programme avant le lancement. Même prompt pour tous, effort `medium`, lecture seule,
lancement en parallèle avec `nay run … &`, attente avec `nay wait --feature … --all`.
Luna a été lancée bien que son quota Codex soit sous son seuil habituel (accord de l'utilisateur).
Après ses résultats, les deux manches ont été rejouées avec **Terra** (gpt-6.1-terra, medium) et
**Gemini Flash** (gemini-3.8-flash, high), mêmes prompts et même barème.

Sources dans [2026-11-19-reflexion/](2026-11-19-reflexion/) : prompt (`brief.md`), corrigé et
barème (`corrige.txt`), réponses brutes (`reponse-*.txt`) et scripts de vérification (`verif*`).

## Manche 1 — 7 énigmes, 12 points

Logique (chevaliers et fripons), ordonnancement avec 2 ouvriers, probabilité, trace de code JS,
dénombrement, choix d'un relecteur selon les règles de Nay, jeu de retrait de jetons.

| | Hydrogen | Haiku | Luna | Terra | Gemini Flash |
|---|---|---|---|---|---|
| **Score** | **12/12** | **12/12** | 9/12 | **12/12** | **12/12** |
| Durée | 27 s | 43 s | **21 s** | 26 s | 2 min 14 |
| Entrée (dont cache) | 11,7 k | 41,4 k (21,8 k) | 16,7 k | 20,2 k (8,1 k) | 11,0 k |
| Sortie (dont réflexion) | 6,4 k (5,4 k) | 7,9 k | 0,7 k (0) | 1,1 k (0,6 k) | 17,9 k (16,0 k) |
| Total | 18,1 k | 49,3 k | **17,4 k** | 21,2 k | 28,9 k |

Erreurs de Luna : P1 (raisonnement contradictoire, réponse BD = l'exemple du format), P4
(compte `0` comme vrai), P5 (6 multiples de 105 au lieu de 9).

## Manche 2 — 8 problèmes difficiles, 15 points

Grille logique à solution unique (12 indices), mots sans triple lettre, espérance exacte
(fraction sur 6⁹), ordre des tâches et microtâches en JS, plus court chemin avec péages,
états `nay wait` déduits d'événements, n! et puissance modulaire, Nim à retraits limités.

| | Hydrogen | Haiku | Luna | Terra | Gemini Flash |
|---|---|---|---|---|---|
| **Score** | **15/15** | **15/15** | 4/15 | 14/15 | **15/15** |
| Durée | 52 s | 67 s | **10 s** | 38 s | 5 min 00 |
| Entrée (dont cache) | 12,3 k | 42,0 k (21,8 k) | 17,2 k (14,8 k) | 17,8 k (7,2 k) | 11,6 k |
| Sortie (dont réflexion) | 14,5 k (12,6 k) | 14,6 k | 0,2 k (0) | 1,8 k (1,1 k) | 42,2 k (39,0 k) |
| Total | 26,8 k | 56,6 k | **17,4 k** | 19,6 k | 53,8 k |

Luna : seuls H6 (états de Nay) et la moitié de H8 sont justes ; 180 jetons de sortie et
aucun raisonnement écrit malgré la consigne. Terra : seule erreur H2 (88 mots au lieu de 114).

## Cumul (27 points)

| | Hydrogen | Haiku | Luna | Terra | Gemini Flash |
|---|---|---|---|---|---|
| Score | **27/27** | **27/27** | 13/27 | 26/27 | **27/27** |
| Durée | 1 min 19 | 1 min 50 | **31 s** | 1 min 03 | 7 min 14 |
| Jetons | 44,8 k | 105,9 k | **34,8 k** | 40,8 k | 82,6 k |
| Dont réflexion | 18,0 k | non rapporté | 0 | 1,7 k | 55,0 k |

## Conclusions

- **Hydrogen** : aussi juste que Haiku, ~30 % plus rapide, 2,4 fois moins de jetons. Meilleur
  choix pour les tâches de raisonnement et de relecture.
- **Haiku** : sans faute, y compris sur les pièges (microtâches JS, grille logique). Environ
  21 k jetons de prompt système du CLI Claude par appel (en partie en cache).
- **Terra** : le plus rapide et le plus économe parmi les agents (presque) sans faute ; une
  seule erreur de dénombrement, très peu de réflexion. Bon remplaçant de Luna en explorateur.
- **Gemini Flash (high)** : sans faute mais de loin le plus lent (7 min au total, 55 k jetons
  de réflexion) ; sûr mais coûteux en temps.
- **Luna** : très rapide mais ne raisonne pas en effort `medium` (0 jeton de réflexion, alors
  que Codex les rapporte pour Terra) ; à écarter des tâches à vérifier.

## Limites

- Une seule passe par agent et par manche : la régularité n'est pas mesurée.
- Les deux manches ne départagent pas Hydrogen et Haiku ; il faudrait des tâches plus longues
  ou ouvertes (preuve, débogage d'un vrai code) et plusieurs passes.
- Claude ne rapporte pas les jetons de réflexion de Haiku ; Codex et agy les détaillent.
- Efforts différents : Gemini Flash en `high` (son réglage habituel), les autres en `medium`.
