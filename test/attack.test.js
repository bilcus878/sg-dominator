import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTACK_DEFAULTS, normUnit, sanitizeAttack, mergeSeenUnits, sanitizeReport, sanitizeSeenUnits, unitsFor, ARMY_DEFAULTS, sanitizeArmy } from '../src/attack.js';

test('normUnit: bez diakritiky, malá písmena, jedna mezera', () => {
  assert.equal(normUnit('  Bedrosiánský   Křižník '), 'bedrosiansky kriznik');
  assert.equal(normUnit('Elitní Bedrosian'), 'elitni bedrosian');
});

test('výchozí nastavení: nic se neodesílá samo, planeta se losuje', () => {
  assert.equal(ATTACK_DEFAULTS.autoSubmit, false);
  assert.equal(ATTACK_DEFAULTS.randomPlanet, true);
  assert.equal(ATTACK_DEFAULTS.closeTab, true);
  assert.deepEqual(ATTACK_DEFAULTS.units, []);
});

test('sanitizeAttack: jednotky se očistí, duplicity (i s jinou diakritikou) zahodí', () => {
  const a = sanitizeAttack(ATTACK_DEFAULTS, {
    autoSubmit: 1,
    units: [
      { name: ' Bedrosian ', count: '1500.9', max: false },
      { name: 'bedrosian', count: 5 }, // duplicita
      { name: 'Samolet', count: -3, max: true },
      { name: '', count: 10 },
      { name: 'Křižník', count: 'abc' },
    ],
  });
  assert.equal(a.autoSubmit, true);
  assert.deepEqual(a.units, [
    { name: 'Bedrosian', count: 1500, max: false },
    { name: 'Samolet', count: 0, max: true },
    { name: 'Křižník', count: 0, max: false },
  ]);
});

test('sanitizeAttack: bez units v těle se seznam nemění, počet jednotek je omezený', () => {
  const cur = { ...ATTACK_DEFAULTS, units: [{ name: 'A', count: 1, max: false }] };
  assert.deepEqual(sanitizeAttack(cur, { randomPlanet: false }).units, cur.units);
  const many = Array.from({ length: 80 }, (_, i) => ({ name: `U${i}`, count: i }));
  assert.equal(sanitizeAttack(ATTACK_DEFAULTS, { units: many }).units.length, 30);
});

test('mergeSeenUnits: nové jednotky ze stránky se doplní s počtem 0, známé se nemění', () => {
  const cur = { ...ATTACK_DEFAULTS, units: [{ name: 'Bedrosian', count: 1000, max: false }] };
  const merged = mergeSeenUnits(cur, [{ name: 'Bedrosian' }, { name: 'Bedrosianský samolet' }, { name: 'Elitní Bedrosian' }]);
  assert.deepEqual(merged.units.map((u) => [u.name, u.count]), [['Bedrosian', 1000], ['Bedrosianský samolet', 0], ['Elitní Bedrosian', 0]]);
  assert.equal(mergeSeenUnits(merged, [{ name: 'bedrosiansky samolet' }]), null); // nic nového
});

test('sanitizeReport a sanitizeSeenUnits zkrátí a očistí vstup z prohlížeče', () => {
  const r = sanitizeReport({ ok: 1, planet: 'x'.repeat(500), filled: [{ name: 'A', value: 12 }], problems: ['a', 7, 'b'.repeat(999)] });
  assert.equal(r.ok, true);
  assert.equal(r.planet.length, 80);
  assert.deepEqual(r.filled, [{ name: 'A', value: '12' }]);
  assert.equal(r.problems[2].length, 160);
  assert.deepEqual(sanitizeSeenUnits([{ name: 'Bedrosian', available: '18822832', attack: 7.3 }, { name: '' }, { name: 'X', available: 'n' }]),
    [{ name: 'Bedrosian', available: 18822832, attack: 7.3 }, { name: 'X', available: null, attack: null }]);
});

test('jednotky pro každý druh útoku: D má units, ostatní types; neznámý druh = D', () => {
  const a = sanitizeAttack(ATTACK_DEFAULTS, { units: [{ name: 'Bedrosian', count: 5 }], types: { P: [{ name: 'Křižník', count: 7, max: false }], X: [{ name: 'Nic', count: 1 }] } });
  assert.deepEqual(unitsFor(a, 'D').map((u) => u.name), ['Bedrosian']);
  assert.deepEqual(unitsFor(a, 'P'), [{ name: 'Křižník', count: 7, max: false }]);
  assert.deepEqual(unitsFor(a, 'Z'), []);
  assert.deepEqual(unitsFor(a, 'X').map((u) => u.name), ['Bedrosian']);
  assert.equal(a.types.X, undefined);
  // úprava jednoho druhu nesmaže ostatní
  const b = sanitizeAttack(a, { types: { Z: [{ name: 'Samolet', count: 1 }] } });
  assert.equal(b.types.P.length, 1);
  assert.equal(b.types.Z.length, 1);
});

test('mergeSeenUnits doplní jednotky do správného druhu útoku', () => {
  const m = mergeSeenUnits(ATTACK_DEFAULTS, [{ name: 'Křižník' }], 'P');
  assert.deepEqual(m.types.P, [{ name: 'Křižník', count: 0, max: false }]);
  assert.deepEqual(m.units, []);
  assert.deepEqual(mergeSeenUnits(ATTACK_DEFAULTS, [{ name: 'Bedrosian' }]).units.map((u) => u.name), ['Bedrosian']);
});

test('sanitizeArmy: jednotky dohozu se čistí stejně jako u útoku a nesmaží se, když v těle nejsou', () => {
  const a = sanitizeArmy(ARMY_DEFAULTS, { units: [{ name: ' Bedrosian ', count: '1500.7', max: false }, { name: 'bedrosian', count: 3 }, { name: '', count: 1 }, { name: 'Křižník', max: true }] });
  assert.deepEqual(a.units, [{ name: 'Bedrosian', count: 1500, max: false }, { name: 'Křižník', count: 0, max: true }]);
  assert.deepEqual(sanitizeArmy(a, {}).units, a.units);
  assert.deepEqual(sanitizeArmy(a, { units: 'x' }).units, a.units);
});
