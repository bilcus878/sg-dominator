import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpTracker } from '../src/op.js';
import { formatAlert } from '../src/notifiers.js';

const s = (...ids) => ids.map((id) => ({ id: String(id), label: '' }));

test('OP: po souhrnné zprávě se připomínka posílá pro všechny tečky naráz až po repeatMs', () => {
  const op = createOpTracker();
  op.update([], 0, { repeatMs: 10_000 }); // výchozí stav
  let r = op.update(s(1), 1000, { repeatMs: 10_000 });
  assert.equal(r.fresh.length, 1);
  op.markAllNotified(1000);
  r = op.update(s(1, 2), 6000, { repeatMs: 10_000 });
  assert.deepEqual(r.fresh.map((f) => f.id), ['2']);
  op.markAllNotified(6000);
  r = op.update(s(1, 2), 12_000, { repeatMs: 10_000 });
  assert.equal(r.repeats.length, 0, 'sektor 1 byl pokrytý souhrnem v 6000, ještě nemá připomínku');
  r = op.update(s(1, 2), 16_000, { repeatMs: 10_000 });
  assert.equal(r.repeats.length, 2);
});

test('OP: souhrnná zpráva obsahuje počet OP a sektory', () => {
  const a = { reason: 'op', count: 3, sectors: 'Sektor 1, Sektor 2, Sektor 5 (Abydos)', repeat: false };
  assert.equal(formatAlert(a), '🚨🟠 OP! Na mapě je 3 OP\nSektor 1, Sektor 2, Sektor 5 (Abydos)');
  assert.equal(formatAlert({ ...a, repeat: true }), '❗🟠 OP stále na mapě: 3\nSektor 1, Sektor 2, Sektor 5 (Abydos)');
});
