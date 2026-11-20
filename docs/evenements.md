# Format des événements

Contrat commun entre le flux d'événements (`feature/flux-evenements`, qui les écrit)
et les alertes / l'interface (`feature/alertes`, `feature/interface`, qui les lisent).

## Fichier

- Une ligne JSON par événement, dans `.nay/state/events/AAAA-MM-JJ.jsonl` à la racine du dépôt Nay
  (jamais dans le dossier de travail de l'agent).
- Les sorties de commandes et les textes sont tronqués (limites dans la config).
- Une ligne illisible est ignorée par les lecteurs.

## Champs communs à tous les événements

| Champ | Type | Sens |
|---|---|---|
| `v` | 1 | version du format |
| `ts` | ISO UTC | moment de l'événement |
| `callId` | chaîne | identifiant unique d'un appel d'agent (`nay run` ou `nay resume`) |
| `agent` | chaîne | nom de l'agent (`sol`, `hydrogen`…) |
| `model` | chaîne | modèle résolu |
| `feature` | chaîne ou null | fonctionnalité concernée |
| `project` | chaîne ou null | nom déduit du dépôt Git commun |
| `branch` | chaîne ou null | branche du dossier de travail, nulle en HEAD détachée |
| `role` | chaîne ou null | rôle (`developpeur`, `relecteur`…) |
| `kind` | chaîne | type d'événement, voir ci-dessous |
| `storyId` | chaîne, facultatif | story qui a lancé l'appel (absent hors story) |

Les anciens événements peuvent omettre `project` et `branch`. Hors Git, les deux champs valent `null`.

## Types (`kind`)

- `call_start` : début de l'appel. Champs `mode` (`write` ou `read`) et `resumedFrom` (callId repris, ou null).
- `tool_start` : l'agent lance un outil. Champ `tool`.
- `tool_end` : l'outil a fini. Champs `tool`, `ok` (booléen), `exitCode` (si commande), `durationMs` (si connu), `output` (tronqué).
- `message` : texte de l'agent. Champ `text` (tronqué).
- `usage` : mesure brute intermédiaire du CLI, par tour ou étape (sans soustraction de l’historique lors d’une reprise). Champ `usage` `{ input, cachedInput, output, thinking, total }`.
- `call_end` : fin de l'appel. Champs `status` (`ok`, `error`, `timeout`), `usage`, `durationMs`, `sessionId` (identifiant fournisseur, ou null si inconnu), `error` (si échec), `cause` (si échec : `timeout`, `shell_blocked`, `empty`, `quota`, `crash`), `question: true` (succès qui finit sur une question), `retrying: true` (une reprise automatique suit).
- `story_start` / `story_end` marquent le début et la fin d'un `nay story`. Les deux portent `storyId`, `feature`, `project` et `branch`. [Détail des champs](cycle-de-vie.md)

## Outil (`tool`)

`{ id, name, kind, target }`

- `id` : identifiant de l'outil dans l'appel, identique entre `tool_start` et `tool_end` quand le CLI le fournit.
- `name` : nom brut donné par le CLI (`Bash`, `read_file`, `command_execution`…).
- `kind` : `command`, `read`, `edit`, `search`, `web` ou `other`.
- `target` : la commande lancée, le chemin lu ou modifié, ou le motif cherché.

La correspondance entre noms bruts et `kind` est dans la config, pas dans le code.

Le `callId` est identique dans le résultat de `runAgent`, les événements et
`usage.jsonl`. Une reprise obtient un nouveau `callId` ; `resumedFrom` relie son
`call_start` à l'appel précédent. Les anciens événements peuvent ne pas avoir
`resumedFrom` ou `sessionId`.

Pour les CLI de `config/engine.json` → `cumulativeUsageOnResume` (Codex et agy),
`call_end` contient aussi `usageCumulative`, la consommation brute finale dans le
même format que `usage`. `call_end.usage` représente la consommation propre à
l'appel : lors d'une reprise, chaque champ vaut le cumul brut moins celui du
dernier enregistrement de l'appel repris dans usage.jsonl, avec une borne à zéro.
La base est `usageCumulative`, ou `usage` pour une entrée ancienne ; sans base,
elle vaut zéro. Pour un appel initial, `usage` et `usageCumulative` sont identiques.
Claude conserve son usage tel quel et n'a pas de champ `usageCumulative`.

Les événements intermédiaires `usage` restent inchangés : les étapes agy et les
tours Codex n'ont pas tous la même portée que le cumul final de la conversation.
Ils sont provisoires ; `call_end.usage` fait foi pour la consommation de l'appel.
