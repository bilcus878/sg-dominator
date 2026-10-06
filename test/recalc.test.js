import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecalc, recalcHour } from '../src/recalc.js';

const at = (h, m, s = 0) => new Date(2026, 9, 6, h, m, s).getTime();

test('přepočet: celá hodina – pár minut po celé zpět na ni, těsně před celou na ni', () => {
  assert.equal(recalcHour(at(14, 0, 5)), at(14, 0));
  assert.equal(recalcHour(at(14, 7)), at(14, 0));
  assert.equal(recalcHour(at(13, 58)), at(14, 0));
  assert.equal(recalcHour(at(23, 55)), new Date(2026, 9, 7, 0, 0).getTime());
});

test('přepočet: vynulování „Dobyt“ z >0 na 0 potvrzené 2 čteními se uloží jako celá hodina', () => {
  let saved = null;
  const r = createRecalc({}, { onChange: (x) => { saved = x; } });
  r.ingest('5', [{ name: 'Nortrom', dobyt: 11 }], at(13, 50));
  assert.deepEqual(r.ingest('5', [{ name: 'Nortrom', dobyt: 0 }], at(14, 0, 2)), [], 'jedno čtení nestačí');
  const f = r.ingest('5', [{ name: 'Nortrom', dobyt: 0 }], at(14, 0, 4));
  assert.deepEqual(f, [{ name: 'Nortrom', at: at(14, 0), hour: 14 }]);
  assert.deepEqual(r.of('5', 'Nortrom'), { recalcAt: at(14, 0), recalcHour: 14 });
  assert.equal(saved['5|Nortrom'].hour, 14);
  // nula dál trvá: žádný další přepočet
  assert.deepEqual(r.ingest('5', [{ name: 'Nortrom', dobyt: 0 }], at(14, 5)), []);
});

test('přepočet: jednorázová nula (chyba čtení) ani hráč, co měl 0× od začátku, se nepočítá', () => {
  const r = createRecalc();
  r.ingest('5', [{ name: 'A', dobyt: 3 }, { name: 'B', dobyt: 0 }], at(10, 0));
  r.ingest('5', [{ name: 'A', dobyt: 0 }, { name: 'B', dobyt: 0 }], at(10, 1));
  r.ingest('5', [{ name: 'A', dobyt: 3 }, { name: 'B', dobyt: 0 }], at(10, 2));
  assert.deepEqual(r.of('5', 'A'), { recalcAt: null, recalcHour: null });
  assert.deepEqual(r.of('5', 'B'), { recalcAt: null, recalcHour: null });
});

test('přepočet: uložené časy přežijí restart (načtou se ze souboru)', () => {
  const r = createRecalc({ '5|X': { at: at(9, 0), hour: 9, history: [at(9, 0)] } });
  assert.deepEqual(r.of('5', 'X'), { recalcAt: at(9, 0), recalcHour: 9 });
});
