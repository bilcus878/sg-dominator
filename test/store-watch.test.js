import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { resolveWatch } from '../src/watch.js';

test('store: dvě okna téže rasy se počítají jako 2 zdroje, hráči se nezdvojují', () => {
  const s = createStore();
  s.ingest({ raceId: '20', src: 'a', players: [{ name: 'X', power: 1 }, { name: 'Y', power: 2 }] }, 1000);
  s.ingest({ raceId: '20', src: 'b', players: [{ name: 'X', power: 1 }, { name: 'Y', power: 3 }] }, 1500);
  const snap = s.snapshot('20', 2000);
  assert.equal(snap.sources, 2);
  assert.equal(snap.players.length, 2);
  assert.equal(snap.players.find((p) => p.name === 'Y').power, 3); // poslední data vyhrávají
});

test('store: stránky jedné rasy se slučují, zdroj po 5 s přestane být aktivní', () => {
  const s = createStore();
  s.ingest({ raceId: '5', page: 1, src: 'a', players: [{ name: 'A', power: 1 }] }, 1000);
  s.ingest({ raceId: '5', page: 2, src: 'b', players: [{ name: 'B', power: 2 }] }, 1000);
  assert.equal(s.snapshot('5', 1500).players.length, 2);
  assert.equal(s.snapshot('5', 9000).sources, 0);
});

test('watch: režim rasy je nadřazený, výjimky hráče platí jen v all (watch:false) a selected (watch:true)', () => {
  const cfg = {
    threshold: 100,
    races: { 1: { mode: 'all', threshold: 50 }, 2: { mode: 'selected', threshold: null }, 3: { mode: 'off', threshold: null } },
    players: { Vip: { watch: true, threshold: 999 }, Skip: { watch: false } },
  };
  assert.deepEqual(resolveWatch(cfg, '1', 'A'), { watched: true, threshold: 50, critical: 0, overridden: false, ownThreshold: null, ownTop: null, hunt: false });
  assert.equal(resolveWatch(cfg, '1', 'Skip').watched, false); // all: výjimka vypíná
  assert.equal(resolveWatch(cfg, '2', 'A').watched, false); // selected: bez výjimky se nehlídá
  assert.equal(resolveWatch(cfg, '2', 'Vip').watched, true); // selected: výjimka zapíná
  assert.equal(resolveWatch(cfg, '2', 'Skip').watched, false);
  assert.equal(resolveWatch(cfg, '2', 'A').threshold, 100);
  assert.equal(resolveWatch(cfg, '3', 'Vip').watched, false); // off: nehlídá se nikdo, ani výjimka
  assert.equal(resolveWatch(cfg, '3', 'Vip').threshold, 999); // vlastní práh platí dál
  assert.equal(resolveWatch(cfg, '3', 'A').watched, false);
});

test('watch: kritická hranice = % z prahu hráče; rasa přebíjí globální, 0 vypíná', () => {
  const cfg = {
    threshold: 100, criticalPct: 50,
    races: { 1: { mode: 'all', threshold: null, criticalPct: 20 }, 2: { mode: 'all', threshold: 200, criticalPct: null }, 3: { mode: 'all', threshold: null, criticalPct: 0 } },
    players: { Vip: { threshold: 1000 } },
  };
  assert.equal(resolveWatch(cfg, '1', 'A').critical, 20); // 20 % ze 100
  assert.equal(resolveWatch(cfg, '2', 'A').critical, 100); // globálních 50 % z prahu rasy 200
  assert.equal(resolveWatch(cfg, '3', 'A').critical, 0); // vypnuto u rasy
  assert.equal(resolveWatch(cfg, '2', 'Vip').critical, 500); // 50 % z vlastního prahu hráče 1000
});
