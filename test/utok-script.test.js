import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** Čistá logika je v userscriptu mezi značkami <logic>; tady ji vytáhneme a spustíme. */
const src = readFileSync(new URL('../userscript/stargate-utok.user.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// <logic>'), src.indexOf('// </logic>'));
const { strip, toNum, pickPlanet, planFill } = new Function(`${block}; return { strip, toNum, pickPlanet, planFill };`)();

test('toNum čte čísla ze hry: mezery, pevná mezera, desetinná čárka', () => {
  assert.equal(toNum('18 822 832'), 18822832);
  assert.equal(toNum('18 822 832'), 18822832);
  assert.equal(toNum('346,1'), 346.1);
  assert.equal(toNum('7,3'), 7.3);
  assert.equal(toNum('nic'), null);
  assert.equal(toNum(''), null);
});

test('pickPlanet vybere náhodnou použitelnou planetu, prázdné a zakázané přeskočí', () => {
  const opts = [{ value: '' }, { value: 'a' }, { value: 'b', disabled: true }, { value: 'c' }];
  assert.equal(pickPlanet(opts, () => 0).value, 'a');
  assert.equal(pickPlanet(opts, () => 0.99).value, 'c');
  assert.equal(pickPlanet([{ value: '' }, { value: 'x', disabled: true }]), null);
  assert.equal(pickPlanet([]), null);
});

test('pickPlanet: rozdělení je rovnoměrné (žádná planeta není vynechaná)', () => {
  const opts = Array.from({ length: 5 }, (_, i) => ({ value: String(i) }));
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(pickPlanet(opts).value);
  assert.equal(seen.size, 5);
});

const rows = [
  { name: 'Bedrosian', available: 18_822_832 },
  { name: 'Bedrosianský samolet', available: 732 },
  { name: 'Bedrosianský křižník', available: 26_787 },
  { name: 'Elitní Bedrosian', available: 26_788 },
];

test('planFill: pošle nejvýš tolik, kolik je k dispozici, počet 0 přeskočí', () => {
  const plan = planFill(rows, [
    { name: 'Bedrosian', count: 5000, max: false },
    { name: 'Bedrosianský samolet', count: 1000, max: false }, // k dispozici jen 732
    { name: 'Bedrosianský křižník', count: 0, max: false }, // 0 = nepošlu
  ]);
  assert.deepEqual(plan, [
    { i: 0, name: 'Bedrosian', mode: 'value', value: 5000 },
    { i: 1, name: 'Bedrosianský samolet', mode: 'value', value: 732 },
  ]);
});

test('planFill: Max má přednost před počtem a názvy se párují bez ohledu na diakritiku a velikost', () => {
  const plan = planFill(rows, [{ name: 'ELITNI bedrosian', count: 10, max: true }, { name: 'bedrosiansky kriznik', count: 7, max: false }]);
  assert.deepEqual(plan, [
    { i: 2, name: 'Bedrosianský křižník', mode: 'value', value: 7 },
    { i: 3, name: 'Elitní Bedrosian', mode: 'max' },
  ]);
});

test('planFill: neznámé jednotky v nastavení se ignorují, neznámý počet k dispozici = pošle se požadovaný', () => {
  assert.deepEqual(planFill(rows, [{ name: 'Něco jiného', count: 5 }]), []);
  assert.deepEqual(planFill([{ name: 'X', available: null }], [{ name: 'X', count: 9 }]), [{ i: 0, name: 'X', mode: 'value', value: 9 }]);
});

test('strip sjednotí názvy', () => {
  assert.equal(strip('  Bedrosiánský   Křižník '), 'bedrosiansky kriznik');
});
