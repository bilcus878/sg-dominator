import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTelescope, VIGILANCE_DEFAULTS, TELESCOPE_DEFAULTS } from '../src/telescope.js';
import { sanitizeUpdate, DEFAULTS } from '../src/config.js';

const op = (v = {}, t = {}) => ({ vigilance: { ...VIGILANCE_DEFAULTS, ...v }, telescope: { ...TELESCOPE_DEFAULTS, ...t } });
const MIN = 60_000;

test('bdělost: jednou za skipMin–skipMax potvrzení se tlačítko záměrně vynechá', () => {
  const tele = createTelescope({ rand: () => 0.5 }); // randInt(2,4) = 3
  const v = { skipMin: 2, skipMax: 4 };
  const seq = Array.from({ length: 9 }, () => tele.vigilanceSeen({ ...VIGILANCE_DEFAULTS, ...v }).action);
  assert.deepEqual(seq, ['click', 'click', 'click', 'skip', 'click', 'click', 'click', 'skip', 'click']);
  assert.equal(tele.snapshot().skipped, 2);
});

test('bdělost: rozestup mezi vynecháními je v zadaném rozmezí a vypnutí vždy potvrzuje', () => {
  const tele = createTelescope();
  const v = { ...VIGILANCE_DEFAULTS, skipMin: 5, skipMax: 10 };
  let since = 0;
  const gaps = [];
  for (let i = 0; i < 400; i++) {
    if (tele.vigilanceSeen(v).action === 'skip') { gaps.push(since); since = 0; } else since++;
  }
  assert.ok(gaps.length > 20);
  for (const g of gaps.slice(1)) assert.ok(g >= 5 && g <= 10, `rozestup ${g}`); // první je zkrácený startem
  const off = createTelescope();
  for (let i = 0; i < 50; i++) assert.equal(off.vigilanceSeen({ ...v, skipEnabled: false }).action, 'click');
});

test('teleskop: zastavený se po lidské prodlevě aktivuje, aktivní nic nedělá', () => {
  const tele = createTelescope({ rand: () => 0.5 });
  assert.deepEqual(tele.telescopeState({ state: 'active', remainingSec: 5000 }, op()), { action: 'none' });
  const r = tele.telescopeState({ state: 'stopped', remainingSec: 5000 }, op({}, { reactMinSec: 10, reactMaxSec: 20 }), 0);
  assert.equal(r.action, 'activate');
  assert.equal(r.delayMs, 15_000);
  assert.deepEqual(tele.telescopeState({ state: 'stopped', remainingSec: 5000 }, op({}, { auto: false })), { action: 'none' }); // vypnuto
});

test('po vynechané bdělosti se zastavený teleskop nechá vypnutý a pak se zapne', () => {
  const tele = createTelescope({ rand: () => 0.5 });
  const cfg = op({ skipMin: 1, skipMax: 1, downMin: 4, downMax: 6 }); // pauza 5 min
  assert.equal(tele.vigilanceSeen(cfg.vigilance).action, 'click');
  assert.equal(tele.vigilanceSeen(cfg.vigilance).action, 'skip');
  // hra ještě teleskop nezastavila -> aktivní, pauza se nezačíná
  assert.equal(tele.telescopeState({ state: 'active', remainingSec: 900 }, cfg, 0).action, 'none');
  // zastavila: pauza začíná teď
  const wait = tele.telescopeState({ state: 'stopped', remainingSec: 900 }, cfg, 1000);
  assert.equal(wait.action, 'wait');
  assert.equal(wait.waitMs, 5 * MIN);
  assert.equal(tele.telescopeState({ state: 'stopped', remainingSec: 900 }, cfg, 3 * MIN).action, 'wait');
  assert.equal(tele.telescopeState({ state: 'stopped', remainingSec: 900 }, cfg, 5 * MIN + 1001).action, 'activate');
});

test('běžné zastavení (bez vynechání) se zapne bez dlouhé pauzy', () => {
  const tele = createTelescope({ rand: () => 0.5 });
  assert.equal(tele.telescopeState({ state: 'stopped', remainingSec: 900 }, op(), 0).action, 'activate');
});

test('potvrzená bdělost ruší čekající pauzu (kdyby ji hra po vynechání nezastavila)', () => {
  const tele = createTelescope({ rand: () => 0.5 });
  const cfg = op({ skipMin: 1, skipMax: 1 });
  tele.vigilanceSeen(cfg.vigilance);
  assert.equal(tele.vigilanceSeen(cfg.vigilance).action, 'skip');
  tele.vigilanceClicked();
  assert.equal(tele.telescopeState({ state: 'stopped', remainingSec: 900 }, cfg, 0).action, 'activate'); // žádná pauza
});

test('teleskop bez zbývajícího času: nezkouší se a upozorní se jednou; po aktivním stavu znovu', () => {
  const tele = createTelescope();
  const stopped = { state: 'stopped', remainingSec: 0 };
  assert.deepEqual(tele.telescopeState(stopped, op()), { action: 'none', alert: 'zero' });
  assert.deepEqual(tele.telescopeState(stopped, op()), { action: 'none' });
});

test('3 neúspěšné aktivace za sebou: alert a půlhodinová pauza; úspěch počítadlo vynuluje', () => {
  const tele = createTelescope({ rand: () => 0.5 });
  const stopped = { state: 'stopped', remainingSec: 900 };
  assert.deepEqual(tele.attempt(0), {});
  assert.deepEqual(tele.attempt(1), {});
  assert.deepEqual(tele.attempt(2), { alert: 'failed' });
  assert.equal(tele.telescopeState(stopped, op(), 10 * MIN).action, 'none'); // blokováno
  assert.equal(tele.telescopeState(stopped, op(), 31 * MIN).action, 'activate'); // po 30 minutách znovu

  const t2 = createTelescope({ rand: () => 0.5 });
  t2.attempt(0); t2.attempt(1);
  t2.telescopeState({ state: 'active', remainingSec: 900 }, op(), 5); // aktivace se povedla
  assert.deepEqual(t2.attempt(6), {});
});

test('sanitizeUpdate: nastavení vynechávání a teleskopu se čistí a doplňuje výchozími', () => {
  const next = sanitizeUpdate(structuredClone(DEFAULTS), {
    op: { vigilance: { skipEnabled: 0, skipMin: '9', skipMax: '4', downMin: '20', downMax: '5', minSec: 7 }, telescope: { auto: 0, reactMinSec: '30', reactMaxSec: '10' } },
  });
  const v = next.op.vigilance;
  assert.equal(v.skipEnabled, false);
  assert.deepEqual([v.skipMin, v.skipMax], [9, 9]); // max nikdy pod min
  assert.deepEqual([v.downMin, v.downMax], [20, 20]);
  assert.deepEqual([v.minSec, v.maxSec], [7, 10]);
  assert.deepEqual(next.op.telescope, { auto: false, reactMinSec: 30, reactMaxSec: 30 });
  const clamped = sanitizeUpdate(next, { op: { vigilance: { skipMin: 999, downMax: 99999 }, telescope: { reactMaxSec: 99999 } } });
  assert.equal(clamped.op.vigilance.skipMin, 50);
  assert.equal(clamped.op.vigilance.downMax, 240);
  assert.equal(clamped.op.telescope.reactMaxSec, 600);
});
