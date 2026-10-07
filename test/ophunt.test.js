import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHunt, HUNT_DEFAULTS } from '../src/ophunt.js';
import { sanitizeUpdate, DEFAULTS } from '../src/config.js';

const cfg = (x = {}) => ({ ...HUNT_DEFAULTS, enabled: true, dryRun: false, reactMinSec: 2, reactMaxSec: 2, ...x });
const dot = (id, u = 0.3, v = 0.4, label = id) => ({ id, label, u, v });
const mk = () => createHunt({ rand: () => 0.5 });

test('nic se neděje, když je automat vypnutý nebo OP vypnuto', () => {
  const h = mk();
  assert.deepEqual(h.offer([dot('27')], cfg({ enabled: false }), 0), {});
  assert.deepEqual(h.offer([dot('27')], cfg(), 0, { opEnabled: false }), {});
  assert.equal(h.active(0), false);
});

test('zakázka se nabídne až po reakční prodlevě a jen u tečky s polohou', () => {
  const h = mk();
  assert.deepEqual(h.offer([{ id: '9', label: '9' }], cfg(), 0), {}, 'bez polohy se nelovi');
  const a = h.offer([dot('27')], cfg(), 1000);
  assert.equal(a.spec, undefined);
  assert.equal(a.wait, 2000);
  const b = h.offer([dot('27')], cfg(), 3100);
  assert.equal(b.spec.sector, '27');
  assert.equal(b.spec.u, 0.3);
  assert.equal(b.spec.dryRun, false);
});

test('celý průběh: start, sektor, dvě tečky, úspěch; zprávy jen při výsledku', () => {
  const h = mk();
  h.offer([dot('27')], cfg(), 0);
  const spec = h.offer([dot('27')], cfg(), 5000).spec;
  assert.equal(h.event({ id: spec.id, event: 'start' }, cfg(), 5000).ok, true);
  assert.equal(h.event({ id: spec.id, event: 'start' }, cfg(), 5001).ok, false, 'druhá karta zakázku nepřebere');
  assert.equal(h.offer([dot('27')], cfg(), 5200).spec, undefined, 'rozjetá zakázka se nenabízí znovu');
  h.event({ id: spec.id, event: 'try', x: 230, y: 84 }, cfg(), 6000);
  h.event({ id: spec.id, event: 'no-button' }, cfg(), 8000);
  h.event({ id: spec.id, event: 'try', x: 78, y: 132 }, cfg(), 9000);
  assert.equal(h.snapshot(9000).job.tries, 2);
  const r = h.event({ id: spec.id, event: 'success', cost: '85 860 368', have: '114 011 183' }, cfg(), 12000);
  assert.match(r.notify, /OP CHYCENA/);
  assert.match(r.notify, /sektoru 27/);
  assert.match(r.notify, /85\s860\s368 kg/);
  assert.match(r.notify, /zbývá asi 28\s150\s815 kg/);
  assert.match(r.notify, /Dnes chyceno: 1×/);
  assert.equal(h.snapshot(12000).caughtTotal, 1);
  assert.equal(h.active(12000), false);
  assert.equal(h.snapshot(12000).last.result, 'success');
});

test('nenalezená tečka: zpráva a cooldown sektoru, jiný sektor se loví dál', () => {
  const h = mk();
  h.offer([dot('27'), dot('40')], cfg(), 0);
  const s = h.offer([dot('27'), dot('40')], cfg(), 3000).spec;
  assert.equal(s.sector, '27');
  h.event({ id: s.id, event: 'start' }, cfg(), 3000);
  const r = h.event({ id: s.id, event: 'no-dot', text: 'nejbližší 80 px' }, cfg(), 4000);
  assert.match(r.notify, /nepodařilo najít/);
  const a = h.offer([dot('27'), dot('40')], cfg(), 5000); // 27 se zkouší až po cooldownu, jde se na 40
  const b = h.offer([dot('27'), dot('40')], cfg(), 8000);
  assert.equal((a.spec ?? b.spec).sector, '40');
  assert.equal(h.snapshot(5000).cooling[0].sector, '27');
});

test('nedostatek naquadahu: automat se má vypnout a hlásí se', () => {
  const h = mk();
  h.offer([dot('27')], cfg(), 0);
  const s = h.offer([dot('27')], cfg(), 3000).spec;
  h.event({ id: s.id, event: 'start' }, cfg(), 3000);
  const r = h.event({ id: s.id, event: 'no-naquadah', text: 'Nemáte dost naquadahu' }, cfg(), 4000);
  assert.equal(r.disable, true);
  assert.match(r.notify, /VYPNUL/);
});

test('zkušební režim: výsledek dry se hlásí, ale neosidluje se', () => {
  const h = mk();
  h.offer([dot('27')], cfg({ dryRun: true }), 0);
  const s = h.offer([dot('27')], cfg({ dryRun: true }), 3000).spec;
  assert.equal(s.dryRun, true);
  h.event({ id: s.id, event: 'start' }, cfg(), 3000);
  assert.match(h.event({ id: s.id, event: 'dry' }, cfg(), 4000).notify, /zkušební režim/);
});

test('vypršení zakázky, vypnutí zruší zakázku, limit za hodinu', () => {
  const h = mk();
  h.offer([dot('27')], cfg(), 0);
  h.offer([dot('27')], cfg(), 3000);
  const o = h.offer([dot('27')], cfg(), 5 * 60_000); // nikdo nezačal
  assert.match(o.notify, /vypršela/);
  assert.equal(h.event({ id: 1, event: 'start' }, cfg(), 5 * 60_000).ok, false);
  const h2 = mk();
  h2.offer([dot('27')], cfg(), 0);
  h2.offer([dot('27')], cfg({ enabled: false }), 10);
  assert.equal(h2.active(10), false);
  const h3 = mk();
  const c = cfg({ maxPerHour: 1, retrySectorSec: 10 });
  h3.offer([dot('1')], c, 0);
  const s = h3.offer([dot('1')], c, 3000).spec;
  h3.event({ id: s.id, event: 'start' }, c, 3000);
  h3.event({ id: s.id, event: 'fail', text: 'x' }, c, 4000);
  const lim = h3.offer([dot('2')], c, 20_000);
  assert.match(lim.notify, /limit 1/);
  assert.equal(h3.offer([dot('2')], c, 21_000).notify, undefined, 'limit se hlásí jen jednou');
});

test('nastavení automatu na OP: meze a konec nikdy pod začátkem', () => {
  const base = structuredClone(DEFAULTS);
  const a = sanitizeUpdate(base, { op: { hunt: { enabled: true, dryRun: false, reactMinSec: 10, reactMaxSec: 2, tolerancePx: 1, maxTries: 99 } } }).op.hunt;
  assert.equal(a.enabled, true);
  assert.equal(a.dryRun, false);
  assert.equal(a.reactMaxSec, 10);
  assert.equal(a.tolerancePx, 8);
  assert.equal(a.maxTries, 10);
  assert.equal(DEFAULTS.op.hunt.enabled, false);
  assert.equal(DEFAULTS.op.hunt.dryRun, true, 'výchozí je zkušební režim');
});
