# Nay

Moteur d'orchestration multi-agents, en Node.js, pour le développement logiciel.

L'orchestrateur (Claude Opus) coordonne ; le moteur exécute le travail mécanique :
appel des agents par leur CLI, choix du relecteur, fiches de fonctionnalité,
travail en parallèle et journal de consommation des jetons.
Une interface localhost expose cette consommation et le suivi des agents.

## Agents

| Rôle | Principal | Secours / autres |
|---|---|---|
| Explorateur | Luna | Haiku |
| Développeur | Sol 6.1 | Sonnet ; Terra et Hydrogen (tâches faciles) ; Argon (sur appel) |
| Relecteur | Hydrogen | Terra puis Sonnet ; si Hydrogen a écrit : Terra puis Gemini 3.8 Flash |

Effort moyen pour tous, sauf Gemini 3.8 Flash (High). Un modèle ne relit jamais son propre code.

L’ordre des agents pour chaque rôle est défini dans `config/delegation.json`.
La relecture utilise `relecteur.selonAuteur` si une liste existe pour l’auteur,
sinon `relecteur.parDefaut`, en excluant toujours l’auteur. Les rôles sont
`explorateur`, `developpeur`, `tachesFaciles`, `surAppel` et `relecteur`.

```bash
node bin/nay.js check-config
node bin/nay.js choose relecteur --author hydrogen --unavailable terra
```

`choose` affiche le premier agent disponible et les candidats sautés avec leur
raison ; `--unavailable` simule les indisponibilités, sans lire de quotas ni appeler
d’agent. Un échec de sélection ou de validation renvoie le code 1.

L’API `src/delegation.js` expose `loadDelegation`, `validateDelegation`,
`candidatesFor` et `chooseAgent`. Les fonctions de sélection acceptent une option
`delegation` pour injecter une configuration ; `chooseAgent` accepte aussi
`isAvailable(agent)`. `validateDelegation(config, agentNames)` renvoie les erreurs
pour permettre à une future interface de valider la configuration avant sauvegarde.

## Règles

- Une branche `feature/nom-de-la-fonction` par fonctionnalité ; jamais de travail direct sur `main`.
- Petits commits fréquents, un par étape logique, message court qui explique le pourquoi.
- Fonctions courtes, noms explicites, commentaires seulement pour le pourquoi.
- Pas de valeurs magiques : les paramètres vont dans une config.
- Un test pour chaque logique importante, pas partout.
- Une fiche par fonctionnalité dans `docs/features/`.
- Jamais de clés d'API ni de configuration de production touchées par les agents.

## Tests

```bash
npm test
```

## Appeler un agent

```bash
node bin/nay.js run sol brief.md --feature appel-agents --role dev
cat brief.md | node bin/nay.js run hydrogen - --read-only --cwd /chemin/du/projet
```

L'API ESM est `runAgent(name, prompt, { mode, cwd, feature, role, onEvent })` dans
`src/runAgent.js`. Le mode vaut `write` par défaut, ou `read` pour la lecture seule.
Le résultat contient le statut `ok`, `error` ou `timeout`, le texte, les jetons et
la durée. Les échecs des agents sont renvoyés avec `error` ; une erreur d'écriture
du journal rejette la promesse pour éviter une consommation silencieusement perdue.

Les modèles, efforts et délais sont dans `config/agents.json`. Les chemins des
binaires et du journal sont dans `config/engine.json`. `CODEX_BIN`, `AGY_BIN` et
`CLAUDE_BIN` permettent de remplacer les binaires sans modifier la config.

Le journal `.nay/state/usage.jsonl` est relatif à la racine du dépôt Nay,
y compris depuis un worktree ; `--cwd` ne déplace pas les journaux. Chaque ligne contient les métadonnées de
l'appel, sa consommation, sa durée et un horodatage UTC ; les réponses et prompts
ne sont pas recopiés dans le journal. `readUsage(path)` ignore les lignes
corrompues et renvoie une liste vide si le journal n'existe pas.

`usage.input` comprend le cache ; `cachedInput` indique les jetons relus depuis
le cache. Pour Claude, les jetons de création du cache sont ajoutés à l'entrée.
Les jetons de réflexion Codex sont déjà inclus dans la sortie ; agy fournit son
total. Une métrique absente vaut zéro, notamment la réflexion Claude, qui n'est
pas fournie séparément dans ce format.

Les fichiers temporaires sont propres à chaque appel, dans le dossier de travail,
puis supprimés. Au-delà du seuil `agyPromptMaxBytes`, agy reçoit le chemin d'un
brief temporaire à lire. Sous Unix, un timeout tue le groupe de processus de
l'agent avec ses outils. Sous Windows, seul le processus direct est arrêté.
Les permissions restent celles des CLI en modes sandbox/accept-edits/plan ; aucune
option de contournement des permissions n'est utilisée.

Les tests utilisent des processus et des flux simulés ; ils ne lancent aucun
agent et ne consomment aucun jeton.

## Quotas

```bash
node bin/nay.js quota
```

La commande affiche les fenêtres connues et les agents sous leur seuil configuré
(`config/quotas.json`). Les relevés Codex proviennent des sessions locales et
peuvent être périmés ; agy fournit `/usage` sans appel de modèle. Claude utilise le dernier relevé reçu pendant un appel, conservé dans
`.nay/state/quota-claude.json` ; en son absence, son quota reste inconnu. Un quota inconnu ne bloque pas
un agent. L'API `readQuotas()` et `isAgentAvailable(name, quotas, config)` se
trouve dans `src/quota/index.js` ; `quotaAgentConfig()` fournit les agents et
les seuils attendus. Les relevés sont conservés en mémoire selon `cacheTtlSec`.

Les événements des CLI sont convertis en direct selon [le contrat commun](docs/evenements.md)
et écrits dans `.nay/state/events/AAAA-MM-JJ.jsonl` à la racine Nay (date UTC).
`onEvent(event)` reçoit aussi chaque événement pendant l'appel. `config/events.json`
définit les outils, les limites de texte et la rotation ; `.1` désigne la rotation
la plus récente. Une erreur d'écriture d'événement ou de callback n'interrompt pas
l'agent ; une erreur du journal de consommation continue de rejeter la promesse.
Le quota Claude devient périmé selon `claudeStaleAfterMin` dans `config/quotas.json`.

## Interface locale

```bash
node bin/nay.js ui
```

`nay ui` affiche son adresse au démarrage (`http://127.0.0.1:4317` par défaut).
`config/ui.json` définit les paramètres HTTP, les dossiers de la page et des fiches,
la limite des requêtes et les intervalles SSE. La page provisoire sera remplacée
par la branche `feature/page-web` ; le serveur suit [le contrat API](docs/api.md).
Les journaux restent ceux du dépôt Nay central depuis un worktree ; les fiches,
la page et la délégation viennent du worktree actif. Seul l'enregistrement de
la délégation modifie un fichier, par remplacement atomique. Les quotas réutilisent
le cache de `readQuotas()` et son relevé `agy /usage`.
