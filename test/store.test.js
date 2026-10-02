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
