# Contrats d’API des maquettes (Observatoire Orbital)

Les fonctionnalités signalées par un badge **« MAQUETTE »** dans l’interface (`ui/`) fonctionnent
actuellement avec des données simulées côté client. Ce document spécifie les quatre points d’accès
à ajouter au serveur local (`src/server/`) pour les brancher sur des données et actions réelles.

Toutes les routes ci-dessous suivent les règles de sécurité de `docs/api.md` : écoute exclusive sur
`127.0.0.1`, vérification de l’en-tête `Host`, et pour les méthodes `POST` : `Content-Type: application/json`,
`Origin: http://<Host>` et limite `maxBodyBytes`.

---

## 1. Budget et économies de cache — `GET /api/budget`

Estime le coût financier de la consommation journalisée dans `.nay/state/usage.jsonl` à partir d’une
grille tarifaire configurable (`config/pricing.json`, tarifs au million de jetons pour `input`,
`cachedInput` et `output`), et met en évidence l’économie apportée par le cache de contexte.

### Paramètres de requête (facultatifs)
- `feature` : nom de la fonctionnalité à filtrer.
- `since` : horodatage ISO UTC de début de période (400 si invalide).

### Réponse `200 OK`
```json
{
  "currency": "USD",
  "pricingVersion": "2026-11",
  "dailyCapUsd": 25,
  "totalUsd": 15.47,
  "savedByCacheUsd": 60.38,
  "byAgent": [
    {
      "agent": "sol",
      "calls": 13,
      "totalUsd": 9.71,
      "savedUsd": 41.26,
      "costFresh": 1.82,
      "costCached": 4.58,
      "costOutput": 3.31
    }
  ],
  "byFeature": [
    {
      "feature": "reprise-session",
      "totalUsd": 3.12,
      "savedUsd": 11.40
    }
  ]
}
```

---

## 2. Simulateur d’aiguillage — `POST /api/delegation/simulate`

Exécute la logique réelle de `chooseAgent` (`src/delegation.js`) sans lancer d’agent, en combinant
les quotas en cache (`readQuotas()`) avec une configuration candidate et des indisponibilités simulées.
Permet de vérifier l’impact d’une modification d’ordre avant de l’enregistrer dans `config/delegation.json`.

### Corps de requête JSON
```json
{
  "role": "relecteur",
  "author": "hydrogen",
  "unavailable": ["terra"],
  "delegation": null
}
```
- `role` *(obligatoire)* : `explorateur`, `developpeur`, `tachesFaciles`, `surAppel` ou `relecteur`.
- `author` *(obligatoire si `role === "relecteur"`)* : nom d’agent ou `"orchestrateur"`.
- `unavailable` *(facultatif)* : liste d’agents simulés indisponibles.
- `delegation` *(facultatif)* : brouillon à tester ; si `null` ou absent, utilise `config/delegation.json`.

### Réponse `200 OK`
```json
{
  "chosen": "gemini-flash",
  "steps": [
    { "agent": "terra", "status": "skipped", "reason": "Marqué indisponible dans la simulation" },
    { "agent": "gemini-flash", "status": "chosen", "reason": "Premier candidat disponible" }
  ],
  "error": null
}
```
- `400 Bad Request` si `role` est inconnu, `author` manquant pour `relecteur`, ou `delegation` invalide.

---

## 3. Interruption d’un appel en vol — `POST /api/calls/:callId/cancel`

Permet d’arrêter proprement depuis la Boîte Noire un agent bloqué sur une commande longue ou une
boucle répétée, en envoyant `SIGTERM` (puis `SIGKILL` après délai de grâce) au groupe de processus
associé à `callId`.

### Corps de requête JSON
```json
{
  "reason": "Commande bloquée depuis 12 min"
}
```

### Réponses
- `202 Accepted` :
  ```json
  {
    "callId": "bec9310c-9588-4084-8dc5-1d4de8a9db98",
    "status": "cancelling",
    "signal": "SIGTERM"
  }
  ```
- `404 Not Found` : `callId` inconnu ou non géré par le registre des processus actifs.
- `409 Conflict` : appel déjà terminé (`call_end` déjà journalisé).

---

## 4. Décision de fusion depuis le Sas — `POST /api/features/:name/decision`

Enregistre la décision utilisateur directement dans la fiche `docs/features/<name>.md` (section
`## Tests` → `Ma décision` et éventuellement mise à jour de statut) sans édition manuelle de Markdown.

### Corps de requête JSON
```json
{
  "decision": "merge",
  "comment": "Validé après revue des captures."
}
```
- `decision` *(obligatoire)* : `"merge"` (approuver la fusion) ou `"changes"` (demander une correction).
- `comment` *(facultatif)* : note libre ajoutée sous la décision.

### Réponses
- `200 OK` :
  ```json
  {
    "name": "quotas",
    "decision": "merge",
    "state": "fusionnee",
    "waitingForUser": false,
    "updatedAt": "2026-11-19T04:20:00.000Z"
  }
  ```
- `400 Bad Request` : valeur de `decision` invalide.
- `404 Not Found` : fiche `docs/features/<name>.md` introuvable.
