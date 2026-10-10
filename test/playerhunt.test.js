import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerHunt as createHunt } from '../src/playerhunt.js';
import { formatAlert } from '../src/notifiers.js';

const T = (power, attackable) => [{ name: 'Tartarus', power, attackable }];
const B = 10_000_000;

test('lov: objeví se D (2 čtení) -> zpráva; pak síla pod 10 mil. -> kritická; D zmizí -> konec', () => {
  const h = createHunt();
  assert.deepEqual(h.evaluate('11', T(50e6, false), B, 0), []);
  assert.deepEqual(h.evaluate('11', T(50e6, true), B, 1), [], 'jedno čtení nestačí');
  assert.deepEqual(h.evaluate('11', T(50e6, true), B, 2), [{ type: 'd-on', name: 'Tartarus', power: 50e6 }]);
  assert.deepEqual(h.evaluate('11', T(50e6, true), B, 3), [], 'D trvá: nic dalšího');
  assert.deepEqual(h.evaluate('11', T(8e6, true), B, 4), []);
  assert.deepEqual(h.evaluate('11', T(8e6, true), B, 5), [{ type: 'crit', name: 'Tartarus', power: 8e6 }]);
  assert.deepEqual(h.evaluate('11', T(7e6, true), B, 6), [], 'kritické se neopakuje');
  assert.deepEqual(h.status('11', 'Tartarus'), { huntD: true, huntCrit: true });
  h.evaluate('11', T(7e6, false), B, 7);
  assert.deepEqual(h.evaluate('11', T(7e6, false), B, 8), [{ type: 'd-off', name: 'Tartarus', power: 7e6 }]);
});

test('lov: D se objeví rovnou se silou pod 10 mil. -> jen kritická zpráva (ne dvě)', () => {
  const h = createHunt();
  h.evaluate('11', T(5e6, true), B, 0);
  assert.deepEqual(h.evaluate('11', T(5e6, true), B, 1), [{ type: 'crit', name: 'Tartarus', power: 5e6 }]);
});

test('lov: jednorázový výkyv D ani síly se nehlásí; po vyjetí nad hranici a novém pádu znovu kritické', () => {
  const h = createHunt();
  h.evaluate('11', T(50e6, true), B, 0); h.evaluate('11', T(50e6, true), B, 1); // D svítí
  assert.deepEqual(h.evaluate('11', T(50e6, false), B, 2), [], 'jedno čtení bez D');
  assert.deepEqual(h.evaluate('11', T(50e6, true), B, 3), []);
  h.evaluate('11', T(5e6, true), B, 4); h.evaluate('11', T(5e6, true), B, 5); // kritické
  h.evaluate('11', T(30e6, true), B, 6); // vyskočil nad hranici
  h.evaluate('11', T(5e6, true), B, 7);
  assert.deepEqual(h.evaluate('11', T(5e6, true), B, 8), [{ type: 'crit', name: 'Tartarus', power: 5e6 }]);
});

test('lov: texty zpráv', () => {
  assert.match(formatAlert({ reason: 'target', hunt: 'd-on', race: 'Vyvrhel', name: 'Tartarus', power: 50_000_000 }), /^🎯 LOV: \[Vyvrhel\] Tartarus jde dobýt \(D svítí\) – síla 50\.000\.000$/);
  assert.match(formatAlert({ reason: 'critical', hunt: 'crit', race: 'Vyvrhel', name: 'Tartarus', power: 8_000_000, below: 10_000_000 }), /^🆘 LOV: \[Vyvrhel\] TARTARUS JDE DOBÝT – síla 8\.000\.000 \(pod 10\.000\.000\)!$/);
  assert.match(formatAlert({ reason: 'released', hunt: 'd-off', race: 'Vyvrhel', name: 'Tartarus', power: 8_000_000 }), /^⚪ LOV: \[Vyvrhel\] Tartarus už nejde dobýt \(D zmizelo\)/);
});
