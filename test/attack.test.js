import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTACK_DEFAULTS, normUnit, sanitizeAttack, mergeSeenUnits, sanitizeReport, sanitizeSeenUnits } from '../src/attack.js';

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
