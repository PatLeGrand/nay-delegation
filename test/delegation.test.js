import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatesFor, chooseAgent, loadDelegation, validateDelegation } from '../src/delegation.js';
import { readConfig } from '../src/config.js';

const agentNames = Object.keys(readConfig('agents'));

test('Les clés selonAuteur désignent un agent connu ou l’orchestrateur', () => {
  const delegation = loadDelegation();
  delegation.relecteur.selonAuteur.orchestrateur = ['sol'];
  assert.deepEqual(validateDelegation(delegation, agentNames), []);
  delegation.relecteur.selonAuteur.hydrogene = ['terra'];
  assert.ok(validateDelegation(delegation, agentNames)
    .some((error) => /selonAuteur.hydrogene.*auteur inconnu/.test(error)));
});

for (const [author, unavailable, expected] of [
  ['sol', [], 'hydrogen'],
  ['hydrogen', [], 'terra'],
  ['sol', ['hydrogen'], 'terra'],
  ['terra', ['hydrogen'], 'sonnet'],
  ['hydrogen', ['terra'], 'gemini-flash'],
  ['orchestrateur', [], 'hydrogen'],
]) {
  test(`Relecture de ${author}, indisponibles ${unavailable} : ${expected}`, () => {
    const result = chooseAgent('relecteur', { author,
      isAvailable: (agent) => !unavailable.includes(agent) });
    assert.deepEqual(result, { agent: expected,
      skipped: unavailable.map((agent) => ({ agent, reason: 'indisponible' })) });
  });
}

test('Tous les agents indisponibles : erreur avec les candidats et les raisons', () => {
  assert.throws(() => chooseAgent('relecteur', { author: 'hydrogen', isAvailable: () => false }),
    /Aucun agent disponible.*terra \(indisponible\), gemini-flash \(indisponible\)/);
});

// Liste fixe : ces tests portent sur la règle, pas sur l'ordre réglé dans config/delegation.json.
const solThenSonnet = () => ({ ...loadDelegation(), developpeur: ['sol', 'sonnet'] });

test('Le développeur de secours est choisi si sol est indisponible', () => {
  assert.deepEqual(chooseAgent('developpeur', { delegation: solThenSonnet(), isAvailable: (agent) => agent !== 'sol' }),
    { agent: 'sonnet', skipped: [{ agent: 'sol', reason: 'indisponible' }] });
});

test('L’auteur est exclu même dans selonAuteur, avant de vérifier sa disponibilité', () => {
  const delegation = loadDelegation();
  delegation.relecteur.selonAuteur.sol = ['sol', 'terra'];
  assert.deepEqual(candidatesFor('relecteur', { author: 'sol', delegation }), ['terra']);
  assert.deepEqual(chooseAgent('relecteur', { author: 'sol', delegation,
    isAvailable(agent) { assert.notEqual(agent, 'sol'); return true; } }),
  { agent: 'terra', skipped: [{ agent: 'sol', reason: 'auteur' }] });
});

test('Choisir un relecteur exige un auteur non vide', () => {
  for (const select of [candidatesFor, chooseAgent]) {
    for (const author of [undefined, null, '', '   ', 42]) {
      assert.throws(() => select('relecteur', { author }),
        /auteur requis pour choisir un relecteur/);
    }
  }
});

test('Une liste selonAuteur doit proposer un autre agent que l’auteur', () => {
  const delegation = loadDelegation();
  delegation.relecteur.selonAuteur.sol = ['sol'];
  assert.ok(validateDelegation(delegation, agentNames)
    .some((error) => /selonAuteur.sol.*autre agent que l’auteur/.test(error)));
  for (const select of [candidatesFor, chooseAgent]) {
    assert.throws(() => select('relecteur', { author: 'sol', delegation }),
      /selonAuteur.sol.*autre agent que l’auteur/);
  }
  delegation.relecteur.selonAuteur.sol.push('terra');
  assert.deepEqual(validateDelegation(delegation, agentNames), []);
});

test('Les sélecteurs rejettent clairement les configurations injectées invalides', () => {
  for (const select of [candidatesFor, chooseAgent]) {
    assert.throws(() => select('developpeur', { delegation: null }),
      /Configuration de délégation invalide.*\nLa délégation doit être un objet/);
    for (const list of ['sol', { agent: 'sol' }, [42], [null], [{}]]) {
      const delegation = loadDelegation();
      delegation.developpeur = list;
      assert.throws(() => select('developpeur', { delegation }),
        /developpeur : (une liste non vide est requise|chaque agent doit être une chaîne)/);
    }
    assert.throws(() => select('inconnu', { delegation: loadDelegation() }), /Rôle inconnu/);
  }
});

test('La disponibilité doit être un booléen strict pour chaque agent essayé', () => {
  for (const result of [Promise.resolve(true), {}, undefined, null, 0, 1, '', 'true']) {
    assert.throws(() => chooseAgent('developpeur', { delegation: solThenSonnet(), isAvailable: () => result }),
      /isAvailable doit renvoyer un booléen pour sol/);
  }
  assert.throws(() => chooseAgent('developpeur', { isAvailable: null }),
    /isAvailable doit être une fonction/);
  assert.throws(() => chooseAgent('developpeur', { delegation: solThenSonnet(),
    isAvailable: (agent) => agent === 'sol' ? false : undefined,
  }), /isAvailable doit renvoyer un booléen pour sonnet/);
});

test('L’auteur est aussi exclu de la liste par défaut', () => {
  const delegation = loadDelegation();
  delete delegation.relecteur.selonAuteur.hydrogen;
  assert.ok(!candidatesFor('relecteur', { author: 'hydrogen', delegation }).includes('hydrogen'));
  assert.deepEqual(chooseAgent('relecteur', { author: 'hydrogen', delegation }),
    { agent: 'terra', skipped: [{ agent: 'hydrogen', reason: 'auteur' }] });
});

test('L’ordre injecté change le choix sans modifier la configuration sur disque', () => {
  const delegation = loadDelegation();
  const configured = [...delegation.developpeur];
  delegation.developpeur.reverse();
  assert.equal(chooseAgent('developpeur', { delegation }).agent, configured.at(-1));
  assert.deepEqual(candidatesFor('developpeur', { delegation }), [...configured].reverse());
  assert.equal(chooseAgent('developpeur').agent, configured[0]);
});

test('Validation : configuration valide, agent inconnu, liste vide et doublon', () => {
  assert.deepEqual(validateDelegation(loadDelegation(), agentNames), []);
  for (const [list, message] of [
    [['inconnu'], /developpeur.*agent inconnu.*inconnu/],
    [[], /developpeur.*liste non vide/],
    [['sol', 'sol'], /developpeur.*doublon.*sol/],
  ]) {
    const delegation = loadDelegation();
    delegation.developpeur = list;
    assert.ok(validateDelegation(delegation, agentNames).some((error) => message.test(error)));
  }
});

test('Validation des listes de relecture et des structures mal formées', () => {
  for (const relecteur of [undefined, {}, { parDefaut: [] },
    { parDefaut: ['sol'], selonAuteur: { sol: ['inconnu', 'inconnu'] } },
    { parDefaut: ['sol'], selonAuteur: [] }]) {
    assert.ok(validateDelegation({ relecteur }, agentNames).length > 0);
  }
  for (const delegation of [null, [], 'invalide']) {
    assert.ok(validateDelegation(delegation, agentNames).length > 0);
  }
});

test('Les rôles inconnus, même hérités, produisent une erreur claire', () => {
  for (const role of ['inconnu', 'toString', '__proto__']) {
    assert.throws(() => chooseAgent(role), /Rôle inconnu/);
  }
  assert.equal(chooseAgent('relecteur', { author: 'toString' }).agent, 'hydrogen');
});

test('Un auteur entouré d’espaces est refusé au lieu de pouvoir se relire', () => {
  assert.throws(() => chooseAgent('relecteur', { author: ' hydrogen ' }), /auteur mal formé/);
});
