# Décisions du 19/11/2026 — Nay

## Déjà en place
- `nay story` : dev → commit → revue → correction en une commande, bascule d'agent si échec
  sans modification, compte rendu court et code de sortie (0 OK, 1 bloqué, 2 aucun agent).
- `--commit` : Nay committe hors sandbox les fichiers annoncés par l'agent.
- `--effort` et `--skip-permissions` (agy et Codex, worktree Git lié uniquement).
- Agents ajoutés : `astra` (gpt-6.2-astra), `neon` (gemini-4-neon).
- L'orchestrateur ne relit ni le diff ni les contrôles : il lit le compte rendu de Nay.

## 1. Interface (`nay ui`)
- Base retenue : **la version de Neon** (`bench/ui-neon`, Observatoire orbital).
- À reprendre ailleurs : le statut des stories de Hydrogen (dev, relecture, fusion), ses
  couleurs, et les avatars d'agents.
- Les maquettes de Neon sont candidates au backend (voir §5).

## 2. Serveur MCP
- Écrit en **Node, sans dépendance** : JSON-RPC 2.0 en stdio, sous-ensemble utile du protocole
  (`initialize`, `tools/list`, `tools/call`). Nouvelle commande `nay mcp`.
- Outils : `nay_story_start`, `nay_run`, `nay_wait`, `nay_status`, `nay_quota`.
- Réponses courtes par défaut, détail sur demande (`detail: true`).
- But : utiliser Nay depuis **Codex et Antigravity**. Le MCP n'est pas un levier d'économie de
  tokens (coût fixe des définitions d'outils).
- **Mise à jour** : Antigravity utilise déjà Nay **sans MCP**, par le shell, grâce à une skill
  (`~/.gemini/config/skills/nay-delegation/SKILL.md`) : `nay run --commit` avec Sol et
  `--read-only` avec Luna ont fonctionné. Le MCP **passe en dernière priorité** ; à reprendre
  seulement si l'approbation des commandes ou les appels longs (stories de 10 min et plus, non
  encore testées dans Antigravity) posent problème.
- **À corriger** : la skill pointe vers une **copie séparée** de Nay
  (`~/.gemini/antigravity/scratch/nay-delegation`), avec son propre journal et sa propre
  configuration (sans Astra ni Neon). La faire pointer vers le dépôt principal pour garder un
  seul journal, une seule `nay ui` et un seul code.

## 3. Cycle de vie piloté par les événements
- États normalisés, **déduits des événements par Nay**, jamais annoncés par l'agent :

| État | Signal |
|---|---|
| `accepted` | processus lancé |
| `working` | premier outil ou premier message |
| `stalled` | silence au-delà du seuil (alerte existante) |
| `needs_input` | réponse finale qui est une question, sans commit |
| `done` | appel `ok` (+ commit, + verdict pour une story) |
| `failed` | avec une cause typée : `quota`, `timeout`, `shell_blocked`, `empty`, `crash` |

- **Pas de sondage** : `nay wait <id> --until done,failed,needs_input` (CLI) et `nay_wait` (MCP)
  bloquent jusqu'au prochain état utile, avec un délai maximal.
- Permet d'attendre « la première de N stories » qui change d'état.

## 4. Bash et MCP en même temps
- Mêmes fonctions, même journal `.nay/state` : tout est visible des deux côtés, dans `nay ui`
  et dans le cockpit.
- **Claude Code** : Bash en arrière-plan pour lancer et attendre (réveil à la fin), MCP pour
  consulter seulement. Serveur MCP désactivable si son coût fixe gêne.
- **Codex, Antigravity** : MCP pour tout. Règles recopiées dans `AGENTS.md` et le fichier de
  règles d'Antigravity.
- **Anti-doublon** dans Nay : une story déjà en cours (même dossier, même fonctionnalité)
  renvoie son identifiant au lieu d'en relancer une.
- **Cockpit** : à enrichir pour afficher l'agent réel, l'état, l'outil en cours et les tokens
  en lisant les événements de Nay.

## 5. Benchmark backend
- Participants : **Sonnet, Terra, Argon** (puis comparaison avec Sol, Neon, Astra, Hydrogen).
- Préalable : étendre `--skip-permissions` au CLI Claude pour Sonnet (mêmes droits pour tous).
- Trois tâches tirées des maquettes de Neon, même prompt pour tous :

| Niveau | Tâche |
|---|---|
| Facile | `GET /api/budget` (budget, économies de cache) |
| Moyen | `POST /api/calls/:id/cancel` (arrêt d'urgence, sécurité) |
| Difficile | `POST /api/delegation/simulate` (simulateur d'aiguillage) |

- **Tests d'acceptation cachés écrits avant** le lancement ; les agents ne reçoivent que le
  contrat d'API.
- Grille par tâche (sur 100) : tests cachés 40 · robustesse et sécurité 15 · qualité et
  intégration (**revue à l'aveugle**) 15 · tests de l'agent (doivent attraper un bug injecté)
  10 · discipline du diff 10 · respect du contrat et doc 10.
- **Efficacité publiée à part** (durée, tokens, coût par point au-dessus de 70), utilisée pour
  départager. Tâche difficile lancée deux fois par agent.
- Pour les benchmarks d'interface : ajouter un critère de **profondeur** (vues réellement
  repensées, pas seulement restylées) et ouvrir toutes les vues avant de noter.

## Ordre proposé
1. Faire pointer la skill Antigravity vers le dépôt principal de Nay (§2).
2. Spécification des états et de `nay wait` (§3), puis `nay wait` en CLI.
3. Contrats d'API et tests cachés des trois tâches (§5), `--skip-permissions` pour Claude.
4. Benchmark backend avec Sonnet, Terra, Argon.
5. Intégration de l'interface de Neon, anti-doublon (§4) et enrichissement du cockpit.
6. Serveur MCP (§2), seulement si le shell ne suffit plus.
