import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeRecalc, mergeEcon, sharedFileName, buildShared, sameShared, readAllShared, writeShared } from '../src/shared-data.js';

const H = 3_600_000;
const NOW = new Date(2026, 9, 6, 20, 0, 0).getTime();
const at = (h) => new Date(2026, 9, 6, h, 0, 0).getTime();
const rc = (...hours) => ({ at: at(hours[0]), hour: hours[0], history: hours.map(at) });
const clone = (o) => JSON.parse(JSON.stringify(o));

test('sdílení vojenských přepočtů: sjednocení historie, stejný přepočet z obou počítačů se spojí, výsledek nezávisí na pořadí ani na opakování', () => {
  const a = { '4|Bob': rc(14, 10), '4|Eva': rc(9) };
  const b = { '4|Bob': rc(14, 12), '4|Cyd': rc(7) };
  const x = clone(a); const y = clone(b);
  assert.equal(mergeRecalc(x, [b], { now: NOW }), true);
  assert.equal(mergeRecalc(y, [a], { now: NOW }), true);
  assert.deepEqual(x['4|Bob'].history, [at(14), at(12), at(10)]);
  assert.equal(x['4|Bob'].at, at(14)); assert.equal(x['4|Bob'].hour, 14);
  assert.deepEqual(Object.keys(x).sort(), ['4|Bob', '4|Cyd', '4|Eva']);
  assert.deepEqual(Object.fromEntries(Object.entries(x).sort()), Object.fromEntries(Object.entries(y).sort()), 'pořadí slučování nevadí');
  assert.equal(mergeRecalc(x, [b, a], { now: NOW }), false, 'opakované sloučení nic nemění');
});

test('sdílení vojenských přepočtů: historie je omezená na 7 a staré záznamy a náhrobek (nový věk) se zahodí', () => {
  const many = { '4|A': { at: at(19), hour: 19, history: [19, 18, 17, 16, 15, 14, 13].map(at) } };
  const t = { '4|A': { at: at(12), hour: 12, history: [at(12), at(11)] } };
  mergeRecalc(t, [many], { now: NOW });
  assert.equal(t['4|A'].history.length, 7);
  const cleared = clone(t);
  mergeRecalc(cleared, [many], { clearedAt: at(16), now: NOW }); // vše před 16:00 pryč
  assert.deepEqual(cleared['4|A'].history, [at(19), at(18), at(17), at(16)]);
  const old = { '4|B': { at: NOW - 200 * 24 * H, hour: 1, history: [NOW - 200 * 24 * H] } };
  const t2 = {}; mergeRecalc(t2, [old], { now: NOW });
  assert.deepEqual(t2, {}, 'starší než 120 dní se nenese dál');
  const all = clone(many); mergeRecalc(all, [], { clearedAt: at(23), now: NOW + 5 * H });
  assert.deepEqual(all, {}, 'nic nové než náhrobek = hráč zmizí');
});

test('sdílení ekonomických přepočtů: dvě pozorování téhož přepočtu (do 15 min) se spojí, vzdálená zůstanou zvlášť', () => {
  const ev = (min, extra = {}) => ({ at: at(14) + min * 60_000, popGain: 1000, online: false, colon: 0, planetsBefore: 50, ...extra });
  const mine = { '4|A': { events: [ev(23, { popGain: 1200 })] } };
  const other = { '4|A': { events: [ev(25, { online: true, colon: 9, popGain: 900 }), ev(0).at ? { ...ev(0), at: at(8) } : null].filter(Boolean) } };
  const t = clone(mine);
  assert.equal(mergeEcon(t, [other], { now: NOW }), true);
  assert.equal(t['4|A'].events.length, 2);
  assert.deepEqual(t['4|A'].events[0], { at: at(14) + 23 * 60_000, popGain: 1200, online: true, colon: 9, planetsBefore: 50 });
  assert.equal(t['4|A'].events[1].at, at(8));
  const u = clone(other); mergeEcon(u, [mine], { now: NOW });
  assert.deepEqual(u, t, 'stejný výsledek při opačném pořadí');
  assert.equal(mergeEcon(t, [mine, other], { now: NOW }), false);
  const c = clone(t); mergeEcon(c, [], { clearedAt: at(12), now: NOW });
  assert.equal(c['4|A'].events.length, 1, 'náhrobek odstraní starší událost');
});

test('sdílení: soubory se zapisují a čtou, vlastní soubor se pozná, shodný obsah se nepřepisuje, poškozený soubor se přeskočí', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sgd-shared-'));
  try {
    assert.equal(sharedFileName('Muj PC!'), 'data-Muj_PC_.json');
    const a = buildShared('PC1', { '4|A': rc(10) }, {}, { military: 0, economic: 0 }, 1000);
    writeShared(dir, sharedFileName('PC1'), a);
    writeShared(dir, sharedFileName('PC2'), buildShared('PC2', {}, {}, { military: 5, economic: 0 }, 2000));
    writeShared(dir, 'poznamky.json', { x: 1 }); // cizí soubor se nebere
    const bad = join(dir, 'data-rozbity.json'); writeFileSync(bad, '{nesmysl');
    const all = readAllShared(dir);
    assert.deepEqual(all.map((f) => f.file).sort(), ['data-PC1.json', 'data-PC2.json']);
    assert.ok(sameShared(a, buildShared('PC1', { '4|A': rc(10) }, {}, { military: 0, economic: 0 }, 9999)), 'čas uložení obsah nemění');
    assert.ok(!sameShared(a, buildShared('PC1', { '4|A': rc(11) }, {}, { military: 0, economic: 0 }, 1000)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
