# Cycle de vie des appels et des stories

Contrat entre le journal d'événements (`docs/evenements.md`), `nay wait` et, plus tard, le
serveur MCP (`nay_wait`) et le cockpit. Les états sont **déduits par Nay** des événements ;
l'agent ne les annonce jamais.

## Travaux suivis

- **Appel** : un `nay run` ou `nay resume`, identifié par son `callId`.
- **Story** : un `nay story`, identifié par son `storyId` (8 caractères hexadécimaux, ou celui
  donné par `--id`). Ses appels portent le même `storyId`.

## États

| État | Appel | Story |
|---|---|---|
| `accepted` | `call_start` vu, aucune activité encore | `story_start` vu, aucun appel actif |
| `working` | premier `tool_start`, `tool_end` ou `message` | un de ses appels est `working` |
| `stalled` | en cours, aucun événement depuis `silenceSec` (`config/monitor.json`) | en cours, aucun événement d'aucun de ses appels depuis `silenceSec` |
| `needs_input` | `call_end` `ok` avec `question: true` | `story_end` avec `question: true` |
| `done` | `call_end` `ok` sans question | `story_end` avec `code` 0 |
| `failed` | `call_end` `error` ou `timeout` | `story_end` avec `code` ≠ 0, sans question |

`done`, `failed` et `needs_input` sont terminaux.

**Question** : la dernière ligne non vide de la réponse (hors lignes `NAY-…`) finit par `?`,
et la réponse ne demande pas de commit (`NAY-COMMIT`). Pour une story, le développeur s'est
arrêté sur une question sans rien modifier.

**Reprise automatique** (shell bloqué chez agy) : le `call_end` de l'appel porte
`retrying: true`. L'appel suit alors l'état de sa reprise (l'appel dont `resumedFrom` vaut son
`callId`), et reste `working` tant qu'elle n'a pas commencé.

## Causes d'échec (`cause`)

| Appel | Signal |
|---|---|
| `timeout` | `status` `timeout` |
| `shell_blocked` | shell bloqué en mode plan (agy), sans reprise possible |
| `empty` | réponse vide |
| `quota` | erreur qui correspond à `quotaPattern` (`config/lifecycle.json`) |
| `crash` | tout autre échec |

| Story | Signal |
|---|---|
| `no_agent` | `AUCUN AGENT` : aucun agent disponible pour un rôle |
| `blocked` | `BLOQUÉ` : échec du dev après modification, commit impossible, correction échouée |
| `defects` | `DÉFAUTS` : défauts restants après le dernier tour de revue |
| `checks` | `CONTRÔLES` : contrôles du projet encore en échec au dernier tour |
| `red_base` | `BASE ROUGE` : contrôles du projet déjà en échec avant l'appel du dev |
| `crash` | exception inattendue de `nay story` (git, CLI) : `story_end` est quand même écrit |

`call_end.cause` est écrit par Nay ; pour un ancien événement sans `cause`, elle est déduite du
statut et du message d'erreur.

## Événements ajoutés

- `call_end` : champs `cause` (si échec), `question` (si succès sur une question), `retrying`
  (si une reprise automatique suit).
- Champ commun `storyId` sur les événements des appels lancés par une story.
- `story_start` : `storyId`, `feature`, `cwd`, `ts`. Sans `callId`.
- `story_end` : `storyId`, `feature`, `status` (`OK`, `BLOQUÉ`, `DÉFAUTS`, `CONTRÔLES`, `BASE ROUGE`, `AUCUN AGENT`),
  `code`, `cause`, `question`, `detail`, `dev`, `reviews`, `roles`, `commits`, `checks` (résumé),
  `checksBy` (`nay`, `dev` ou null), `ts`. `detail` et les
  verdicts de `reviews` et `roles` sont masqués comme `error` (ils peuvent reprendre un stderr).

## `nay wait`

```bash
nay wait <id>... [--until done,failed,needs_input] [--all] [--timeout <min>]
nay wait --feature <nom> [--feature <nom>...] [--since 10m|<ISO>] [--until …] [--all] [--timeout <min>]
```

- Bloque jusqu'à ce qu'**un** des travaux (ou **tous** avec `--all`) atteigne un état de
  `--until`, puis affiche une ligne par travail. Sans `--until` : `done,failed,needs_input`.
- `--feature` : suit les travaux de la fonctionnalité **non terminés au lancement de la
  commande ou commencés après** (stories, et appels hors story) ; pratique juste après un
  `nay story … &`, avant de connaître son identifiant. Répétable : plusieurs fonctionnalités
  en une seule attente.
- `--since <durée|date>` (avec `--feature`) : suit aussi les travaux **commencés depuis**
  (`30s`, `10m`, `2h` ou date ISO), même s'ils sont déjà terminés. Évite de manquer un
  travail fini avant le lancement de l'attente, par exemple en enchaînant deux attentes.
  Sans `--since`, un travail déjà terminé n'est jamais suivi : `nay wait --feature f` ne rend
  pas la main sur l'ancienne story de `f`.
- Un identifiant (ou une fonctionnalité sans travail) qui n'apparaît pas dans le journal sous
  `appearGraceSec` est une erreur.
- Lecture du journal par Nay toutes les `pollMs` ; l'appelant ne sonde pas.
- Codes de sortie : `0` état atteint · `1` erreur (argument, identifiant inconnu) ·
  `2` délai dépassé (par défaut `defaultTimeoutMin`).

Sortie, une ligne par travail :

```
story 3f2a9c1d · done · feature quotas · dev sol · revue terra PASS · 4 min 12 s
appel 1b7e…  · failed (quota) · sol · feature quotas · 12 s
```
