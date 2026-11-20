# Fonctionnalité : nay-wait

- **Branche :** feature/nay-wait
- **Créé par :** orchestrateur
- **Tâche :** états de cycle de vie déduits des événements et commande `nay wait`, pour attendre un appel ou une story sans sonder (décisions du 19/11, §3).

## Explorateur

- Lecture de `docs/evenements.md`, `src/monitor/`, `src/runAgent.js` (reprise automatique agy), `src/story.js` et du tailer SSE.
- Constats : aucune notion de story dans le journal ; la reprise agy crée un second appel relié par `resumedFrom` ; le texte final n'est pas dans le journal (seulement tronqué dans `message`).

## Développeur

- Contrat : `docs/cycle-de-vie.md` (états, causes, nouveaux champs, CLI).
- `src/lifecycle.js` : réduction des événements en appels et stories, états, causes, question finale, suivi de la reprise automatique.
- `runAgent` : `call_end` porte `cause`, `question`, `retrying` ; `storyId` sur les événements d'une story. La reprise agy est décidée au même endroit qu'avant.
- `runStory` : `storyId` (aléatoire ou `--id`), `story_start` / `story_end` écrits par la CLI seulement (les tests n'écrivent pas dans le journal réel), arrêt sur question du dev signalé.
- `src/wait.js` : lecture incrémentale du journal par inode (rotation, lignes partielles, veille), `nay wait <id>... | --feature`, `--until`, `--all`, `--timeout`, codes 0 / 1 / 2.

## Reviewer

- Relecture externe : en attente.

## Tests

- États et causes, reprise automatique, story, lecture incrémentale avec rotation, `nay wait` avec horloge simulée (fin, `--all`, `--until`, inconnu, délai, `--feature`), `call_end` réel de `runAgent` avec reprise agy, CLI.
- Essais réels : `nay run haiku … &` puis `nay wait --feature essai-wait` → `done` en 8 s ; consigne finissant sur une question → `needs_input`.
- `node --test "test/*.test.js"` : 241 réussis, 0 échec.
- Ma décision : en attente.

## Décision finale

- En attente.
