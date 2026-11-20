# Fonctionnalité : diagnose

- **Branche :** feature/ci-diagnose
- **Créé par :** orchestrateur
- **Tâche :** CI GitHub des tests (Node 22 et 24) et commande `nay diagnose <storyId|callId>` qui explique une story ou un appel qui a mal tourné à partir du journal d'événements, avec avis facultatif d'un explorateur (`--explain`).

## Explorateur

Explorateur non lancé : périmètre lu par le développeur (`src/eventLog.js`, `src/lifecycle.js`, `src/monitor/`, `src/wait.js`, `src/story.js`, `docs/evenements.md`, `docs/cycle-de-vie.md`).

## Développeur

- `.github/workflows/tests.yml` : push sur `main` et pull requests, ubuntu-latest, matrice Node 22 / 24, `actions/checkout@v5` et `actions/setup-node@v5`, `node --test "test/*.test.js"`. Aucune dépendance, aucun secret, droits en lecture seule.
- `src/diagnose.js` : lit les fichiers du journal des `daysBack` derniers jours (archives comprises) avec les réducteurs existants — `applyJobEvent` (états et causes, comme `nay wait`) et `applyEvent` de `src/monitor/state.js` (rôle, mode, outils, comme `nay status`) — plus le dernier message de chaque appel et le `story_end` brut (contrôles).
  - Story : début, chaque appel (agent, rôle, mode, durée, statut et cause, outils, échecs d'outils, reprise), fin (statut, cause, code, dev, verdicts, contrôles, commits, détail).
  - Appel : l'appel et ses reprises (automatique ou `nay resume`).
  - Diagnostic mécanique : arrêt et cause, question finale du dev citée, agents sautés (appel en échec suivi d'un autre du même rôle), contrôles en échec, absence de fin (interrompue ou en cours), reprise suivie ou reprise manuelle ultérieure. Erreurs et messages masqués à nouveau (`secretPatterns`) et raccourcis.
  - `--explain` : le rapport (fin gardée si trop long) part vers le rôle `explorateur` (`chooseAgent`, quotas réels, mode `read`, feature `diagnose`), avec consigne de ne rien ouvrir ; repli sur l'explorateur suivant en cas d'échec, comme `nay role`.
  - Identifiant inconnu : code 1, « Inconnu dans le journal des N derniers jours ».
- `config/diagnose.json` : `daysBack`, `maxExplainChars`, `errorMaxChars`, `messageMaxChars`, `explainFeature`.
- `src/wait.js` : tri des fichiers du journal exporté (`journalFiles`) pour être partagé.
- `src/command.js` : commande `diagnose` et ligne d'USAGE ; README.

## Reviewer

- Pas encore relu.

## Tests

- `test/diagnose.test.js` (faux journal dans un dossier temporaire, faux agents) : story en défauts avec dev sauté pour quota et secret masqué, story arrêtée sur une question, story sans fin, appel avec reprise automatique, appel repris à la main, identifiant inconnu ou hors fenêtre, `--explain` (repli sur le second explorateur, mode lecture, rapport tronqué, ni secret ni dossier dans le prompt).
- Essai réel : `nay diagnose <callId>` sur un appel neon en échec (`crash`, erreur 401 citée, reprise manuelle signalée).

## Décision finale

- En attente.
