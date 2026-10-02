import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpTracker } from '../src/op.js';

const S = (id, label = id) => ({ id, label });
const fresh = (t, list, now, o) => t.update(list, now, o).fresh;

test('první snímek je jen výchozí stav (tečka, která už svítila, nealertuje)', () => {
  const t = createOpTracker();
  assert.deepEqual(fresh(t, [S('129')], 0), []);
  assert.deepEqual(fresh(t, [S('129')], 1000), []);
});

test('nová tečka alertuje jednou, dokud svítí (bez opakování)', () => {
  const t = createOpTracker();
  t.update([], 0);
  assert.deepEqual(fresh(t, [S('73')], 1000), [S('73')]);
  for (let s = 2; s <= 60; s++) assert.deepEqual(t.update([S('73')], s * 1000), { fresh: [], repeats: [] });
});

test('krátký výpadek (< 10 s) není nová tečka, delší ano', () => {
  const t = createOpTracker();
  t.update([], 0);
  t.update([S('73')], 1000);
  t.update([], 5000);
  assert.deepEqual(fresh(t, [S('73')], 8000), []);
  t.update([], 9000);
  assert.deepEqual(fresh(t, [S('73')], 25000), [S('73')]);
});

test('víc teček najednou se hlásí všechny; current() vrací jen čerstvé', () => {
  const t = createOpTracker();
  t.update([], 0);
  assert.equal(fresh(t, [S('1'), S('2')], 1000).length, 2);
  assert.equal(t.current(1500).length, 2);
  assert.equal(t.current(9000).length, 0);
});

test('opakování: tečka, která svítí dál, se připomene po repeatMs', () => {
  const t = createOpTracker();
  const o = { repeatMs: 10_000 };
  t.update([], 0, o);
  assert.equal(t.update([S('73')], 1000, o).fresh.length, 1);
  assert.equal(t.update([S('73')], 5000, o).repeats.length, 0);
  assert.equal(t.update([S('73')], 11000, o).repeats.length, 1);
  assert.equal(t.update([S('73')], 15000, o).repeats.length, 0);
  assert.equal(t.update([S('73')], 21000, o).repeats.length, 1);
});

test('opakování se týká i tečky, která svítila už při startu, a končí, když zmizí', () => {
  const t = createOpTracker();
  const o = { repeatMs: 10_000 };
  t.update([S('129')], 0, o);
  assert.equal(t.update([S('129')], 10_000, o).repeats.length, 1);
  t.update([], 12_000, o);
  assert.equal(t.update([], 30_000, o).repeats.length, 0);
});

test('silent (alert vypnutý): nic se nehlásí a po zapnutí se nepřipomínají staré tečky', () => {
  const t = createOpTracker();
  t.update([], 0, { silent: true });
  assert.equal(t.update([S('5')], 1000, { silent: true }).fresh.length, 0);
  t.update([S('5')], 50_000, { silent: true });
  // zapnuto: opakování se počítá od posledního "silent" snímku
  assert.equal(t.update([S('5')], 51_000, { repeatMs: 10_000 }).repeats.length, 0);
  assert.equal(t.update([S('5')], 61_000, { repeatMs: 10_000 }).repeats.length, 1);
});
