import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWatchdog } from '../src/watchdog.js';

const O = { staleMs: 30_000 };
const src = (at, key = 'race:20') => [{ key, name: 'Rasa Bedrosian', at }];

test('dokud data chodí, mlčí', () => {
  const w = createWatchdog();
  for (let t = 1000; t <= 60_000; t += 5000) assert.deepEqual(w.check(src(t - 500), t, O), []);
});

test('po 30 s ticha pošle výpadek (jednou), po návratu dat obnovu', () => {
  const w = createWatchdog();
  w.check(src(1000), 2000, O);
  let ev = [];
  for (let t = 7000; t <= 40_000; t += 5000) ev.push(...w.check(src(1000), t, O));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'down');
  assert.ok(ev[0].ageMs > 30_000);
  assert.equal(w.isDown('race:20'), true);
  // další ticho už nehlásí
  assert.deepEqual(w.check(src(1000), 45_000, O), []);
  // data se vrátila
  const up = w.check(src(49_000), 50_000, O);
  assert.equal(up.length, 1);
  assert.equal(up[0].type, 'up');
  assert.equal(up[0].ageMs, 49_000); // délka výpadku od posledních dat
  assert.equal(w.isDown('race:20'), false);
});

test('zdroj, který nikdy nedodal data, nehlásí', () => {
  const w = createWatchdog();
  for (let t = 5000; t <= 120_000; t += 5000) assert.deepEqual(w.check(src(0), t, O), []);
});

test('uspání procesu (velká mezera mezi kontrolami) výpadek nespustí hned', () => {
  const w = createWatchdog();
  w.check(src(1000), 2000, O);
  // PC spalo hodinu: první kontrola po probuzení nesmí hlásit
  assert.deepEqual(w.check(src(1000), 3_600_000, O), []);
  assert.deepEqual(w.check(src(1000), 3_620_000, O), []); // ještě v odkladu
  // okna se probrala a posílají data
  assert.deepEqual(w.check(src(3_640_000), 3_645_000, O), []);
});

test('zdroj, který se přestal sledovat, se zapomene bez hlášení', () => {
  const w = createWatchdog();
  w.check(src(1000), 2000, O);
  for (let t = 7000; t <= 40_000; t += 5000) w.check(src(1000), t, O);
  assert.equal(w.isDown('race:20'), true);
  assert.deepEqual(w.check([], 45_000, O), []);
  assert.equal(w.isDown('race:20'), false);
});
