import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDohozStats, summarize, filterEpisodes } from '../src/dohoz-stats.js';

const T = 1_000_000_000_000;
const base = { name: 'Bob', source: 'auto', threshold: 100, target: 100 };

test('epizoda auto-dohozu: časy pádu, prvního odeslání, účinku a návratu nad práh se spočítají', () => {
  let saved = null;
  const s = createDohozStats({ onChange: (e) => { saved = e; } });
  s.requestStarted({ ...base, at: T + 2000, id: 1, powerBefore: 80, fallAt: T });
  s.sent(1, T + 2300);
  s.power('Bob', 80, T + 2400); // beze změny: účinek ještě není
  s.power('Bob', 130, T + 3100); // dohoz zabral a je nad prahem
  s.end('Bob', T + 3100, 'done');
  const e = saved[0];
  assert.equal(e.source, 'auto'); assert.equal(e.mixed, false);
  assert.equal(e.firstSendMs, 2300); // pád -> odeslání
  assert.equal(e.belowMs, 3100); // pád -> první čtení nad prahem
  assert.equal(e.rounds[0].sendMs, 300); // zadání -> odeslání
  assert.equal(e.rounds[0].effectMs, 800); // odeslání -> zvýšená síla v datech
  assert.equal(e.rounds[0].gain, 50); assert.equal(e.rounds[0].status, 'ok');
  assert.equal(e.outcome, 'done'); assert.equal(e.totalMs, 3100);
});

test('víc kol (k horní hranici) a ruční zásah do auto epizody se označí jako smíšené; kolo bez účinku skončí „noeffect“', () => {
  const s = createDohozStats();
  s.requestStarted({ ...base, at: T + 1000, id: 1, powerBefore: 50, fallAt: T, target: 300 });
  s.sent(1, T + 1200); s.power('Bob', 120, T + 1800);
  s.requestStarted({ ...base, source: 'manual', at: T + 4000, id: 2, powerBefore: 120 });
  s.sent(2, T + 4200);
  s.end('Bob', T + 9000, 'stall', 'síla nevzrostla');
  const e = s.snapshot().episodes[0];
  assert.equal(e.rounds.length, 2); assert.equal(e.mixed, true); assert.equal(e.target, 300);
  assert.equal(e.rounds[0].status, 'ok'); assert.equal(e.rounds[1].status, 'noeffect');
  assert.equal(e.outcome, 'stall'); assert.equal(e.note, 'síla nevzrostla');
});

test('chyba skriptu, vrácení kvůli zastaralé stránce a obnovení stránky se zapíšou k správnému kolu', () => {
  const s = createDohozStats();
  s.requestStarted({ ...base, at: T, id: 7, powerBefore: 10, fallAt: T - 500 });
  s.retried(7, T + 100);
  s.sent(7, T + 900);
  s.reloaded('Bob', T + 3500); // auto-dohoz nechal stránku obnovit (nezabralo)
  s.requestStarted({ ...base, at: T + 4500, id: 8, powerBefore: 10 });
  s.failed(8, T + 4600, 'tlačítko Odeslat nenalezeno');
  s.end('Bob', T + 5000, 'fail');
  const e = s.snapshot().episodes[0];
  assert.equal(e.rounds[0].reloaded, true); assert.equal(e.rounds[0].status, 'noeffect');
  assert.equal(e.rounds[1].status, 'failed'); assert.match(e.rounds[1].error, /Odeslat/);
  assert.equal(summarize([e]).reloads, 1);
});

test('uklízení: ruční dohoz bez konce se po návratu nad práh a po delším tichu ukončí; počet hotových epizod je omezený a mazání funguje', () => {
  let saved = [];
  const s = createDohozStats({ keep: 20, onChange: (e) => { saved = e; } });
  for (let i = 0; i < 30; i++) {
    const t = T + i * 100_000;
    s.requestStarted({ name: 'P' + i, source: 'manual', at: t, id: i + 1, powerBefore: 50, threshold: 100, fallAt: t - 1000 });
    s.sent(i + 1, t + 300); s.power('P' + i, 150, t + 900);
    s.sweep(t + 2000); assert.equal(s.hasOpen('P' + i), true, 'po návratu se chvíli čeká na další kolo');
    s.sweep(t + 5000); assert.equal(s.hasOpen('P' + i), false);
  }
  assert.equal(s.snapshot().episodes.length, 20); assert.equal(saved.length, 20);
  assert.equal(s.snapshot().episodes[0].name, 'P29', 'nejnovější první');
  s.requestStarted({ name: 'Tichy', source: 'manual', at: T, id: 99, powerBefore: 1, threshold: 100 });
  s.sweep(T + 30_000); assert.equal(s.hasOpen('Tichy'), true);
  s.sweep(T + 70_000); assert.equal(s.hasOpen('Tichy'), false);
  assert.equal(s.snapshot().episodes[0].outcome, 'fail', 'nic se neodeslalo');
  const rev = s.rev; s.clear();
  assert.equal(s.snapshot().episodes.length, 0); assert.ok(s.rev > rev);
});

test('filtry a souhrn: zdroj, jméno, výsledek, stáří, pomalé první dohozy; mediány', () => {
  const mk = (name, source, fall, firstSendMs, belowMs, outcome, mixed = false) => ({ id: Math.random(), name, source, mixed, fallAt: fall, startedAt: fall, firstSendMs, belowMs, outcome, rounds: [{ source, sentAt: fall + firstSendMs, sendMs: 200, effectMs: 700, reloaded: false }] });
  const list = [mk('Alfa', 'auto', 5000, 1800, 2500, 'done'), mk('Beta', 'manual', 4000, 9000, 12000, 'done'), mk('Gama', 'auto', 3000, 2000, null, 'stall'), mk('Delta', 'auto', 2000, 3000, 4000, 'done', true)];
  assert.deepEqual(filterEpisodes(list, { source: 'auto' }).map((e) => e.name), ['Alfa', 'Gama']);
  assert.deepEqual(filterEpisodes(list, { source: 'manual' }).map((e) => e.name), ['Beta']);
  assert.deepEqual(filterEpisodes(list, { source: 'mixed' }).map((e) => e.name), ['Delta']);
  assert.deepEqual(filterEpisodes(list, { name: 'AM' }).map((e) => e.name), ['Gama']);
  assert.deepEqual(filterEpisodes(list, { outcome: 'bad' }).map((e) => e.name), ['Gama']);
  assert.deepEqual(filterEpisodes(list, { outcome: 'ok', sinceMs: 3500 }).map((e) => e.name), ['Alfa', 'Beta']);
  assert.deepEqual(filterEpisodes(list, { slowMs: 2500 }).map((e) => e.name), ['Beta', 'Delta']);
  const sm = summarize(list);
  assert.equal(sm.episodes, 4); assert.equal(sm.ok, 3); assert.equal(sm.bad, 1);
  assert.equal(sm.firstSendMedian, 2500); assert.equal(sm.belowMedian, 4000); assert.equal(sm.firstSendMax, 9000);
  assert.deepEqual([sm.auto, sm.manual], [3, 1]);
});
