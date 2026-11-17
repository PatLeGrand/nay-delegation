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
| `callId` | chaîne | identifiant unique d'un appel d'agent (`nay run`) |
| `agent` | chaîne | nom de l'agent (`sol`, `hydrogen`…) |
| `model` | chaîne | modèle résolu |
| `feature` | chaîne ou null | fonctionnalité concernée |
| `role` | chaîne ou null | rôle (`developpeur`, `relecteur`…) |
| `kind` | chaîne | type d'événement, voir ci-dessous |

## Types (`kind`)

- `call_start` : début de l'appel. Champ `mode` (`write` ou `read`).
- `tool_start` : l'agent lance un outil. Champ `tool`.
- `tool_end` : l'outil a fini. Champs `tool`, `ok` (booléen), `exitCode` (si commande), `durationMs` (si connu), `output` (tronqué).
- `message` : texte de l'agent. Champ `text` (tronqué).
- `usage` : consommation intermédiaire. Champ `usage` `{ input, cachedInput, output, thinking, total }`.
- `call_end` : fin de l'appel. Champs `status` (`ok`, `error`, `timeout`), `usage`, `durationMs`, `error` (si échec).

## Outil (`tool`)

`{ id, name, kind, target }`

- `id` : identifiant de l'outil dans l'appel, identique entre `tool_start` et `tool_end` quand le CLI le fournit.
- `name` : nom brut donné par le CLI (`Bash`, `read_file`, `command_execution`…).
- `kind` : `command`, `read`, `edit`, `search`, `web` ou `other`.
- `target` : la commande lancée, le chemin lu ou modifié, ou le motif cherché.

La correspondance entre noms bruts et `kind` est dans la config, pas dans le code.
