import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChanges, createBuildRun } from '../src/build.js';
import { sanitizeUpdate, DEFAULTS } from '../src/config.js';

const page = (over = {}) => ({
  mesto: { cur: 400, max: 430 },
  vyrobna: { cur: 100, max: 500 },
  laborator: { cur: 0, max: 1000 },
  park: { cur: 0, max: 400 },
  po: { cur: 0, max: 48906 },
  ...over,
});
const cfg = (over = {}) => ({ plan: {}, parks: {}, dryRun: false, pace: 1, ...over });
const full = () => cfg({
  plan: { mesto: { mode: 'max', n: 0 }, laborator: { mode: 'target', n: 50 }, vyrobna: { mode: 'max', n: 0 } },
  parks: { '-50': 300, '10': 100 },
});

test('planChanges: fáze, strop max, žádné snižování, parky podle spokojenosti', () => {
  const c = full();
  assert.deepEqual(planChanges(c, page(), -50, 0), { mesto: 430 });
  assert.deepEqual(planChanges(c, page(), -50, 1), { laborator: 50, park: 300 });
  assert.deepEqual(planChanges(c, page(), 10, 1), { laborator: 50, park: 100 });
  assert.deepEqual(planChanges(c, page(), 5, 1), { laborator: 50 }); // pro +5 % parky nejsou nastavené
  assert.deepEqual(planChanges(c, page(), null, 1), { laborator: 50 }); // spokojenost nerozpoznána
  assert.deepEqual(planChanges(c, page(), 0, 2), { vyrobna: 500 });
  // park a ostatní se nehledí na max (hra uvolní místo z dolů), město a důl ano
  assert.deepEqual(planChanges(c, page({ park: { cur: 0, max: 0 }, laborator: { cur: 0, max: 0 } }), -50, 1), { laborator: 50, park: 300 });
  assert.deepEqual(planChanges(cfg({ plan: { mesto: { mode: 'target', n: 999 } } }), page(), 0, 0), { mesto: 430 });
  assert.deepEqual(planChanges(cfg({ plan: { bs: { mode: 'target', n: 1000 }, sdi: { mode: 'target', n: 1000 } } }), page({ bs: { cur: 300, max: 0 }, sdi: { cur: 0, max: 0 } }), 0, 1), { bs: 1000, sdi: 1000 });
  assert.deepEqual(planChanges(c, page({ mesto: { cur: 430, max: 430 } }), -50, 0), {}); // města už jsou na maximu
  assert.deepEqual(planChanges(c, page({ park: { cur: 500, max: 600 } }), -50, 1), { laborator: 50 }); // park by se snižoval
});

test('běh: města -> ostatní (bez dolu) -> důl, každý krok jedním odesláním, pak další planeta', () => {
  const sent = [];
  const run = createBuildRun({ notify: (t) => sent.push(t), rand: () => 0.5 });
  const c = full();
  assert.equal(run.report({ phase: 'load', planet: 'A', satisfaction: -50, buildings: page() }, c).action, 'idle'); // neběží
  run.start(c, 0);

  let ins = run.report({ phase: 'load', planet: 'A', satisfaction: -50, buildings: page() }, c, 1);
  assert.equal(ins.action, 'build');
  assert.equal(ins.phase, 0);
  assert.deepEqual(ins.values, { mesto: 430 });

  // po odeslání měst: město je na 430, ostatní stavby mají vyšší strop
  const afterTowns = page({ mesto: { cur: 430, max: 430 }, laborator: { cur: 0, max: 1000 } });
  ins = run.report({ phase: 'load', planet: 'A', satisfaction: -50, buildings: afterTowns }, c, 2);
  assert.equal(ins.phase, 1);
  assert.deepEqual(ins.values, { laborator: 50, park: 300 }); // důl v tomhle kroku není

  const afterOthers = page({ mesto: { cur: 430, max: 430 }, laborator: { cur: 50, max: 1000 }, park: { cur: 300, max: 400 } });
  ins = run.report({ phase: 'load', planet: 'A', satisfaction: -50, buildings: afterOthers }, c, 3);
  assert.equal(ins.phase, 2);
  assert.deepEqual(ins.values, { vyrobna: 500 });

  const afterMine = { ...afterOthers, vyrobna: { cur: 500, max: 500 } };
  assert.equal(run.report({ phase: 'load', planet: 'A', satisfaction: -50, buildings: afterMine }, c, 4).action, 'next');
  assert.equal(run.report({ phase: 'load', planet: 'B', satisfaction: 10, buildings: afterMine }, c, 5).action, 'next'); // B je hotová
  assert.equal(run.report({ phase: 'load', planet: 'A', satisfaction: -50, buildings: afterMine }, c, 6).action, 'done');
  const snap = run.snapshot();
  assert.equal(snap.status, 'finished');
  assert.deepEqual(snap.planets.map((p) => p.state), ['built', 'nothing']);
  assert.match(snap.planets[0].note, /města.*ostatní stavby.*naquadahový důl/);
  assert.match(sent.at(-1), /hotovo/);
});

test('běh: fáze bez práce se přeskočí (města už na maximu -> rovnou ostatní)', () => {
  const run = createBuildRun({ rand: () => 0.5 });
  const c = full();
  run.start(c, 0);
  const ins = run.report({ phase: 'load', planet: 'A', satisfaction: 10, buildings: page({ mesto: { cur: 430, max: 430 } }) }, c, 1);
  assert.equal(ins.phase, 1);
  assert.deepEqual(ins.values, { laborator: 50, park: 100 });
});

test('běh: fáze nezabrala -> planeta selhala, zbylé fáze se nezkouší; 5 selhání po sobě zastaví běh', () => {
  const sent = [];
  const run = createBuildRun({ notify: (t) => sent.push(t), rand: () => 0.5 });
  const c = full();
  run.start(c, 0);
  for (let i = 1; i <= 5; i++) {
    const p = `P${i}`;
    assert.equal(run.report({ phase: 'load', planet: p, satisfaction: 0, buildings: page() }, c, i * 10).action, 'build');
    const ins = run.report({ phase: 'load', planet: p, satisfaction: 0, buildings: page() }, c, i * 10 + 1); // nic se nezměnilo
    assert.equal(ins.action, i < 5 ? 'next' : 'idle');
  }
  assert.equal(run.snapshot().status, 'error');
  assert.match(sent.at(-1), /došly suroviny/);
});

test('zkušební běh: vyplní všechny fáze po sobě bez přenačtení a jde dál', () => {
  const run = createBuildRun({ rand: () => 0.5 });
  const c = full();
  c.dryRun = true;
  run.start(c, 0);
  const rep = { planet: 'A', satisfaction: -50, buildings: page() };
  assert.equal(run.report({ phase: 'load', ...rep }, c, 1).phase, 0);
  assert.equal(run.report({ phase: 'filled', ...rep }, c, 2).phase, 1);
  assert.equal(run.report({ phase: 'filled', ...rep }, c, 3).phase, 2);
  assert.equal(run.report({ phase: 'filled', ...rep }, c, 4).action, 'next');
  assert.equal(run.snapshot().planets[0].state, 'dry');
});

test('nerozpoznaná spokojenost: parky se přeskočí a poznamená se to', () => {
  const run = createBuildRun({ rand: () => 0.5 });
  const c = cfg({ parks: { '10': 100 } });
  run.start(c, 0);
  assert.equal(run.report({ phase: 'load', planet: 'A', satisfaction: null, buildings: page() }, c, 1).action, 'next');
  assert.match(run.snapshot().planets[0].note, /spokojenost nerozpoznána/);
});

test('chyba stránky zastaví běh a pošle upozornění; stop vrací idle; stale se ohlásí jednou', () => {
  const sent = [];
  const run = createBuildRun({ notify: (t) => sent.push(t) });
  const c = cfg();
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

test('sanitizeUpdate: plán staveb a tabulka parků se čistí', () => {
  const next = sanitizeUpdate(structuredClone(DEFAULTS), {
    build: {
      pace: 1.6, dryRun: 1,
      plan: { po: { mode: 'target', n: '1234.9' }, xxx: { mode: 'max' }, mesto: { mode: 'bad', n: -5 } },
      parks: { '-50': '300', '10': 100, '7': 5, '5': 'abc', '0': -3 },
    },
  });
  assert.equal(next.build.pace, 1.6);
  assert.equal(next.build.dryRun, true);
  assert.deepEqual(next.build.plan.po, { mode: 'target', n: 1234 });
  assert.equal(next.build.plan.xxx, undefined);
  assert.deepEqual(next.build.plan.mesto, { mode: 'skip', n: 0 });
  assert.deepEqual(next.build.parks, { '-50': 300, '10': 100 }); // neznámé klíče a nesmysly pryč
  assert.deepEqual(sanitizeUpdate(next, { build: { parks: { '-50': null } } }).build.parks, { '10': 100 }); // null maže
  assert.equal(sanitizeUpdate(next, { build: { pace: 99 } }).build.pace, 1);
});
