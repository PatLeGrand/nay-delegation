Défi de raisonnement. N'utilise aucun outil, ne lis ni n'écris aucun fichier, ne lance aucune
commande : raisonne seul. Pour chaque problème, un raisonnement court, puis termine ta réponse
par le bloc RÉPONSES exactement au format demandé (une ligne par réponse, rien après le bloc).

P1. Cinq personnes A, B, C, D, E sont chacune soit chevalier (dit toujours vrai), soit fripon
(ment toujours).
A : « B est un fripon. »
B : « C et E sont de même nature. »
C : « A est un fripon, ou D est un chevalier. »
D : « Parmi nous cinq, il y a exactement un chevalier. »
E : « C est un fripon. »
Qui sont les chevaliers ?

P2. Huit tâches, avec durée (heures) et prérequis (une tâche ne commence qu'une fois tous ses
prérequis terminés ; une tâche commencée n'est pas interrompue ; un ouvrier fait une tâche à
la fois) :
A 3 h (aucun) · B 1 h (A) · C 1 h (A) · D 5 h (B) · E 5 h (B, C) · F 1 h (D, E) · G 1 h (aucun) · H 3 h (G, C)
a) Durée totale minimale avec autant d'ouvriers que nécessaire ?
b) Durée totale minimale avec exactement 2 ouvriers ?

P3. Une urne contient 4 boules rouges, 3 bleues et 2 vertes. On en tire 3 sans remise.
Probabilité que les trois boules soient de trois couleurs différentes ? (fraction irréductible)

P4. Qu'affiche ce programme JavaScript (une seule ligne) ?
const fns = [];
for (var i = 0; i < 3; i++) fns.push(() => i);
let total = fns.reduce((acc, f) => acc + f(), 0);
const nums = [10, 9, 1, 100].sort();
const obj = { n: 1, inc() { this.n++; return this; } };
obj.inc().inc();
const { n } = obj;
console.log(total, nums.join(','), n, [0, '', null, 'a'].filter(Boolean).length, typeof NaN, 0.1 + 0.2 === 0.3);

P5. Combien d'entiers de 1 à 1000 sont divisibles par 3 ou par 5, mais pas par 7 ?

P6. Règle de choix d'un relecteur : on prend la liste propre à l'auteur si elle existe, sinon
la liste par défaut ; on retire toujours l'auteur ; on choisit le premier agent disponible.
Liste par défaut : hydrogen, terra, sonnet, gemini-flash
Liste si l'auteur est hydrogen : terra, gemini-flash
Liste si l'auteur est terra : hydrogen, sonnet, gemini-flash
Quel relecteur est choisi dans chaque cas ?
a) auteur terra ; indisponibles : hydrogen, sonnet
b) auteur hydrogen ; indisponible : terra
c) auteur sol ; indisponible : hydrogen
d) auteur sonnet ; indisponibles : hydrogen, terra

P7. Il y a 2026 jetons. Deux joueurs retirent à tour de rôle 1, 2 ou 4 jetons ; celui qui
prend le dernier jeton gagne. Qui gagne avec un jeu parfait (premier ou second joueur), et
quels sont tous les premiers coups gagnants (si le premier joueur gagne) ?

Format final obligatoire :
RÉPONSES
P1: <lettres des chevaliers, ex. BD>
P2a: <nombre>
P2b: <nombre>
P3: <fraction>
P4: <ligne affichée>
P5: <nombre>
P6a: <agent>
P6b: <agent>
P6c: <agent>
P6d: <agent>
P7: <premier|second> ; <coups séparés par des virgules, ou aucun>
