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
- Ne modifie pas `config/` sans l'accord de l'utilisateur (même les chemins des CLI : voir
  l'étape 3).

## 1. Prérequis

| Outil | Pourquoi | Vérification |
|---|---|---|
| Node.js ≥ 22 | moteur et serveur local | `node --version` |
| Git | commits des agents, worktrees | `git --version` |
| Au moins un CLI d'agent | exécuter les agents | voir ci-dessous |

Sur **macOS**, voir aussi la section [macOS](#macos) (Node et Git par Homebrew, lien de la
commande, interface en tâche de fond).

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

## 3. Chemins des CLI

`config/engine.json` contient le chemin de chaque CLI (`codexBin`, `agyBin`, `claudeBin`).
**Ne le modifie pas** : un dépôt modifié fait refuser `nay update`.

- Un chemin absolu configuré qui n'existe pas sur la machine (ex. `/usr/lib/chatgpt/resources/codex`,
  propre au Codex de l'app ChatGPT pour Linux) est remplacé par le nom du CLI cherché dans le
  `PATH`. `nay check-config` affiche une ligne quand ce repli a lieu.
- Un CLI installé hors du `PATH` : définis `CODEX_BIN`, `AGY_BIN` ou `CLAUDE_BIN` dans
  l'environnement du harness.

```bash
command -v codex agy claude   # chaque CLI installé doit être trouvé
```

Si un CLI est absent, ses agents sont simplement indisponibles.

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

Le dépôt fournit une skill prête à l'emploi : [`skills/nay/SKILL.md`](../skills/nay/SKILL.md)
(commandes, règles de l'orchestrateur, rôles perso, projets, consignes par harness). Installe-la
par un **lien** vers la copie unique de Nay : `nay update` la tient alors à jour.

```bash
NAY_DIR=~/Documents/Projets/nay-delegation
# Claude Code
mkdir -p ~/.claude/skills && ln -sfn "$NAY_DIR/skills/nay" ~/.claude/skills/nay
# Codex (+ règle qui autorise `nay` hors sandbox)
mkdir -p ~/.codex/skills ~/.codex/rules && ln -sfn "$NAY_DIR/skills/nay" ~/.codex/skills/nay
printf 'prefix_rule(pattern = ["nay"], decision = "allow")\n' > ~/.codex/rules/nay.rules
# Antigravity
mkdir -p ~/.gemini/config/skills && ln -sfn "$NAY_DIR/skills/nay" ~/.gemini/config/skills/nay
```

Vérification : `head -3 ~/.claude/skills/nay/SKILL.md` affiche `name: nay`.

La skill suppose la commande `nay` dans le `PATH` (section 8). Les règles propres à un projet
(branches, tickets, tâches à garder pour soi) vont dans son `CLAUDE.md` ou `AGENTS.md`, pas dans
la skill.

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

## macOS

Testé sous Linux ; ces étapes remplacent ce qui y est propre. Rapporte toute différence.

1. **Prérequis** (avec [Homebrew](https://brew.sh)) : `brew install node git`, puis
   `node --version` (≥ 22). CLI d'agents : `brew install codex` ou `npm install -g @openai/codex`,
   `npm install -g @anthropic-ai/claude-code`, et l'app Antigravity pour `agy`. Vérifie avec
   `command -v codex agy claude` : rien à changer dans `config/engine.json` (section 3).
2. **Commande `nay`** : `~/.local/bin` n'est pas dans le `PATH` par défaut.
   ```bash
   mkdir -p ~/.local/bin && ln -sfn ~/Documents/Projets/nay-delegation/bin/nay.js ~/.local/bin/nay
   echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
   nay check-config
   ```
   Une app lancée depuis le Dock (Claude Code, Codex, Antigravity) ne lit pas toujours
   `~/.zshrc` : si elle ne trouve pas `nay`, relance-la depuis un terminal ou utilise
   `node ~/Documents/Projets/nay-delegation/bin/nay.js` dans ses consignes.
3. **Skill** : section 6, identique.
4. **Interface toujours active** (facultatif), avec launchd à la place de systemd :
   `~/Library/LaunchAgents/com.nay.ui.plist`
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>Label</key><string>com.nay.ui</string>
     <key>ProgramArguments</key><array>
       <string>/opt/homebrew/bin/node</string>
       <string>/Users/TON_NOM/Documents/Projets/nay-delegation/bin/nay.js</string>
       <string>ui</string>
     </array>
     <key>WorkingDirectory</key><string>/Users/TON_NOM/Documents/Projets/nay-delegation</string>
     <key>EnvironmentVariables</key><dict>
       <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
     </dict>
     <key>RunAtLoad</key><true/>
     <key>KeepAlive</key><true/>
   </dict></plist>
   ```
   Remplace `TON_NOM` et le chemin de `node` (`command -v node` : `/opt/homebrew/bin/node` sur
   puce Apple, `/usr/local/bin/node` sur Intel).
   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nay.ui.plist
   ```
5. **Mise à jour** : `nay update` met le dépôt à jour mais ne sait redémarrer que le service
   systemd. Après une mise à jour, redémarre l'interface :
   `launchctl kickstart -k gui/$(id -u)/com.nay.ui`.

## Pièges connus

| Symptôme | Cause | Solution |
|---|---|---|
| `Réponse vide de l'agent` avec un agent agy en lecture seule | en mode `plan`, agy n'exécute pas le shell | Nay ajoute une consigne « sans shell » et reprend la session une fois ; fournir le diff dans le brief |
| L'agent ne peut pas committer | le sandbox garde `.git` en lecture seule | utiliser `--commit` : c'est Nay qui committe |
| Tests en échec `EPERM` | exécution dans un sandbox | relancer hors sandbox |
| Appels absents de `nay ui` | le harness utilise une autre copie de Nay | pointer toutes les règles vers la copie unique |
| `nay: command not found` dans une app (Mac) | l'app ne lit pas `~/.zshrc` | la relancer depuis un terminal, ou appeler `node <dépôt Nay>/bin/nay.js` |
| `Agent inconnu` | agent absent de `config/agents.json` | vérifier le nom avec `node bin/nay.js check-config` |
