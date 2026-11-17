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

Consommation lue dans `.nay/state/usage.jsonl`. Paramètres facultatifs : `feature`, `since` (ISO).

```json
{
  "totals": { "calls": 12, "input": 3200000, "cachedInput": 2900000, "output": 120000, "durationMs": 1800000 },
  "byAgent":   [{ "key": "sol", "calls": 5, "input": 0, "cachedInput": 0, "output": 0, "durationMs": 0 }],
  "byModel":   [{ "key": "gpt-6.1-sol", "calls": 5, "input": 0, "cachedInput": 0, "output": 0, "durationMs": 0 }],
  "byFeature": [{ "key": "quotas", "calls": 4, "input": 0, "cachedInput": 0, "output": 0, "durationMs": 0 }],
  "byRole":    [{ "key": "relecteur", "calls": 6, "input": 0, "cachedInput": 0, "output": 0, "durationMs": 0 }],
  "recent":    [{ "timestamp": "…", "agent": "sol", "model": "…", "feature": "…", "role": "…", "status": "ok", "usage": { "input": 0, "cachedInput": 0, "output": 0 }, "durationMs": 0 }]
}
```
Listes triées par `input + output` décroissant. `recent` : les 50 derniers appels, du plus récent au plus ancien.

### `GET /api/quota`

Résultat de `readQuotas()` plus la disponibilité de chaque agent :

```json
{
  "providers": { "codex": { "status": "ok", "windows": [{ "label": "5h", "remainingPct": 77, "resetsAt": "…" }], "measuredAt": "…", "stale": false }, "agy": {}, "claude": {} },
  "agents": [{ "name": "sol", "provider": "codex", "available": true, "reason": "…" }]
}
```

### `GET /api/status`

État des appels et alertes, calculés depuis le fichier d'événements du jour (`src/monitor/`). Paramètre facultatif : `feature`.

```json
{
  "now": "…",
  "calls": [{
    "callId": "…", "agent": "sol", "model": "…", "feature": "…", "role": "developpeur", "mode": "write",
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

### `GET /api/events/stream`

Flux Server-Sent Events. Envoie chaque nouvel événement ajouté au fichier d'événements du jour (`event: agent`, `data: <événement JSON>`), en suivant le changement de date et la rotation. Commentaire `: ping` toutes les 15 s. Paramètre facultatif : `feature`.

## Ce que la page affiche

- **Tableau de bord** : totaux, jetons par agent, par modèle, par fonctionnalité (le cache affiché à part) ; quotas restants par fournisseur avec agents indisponibles.
- **À décider** : fonctionnalités où `waitingForUser` est vrai, en tête de page.
- **Fonctionnalités** : tableau des fiches (état, dernier verdict, tests, décision).
- **Agents en direct** : par fonctionnalité, arbre orchestrateur → explorateur / développeur / relecteur (d'après `role`), statut, outil en cours, durée, alertes ; mise à jour par le flux SSE.
- **Fiche d'un agent** (au clic sur un appel) : modèle, rôle, durée, jetons, liste des outils et messages de `/api/calls/:callId`.
- **Frise** : pour une fonctionnalité, une barre par appel sur l'axe du temps (début → fin), couleur par agent.
- **Paramètres** : ordre de délégation par rôle, réordonnable par glisser-déposer (et boutons monter / descendre pour le clavier), enregistré par `PUT /api/delegation` ; erreurs de validation affichées.
