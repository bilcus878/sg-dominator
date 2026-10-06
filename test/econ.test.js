import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEcon, usualHour } from '../src/econ.js';

const at = (h, m, s = 0) => new Date(2026, 9, 6, h, m, s).getTime();
const P = (population, extra = {}) => ({ name: 'A', power: 1000, planets: 50, population, ...extra });

test('ekonomický přepočet: růst populace (planety stejné) potvrzený 2 čteními, online; pak přibývají planety z mateřských lodí', () => {
  let saved = null;
  const e = createEcon({}, { onChange: (r) => { saved = r; } });
  e.ingest('4', [P(100_000)], at(14, 0));
  assert.deepEqual(e.ingest('4', [P(110_000, { online: true })], at(14, 23)), [], 'jedno čtení nestačí');
  const f = e.ingest('4', [P(110_000, { online: true })], at(14, 23, 2));
  assert.equal(f.length, 1);
  assert.equal(f[0].at, at(14, 23));
  assert.equal(f[0].online, true);
  // vybírá mateřské lodě: planety přibývají po ~30 s
  e.ingest('4', [P(110_000, { planets: 53 })], at(14, 24));
  e.ingest('4', [P(110_000, { planets: 60 })], at(14, 25));
  assert.equal(saved['4|A'].events[0].colon, 10);
  e.ingest('4', [P(110_000, { planets: 70 })], at(14, 45)); // po 15 min už se nepřipisuje
  assert.equal(saved['4|A'].events[0].colon, 10);
  const o = e.of('4', 'A');
  assert.equal(o.econAt, at(14, 23));
  assert.deepEqual(o.econUsual, { hour: 14, n: 1 });
  assert.equal(o.econEvents[0].colon, 10);
});

test('ekonomický přepočet: změna počtu planet bez předchozího růstu populace ani pokles populace se nepočítá', () => {
  const e = createEcon();
  e.ingest('4', [P(100_000)], at(10, 0));
  e.ingest('4', [P(130_000, { planets: 51 })], at(10, 1)); // získal planetu (populace s ní)
  e.ingest('4', [P(130_000, { planets: 51 })], at(10, 2));
  e.ingest('4', [P(90_000, { planets: 51 })], at(10, 3)); // ztratil lidi
  e.ingest('4', [P(90_000, { planets: 51 })], at(10, 4));
  assert.equal(e.of('4', 'A').econAt, null);
});

test('ekonomický přepočet: jednorázový skok (chyba čtení) se nepočítá; další růst do 15 min je stejný přepočet', () => {
  const e = createEcon();
  e.ingest('4', [P(100_000)], at(9, 0));
  e.ingest('4', [P(150_000)], at(9, 1));
  e.ingest('4', [P(100_000)], at(9, 2));
  assert.equal(e.of('4', 'A').econAt, null);
  e.ingest('4', [P(110_000)], at(9, 30));
  e.ingest('4', [P(110_000)], at(9, 30, 2));
  e.ingest('4', [P(112_000)], at(9, 35));
  e.ingest('4', [P(112_000)], at(9, 35, 2));
  assert.equal(e.of('4', 'A').econEvents.length, 1);
});

test('obvyklá hodina = nejčastější hodina událostí', () => {
  assert.deepEqual(usualHour([{ at: at(14, 5) }, { at: at(14, 40) }, { at: at(9, 0) }]), { hour: 14, n: 2 });
  assert.equal(usualHour([]), null);
});
