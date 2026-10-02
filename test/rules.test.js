import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, evaluate, rebaseline } from '../src/rules.js';
import { DEFAULTS } from '../src/config.js';

const cfg = (o = {}) => ({ ...structuredClone(DEFAULTS), threshold: 100, cooldownSec: 10, repeatWhileBelow: false, ...o });
const P = (name, power, extra = {}) => [{ name, power, ...extra }];
// pád se potvrdí až druhým shodným čtením; vrací alerty z druhého čtení
const drop = (s, c, name, power, t) => {
  const first = evaluate(s, P(name, power), c, t);
  return [...first, ...evaluate(s, P(name, power), c, t + 1000)];
};

test('první snapshot je baseline, nealertuje', () => {
  const s = createState();
  assert.equal(evaluate(s, P('A', 50), cfg(), 0).length, 0);
});

test('pád pod práh vyšle alert, stejná hodnota ne', () => {
  const s = createState();
  evaluate(s, P('A', 200), cfg(), 0);
  assert.equal(drop(s, cfg(), 'A', 90, 1000).length, 1);
  assert.equal(evaluate(s, P('A', 90), cfg(), 60000).length, 0);
});

test('další útok pod prahem alertuje po cooldownu, ne dřív', () => {
  const s = createState();
  evaluate(s, P('A', 200), cfg(), 0);
  drop(s, cfg(), 'A', 90, 1000);
  assert.equal(drop(s, cfg(), 'A', 80, 5000).length, 0); // cooldown
  assert.equal(evaluate(s, P('A', 80), cfg(), 12000).length, 1); // potlačený alert dorazí
});

test('ignorovaný hráč nealertuje', () => {
  const s = createState();
  const c = cfg();
  const ign = (pw) => P('A', pw, { watched: false });
  evaluate(s, ign(200), c, 0);
  assert.equal(evaluate(s, ign(10), c, 1000).length, 0);
  assert.equal(evaluate(s, ign(10), c, 2000).length, 0);
});

test('individuální práh přebíjí globální', () => {
  const s = createState();
  const c = cfg();
  const own = (pw) => P('A', pw, { threshold: 500 });
  evaluate(s, own(600), c, 0);
  evaluate(s, own(400), c, 1000);
  assert.equal(evaluate(s, own(400), c, 2000).length, 1);
});

test('návrat nad práh znovu ozbrojí', () => {
  const s = createState();
  evaluate(s, P('A', 200), cfg(), 0);
  drop(s, cfg(), 'A', 90, 1000);
  evaluate(s, P('A', 150), cfg(), 20000);
  assert.equal(drop(s, cfg(), 'A', 95, 40000).length, 1);
});

test('procentuální propad nad prahem', () => {
  const s = createState();
  const c = cfg({ threshold: 10, dropPct: 20 });
  evaluate(s, P('A', 1000), c, 0);
  const a = drop(s, c, 'A', 700, 1000);
  assert.equal(a.length, 1);
  assert.equal(a[0].reason, 'drop');
});

test('jednorázový výkyv (jedno čtení) nealertuje', () => {
  const s = createState();
  evaluate(s, P('A', 200), cfg(), 0);
  assert.equal(evaluate(s, P('A', 5), cfg(), 1000).length, 0); // glitch
  assert.equal(evaluate(s, P('A', 200), cfg(), 2000).length, 0);
  assert.equal(evaluate(s, P('A', 200), cfg(), 3000).length, 0);
});

test('alert nese hodnotu před pádem jako prev', () => {
  const s = createState();
  evaluate(s, P('A', 200), cfg(), 0);
  const [a] = drop(s, cfg(), 'A', 90, 1000);
  assert.equal(a.prev, 200);
});

test('zvýšení prahu nevyvolá alert za všechny pod novým prahem', () => {
  const s = createState();
  evaluate(s, P('A', 200), cfg(), 0);
  evaluate(s, P('A', 200), cfg(), 1000);
  const c = cfg({ threshold: 300 });
  rebaseline(s, () => 300);
  assert.equal(evaluate(s, P('A', 200), c, 2000).length, 0);
  assert.equal(drop(s, c, 'A', 150, 3000).length, 1); // další pokles už hlásí
});

test('minDrop: malé další poklesy pod prahem se neposílají', () => {
  const s = createState();
  const c = cfg({ minDrop: 10 });
  evaluate(s, P('A', 200), c, 0);
  assert.equal(drop(s, c, 'A', 90, 1000).length, 1);
  assert.equal(drop(s, c, 'A', 85, 30000).length, 0); // jen -5
  assert.equal(drop(s, c, 'A', 70, 60000).length, 1); // -20 od posledního alertu
});

test('notifyRecovery: návrat nad práh se ohlásí po potvrzení', () => {
  const s = createState();
  const c = cfg({ notifyRecovery: true });
  evaluate(s, P('A', 200), c, 0);
  drop(s, c, 'A', 90, 1000);
  assert.equal(evaluate(s, P('A', 150), c, 20000).length, 0);
  const a = evaluate(s, P('A', 150), c, 21000);
  assert.equal(a.length, 1);
  assert.equal(a[0].reason, 'recovered');
});

test('repeatWhileBelow: připomínka každou pauzu, dokud je pod prahem', () => {
  const s = createState();
  const c = cfg({ repeatWhileBelow: true });
  evaluate(s, P('A', 200), c, 0);
  assert.equal(drop(s, c, 'A', 90, 1000).length, 1);
  assert.equal(evaluate(s, P('A', 90), c, 5000).length, 0); // v pauze
  const r = evaluate(s, P('A', 90), c, 12000);
  assert.equal(r.length, 1);
  assert.equal(r[0].repeat, true);
  assert.equal(evaluate(s, P('A', 90), c, 23000).length, 1);
  evaluate(s, P('A', 150), c, 24000); // zpět nad práh
  assert.equal(evaluate(s, P('A', 150), c, 40000).length, 0);
});

// ---- kritické pásmo ----
const C = (name, power) => P(name, power, { critical: 50 });
const cdrop = (s, c, power, t) => {
  const first = evaluate(s, C('A', power), c, t);
  return [...first, ...evaluate(s, C('A', power), c, t + 1000)];
};

test('vstup do kritického pásma hlásí ihned (i v cooldownu běžné zprávy) a označí se reason critical', () => {
  const s = createState();
  const c = cfg();
  evaluate(s, C('A', 200), c, 0);
  assert.equal(cdrop(s, c, 90, 1000).filter((a) => a.reason === 'threshold').length, 1); // běžná zpráva
  const a = cdrop(s, c, 40, 3000); // 2 s po běžné zprávě, cooldown je 10 s
  assert.equal(a.length, 1);
  assert.equal(a[0].reason, 'critical');
  assert.equal(a[0].repeat, false);
  assert.equal(a[0].critical, 50);
});

test('v kritickém pásmu se opakuje po criticalCooldownSec a neposílají se běžné zprávy', () => {
  const s = createState();
  const c = cfg({ criticalCooldownSec: 5 });
  evaluate(s, C('A', 200), c, 0);
  cdrop(s, c, 40, 1000); // vstup (alert ve 2000)
  assert.equal(evaluate(s, C('A', 40), c, 4000).length, 0); // 2 s po vstupu
  const r = evaluate(s, C('A', 40), c, 7500);
  assert.equal(r.length, 1);
  assert.equal(r[0].reason, 'critical');
  assert.equal(r[0].repeat, true);
  assert.equal(evaluate(s, C('A', 30), c, 8500).length, 0); // další pokles v pauze, žádná běžná zpráva
  assert.equal(evaluate(s, C('A', 30), c, 13000)[0].reason, 'critical');
});

test('jednorázový výkyv do kritického pásma nealertuje', () => {
  const s = createState();
  evaluate(s, C('A', 200), cfg(), 0);
  assert.equal(evaluate(s, C('A', 5), cfg(), 1000).length, 0);
  assert.equal(evaluate(s, C('A', 200), cfg(), 2000).length, 0);
});

test('po opuštění kritického pásma a novém vstupu se zase hlásí ihned', () => {
  const s = createState();
  const c = cfg();
  evaluate(s, C('A', 200), c, 0);
  cdrop(s, c, 40, 1000);
  evaluate(s, C('A', 70), c, 5000); // nad kritickou, pod prahem
  evaluate(s, C('A', 70), c, 6000);
  const a = cdrop(s, c, 30, 7000);
  assert.equal(a.filter((x) => x.reason === 'critical' && !x.repeat).length, 1);
});

test('hráč, který je při startu už v kritickém pásmu, nehlásí "vstup", jen "stále kritické"', () => {
  const s = createState();
  const c = cfg({ criticalCooldownSec: 5 });
  evaluate(s, C('A', 40), c, 0);
  const a = evaluate(s, C('A', 40), c, 1000); // potvrzení druhým čtením
  assert.equal(a.length, 1);
  assert.equal(a[0].reason, 'critical');
  assert.equal(a[0].repeat, true);
  assert.equal(evaluate(s, C('A', 40), c, 3000).length, 0); // další až po pauze
  assert.equal(evaluate(s, C('A', 40), c, 6500).length, 1);
});

test('rebaseline: změna prahů nevyvolá "vstup" za ty, kdo už jsou kritičtí', () => {
  const s = createState();
  const c = cfg();
  evaluate(s, C('A', 200), c, 0);
  evaluate(s, C('A', 200), c, 1000);
  rebaseline(s, () => 300, () => 250);
  const a = evaluate(s, C('A', 200), c, 2000);
  assert.equal(a.length, 0);
});

test('bez kritické hranice (critical 0) se chová jako dřív', () => {
  const s = createState();
  evaluate(s, P('A', 200), cfg(), 0);
  const a = drop(s, cfg(), 'A', 5, 1000);
  assert.equal(a.length, 1);
  assert.equal(a[0].reason, 'threshold');
});

test('kritická zpráva nese hodnotu před pádem jako prev', () => {
  const s = createState();
  const c = cfg();
  evaluate(s, C('A', 200), c, 0);
  const a = cdrop(s, c, 40, 1000);
  assert.equal(a.length, 1);
  assert.equal(a[0].reason, 'critical');
  assert.equal(a[0].prev, 200);
});

test('pád z kritického pásma přímo shora: žádná běžná zpráva navíc, jen kritická', () => {
  const s = createState();
  const c = cfg();
  evaluate(s, C('A', 200), c, 0);
  const a = cdrop(s, c, 10, 1000);
  assert.deepEqual(a.map((x) => x.reason), ['critical']);
});
