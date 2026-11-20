# API de l'interface localhost

Contrat entre le serveur (`feature/serveur`, `src/server/`) et la page web (`feature/page-web`, `ui/`).

## Serveur

- Lancement : `node bin/nay.js ui` (port et hôte dans `config/ui.json` : `127.0.0.1`, `4317`).
- N'écoute que sur `127.0.0.1`. Refuse toute requête dont l'en-tête `Host` n'est pas `127.0.0.1:<port>` ou `localhost:<port>` (403).
- Sert les fichiers statiques de `ui/` à la racine (`/` → `ui/index.html`), sans jamais sortir de ce dossier.
- Toutes les réponses d'API sont en JSON (`Content-Type: application/json; charset=utf-8`), sauf le flux SSE.
- Erreur : statut HTTP adapté et corps `{ "error": "message en français" }`.
- Toutes les heures sont en ISO UTC.

## Points d'accès

### `GET /api/usage`

Consommation lue dans `.nay/state/usage.jsonl`. Les filtres facultatifs `feature`, `project` et
`since` (ISO) se cumulent. `project=-` sélectionne les appels sans projet et `project=` désactive
le filtre de projet. Le regroupement et le filtre utilisent le `cwd` pour les anciennes lignes
qui n'ont pas de champ `project`.

```json
{
  "totals": { "calls": 12, "input": 3200000, "cachedInput": 2900000, "output": 120000, "durationMs": 1800000 },
  "byAgent":   [{ "key": "sol", "calls": 5, "input": 0, "cachedInput": 0, "output": 0, "durationMs": 0 }],
  "byModel":   [{ "key": "gpt-6.1-sol", "calls": 5, "input": 0, "cachedInput": 0, "output": 0, "durationMs": 0 }],
  "byFeature": [{ "key": "quotas", "calls": 4, "input": 0, "cachedInput": 0, "output": 0, "durationMs": 0 }],
  "byProject": [{ "key": "nay", "calls": 4, "input": 0, "cachedInput": 0, "output": 0, "durationMs": 0 }],
  "byRole":    [{ "key": "relecteur", "calls": 6, "input": 0, "cachedInput": 0, "output": 0, "durationMs": 0 }],
  "recent":    [{ "timestamp": "…", "agent": "sol", "model": "…", "feature": "…", "role": "…", "status": "ok", "usage": { "input": 0, "cachedInput": 0, "output": 0 }, "durationMs": 0 }]
}
```
Les agrégats par groupe sont triés par `input + output` décroissant. Dans `byProject`, la clé
`null` représente les appels sans projet. `recent` contient les 50 derniers enregistrements
sélectionnés, du plus récent au plus ancien.

### `GET /api/projects`

Projets du journal de consommation, triés par dernière activité décroissante. Chaque entrée
contient le nombre d'appels et les fonctionnalités et branches distinctes observées. La dernière
activité est au format ISO UTC. Le groupe `name: null` rassemble les appels sans projet et
contient zéro appel et une activité `null` lorsqu'il est vide.

```json
[
  { "name": "nay", "calls": 4, "lastActivity": "2026-11-20T14:00:00.000Z", "features": ["projets"], "branches": ["feature/projets"] },
  { "name": null, "calls": 0, "lastActivity": null, "features": [], "branches": [] }
]
```

### `GET /api/quota`

Résultat de `readQuotas()` plus la disponibilité de chaque agent :

```json
{
  "providers": { "codex": { "status": "ok", "windows": [{ "label": "5h", "remainingPct": 77, "resetsAt": "…" }], "measuredAt": "…", "stale": false }, "agy": {}, "claude": {} },
  "agents": [{ "name": "sol", "provider": "codex", "available": true, "reason": "…" }]
}
```

### `GET /api/status`

État des appels et alertes, calculés depuis le fichier d'événements du jour (`src/monitor/`).
Les filtres facultatifs `feature` et `project` se cumulent. `project=` désactive le filtre
de projet. `project=-` sélectionne les appels sans projet, y compris les anciens événements
qui n'ont pas ce champ.

```json
{
  "now": "…",
  "calls": [{
    "callId": "…", "agent": "sol", "model": "…", "feature": "…", "project": "nay",
    "branch": "feature/projets", "role": "developpeur", "mode": "write",
    "status": "running", "startedAt": "…", "lastEventAt": "…", "endedAt": null,
    "currentTools": [{ "name": "Bash", "kind": "command", "target": "npm test", "startedAt": "…" }],
    "toolCount": 12, "failures": 1, "consecutiveFailures": 0,
    "usage": { "input": 0, "cachedInput": 0, "output": 0 }
  }],
  "alerts": [{ "callId": "…", "agent": "sol", "feature": "…", "kind": "commande_longue", "since": "…", "detail": "npm test tourne depuis 2 min" }]
}
```

### `GET /api/calls/:callId`

Tous les événements d'un appel (format de `docs/evenements.md`), dans l'ordre des `ts`, pour la fiche d'un agent et la frise.

```json
{ "callId": "…", "events": [ { "kind": "call_start", "ts": "…" } ] }
```
404 si l'appel est inconnu.

### `POST /api/calls/:callId/resume`

Corps JSON : `{ "message": "Retours du relecteur…" }`. Exige un message texte
non vide, `Content-Type: application/json` et `Origin: http://<Host>` comme
`PUT /api/delegation`. La vérification de l'hôte et la limite `maxBodyBytes`
s'appliquent aussi (403 ou 413). JSON invalide ou message vide : 400.

- 404 : appel inconnu dans `usage.jsonl` ou sans session.
- 409 : absence de `call_end` dans les événements de l'appel, ou reprise de la
  même session déjà en cours dans ce serveur.
- 202 : `{ "callId": "<nouvel appel>", "resumedFrom": "<appel repris>" }`.

La reprise démarre en arrière-plan avec l'agent, le mode, le rôle, la fonctionnalité
et le dossier absolu du dernier enregistrement de l'appel. Les événements du
nouvel appel arrivent par le SSE existant ; ses échecs ne ferment pas le serveur.
Le verrou par session est en mémoire, limité à cette instance du serveur.
Le détail du nouvel appel peut brièvement renvoyer 404 avant l'écriture de son
premier événement. `createServer` accepte `resumer(callId, message, options)`
pour injecter une reprise simulée ; `options.callId` identifie le nouvel appel,
`options.journalRoot` et `options.usagePath` désignent ses journaux.

### `GET /api/features`

Fiches de `docs/features/*.md` analysées :

```json
[{
  "name": "quotas", "title": "quotas", "branch": "feature/quotas",
  "task": "…",
  "developer": "…", "reviewer": "…",
  "verdicts": ["À CORRIGER", "APPROUVÉ"],
  "lastVerdict": "APPROUVÉ",
  "tests": "41/41 réussis …",
  "decision": "confirmation de la fusion (2026-11-17)",
  "final": "Fusionné dans `main` le 2026-11-17.",
  "state": "fusionnee",
  "waitingForUser": false
}]
```
`state` vaut `en_cours`, `en_relecture`, `attend_decision` ou `fusionnee`. `waitingForUser` est vrai quand le dernier verdict est `APPROUVÉ` et que la décision vaut `en attente` (ou est vide) et que la fiche n'est pas fusionnée.
La fonctionnalité analysée doit tolérer une fiche incomplète (champs `null`).

### `GET /api/delegation`

```json
{ "delegation": { "…": "contenu de config/delegation.json" }, "agents": ["sol", "terra", "…"] }
```

### `PUT /api/delegation`

Corps : l'objet `delegation` complet. Exige `Content-Type: application/json` et un en-tête `Origin` égal à l'origine du serveur (sinon 403). Valide avec `validateDelegation` : 400 avec `{ "error": "…", "errors": ["…"] }` si invalide ; sinon écrit `config/delegation.json` (écriture atomique : fichier temporaire puis renommage, JSON indenté de 2 espaces) et renvoie `{ "ok": true, "delegation": {…} }`. Corps limité en taille (config).

### `GET /api/models`

Catalogue des modèles par CLI (`src/models/catalog.js`), lu au démarrage du serveur puis gardé
dans `.nay/state/models.json` :

```json
{
  "fetchedAt": "…", "refreshing": false,
  "providers": {
    "codex": { "status": "ok", "fetchedAt": "…", "models": [
      { "model": "gpt-6.2-sol", "label": "GPT-6.2-Sol", "description": "…",
        "efforts": ["low", "medium", "high", "xhigh"], "defaultEffort": "low", "usedBy": [] }
    ] },
    "agy": { "status": "error", "reason": "…", "fetchedAt": "…", "stale": true, "models": [] },
    "claude": { "status": "ok", "fetchedAt": "…", "models": [] }
  }
}
```
`usedBy` liste les agents de `config/agents.json` qui utilisent ce modèle. `efforts` vide :
modèle à effort fixe. En échec, `models` garde le dernier catalogue connu (`stale: true`).

### `POST /api/models/refresh`

Relit les trois CLI (une seule lecture à la fois) et renvoie la même forme que `GET /api/models`.
Mêmes protections que `PUT /api/delegation` (`Origin`, `Content-Type: application/json`), corps facultatif.

### `GET /api/agents`

```json
{ "agents": { "sol": { "cli": "codex", "model": "gpt-6.1-sol", "effort": "medium", "timeoutMin": 40 } },
  "roles": { "sol": ["developpeur", "relecteur.selonAuteur.terra"] } }
```

### `POST /api/agents` · `PUT /api/agents/:nom` · `DELETE /api/agents/:nom`

Corps de `POST` : `{ "name", "cli", "model", "effort", "timeoutMin" }` (201) ; de `PUT` : le même
sans `name` (renommer est refusé). Mêmes protections et limite de corps que `PUT /api/delegation`.
Contrôles : nom `^[a-z][a-z0-9.-]{0,31}$` libre et différent de `orchestrateur`, CLI connu,
effort parmi ceux de Nay et proposé par le modèle, délai entier de 1 à `maxTimeoutMin`
(`config/models.json`), modèle présent dans le catalogue si celui du CLI a pu être lu (un agent
existant garde son modèle même s’il a quitté le catalogue). 400 avec `errors` sinon ; 404 agent
inconnu. `DELETE` renvoie 409 avec `errors` = rôles qui citent encore l’agent.
Réponse : `{ "ok": true, "name": "…", "agents": {…}, "roles": {…} }`. `config/agents.json` est
réécrit atomiquement, une ligne par agent ; les écritures de configuration passent une à une.

### `GET /api/events/stream`

Flux Server-Sent Events. Envoie chaque nouvel événement ajouté au fichier d'événements du jour (`event: agent`, `data: <événement JSON>`), en suivant le changement de date et la rotation. Commentaire `: ping` toutes les 15 s. Paramètre facultatif : `feature`.

## Ce que la page affiche

- **Tableau de bord** : totaux, jetons par agent, par modèle, par fonctionnalité (le cache affiché à part) ; quotas restants par fournisseur avec agents indisponibles.
- **À décider** : fonctionnalités où `waitingForUser` est vrai, en tête de page.
- **Fonctionnalités** : tableau des fiches (état, dernier verdict, tests, décision).
- **Agents en direct** : par fonctionnalité, arbre orchestrateur → explorateur / développeur / relecteur (d'après `role`), statut, outil en cours, durée, alertes ; mise à jour par le flux SSE.
- **Fiche d'un agent** (au clic sur un appel) : modèle, rôle, durée, jetons, liste des outils et messages de `/api/calls/:callId`.
- **Frise** : pour une fonctionnalité, une barre par appel sur l'axe du temps (début → fin), couleur par agent.
- **Hangar** : agents de `config/agents.json` et modèles du catalogue, ajout, réglage et retrait d’agents.
- **Paramètres** : ordre de délégation par rôle, réordonnable par glisser-déposer (et boutons monter / descendre pour le clavier), enregistré par `PUT /api/delegation` ; erreurs de validation affichées.
