import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChanges, createBuildRun, visitReasons, buildQueue } from '../src/build.js';
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
const row = (id, c = {}) => ({ id, name: `P${id}`, c: { mesto: 0, vyrobna: 0, bs: 0, sdi: 0, po: 0, kasarna: 0, laborator: 0, park: 0, ...c } });

// ---------- planChanges ----------

test('planChanges: fáze, žádné snižování, parky podle spokojenosti', () => {
  const c = full();
  assert.deepEqual(planChanges(c, page(), -50, 0), { mesto: 430 });
  assert.deepEqual(planChanges(c, page(), -50, 1), { laborator: 50, park: 300 });
  assert.deepEqual(planChanges(c, page(), 10, 1), { laborator: 50, park: 100 });
  assert.deepEqual(planChanges(c, page(), 5, 1), { laborator: 50 }); // pro +5 % parky nejsou nastavené
  assert.deepEqual(planChanges(c, page(), null, 1), { laborator: 50 }); // spokojenost nerozpoznána
  assert.deepEqual(planChanges(c, page(), 0, 2), { vyrobna: 500 });
  assert.deepEqual(planChanges(c, page({ mesto: { cur: 430, max: 430 } }), -50, 0), {}); // města už jsou na maximu
  assert.deepEqual(planChanges(c, page({ park: { cur: 500, max: 600 } }), -50, 1), { laborator: 50 }); // park by se snižoval
});

test('planChanges: park a ostatní se nehledí na max (hra uvolní místo z dolů), město a důl ano', () => {
  const c = full();
  assert.deepEqual(planChanges(c, page({ park: { cur: 0, max: 0 }, laborator: { cur: 0, max: 0 } }), -50, 1), { laborator: 50, park: 300 });
  assert.deepEqual(planChanges(cfg({ plan: { mesto: { mode: 'target', n: 999 } } }), page(), 0, 0), { mesto: 430 });
  const bs = cfg({ plan: { bs: { mode: 'target', n: 1000 }, sdi: { mode: 'target', n: 1000 } } });
  assert.deepEqual(planChanges(bs, page({ bs: { cur: 300, max: 0 }, sdi: { cur: 0, max: 0 } }), 0, 1), { bs: 1000, sdi: 1000 });
});

// ---------- fronta z tabulky ----------

test('visitReasons: hotové planety se přeskočí, nové a nedostavěné ne', () => {
  const c = cfg({ plan: { bs: { mode: 'target', n: 1000 }, sdi: { mode: 'target', n: 1000 } } });
  assert.deepEqual(visitReasons(row('1', { bs: 1000, sdi: 1000 }), c), []); // všechno už stojí
  assert.deepEqual(visitReasons(row('2', { bs: 1500, sdi: 1000 }), c), []); // víc než cíl je v pořádku
  assert.deepEqual(visitReasons(row('3', { bs: 300, sdi: 1000 }), c), ['bs']);
  assert.deepEqual(visitReasons(row('4'), c), ['bs', 'sdi']); // nová planeta
});

test('visitReasons: hra víc nedala (tried + beze změny) -> přeskočit; po změně počtu znovu', () => {
  const c = cfg({ plan: { bs: { mode: 'target', n: 1000 } } });
  const entry = { tried: { bs: 1000 }, final: { bs: 700 } };
  assert.deepEqual(visitReasons(row('1', { bs: 700 }), c, entry), []);
  assert.deepEqual(visitReasons(row('1', { bs: 650 }), c, entry), ['bs']); // od minula se něco změnilo
});

test('visitReasons: parky potřebují známou spokojenost, pak se porovná s tabulkou', () => {
  const c = cfg({ parks: { '-50': 300, '10': 100 } });
  assert.deepEqual(visitReasons(row('1', { park: 300 }), c), ['park (spokojenost neznámá)']); // neznáme -> musíme se podívat
  const known = (sat) => ({ satKnown: true, sat });
  assert.deepEqual(visitReasons(row('1', { park: 300 }), c, known(-50)), []);
  assert.deepEqual(visitReasons(row('1', { park: 120 }), c, known(-50)), ['park']);
  assert.deepEqual(visitReasons(row('1', { park: 0 }), c, known(5)), []); // pro +5 % nejsou parky nastavené
  assert.deepEqual(visitReasons(row('1', { park: 0 }), c, known(null)), []); // spokojenost nerozpoznána
});

test('visitReasons: města a důl na maximum – hotovo jen s historií a nezměněnými počty', () => {
  const c = cfg({ plan: { mesto: { mode: 'max', n: 0 }, vyrobna: { mode: 'max', n: 0 } } });
  const key = JSON.stringify([c.plan.mesto, c.plan.vyrobna]);
  const entry = { final: { mesto: 430, vyrobna: 72345 }, capsKey: key };
  const r = row('1', { mesto: 430, vyrobna: 72345 });
  assert.deepEqual(visitReasons(r, c), ['mesto', 'vyrobna']); // bez historie nevíme
  assert.deepEqual(visitReasons(r, c, entry), []);
  assert.deepEqual(visitReasons(row('1', { mesto: 430, vyrobna: 70000 }), c, entry), ['vyrobna']); // důl se změnil
  assert.deepEqual(visitReasons(r, c, entry, true), ['mesto', 'vyrobna']); // vynucené ověření
  assert.deepEqual(visitReasons(r, cfg({ plan: { mesto: { mode: 'target', n: 500 }, vyrobna: { mode: 'max', n: 0 } } }), entry), ['mesto', 'vyrobna']); // jiný plán
});

test('buildQueue: pořadí z tabulky a počet přeskočených', () => {
  const c = cfg({ plan: { bs: { mode: 'target', n: 100 } } });
  const { queue, skipped } = buildQueue([row('1', { bs: 100 }), row('2'), row('3', { bs: 5 })], c);
  assert.deepEqual(queue.map((q) => q.id), ['2', '3']);
  assert.equal(skipped, 1);
});

// ---------- průběh běhu ----------

const mkRun = (opts = {}) => createBuildRun({ rand: () => 0.5, ...opts });
const rep = (plId, extra = {}) => ({ plId, planet: `P${plId}`, satisfaction: -50, buildings: page(), ...extra });

test('běh: tabulka -> fronta -> města -> ostatní (bez dolu) -> důl -> přechod na další planetu -> konec', () => {
  const sent = [];
  const ledger = { planets: {} };
  const run = mkRun({ notify: (t) => sent.push(t), ledger });
  const c = full();
  assert.equal(run.report(rep('1', { phase: 'load' }), c).action, 'idle'); // neběží
  run.start(c, 0);

  assert.equal(run.report(rep('1', { phase: 'load' }), c, 1).action, 'send-table'); // fronta ještě není
  const table = [row('1', { mesto: 400 }), row('2', { mesto: 400 }), row('3', { mesto: 400 })];
  let ins = run.report(rep('1', { phase: 'table', table }), c, 2);
  assert.equal(ins.action, 'build');
  assert.equal(ins.phase, 0);
  assert.deepEqual(ins.values, { mesto: 430 });

  const afterTowns = page({ mesto: { cur: 430, max: 430 } });
  ins = run.report(rep('1', { phase: 'load', buildings: afterTowns }), c, 3);
  assert.equal(ins.phase, 1);
  assert.deepEqual(ins.values, { laborator: 50, park: 300 }); // důl v tomhle kroku není

  const afterOthers = page({ mesto: { cur: 430, max: 430 }, laborator: { cur: 50, max: 1000 }, park: { cur: 300, max: 400 } });
  ins = run.report(rep('1', { phase: 'load', buildings: afterOthers }), c, 4);
  assert.equal(ins.phase, 2);
  assert.deepEqual(ins.values, { vyrobna: 500 });

  const afterMine = { ...afterOthers, vyrobna: { cur: 500, max: 500 } };
  ins = run.report(rep('1', { phase: 'load', buildings: afterMine }), c, 5);
  assert.deepEqual([ins.action, ins.plId], ['goto', '2']); // další planeta z fronty, ne šipka
  assert.equal(ledger.planets['1'].sat, -50);
  assert.equal(ledger.planets['1'].final.vyrobna, 500);

  // planeta 2 už je hotová (nic k práci) -> goto 3 -> hotovo
  const done = { ...afterMine };
  assert.equal(run.report(rep('2', { phase: 'load', buildings: done }), c, 6).plId, '3');
  assert.equal(run.report(rep('3', { phase: 'load', buildings: done }), c, 7).action, 'done');
  const snap = run.snapshot();
  assert.equal(snap.status, 'finished');
  assert.deepEqual(snap.planets.map((p) => p.state), ['built', 'nothing', 'nothing']);
  assert.match(snap.planets[0].note, /města.*ostatní stavby.*naquadahový důl/);
  assert.match(sent.at(-1), /hotovo/);
});

test('běh: planeta mimo frontu se přeskočí a zadaná planeta se otevře', () => {
  const run = mkRun();
  const c = cfg({ plan: { bs: { mode: 'target', n: 100 } } });
  run.start(c, 0);
  const table = [row('1', { bs: 100 }), row('2'), row('3', { bs: 100 })];
  const ins = run.report(rep('1', { phase: 'table', table }), c, 1); // jsme na hotové planetě 1, práce je na 2
  assert.deepEqual([ins.action, ins.plId], ['goto', '2']);
  assert.deepEqual(run.snapshot().queue, { total: 1, left: 1, skipped: 2, tableSize: 3 });
});

test('běh: nic k práci -> hned hotovo', () => {
  const sent = [];
  const run = mkRun({ notify: (t) => sent.push(t) });
  const c = cfg({ plan: { bs: { mode: 'target', n: 100 } } });
  run.start(c, 0);
  assert.equal(run.report(rep('1', { phase: 'table', table: [row('1', { bs: 100 })] }), c, 1).action, 'done');
  assert.match(sent[0], /nic k stavění/);
});

test('běh: nečitelný počet v tabulce (null) planetu přeskočit nesmí', () => {
  const run = mkRun();
  const c = cfg({ plan: { bs: { mode: 'target', n: 100 } } });
  run.start(c, 0);
  const t = [{ id: '1', name: 'P1', c: { bs: null } }];
  const ins = run.report(rep('9', { phase: 'table', table: t }), c, 1); // stojíme jinde, planeta 1 má nečitelný počet
  assert.deepEqual([ins.action, ins.plId], ['goto', '1']);
});

test('běh: fáze bez práce se přeskočí (města už na maximu -> rovnou ostatní)', () => {
  const run = mkRun();
  const c = full();
  run.start(c, 0);
  const ins = run.report(rep('1', { phase: 'table', table: [row('1')], satisfaction: 10, buildings: page({ mesto: { cur: 430, max: 430 } }) }), c, 1);
  assert.equal(ins.phase, 1);
  assert.deepEqual(ins.values, { laborator: 50, park: 100 });
});

test('běh: fáze nezabrala -> planeta selhala a historie ji nepovažuje za hotovou; 5 selhání po sobě zastaví běh', () => {
  const sent = [];
  const ledger = { planets: {} };
  const run = mkRun({ notify: (t) => sent.push(t), ledger });
  const c = full();
  run.start(c, 0);
  const table = ['1', '2', '3', '4', '5', '6'].map((id) => row(id));
  let ins = run.report(rep('1', { phase: 'table', table }), c, 1);
  for (let i = 1; i <= 5; i++) {
    assert.equal(ins.action, 'build');
    ins = run.report(rep(String(i), { phase: 'load' }), c, i * 10); // nic se nezměnilo
    if (i < 5) {
      assert.equal(ins.action, 'goto');
      ins = run.report(rep(ins.plId, { phase: 'load' }), c, i * 10 + 5); // přišli jsme na další planetu
    }
  }
  assert.equal(ins.action, 'idle');
  assert.equal(run.snapshot().status, 'error');
  assert.match(sent.at(-1), /došly suroviny/);
  assert.equal(ledger.planets['1'].final, undefined);
  assert.equal(ledger.planets['1'].satKnown, true); // spokojenost se ale naučila
});

test('běh: hra přijala jen část -> zapamatuje se jako „víc nedá“', () => {
  const ledger = { planets: {} };
  const run = mkRun({ ledger });
  const c = cfg({ plan: { bs: { mode: 'target', n: 1000 } } });
  run.start(c, 0);
  let ins = run.report(rep('1', { phase: 'table', table: [row('1')], buildings: page({ bs: { cur: 0, max: 0 } }) }), c, 1);
  assert.deepEqual(ins.values, { bs: 1000 });
  ins = run.report(rep('1', { phase: 'load', buildings: page({ bs: { cur: 700, max: 0 } }) }), c, 2); // hra dala 700
  assert.equal(ins.action, 'done');
  assert.deepEqual(ledger.planets['1'].tried, { bs: 1000 });
  assert.deepEqual(visitReasons(row('1', { bs: 700 }), c, ledger.planets['1']), []); // příště se přeskočí
});

test('zkušební běh: vyplní všechny fáze bez přenačtení, planetu nezapíše do historie', () => {
  const ledger = { planets: {} };
  const run = mkRun({ ledger });
  const c = full();
  c.dryRun = true;
  run.start(c, 0);
  const table = [row('1')];
  assert.equal(run.report(rep('1', { phase: 'table', table }), c, 1).phase, 0);
  assert.equal(run.report(rep('1', { phase: 'filled' }), c, 2).phase, 1);
  assert.equal(run.report(rep('1', { phase: 'filled' }), c, 3).phase, 2);
  assert.equal(run.report(rep('1', { phase: 'filled' }), c, 4).action, 'done');
  assert.equal(run.snapshot().planets[0].state, 'dry');
  assert.deepEqual(ledger.planets, {});
});

test('nerozpoznaná spokojenost: parky se přeskočí, poznamená se to a uloží do historie', () => {
  const ledger = { planets: {} };
  const run = mkRun({ ledger });
  const c = cfg({ parks: { '10': 100 } });
  run.start(c, 0);
  assert.equal(run.report(rep('1', { phase: 'table', table: [row('1')], satisfaction: null }), c, 1).action, 'done');
  assert.match(run.snapshot().planets[0].note, /spokojenost nerozpoznána/);
  assert.deepEqual([ledger.planets['1'].satKnown, ledger.planets['1'].sat], [true, null]);
});

test('přechod na planetu: ztracená planeta se po 3 pokusech přeskočí; goto-failed ji přeskočí hned', () => {
  const run = mkRun();
  const c = cfg({ plan: { bs: { mode: 'target', n: 100 } } });
  run.start(c, 0);
  const table = [row('1', { bs: 100 }), row('2'), row('3')];
  let ins = run.report(rep('1', { phase: 'table', table }), c, 1);
  assert.equal(ins.plId, '2');
  ins = run.report({ phase: 'goto-failed', plId: '2' }, c, 2);
  assert.deepEqual([ins.action, ins.plId], ['goto', '3']);
  assert.equal(run.report(rep('1', { phase: 'load' }), c, 3).plId, '3'); // skončili jsme pořád na 1
  assert.equal(run.report(rep('1', { phase: 'load' }), c, 4).plId, '3');
  assert.equal(run.report(rep('1', { phase: 'load' }), c, 5).action, 'done'); // 3 se přeskočila
  assert.deepEqual(run.snapshot().planets.map((p) => p.state), ['failed', 'failed']);
});

test('chyba stránky zastaví běh a pošle upozornění; stop vrací idle; stale se ohlásí jednou', () => {
  const sent = [];
  const run = mkRun({ notify: (t) => sent.push(t) });
  const c = cfg();
  run.start(c, 0);
  run.report({ phase: 'load', error: 'chybí formulář' }, c, 1);
  assert.equal(run.snapshot().status, 'error');
  assert.match(sent[0], /zastaveno/);

  run.start(c, 0);
  run.report({ phase: 'load', scriptError: 'TypeError: x' }, c, 1);
  assert.match(sent[1], /chyba skriptu/);

  run.start(c, 0);
  assert.equal(run.staleCheck(10_000), false);
  assert.equal(run.staleCheck(200_000), true);
  assert.equal(run.staleCheck(300_000), false);
  run.stop(5);
  assert.equal(run.report({ phase: 'ping' }, c, 6).action, 'idle');
});

test('parky: minimum = od kolika se planeta bere jako hotová, pod ním se doplní na cíl', () => {
  const c = cfg({ parks: { '-50': 300 }, parksMin: { '-50': 250 } });
  const buildings = (cur) => page({ park: { cur, max: 0 } });
  assert.deepEqual(planChanges(c, buildings(250), -50, 1), {}); // na minimu -> hotovo
  assert.deepEqual(planChanges(c, buildings(280), -50, 1), {}); // mezi minimem a cílem -> hotovo
  assert.deepEqual(planChanges(c, buildings(249), -50, 1), { park: 300 }); // pod minimem -> na cíl, ne na minimum
  assert.deepEqual(planChanges(cfg({ parks: { '-50': 300 } }), buildings(299), -50, 1), { park: 300 }); // bez minima = cíl
  assert.deepEqual(planChanges(cfg({ parks: { '-50': 300 }, parksMin: { '-50': 900 } }), buildings(299), -50, 1), { park: 300 }); // minimum nad cílem se ořízne na cíl

  const known = { satKnown: true, sat: -50 };
  assert.deepEqual(visitReasons(row('1', { park: 260 }), c, known), []); // planeta se ani nenavštíví
  assert.deepEqual(visitReasons(row('1', { park: 100 }), c, known), ['park']);
});

test('sanitizeUpdate: turbo tempo a minimum parků', () => {
  const next = sanitizeUpdate(structuredClone(DEFAULTS), { build: { pace: 0.4, parksMin: { '-50': '250', '7': 1, '10': -4 } } });
  assert.equal(next.build.pace, 0.4);
  assert.deepEqual(next.build.parksMin, { '-50': 250 });
  assert.deepEqual(sanitizeUpdate(next, { build: { parksMin: { '-50': null } } }).build.parksMin, {});
});

test('sanitizeUpdate: plán staveb, tabulka parků a přepínače se čistí', () => {
  const next = sanitizeUpdate(structuredClone(DEFAULTS), {
    build: {
      pace: 1.6, dryRun: 1, recheckMax: 1,
      plan: { po: { mode: 'target', n: '1234.9' }, xxx: { mode: 'max' }, mesto: { mode: 'bad', n: -5 } },
      parks: { '-50': '300', '10': 100, '7': 5, '5': 'abc', '0': -3 },
    },
  });
  assert.equal(next.build.pace, 1.6);
  assert.equal(next.build.dryRun, true);
  assert.equal(next.build.recheckMax, true);
  assert.deepEqual(next.build.plan.po, { mode: 'target', n: 1234 });
  assert.equal(next.build.plan.xxx, undefined);
  assert.deepEqual(next.build.plan.mesto, { mode: 'skip', n: 0 });
  assert.deepEqual(next.build.parks, { '-50': 300, '10': 100 }); // neznámé klíče a nesmysly pryč
  assert.deepEqual(sanitizeUpdate(next, { build: { parks: { '-50': null } } }).build.parks, { '10': 100 }); // null maže
  assert.equal(sanitizeUpdate(next, { build: { pace: 99 } }).build.pace, 1);
});
