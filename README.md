# Nay

Moteur d'orchestration multi-agents, en Node.js, pour le développement logiciel.

**Installation** : suivre [docs/installation.md](docs/installation.md), écrit pour être
exécuté pas à pas par un agent IA comme par un humain.

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

## Config perso de chaque dev

Le dépôt fournit les valeurs communes : `config/agents.json` (agents connus),
`config/delegation.json` (ordre conseillé) et `config/roles.json` (rôles partagés, vide par défaut).
Chaque dev règle les siens **hors du dépôt**, dans `~/.config/nay/` (`$XDG_CONFIG_HOME/nay`, ou
`NAY_CONFIG_DIR`) : `agents.json`, `delegation.json`, `roles.json`. Ces fichiers ne contiennent que
ce qui diffère du dépôt ; une clé perso (un agent, un rôle) remplace entièrement celle du dépôt.

- L'interface (`nay ui`) n'écrit que dans cette config perso : rien à committer, et `nay update`
  n'est plus bloqué par un réglage local. « Revenir aux valeurs du dépôt » efface l'ordre perso.
- Un agent ajouté depuis le Hangar est perso ; un agent du dépôt ne se supprime pas, sa version
  modifiée peut être abandonnée (↺).
- `nay check-config` valide la fusion et indique ce qui vient de la config perso.
- Sous `node --test`, la config perso est ignorée (sauf `NAY_CONFIG_DIR` explicite).

## Rôles perso (`nay role`, `nay guide`, `nay usage`)

Dans l'Aiguillage, « Nouveau rôle » ajoute un rôle à soi : agent UI, agent adversaire, sécurité…
Un rôle a un identifiant, un nom, une description (lue par l'orchestrateur), des consignes
facultatives pour l'agent, un accès (lecture seule ou écriture), un ordre de modèles et une règle :

| Règle | L'orchestrateur… |
|---|---|
| `toujours` | le lance à chaque travail concerné, sans demander |
| `sur-demande` | le lance seulement quand l'utilisateur le demande |
| `proposer` | le propose en une ligne après le travail concerné |
| aucune | pose la question avec ces trois réponses, puis enregistre le choix |

```bash
node bin/nay.js guide                                   # consignes de l'orchestrateur
node bin/nay.js usage adversaire toujours               # enregistrer la règle (ou « demander »)
node bin/nay.js role adversaire brief.md --cwd /projet --diff HEAD
```

`nay role` choisit le modèle selon l'ordre du rôle et les quotas, ajoute au brief la description et
les consignes du rôle, et lance l'agent dans l'accès du rôle. `--diff <révision>` joint le diff
(utile en lecture seule, où l'agent ne peut pas lancer git). En lecture seule, un modèle en échec
cède la place au suivant ; en écriture, on s'arrête. `--commit` comme pour `nay run`.
Les rôles intégrés (`explorateur`, `developpeur`, `relecteur`…) gardent leur comportement.

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
Le résultat contient `callId`, `sessionId` (null si inconnu), le statut `ok`, `error` ou `timeout`, le texte, les jetons et
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
En écriture, chaque agent exécute ses commandes sans demande, dans le bac à sable de son CLI
(écriture limitée au dossier de travail, réseau coupé) : Codex `workspace-write`, Claude
`sandbox` + `autoAllowBashIfSandboxed`, agy `--sandbox`. En lecture : `read-only` / `plan`.
`--skip-permissions` (worktree Git lié uniquement) lève ces bacs à sable.
Pour agy, une règle d'autorisation avec `**` empêche son bac à sable de démarrer : écrire le
dossier seul (`read_file(/chemin/dossier)` couvre tout ce qu'il contient).

Les tests utilisent des processus et des flux simulés ; ils ne lancent aucun
agent et ne consomment aucun jeton.

## Enchaîner dev et revue (`nay story`)

```bash
node bin/nay.js story brief.md --cwd /chemin/du/projet [--feature <nom>] [--rounds 2] [--id <storyId>] [--dev <agent>]
```

Une seule commande pour toute la boucle, utilisable dans n'importe quel dossier :

1. Choisit un `developpeur` selon les quotas (ou celui imposé par `--dev`, sans bascule) et lui donne le brief. Si l'agent échoue
   **sans avoir modifié de fichier** (lancement, quota, délai, réponse vide), Nay passe au
   suivant ; s'il a déjà modifié des fichiers, Nay s'arrête.
2. Dans un dépôt git, committe les fichiers annoncés par le dev (voir `--commit`).
   Hors dépôt git, pas de commit : le relecteur lit les fichiers modifiés.
3. Choisit un `relecteur` qui n'est pas l'auteur, en lecture seule ; il finit par
   `NAY-VERDICT: PASS` ou `CHANGES`. Un relecteur en échec cède la place au suivant.
4. Si `CHANGES` : reprend la session du dev avec les constats, recommite, nouvelle revue,
   jusqu'à `--rounds` tours (2 par défaut).

### Contrôles lancés par Nay

Si le projet déclare ses contrôles dans `.nay/checks.json`, Nay les lance lui-même après
chaque travail du dev, avant la relecture, au lieu de croire le résultat annoncé par l'agent :

```json
{ "checks": [
  { "name": "tests", "command": "pytest -q" },
  { "name": "lint", "command": "ruff check .", "timeoutSec": 60 }
] }
```

- Les commandes tournent dans le dossier de la story, hors bac à sable, avec un shell, l'une
  après l'autre (toutes, même après un échec). Elles ne coûtent aucun jeton.
- Un échec repart directement au dev (même session) avec la fin de la sortie, sans passer par
  le relecteur. Chaque correction compte comme un tour de `--rounds`. Au dernier tour, la story
  s'arrête en `CONTRÔLES` (code 1).
- Si tout passe, le relecteur reçoit le résultat avec le diff.
- Sans ce fichier, Nay demande au dev la ligne `NAY-CHECKS:` comme avant, et l'affiche
  « déclarés par le dev, non vérifiés ». Un fichier invalide arrête la story avant tout appel.

Délai par défaut, taille de la sortie gardée et variables d'environnement (`CI=1`) :
`config/checks.json`. Ces commandes sont exécutées telles quelles : ne lancer `nay story` que sur
des projets dont on connaît le `.nay/checks.json`.

Sortie courte, conçue pour l'orchestrateur :

```text
Story : 3f2a9c1d
Dev : sonnet (sauté : sol — quota épuisé)
Commit : 3f2a1c9 feat(providers): …
Revue : hydrogen PASS (tour 1)
Contrôles : ruff ok · mypy ok · pytest 42 passés
Statut : OK
```

Le relecteur reçoit le diff dans son prompt (commit ou modifications non committées) : il n'a
pas besoin de lancer git. Le verdict doit être la dernière ligne de sa réponse.

agy en lecture seule (`--mode plan`) n'exécute pas les commandes shell : Nay ajoute au prompt
une consigne « sans shell », et si la session s'arrête quand même sur une commande, l'erreur
le dit (« Shell bloqué en mode plan ») et Nay reprend une fois la session sans shell.

Code de sortie : `0` revue PASS, `1` bloqué ou défauts restants (constats du relecteur
affichés), `2` aucun agent disponible. `--feature` vaut par défaut le nom du dossier.
Si le dev s'arrête sur une question sans rien modifier, la story s'arrête (`BLOQUÉ`) et
affiche la question.

## Enchaîner plusieurs stories (`nay plan`)

```bash
nay plan livraison.md --cwd ./projet --feature livraison --parallel 2 --dev sol --rounds 3
```

Chaque titre de niveau 2 ouvre une tâche. La ligne facultative `Après`, placée juste sous le titre,
liste les identifiants des tâches qui doivent réussir avant son lancement.

```markdown
## api : Décrire les routes
Documenter les routes dans docs/api.md.

## interface : Vérifier la navigation
Vérifier les liens du menu principal.

## bilan : Préparer la livraison
Après : api, interface
Rédiger les notes de livraison.
```

Nay valide le plan entier avant tout appel. Les identifiants doivent être uniques et les dépendances
connues et sans cycle. Un échec laisse ses descendants « non lancée » et les tâches indépendantes
continuent. Chaque story lancée porte son propre identifiant et la feature commune pour le suivi
avec `nay wait --feature livraison`. Par défaut, la feature prend le nom du dossier projet.

Par défaut, les stories se succèdent dans le dossier du projet (`parallel` vaut 1 dans
`config/plan.json`). Avec `--parallel` supérieur à 1, Nay exige un dépôt Git avec un premier commit.
Chaque tâche lancée reçoit une branche et un worktree sous `.nay/worktrees/`. Avec une seule
dépendance, la branche part du dernier commit de cette dépendance. Avec zéro ou plusieurs dépendances,
elle part du HEAD initial du projet. Utiliser le mode série pour une tâche qui doit retrouver ensemble
les modifications de plusieurs prédécesseurs. Les worktrees sont conservés et la fusion des branches est
manuelle. Le bilan affiche une ligne par tâche dans l’ordre du fichier, avec statut, storyId, dev,
verdict et branche éventuelle. Le code de sortie vaut 0 si toutes les tâches réussissent, 1 sinon.

## Attendre un appel ou une story (`nay wait`)

```bash
node bin/nay.js story brief.md --cwd /projet --feature quotas &   # ou nay run … &
node bin/nay.js wait --feature quotas
node bin/nay.js wait <callId|storyId>... [--until done,failed,needs_input] [--all] [--timeout <min>]
node bin/nay.js wait --feature a --feature b --since 10m --all   # plusieurs lots, finis ou non
```

Bloque, sans que l'appelant ait à sonder, jusqu'au prochain état utile d'un des travaux suivis
(de tous avec `--all`), puis affiche une ligne par travail :

```text
story 3f2a9c1d · done · feature quotas · dev sol · revue terra PASS · 4 min
appel 1d917a8b-… · needs_input · haiku · feature quotas · 3 s
```

États déduits du journal d'événements : `accepted`, `working`, `stalled`, `needs_input`
(l'agent finit sur une question), `done`, `failed` avec une cause (`quota`, `timeout`,
`shell_blocked`, `empty`, `crash` ; pour une story `no_agent`, `blocked`, `defects`).
`--feature` suit les travaux de la fonctionnalité en cours au lancement ou qui commencent
ensuite : on peut attendre une story lancée en arrière-plan sans connaître son identifiant.
Un travail déjà terminé au lancement n'est suivi qu'avec `--since` (commencé depuis cette
durée ou date) ; `--feature` se répète pour attendre plusieurs lots en une commande.
Codes de sortie : `0` état atteint, `1` erreur ou identifiant inconnu, `2` délai dépassé.
Contrat complet : [docs/cycle-de-vie.md](docs/cycle-de-vie.md) ; réglages dans `config/lifecycle.json`.

## Reprendre une session

```bash
node bin/nay.js resume <callId> retours.md
cat retours.md | node bin/nay.js resume <callId> - --cwd /chemin/du/projet
```

`nay run` et `nay resume` affichent le `callId` de l'appel et l'identifiant de
session du fournisseur (ou « inconnue »). La reprise retrouve la dernière entrée
avec ce `callId` dans `usage.jsonl` et conserve l'agent, le mode, la fonctionnalité,
le rôle et le dossier absolu ; `--cwd` remplace seulement ce dossier.
Un appel inconnu ou sans session ne peut pas être repris. Chaque reprise crée
un nouvel appel, relié au précédent par `resumedFrom`, dans la même conversation.

`--commit` (sur `run` en écriture et sur `resume`) : le sandbox des agents garde `.git` en
lecture seule, donc Nay committe à leur place. Il ajoute au brief une consigne demandant de
finir la réponse par `NAY-COMMIT: <message>` et `NAY-FILES: <fichiers>`, puis committe
uniquement ces fichiers dans le dossier de l'appel et affiche `Commit : <hash> <message>`.
Sans ces lignes, rien n'est committé. Un fichier hors du dépôt ou un échec de git fait
échouer la commande.
Les anciens journaux sans identifiant de session ne permettent pas de reprise.

L'API ESM `resumeCall(callId, prompt, options)` est dans `src/resume.js`.
`runAgent` accepte aussi `resume` (session du fournisseur), `resumedFrom` et un
`callId` facultatif. Le journal conserve `callId`, `sessionId`, `resumedFrom`
(null hors reprise) et `cwd` (absolu).

Pour les CLI listés dans `config/engine.json` → `cumulativeUsageOnResume`
(`codex` et `agy`), le résultat et le journal conservent `usageCumulative`, la
consommation brute du CLI dans le format commun des jetons. `usage` représente
la consommation propre à l'appel : lors d'une reprise, le moteur soustrait le
`usageCumulative` du dernier enregistrement de l'appel repris (ou son `usage`
pour un ancien journal), champ par champ, avec un minimum de zéro. Un appel
initial conserve la même consommation dans les deux champs. Les reprises
successives utilisent ainsi le cumul brut plutôt que le delta précédent.
Les appels directs à `runAgent` doivent fournir `resume` et `resumedFrom` pour
retrouver cette base dans le journal désigné par `journalRoot` et `usagePath` ;
sans parent retrouvé, la base vaut zéro. Les anciennes lignes restent inchangées.
Claude est exclu de la liste : son `result.usage` est supposé propre à l'appel,
ce qui reste à vérifier sur des reprises réelles.

`call_end.usage` contient la même consommation corrigée et `usageCumulative`
est également présent sur cet événement pour les CLI configurés. Les événements
`usage` intermédiaires restent les mesures brutes par tour ou étape ; ils ne
sont pas corrigés et ne doivent pas être additionnés au résultat final.

Dans l'interface, ouvrir un appel terminé avec une session affiche
« Répondre à l’agent ». Envoyer un message ouvre le détail du nouvel appel.
Le serveur refuse une reprise si l'appel n'a pas de `call_end` ou si la même
session est déjà reprise dans ce serveur. Ce verrou est local au processus ;
il ne coordonne pas les reprises lancées par la CLI ou un autre serveur.
La session doit toujours exister dans les données locales de la CLI fournisseur.

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
la limite des requêtes et les intervalles SSE. Le serveur suit [le contrat API](docs/api.md).

### Concept : Observatoire Orbital

L’interface représente la flotte Nay comme un **Planétarium de vol** : l’orchestrateur occupe le
noyau central, entouré de trois anneaux orbitaux (Codex, Agy, Claude) dont les arcs lumineux
affichent directement le quota restant. Chaque agent est un astre dimensionné par sa consommation,
relié au noyau par un faisceau télémétrique lorsqu’il est en vol, et entouré d’un halo en cas
d’alerte.

Six vues (raccourcis clavier `1` à `6`, `/` pour le filtre fonctionnalité, `T` pour le thème
clair/sombre, `Échap` pour fermer la boîte noire) :

- **Orbite** (`1`) : planétarium interactif (cliquer un astre ouvre son dossier et filtre la
  télémétrie), ruban d’alertes, bande télémétrique SSE en direct, vols en cours et réservoirs de quotas.
- **Relais** (`2`) : trajectoires horizontales des stories (`dev → revue → reprise → fusionnée`),
  verdicts et fiches complètes, avec sas de décision en tête.
- **Chronographe** (`3`) : frise UTC du jour cliquable, spectre empilé sur 14 jours (entrée neuve,
  cache relu, sortie), répartitions et autopsie de fiabilité.
- **Aiguillage** (`4`) : cascades de priorité par rôle réordonnables par glisser-déposer ou au
  clavier (`↑`/`↓`), avec disponibilité temps réel et simulateur d’aiguillage.
- **Laboratoire** (`5`) : fonctionnalités prospectives clairement badgées **Maquette** (budget et
  économies de cache, arrêt d’urgence, simulation d’aiguillage, décision en un clic), dont les
  contrats d’API sont détaillés dans [docs/maquettes.md](docs/maquettes.md).
- **Hangar** (`6`) : la flotte de `config/agents.json` (effort et délai modifiables, retrait
  refusé tant que l’agent est cité dans la délégation) et les modèles proposés par chaque CLI,
  les « nouveaux » d’abord. « Ajouter » propose un nom et crée l’agent, qui apparaît aussitôt dans
  l’Aiguillage.

### Catalogue des modèles

Au démarrage, `nay ui` relit en arrière-plan les modèles de chaque CLI : `codex debug models`
(modèles visibles), `agy models` (variantes `-low`…`-xhigh` regroupées en `modele-{effort}`) et,
faute de commande côté Claude, la liste fixe `claude` de `config/models.json`. Le résultat est
gardé dans `.nay/state/models.json` ; un CLI en échec garde son dernier catalogue, marqué périmé.
Seuls les efforts de Nay (`low`, `medium`, `high`, `xhigh`) sont retenus.

```bash
node bin/nay.js models            # dernier catalogue connu
node bin/nay.js models --refresh  # relit les CLI
```

Cliquer n’importe quel appel ouvre sa **Boîte Noire** (journal d’événements, sorties de commandes
dépliables, filiation de reprise et formulaire « Répondre à l’agent »). Les journaux restent ceux
du dépôt Nay central depuis un worktree ; les fiches, la page et la délégation viennent du worktree
actif. L’enregistrement de la délégation utilise un remplacement atomique ; le thème clair ou
sombre est mémorisé localement (avec suivi de la préférence système au premier chargement).
