import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChanges, createBuildRun } from '../src/build.js';
import { sanitizeUpdate, DEFAULTS } from '../src/config.js';

const page = (over = {}) => ({
  mesto: { cur: 429, max: 429 },
  vyrobna: { cur: 100, max: 500 },
  po: { cur: 0, max: 48906 },
  ...over,
});
const cfg = (plan, extra = {}) => ({ plan, dryRun: false, pace: 1, ...extra });

test('planChanges: cíl se ořízne na max, snižování a shodné hodnoty se přeskočí', () => {
  const plan = { mesto: { mode: 'target', n: 500 }, vyrobna: { mode: 'target', n: 50 }, po: { mode: 'max', n: 0 } };
  assert.deepEqual(planChanges(plan, page()), { po: 48906 }); // město už je na stropu, důl by se snižoval
  assert.deepEqual(planChanges({ vyrobna: { mode: 'target', n: 9999 } }, page()), { vyrobna: 500 });
  assert.deepEqual(planChanges({ po: { mode: 'skip', n: 5 } }, page()), {});
});

test('běh: build -> ověření -> další planeta -> konec po návratu na první', () => {
  const sent = [];
  const run = createBuildRun({ notify: (t) => sent.push(t), rand: () => 0.5 });
  const c = cfg({ po: { mode: 'target', n: 100 } });
  assert.equal(run.report({ phase: 'load', planet: 'A', buildings: page() }, c).action, 'idle'); // neběží
  run.start(c, 0);
  const b = run.report({ phase: 'load', planet: 'A', buildings: page() }, c, 1);
  assert.equal(b.action, 'build');
  assert.deepEqual(b.values, { po: 100 });
  // po odeslání stránka ukáže víc staveb
  assert.equal(run.report({ phase: 'load', planet: 'A', buildings: page({ po: { cur: 100, max: 48906 } }) }, c, 2).action, 'next');
  assert.equal(run.report({ phase: 'load', planet: 'B', buildings: page({ po: { cur: 100, max: 48906 } }) }, c, 3).action, 'next'); // B už má 100
  assert.equal(run.report({ phase: 'load', planet: 'A', buildings: page({ po: { cur: 100, max: 48906 } }) }, c, 4).action, 'done');
  const snap = run.snapshot();
  assert.equal(snap.status, 'finished');
  assert.deepEqual(snap.planets.map((p) => p.state), ['built', 'nothing']);
  assert.match(sent.at(-1), /hotovo/);
});

test('běh: počty se po odeslání nezměnily -> planeta selhala, běh pokračuje', () => {
  const run = createBuildRun({ rand: () => 0.5 });
  const c = cfg({ po: { mode: 'max', n: 0 } });
  run.start(c, 0);
  assert.equal(run.report({ phase: 'load', planet: 'A', buildings: page() }, c, 1).action, 'build');
  assert.equal(run.report({ phase: 'load', planet: 'A', buildings: page() }, c, 2).action, 'next');
  assert.equal(run.snapshot().planets[0].state, 'failed');
});

test('zkušební běh: po vyplnění se nic neodesílá a jde se dál', () => {
  const run = createBuildRun({ rand: () => 0.5 });
  const c = cfg({ po: { mode: 'max', n: 0 } }, { dryRun: true });
  run.start(c, 0);
  assert.equal(run.report({ phase: 'load', planet: 'A', buildings: page() }, c, 1).dry, true);
  assert.equal(run.report({ phase: 'filled', planet: 'A', buildings: page() }, c, 2).action, 'next');
  assert.equal(run.snapshot().planets[0].state, 'dry');
});

test('chyba stránky zastaví běh a pošle upozornění; stop vrací idle; stale se ohlásí jednou', () => {
  const sent = [];
  const run = createBuildRun({ notify: (t) => sent.push(t) });
  const c = cfg({});
  run.start(c, 0);
  run.report({ phase: 'load', error: 'chybí formulář' }, c, 1);
  assert.equal(run.snapshot().status, 'error');
  assert.match(sent[0], /zastaveno/);

  run.start(c, 0);
  assert.equal(run.staleCheck(10_000), false);
  assert.equal(run.staleCheck(200_000), true);
  assert.equal(run.staleCheck(300_000), false);
  run.stop(5);
  assert.equal(run.report({ phase: 'ping' }, c, 6).action, 'idle');
});

test('sanitizeUpdate: plán staveb se čistí', () => {
  const next = sanitizeUpdate(structuredClone(DEFAULTS), {
    build: { pace: 1.6, dryRun: 1, plan: { po: { mode: 'target', n: '1234.9' }, xxx: { mode: 'max' }, mesto: { mode: 'bad', n: -5 } } },
  });
  assert.equal(next.build.pace, 1.6);
  assert.equal(next.build.dryRun, true);
  assert.deepEqual(next.build.plan.po, { mode: 'target', n: 1234 });
  assert.equal(next.build.plan.xxx, undefined);
  assert.deepEqual(next.build.plan.mesto, { mode: 'skip', n: 0 });
  assert.equal(sanitizeUpdate(next, { build: { pace: 99 } }).build.pace, 1);
});
