Défi de raisonnement, manche difficile. N'utilise aucun outil, ne lis ni n'écris aucun fichier,
ne lance aucune commande ni aucun code : raisonne seul. Un raisonnement court par problème,
puis termine par le bloc RÉPONSES exactement au format demandé (rien après le bloc).

H1. Ana, Bao, Cyd et Dov passent chacun une fois, aux rangs 1 à 4. Chacun a un langage
différent (Go, Rust, Python, Java) et une couleur différente (rouge, vert, bleu, jaune).
1. La personne qui fait du Rust passe juste après la personne en vert.
2. Ana ne fait pas de Python et n'est pas en bleu.
3. Bao passe avant Dov.
4. La personne au rang 1 n'est pas en jaune.
5. La personne en bleu fait du Java.
6. Cyd et la personne qui fait du Go sont séparés d'exactement 2 rangs.
7. La personne qui fait du Python passe au rang 1 ou au rang 4.
8. Dov n'est pas en rouge.
9. Ana passe au rang 2.
10. La personne en vert ne fait pas de Go.
11. Bao ne passe pas au rang 1.
12. Ana n'est pas en jaune.
Donne langage, couleur et rang de chacun.

H2. Combien de mots de 12 lettres sur l'alphabet {a, b} contiennent exactement 5 lettres « a »
et jamais trois lettres identiques consécutives (ni « aaa » ni « bbb ») ?

H3. On lance un dé équilibré à 6 faces jusqu'à ce que la somme des résultats atteigne au moins
10. Espérance du nombre de lancers ? Donne la fraction irréductible et sa valeur décimale
arrondie à 4 décimales.

H4. Qu'affiche ce programme JavaScript (Node.js) ? Une seule ligne.
const log = [];
setTimeout(() => log.push('T1'), 0);
const p = new Promise((resolve) => { log.push('P'); resolve('R'); });
queueMicrotask(() => log.push('M1'));
p.then((v) => { log.push(v); return Promise.resolve('X'); }).then((v) => log.push(v));
(async () => {
  log.push('A1');
  await null;
  log.push('A2');
  await p;
  log.push('A3');
})();
p.then(() => log.push('Q'));
setTimeout(() => { log.push('T2'); console.log(log.join(' ')); }, 0);
log.push('S');

H5. Graphe non orienté, arêtes « u–v coût » ; les arêtes marquées (P) sont à péage.
S–A 4 · S–B 2 (P) · A–B 1 · A–C 5 (P) · B–C 8 · B–D 10 · C–D 2 · C–E 3 (P) · D–E 4 ·
D–T 11 · E–T 3 · A–E 12
Coût minimal d'un chemin de S à T :
a) sans aucune arête à péage ;
b) avec au plus une arête à péage.

H6. Un outil déduit l'état d'un travail à partir d'événements horodatés (secondes) :
- appel : « accepted » après call_start sans autre activité ; « working » dès un tool_start,
  tool_end ou message ; « stalled » s'il est en cours et qu'aucun de ses événements n'est
  arrivé depuis plus de 60 s ; à son call_end : « done » si ok, « needs_input » si ok avec
  question, « failed » sinon, avec une cause (quota si l'erreur parle de quota, de limite
  de débit, de « too many requests » ou de code 429 ; sinon crash).
- si un call_end porte « retrying », l'appel prend l'état de sa reprise (l'appel dont
  resumedFrom est son identifiant), et vaut « working » tant que la reprise n'a pas commencé.
- story : « working » si un de ses appels est working ; « stalled » si aucun événement de la
  story ni de ses appels depuis plus de 60 s ; sinon « accepted » ; terminée par story_end.
Événements :
t=0 appel a call_start · t=5 appel a tool_start · t=40 appel a call_end error, retrying
t=50 appel b call_start, resumedFrom a · t=60 appel b message · t=300 appel b call_end ok, question
t=0 story s story_start · t=1 appel c (de la story s) call_start · t=10 appel c tool_end
t=0 appel d call_start · t=20 appel d call_end error « HTTP 429 Too Many Requests »
État de : a) a à t=45 · b) a à t=130 · c) a à t=300 · d) s à t=65 · e) s à t=75 ·
f) d à t=30 (avec la cause)

H7. a) Plus petit entier n tel que n! se termine par au moins 500 zéros ?
b) Trois derniers chiffres de 3^2026 ?

H8. Trois piles de 3, 5 et 7 jetons. À son tour, un joueur retire 1, 2 ou 3 jetons d'une seule
pile. Celui qui prend le dernier jeton gagne. Le premier joueur gagne-t-il avec un jeu
parfait ? Donne tous ses premiers coups gagnants.

Format final obligatoire :
RÉPONSES
H1: Ana=<langage>/<couleur>/<rang> Bao=… Cyd=… Dov=…
H2: <nombre>
H3: <fraction> ≈ <décimal>
H4: <ligne affichée>
H5a: <nombre>
H5b: <nombre>
H6a: <état>
H6b: <état>
H6c: <état>
H6d: <état>
H6e: <état>
H6f: <état> (<cause>)
H7a: <nombre>
H7b: <trois chiffres>
H8: <oui|non> ; <coups au format « pile 5 -2 », séparés par des virgules, ou aucun>
