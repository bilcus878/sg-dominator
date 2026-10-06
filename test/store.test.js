import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

test('store: pamatuje si poslední změnu síly hráče a počet planet ze hry', () => {
  const st = createStore();
  st.ingest({ raceId: '20', players: [{ name: 'A', power: 1000, planets: 10, planetsDelta: 2 }] }, 1000);
  let [a] = st.snapshot('20', 1000).players;
  assert.equal(a.powerDelta, 0, 'první údaj není změna');
  assert.equal(a.planets, 10);
  assert.equal(a.planetsDelta, 2);

  st.ingest({ raceId: '20', players: [{ name: 'A', power: 800 }] }, 2000);
  [a] = st.snapshot('20', 2000).players;
  assert.equal(a.powerDelta, -200);
  assert.equal(a.powerAt, 2000);

  st.ingest({ raceId: '20', players: [{ name: 'A', power: 800 }] }, 3000); // beze změny: zůstává poslední změna
  [a] = st.snapshot('20', 3000).players;
  assert.equal(a.powerDelta, -200);
  assert.equal(a.powerAt, 2000);

  st.ingest({ raceId: '20', players: [{ name: 'A', power: 950 }] }, 4000);
  [a] = st.snapshot('20', 4000).players;
  assert.equal(a.powerDelta, 150);
});

test('store: získané/ztracené planety se sčítají, dokud nepřijde 30 s bez změny', () => {
  const st = createStore();
  const at = (planets, now) => { st.ingest({ raceId: '1', players: [{ name: 'A', power: 1, planets }] }, now); return st.snapshot('1', now).players[0]; };
  assert.equal(at(100, 0).planetsChange, 0, 'první údaj není změna');
  let a = at(99, 1000);
  assert.deepEqual([a.planetsChange, a.planetsAt], [-1, 1000]);
  a = at(98, 20_000); // do 30 s od poslední změny: sečte se a čas se posune
  assert.deepEqual([a.planetsChange, a.planetsAt], [-2, 20_000]);
  a = at(98, 45_000); // beze změny: zůstává poslední změna (UI ji po 30 s schová)
  assert.deepEqual([a.planetsChange, a.planetsAt], [-2, 20_000]);
  a = at(99, 60_000); // víc než 30 s od poslední změny: začíná znovu
  assert.deepEqual([a.planetsChange, a.planetsAt], [1, 60_000]);
});


test('snapshot: hráč na víc stránkách – vyhrají nejčerstvější data a každý hráč má čas posledního čtení (seenAt)', () => {
  const st = createStore();
  st.ingest({ raceId: '1', page: 1, players: [{ name: 'A', power: 100 }, { name: 'B', power: 50 }] }, 1000);
  st.ingest({ raceId: '1', page: 2, players: [{ name: 'A', power: 140 }, { name: 'C', power: 70 }] }, 5000);
  const byName = Object.fromEntries(st.snapshot('1', 6000).players.map((p) => [p.name, p]));
  assert.equal(byName.A.power, 140); // novější stránka vyhrává, i když má vyšší číslo stránky i když je starší stránka první
  assert.deepEqual([byName.A.seenAt, byName.B.seenAt, byName.C.seenAt], [5000, 1000, 5000]);
  st.ingest({ raceId: '1', page: 1, players: [{ name: 'A', power: 90 }, { name: 'B', power: 50 }] }, 7000);
  assert.equal(st.snapshot('1', 7100).players.find((p) => p.name === 'A').power, 90);
});

test('store: dvě okna stejné rasy s různými daty – platí okno, kde se data mění; staré (pořád stejné) se ignoruje', () => {
  const st = createStore();
  const P = (power) => [{ name: 'Martos', power }];
  assert.equal(st.ingest({ raceId: '4', src: 'stare', players: P(3_283_580) }, 1000), true);
  assert.equal(st.ingest({ raceId: '4', src: 'zive', players: P(3_283_580) }, 1500), true, 'nové okno = čerstvá stránka');
  assert.equal(st.ingest({ raceId: '4', src: 'zive', players: P(176_923) }, 2000), true); // útok: v živém okně se změnilo
  assert.equal(st.ingest({ raceId: '4', src: 'stare', players: P(3_283_580) }, 2500), false, 'staré okno se ignoruje');
  assert.equal(st.snapshot('4', 2600).players[0].power, 176_923);
  for (let t = 3000; t < 8000; t += 1000) { st.ingest({ raceId: '4', src: 'stare', players: P(3_283_580) }, t); st.ingest({ raceId: '4', src: 'zive', players: P(176_923) }, t + 500); }
  assert.equal(st.snapshot('4', 8000).players[0].power, 176_923, 'síla neskáče tam a zpět');
  assert.equal(st.snapshot('4', 8000).sources, 2);
});

test('store: když živé okno zmizí, převezme to druhé', () => {
  const st = createStore();
  st.ingest({ raceId: '4', src: 'a', players: [{ name: 'X', power: 1 }] }, 0);
  st.ingest({ raceId: '4', src: 'b', players: [{ name: 'X', power: 2 }] }, 100);
  assert.equal(st.ingest({ raceId: '4', src: 'a', players: [{ name: 'X', power: 1 }] }, 1000), false);
  assert.equal(st.ingest({ raceId: '4', src: 'a', players: [{ name: 'X', power: 1 }] }, 7000), true, 'okno b se 5 s neozvalo');
  assert.equal(st.snapshot('4', 7000).players[0].power, 1);
});
