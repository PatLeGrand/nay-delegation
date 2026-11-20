# Installer Nay

Guide écrit pour être suivi **pas à pas par un agent IA** (Claude Code, Codex, Antigravity…)
comme par un humain. Chaque étape a une commande de vérification : ne passe à la suivante
que si elle réussit. En cas d'échec, arrête-toi et rapporte l'erreur exacte.

## Règles pour l'agent qui installe
- N'écris **aucune clé d'API** ni aucun secret dans le dépôt ou dans `config/`.
- N'installe **aucune dépendance npm** : Nay n'en a pas et n'en a pas besoin.
- **Une seule copie de Nay par machine.** Ne clone pas Nay dans un dossier temporaire ou dans
  le dossier de ton harness : tous les harness doivent appeler la même copie, sinon les
  journaux, `nay ui` et la configuration divergent.
- Ne modifie pas `config/` sans l'accord de l'utilisateur, sauf les chemins de binaires de
  l'étape 3.

## 1. Prérequis

| Outil | Pourquoi | Vérification |
|---|---|---|
| Node.js ≥ 22 | moteur et serveur local | `node --version` |
| Git | commits des agents, worktrees | `git --version` |
| Au moins un CLI d'agent | exécuter les agents | voir ci-dessous |

CLI d'agents pris en charge (installe ceux dont l'utilisateur a un abonnement) :

| CLI | Agents | Vérification | Connexion |
|---|---|---|---|
| `codex` (OpenAI) | sol, terra, luna | `codex --version` | `codex login` |
| `agy` (Antigravity) | hydrogen, argon, gemini-flash | `agy models` | via l'app Antigravity |
| `claude` (Claude Code) | sonnet, haiku | `claude --version` | `claude` puis `/login` |

La connexion est faite **par l'utilisateur** : un agent ne saisit jamais d'identifiants.

## 2. Récupérer Nay

```bash
git clone https://github.com/PatLeGrand/nay-delegation.git ~/Documents/Projets/nay-delegation
```

Vérification : `node ~/Documents/Projets/nay-delegation/bin/nay.js check-config` affiche
`Configuration de délégation valide`.

Raccourci facultatif (dans `~/.bashrc` ou `~/.zshrc`) :

```bash
alias nay='node ~/Documents/Projets/nay-delegation/bin/nay.js'
```

## 3. Adapter les chemins des CLI

`config/engine.json` contient le chemin de chaque CLI (`codexBin`, `agyBin`, `claudeBin`).
Trouve les vrais chemins et corrige ceux qui diffèrent :

```bash
command -v codex agy claude
```

Exemple : si `codex` est dans `/usr/local/bin/codex`, mets `"codexBin": "/usr/local/bin/codex"`.
Le Codex fourni avec l'app ChatGPT pour Linux n'est souvent pas dans le `PATH` : cherche
`/usr/lib/chatgpt/resources/codex` (valeur par défaut du dépôt).
Si un CLI est absent, laisse sa ligne : ses agents seront simplement indisponibles.

## 4. Vérifier l'installation

```bash
cd ~/Documents/Projets/nay-delegation
node --test test/*.test.js       # tous les tests doivent passer
node bin/nay.js quota            # quotas lus pour chaque CLI connecté
node bin/nay.js choose developpeur
```

- Des tests en échec avec `EPERM` (git, ports) signifient que la commande tourne dans un
  sandbox : relance-la hors sandbox avant de conclure à un problème.
- `quota` peut afficher `inconnu` pour un CLI non connecté ou jamais utilisé : ce n'est pas
  bloquant.

## 5. Premier appel de bout en bout

Dans un dépôt de test jetable :

```bash
mkdir -p /tmp/nay-essai && cd /tmp/nay-essai && git init -q
printf 'Crée hello.js qui exporte une fonction hello() renvoyant "bonjour", et un test node:test.\n' > /tmp/brief.md
node ~/Documents/Projets/nay-delegation/bin/nay.js run <agent> /tmp/brief.md --cwd /tmp/nay-essai --commit
git -C /tmp/nay-essai log --oneline -1
```

Remplace `<agent>` par un agent dont le CLI est installé (`sol`, `hydrogen`, `sonnet`…).
Réussite : la sortie se termine par `Commit : <hash> <message>` et `git log` le montre.

Puis la boucle complète, qui choisit elle-même dev et relecteur :

```bash
node ~/Documents/Projets/nay-delegation/bin/nay.js story /tmp/brief.md --cwd /tmp/nay-essai
```

Réussite : la dernière ligne est `Statut : OK`.

## 6. Brancher Nay sur ton harness

L'orchestrateur appelle Nay par le shell. Écris les règles dans le fichier d'instructions du
harness, **en pointant vers la copie unique de Nay** :

| Harness | Fichier d'instructions |
|---|---|
| Claude Code | `CLAUDE.md` ou un fichier inclus (ex. `.claude/nay-delegation.local.md`) |
| Codex | `AGENTS.md` |
| Antigravity | une skill, ex. `~/.gemini/config/skills/nay-delegation/SKILL.md` |

Règles minimales à y mettre :
1. Pour une tâche de code courante, écrire un brief (objectif, fichiers, contraintes, critère
   de fin) puis lancer `nay story <brief> --cwd <projet> --feature <nom>`.
2. Lire seulement le compte rendu et le code de sortie : `0` OK, `1` bloqué ou défauts (les
   constats sont affichés), `2` aucun agent disponible.
3. Ne pas relire le diff ni relancer les contrôles : la revue est faite par un autre modèle.
4. Lancer les stories **en arrière-plan** si le harness le permet : elles durent de quelques
   minutes à plus de dix.
5. Briefs hors du dépôt (dossier temporaire), jamais committés.
6. En début de session, lancer `nay guide` et le suivre : rôles perso de l'utilisateur (adversaire,
   sécurité, UI…), règle de chacun, et questions à lui poser avec les réponses proposées, puis
   enregistrer son choix avec `nay usage <rôle> <règle>`.

## 7. Suivre l'activité

```bash
node ~/Documents/Projets/nay-delegation/bin/nay.js ui
```

Ouvre `http://127.0.0.1:4318` : agents, consommation, appels en direct. Le journal est dans
`.nay/state/` (ignoré par Git).

## 8. Installer Nay dans le système (facultatif)

**Commande `nay` partout** : un lien (pas une copie), la mise à jour du dépôt suffit.
```bash
ln -s ~/Documents/Projets/nay-delegation/bin/nay.js ~/.local/bin/nay
```

**Interface toujours active** (Linux, service systemd utilisateur) :
`~/.config/systemd/user/nay-ui.service`
```ini
[Unit]
Description=Nay - interface locale (nay ui)

[Service]
WorkingDirectory=%h/Documents/Projets/nay-delegation
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/chemin/vers/node %h/Documents/Projets/nay-delegation/bin/nay.js ui
Restart=on-failure

[Install]
WantedBy=default.target
```
```bash
systemctl --user daemon-reload && systemctl --user enable --now nay-ui
```

**Mise à jour** : `nay update` (refuse si le dépôt n'est pas sur `main` ou a des modifications ;
puis `git pull --ff-only`, `check-config` et redémarrage du service ; le service est aussi
redémarré quand `main` était déjà à jour mais qu'il a démarré avant le dernier commit, par
exemple après un `git pull` fait à la main). Le dossier de Nay doit
rester sur `main` : pour travailler sur Nay, utiliser un worktree séparé.

**Codex sans dépôt indiqué** : une skill globale `~/.codex/skills/nay/SKILL.md` (commandes de
la section 6) et une règle `~/.codex/rules/nay.rules` :
`prefix_rule(pattern = ["nay"], decision = "allow")`. La skill doit demander l'exécution hors
sandbox (`require_escalated`) : Nay écrit son journal hors du dossier courant. `codex exec`
(sans interface) refuse toute élévation ; l'app Codex l'accepte.

## Pièges connus

| Symptôme | Cause | Solution |
|---|---|---|
| `Réponse vide de l'agent` avec un agent agy en lecture seule | en mode `plan`, agy n'exécute pas le shell | Nay ajoute une consigne « sans shell » et reprend la session une fois ; fournir le diff dans le brief |
| L'agent ne peut pas committer | le sandbox garde `.git` en lecture seule | utiliser `--commit` : c'est Nay qui committe |
| Tests en échec `EPERM` | exécution dans un sandbox | relancer hors sandbox |
| Appels absents de `nay ui` | le harness utilise une autre copie de Nay | pointer toutes les règles vers la copie unique |
| `Agent inconnu` | agent absent de `config/agents.json` | vérifier le nom avec `node bin/nay.js check-config` |
