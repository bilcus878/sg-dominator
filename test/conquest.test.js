import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConquest } from '../src/conquest.js';
import { formatAlert } from '../src/notifiers.js';

const L = { below: 10_000_000, above: 20_000_000 };
const run = (c, power, now, extra = {}) => c.evaluate('1', [{ name: 'A', power, watched: true, ...extra }], L, now);

test('k dobytí: jedna zpráva při pádu pod 10M (po 2 čteních), jedna při návratu nad 20M', () => {
  const c = createConquest();
  assert.deepEqual(run(c, 50_000_000, 0), []);
  assert.deepEqual(run(c, 8_000_000, 1000), [], 'první čtení pod hranicí ještě nestačí');
  const ev = run(c, 8_000_000, 2000);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'target');
  assert.equal(c.status('1', 'A').target, true);
  assert.deepEqual(run(c, 7_000_000, 3000), [], 'další pokles = žádná další zpráva');
  assert.deepEqual(run(c, 15_000_000, 4000), [], 'mezi 10M a 20M zůstává k dobytí');
  assert.equal(c.status('1', 'A').target, true);
  assert.deepEqual(run(c, 25_000_000, 5000), []);
  const rel = run(c, 25_000_000, 6000);
  assert.equal(rel.length, 1);
  assert.equal(rel[0].type, 'released');
  assert.equal(c.status('1', 'A').target, false);
});

test('k dobytí: jednorázový výkyv pod 10M se nehlásí', () => {
  const c = createConquest();
  run(c, 50_000_000, 0);
  assert.deepEqual(run(c, 1_000, 1000), []);
  assert.deepEqual(run(c, 50_000_000, 2000), []);
  assert.equal(c.status('1', 'A').target, false);
});

test('k dobytí: když hra útok nedovolí, hlásí se až ve chvíli, kdy útok půjde', () => {
  const c = createConquest();
  run(c, 5_000_000, 0, { attackable: false });
  assert.deepEqual(run(c, 5_000_000, 1000, { attackable: false }), []);
  assert.equal(c.status('1', 'A').target, true, 'v aplikaci je vidět jako cíl');
  const ev = run(c, 5_000_000, 2000, { attackable: true });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'target');
});

test('k dobytí: návrat se hlásí jen u hráče, o kterém přišla zpráva', () => {
  const c = createConquest();
  run(c, 5_000_000, 0, { attackable: false });
  run(c, 5_000_000, 1000, { attackable: false });
  run(c, 30_000_000, 2000, { attackable: false });
  assert.deepEqual(run(c, 30_000_000, 3000, { attackable: false }), []);
});

test('k dobytí: text zpráv', () => {
  assert.equal(
    formatAlert({ reason: 'target', race: 'Asgard', name: 'Lucky', power: 8_200_000, planets: 468 }),
    '🎯 K DOBYTÍ: [Asgard] Lucky – síla 8.200.000 (468 planet)',
  );
  assert.match(formatAlert({ reason: 'released', race: 'Asgard', name: 'Lucky', power: 21_000_000 }), /^✅ \[Asgard\] Lucky už není k dobytí – síla 21\.000\.000$/);
});
