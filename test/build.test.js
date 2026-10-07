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
  assert.deepEqual(visitReasons(r, c, entry, true), ['vynuceno']); // vynucený průchod
  assert.deepEqual(visitReasons(r, cfg({ plan: { mesto: { mode: 'target', n: 500 }, vyrobna: { mode: 'max', n: 0 } } }), entry), ['mesto', 'vyrobna']); // jiný plán
});

test('visitReasons: s daty ze seznamu planet se rozhoduje bez návštěvy a bez historie', () => {
  // plán: BS a SDI 1000, parky podle spokojenosti, města a doly na maximum
  const c = cfg({
    plan: { bs: { mode: 'target', n: 1000 }, sdi: { mode: 'target', n: 1000 }, mesto: { mode: 'max', n: 0 }, vyrobna: { mode: 'max', n: 0 } },
    parks: { '-50': 300, '10': 100 },
  });
  const done = { bs: 1000, sdi: 1000, mesto: 430, park: 100 };
  // všechno stojí, města na stropu, žádné volné místo na doly -> přeskočit (i bez historie)
  assert.deepEqual(visitReasons({ ...row('1', done), sat: 10, townsMax: 430, free: 0 }, c), []);
  // chybí město
  assert.deepEqual(visitReasons({ ...row('1', { ...done, mesto: 400 }), sat: 10, townsMax: 430, free: 0 }, c), ['mesto']);
  // volné místo -> dá se postavit důl
  assert.deepEqual(visitReasons({ ...row('1', done), sat: 10, townsMax: 430, free: 25 }, c), ['vyrobna']);
  // park podle spokojenosti: na -50 % má být 300
  assert.deepEqual(visitReasons({ ...row('1', done), sat: -50, townsMax: 430, free: 0 }, c), ['park']);
  // BS nedostavěné
  assert.deepEqual(visitReasons({ ...row('1', { ...done, bs: 300 }), sat: 10, townsMax: 430, free: 0 }, c), ['bs']);
});

test('visitReasons: nedostupné město/důl se kvůli chybějícím surovinám nenavštěvuje pořád dokola', () => {
  const c = cfg({ plan: { mesto: { mode: 'max', n: 0 }, vyrobna: { mode: 'max', n: 0 } } });
  const key = JSON.stringify([c.plan.mesto, c.plan.vyrobna]);
  const r = { ...row('1', { mesto: 400, vyrobna: 5000 }), townsMax: 430, free: 90 }; // je kam stavět
  assert.deepEqual(visitReasons(r, c), ['mesto', 'vyrobna']); // nová planeta -> navštívit
  const entry = { final: { mesto: 400, vyrobna: 5000 }, capsKey: key }; // byli jsme tu a víc nešlo
  assert.deepEqual(visitReasons(r, c, entry), []);
  assert.deepEqual(visitReasons({ ...r, c: { ...r.c, vyrobna: 4000 } }, c, entry), ['vyrobna']); // důl se od té doby změnil
  assert.deepEqual(visitReasons(r, c, entry, true), ['vynuceno']); // po přidání surovin: projít všechno
});

test('běh: spokojenost a volné místo z tabulky se předají frontě (planeta bez práce se nenavštíví)', () => {
  const run = mkRun();
  const c = cfg({ plan: { bs: { mode: 'target', n: 1000 }, mesto: { mode: 'max', n: 0 } }, parks: { '10': 100 } });
  run.start(c, 0);
  const full = { bs: 1000, mesto: 430, park: 100 };
  const t = [
    { ...row('1', full), sat: 10, townsMax: 430, free: 0 }, // hotová
    { ...row('2', { ...full, bs: 5 }), sat: 10, townsMax: 430, free: 0 }, // chybí BS
    { ...row('3', full), sat: 10, townsMax: 430, free: 0 }, // hotová
  ];
  const ins = run.report(rep('3', { phase: 'table', table: t }), c, 1);
  assert.deepEqual([ins.action, ins.plId], ['goto', '2']);
  assert.deepEqual(run.snapshot().queue, { total: 1, left: 1, skipped: 2, excluded: 0, tableSize: 3, reasons: { bs: 1 } });
});

test('buildQueue: pořadí z tabulky a počet přeskočených', () => {
  const c = cfg({ plan: { bs: { mode: 'target', n: 100 } } });
  const { queue, skipped } = buildQueue([row('1', { bs: 100 }), row('2'), row('3', { bs: 5 })], c);
  assert.deepEqual(queue.map((q) => q.id), ['2', '3']);
  assert.equal(skipped, 1);
});

// ---------- průběh běhu ----------

const mkRun = (opts = {}) => createBuildRun({ rand: () => 0.5, ...opts });
const rep = (plId, extra = {}) => ({ plId, planet: `P${plId}`, satisfaction: -50, buildings: page(), uninhabitable: false, ...extra });

test('běh: nejdřív města na všech planetách, pak nová tabulka a ostatní (bez dolu) -> důl -> další planeta -> konec', () => {
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
  // průchod městy: po městech planety 1 hned na planetu 2 a 3, ostatní stavby až potom
  ins = run.report(rep('1', { phase: 'load', buildings: afterTowns }), c, 3);
  assert.deepEqual([ins.action, ins.plId], ['goto', '2']);
  assert.equal(ledger.planets['1']?.final, undefined, 'návštěva jen kvůli městům planetu za hotovou nepovažuje');
  assert.deepEqual(run.report(rep('2', { phase: 'load' }), c, 3.1).values, { mesto: 430 });
  assert.deepEqual([run.report(rep('2', { phase: 'load', buildings: afterTowns }), c, 3.2).plId], ['3']);
  assert.deepEqual(run.report(rep('3', { phase: 'load' }), c, 3.3).values, { mesto: 430 });
  assert.equal(run.report(rep('3', { phase: 'load', buildings: afterTowns }), c, 3.4).action, 'send-table'); // města všude hotová
  const table2 = [row('1', { mesto: 430 }), row('2', { mesto: 430 }), row('3', { mesto: 430 })];
  ins = run.report(rep('3', { phase: 'table', table: table2, buildings: afterTowns }), c, 3.5);
  assert.deepEqual([ins.action, ins.plId], ['goto', '1']); // zbytek od začátku fronty
  ins = run.report(rep('1', { phase: 'load', buildings: afterTowns }), c, 3.6);
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
  assert.deepEqual(snap.planets.map((p) => p.state), ['built', 'built', 'built', 'built', 'nothing', 'nothing']);
  assert.match(snap.planets[0].note, /^města$/);
  assert.match(snap.planets[3].note, /ostatní stavby.*naquadahový důl/);
  assert.match(sent.at(-1), /hotovo/);
});

test('běh: planeta mimo frontu se přeskočí a zadaná planeta se otevře', () => {
  const run = mkRun();
  const c = cfg({ plan: { bs: { mode: 'target', n: 100 } } });
  run.start(c, 0);
  const table = [row('1', { bs: 100 }), row('2'), row('3', { bs: 100 })];
  const ins = run.report(rep('1', { phase: 'table', table }), c, 1); // jsme na hotové planetě 1, práce je na 2
  assert.deepEqual([ins.action, ins.plId], ['goto', '2']);
  assert.deepEqual(run.snapshot().queue, { total: 1, left: 1, skipped: 2, excluded: 0, tableSize: 3, reasons: { bs: 1 } });
});

test('běh: planety se značkou (CP), (DP), (PP) se z fronty vyřadí, ostatní značky ne', () => {
  const run = mkRun();
  const c = cfg({ plan: { bs: { mode: 'target', n: 100 } } });
  run.start(c, 0);
  const t = (id, tag) => ({ ...row(id), tag });
  const table = [t('1', 'DP'), t('2', 'CP'), t('3', 'PP'), t('4', 'cp'), t('5', 'SP'), t('6', '')];
  const ins = run.report(rep('1', { phase: 'table', table }), c, 1); // stojíme na (DP) planetě
  assert.deepEqual([ins.action, ins.plId], ['goto', '5']); // (SP) a bez značky se staví
  assert.deepEqual(run.snapshot().queue, { total: 2, left: 2, skipped: 0, excluded: 4, tableSize: 6, reasons: { bs: 2 } });
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
  const towns = page({ mesto: { cur: 430, max: 430 } });
  // tabulka ještě hlásí málo měst -> průchod městy, na stránce už jsou na maximu -> nic, pak nová tabulka
  assert.equal(run.report(rep('1', { phase: 'table', table: [row('1')], satisfaction: 10, buildings: towns }), c, 1).action, 'send-table');
  const ins = run.report(rep('1', { phase: 'table', table: [row('1', { mesto: 430 })], satisfaction: 10, buildings: towns }), c, 2);
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
  assert.equal(run.report(rep('1', { phase: 'filled' }), c, 1.5).action, 'send-table'); // města všude, pak zbytek
  assert.equal(run.report(rep('1', { phase: 'table', table }), c, 1.7).phase, 1);
  assert.equal(run.report(rep('1', { phase: 'filled' }), c, 3).phase, 2);
  assert.equal(run.report(rep('1', { phase: 'filled' }), c, 4).action, 'done');
  assert.deepEqual(run.snapshot().planets.map((p) => p.state), ['dry', 'dry']);
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

test('parky: globální minimum = od kolika se planeta kvůli parkům nenavštěvuje, pod ním se doplní na cíl podle spokojenosti', () => {
  const c = cfg({ parks: { '-50': 300, '10': 100 }, parksMinAll: 80 });
  const buildings = (cur) => page({ park: { cur, max: 0 } });
  assert.deepEqual(planChanges(c, buildings(80), 10, 1), {}); // na minimu -> hotovo, i když cíl pro +10 % je 100
  assert.deepEqual(planChanges(c, buildings(90), 10, 1), {});
  assert.deepEqual(planChanges(c, buildings(79), 10, 1), { park: 100 }); // pod minimem -> na cíl
  assert.deepEqual(planChanges(c, buildings(79), -50, 1), { park: 300 }); // cíl se řídí spokojeností, minimum je jedno pro všechny
  assert.deepEqual(planChanges(cfg({ parks: { '-50': 300 } }), buildings(299), -50, 1), { park: 300 }); // bez minima = cíl
  assert.deepEqual(planChanges(cfg({ parks: { '-50': 300 }, parksMinAll: 900 }), buildings(299), -50, 1), { park: 300 }); // minimum nad cílem se ořízne na cíl

  // planeta s dost parky se ani nenavštíví – a nemusí se ani znát spokojenost
  assert.deepEqual(visitReasons(row('1', { park: 85 }), c), []);
  assert.deepEqual(visitReasons({ ...row('1', { park: 85 }), sat: -50 }, c), []);
  assert.deepEqual(visitReasons(row('1', { park: 79 }), c), ['park (spokojenost neznámá)']);
  assert.deepEqual(visitReasons({ ...row('1', { park: 79 }), sat: 10 }, c), ['park']);
});

test('sanitizeUpdate: turbo tempo a globální minimum parků', () => {
  const next = sanitizeUpdate(structuredClone(DEFAULTS), { build: { pace: 0.4, parksMinAll: '80.9' } });
  assert.equal(next.build.pace, 0.4);
  assert.equal(next.build.parksMinAll, 80);
  assert.equal(sanitizeUpdate(next, { build: { parksMinAll: 'abc' } }).build.parksMinAll, 80); // nesmysl se ignoruje
  assert.equal(sanitizeUpdate(next, { build: { parksMinAll: '' } }).build.parksMinAll, null); // prázdné = vypnuto
  assert.equal(sanitizeUpdate(next, { build: { parksMinAll: -5 } }).build.parksMinAll, 80);
});

test('náhled fronty: tabulka bez spuštění běhu spočítá, co by se navštívilo, a z jakých důvodů', () => {
  const run = mkRun();
  const c = cfg({ plan: { bs: { mode: 'target', n: 1000 }, sdi: { mode: 'target', n: 1000 } } });
  assert.equal(run.report(rep('1', { phase: 'load' }), c, 1).action, 'idle'); // nikdo nic nechtěl
  run.requestScan(1000);
  assert.deepEqual(run.report(rep('1', { phase: 'load' }), c, 2000), { action: 'send-table', scan: true });
  const t = [row('1', { bs: 1000, sdi: 1000 }), row('2', { bs: 300, sdi: 1000 }), row('3'), { ...row('4'), tag: 'CP' }];
  assert.equal(run.report(rep('1', { phase: 'table', scan: true, table: t }), c, 3000).action, 'idle');
  const p = run.snapshot().preview;
  assert.deepEqual([p.tableSize, p.excluded, p.visit, p.skipped], [4, 1, 2, 1]);
  assert.deepEqual(p.reasons, { bs: 2, sdi: 1 });
  assert.deepEqual(p.sample, ['P2', 'P3']);
  assert.equal(run.snapshot().scanPending, false);
  assert.equal(run.report(rep('1', { phase: 'load' }), c, 4000).action, 'idle'); // žádost je vyřízená
  assert.equal(run.snapshot().status, 'idle'); // náhled běh nespustil
});

test('náhled fronty: žádost vyprší, když není otevřená stránka Stavění', () => {
  const run = mkRun();
  const c = cfg({ plan: { bs: { mode: 'target', n: 1000 } } });
  run.requestScan(0);
  assert.equal(run.report(rep('1', { phase: 'load' }), c, 91_000).action, 'idle');
});

test('běh: důvody fronty se uloží pro UI', () => {
  const run = mkRun();
  const c = cfg({ plan: { bs: { mode: 'target', n: 1000 } }, parks: { '10': 100 } });
  run.start(c, 0);
  run.report(rep('9', { phase: 'table', table: [{ ...row('1', { bs: 5, park: 100 }), sat: 10 }, row('2', { bs: 1000 })] }), c, 1);
  assert.deepEqual(run.snapshot().queue.reasons, { bs: 1, 'park?': 1 });
});

test('sanitizeUpdate: plán staveb, tabulka parků a přepínače se čistí', () => {
  const next = sanitizeUpdate(structuredClone(DEFAULTS), {
    build: {
      pace: 1.6, dryRun: 1, forceAll: 1,
      plan: { po: { mode: 'target', n: '1234.9' }, xxx: { mode: 'max' }, mesto: { mode: 'bad', n: -5 } },
      parks: { '-50': '300', '10': 100, '7': 5, '5': 'abc', '0': -3 },
    },
  });
  assert.equal(next.build.pace, 1.6);
  assert.equal(next.build.dryRun, true);
  assert.equal(next.build.forceAll, true);
  assert.deepEqual(next.build.plan.po, { mode: 'target', n: 1234 });
  assert.equal(next.build.plan.xxx, undefined);
  assert.deepEqual(next.build.plan.mesto, { mode: 'skip', n: 0 });
  assert.deepEqual(next.build.parks, { '-50': 300, '10': 100 }); // neznámé klíče a nesmysly pryč
  assert.deepEqual(sanitizeUpdate(next, { build: { parks: { '-50': null } } }).build.parks, { '10': 100 }); // null maže
  assert.equal(sanitizeUpdate(next, { build: { pace: 99 } }).build.pace, 1);
});

test('neobyvatelné planety (červený řádek ve hře) se z fronty vyřadí stejně jako (CP)/(DP)/(PP)', () => {
  const run = mkRun();
  const c = cfg({ plan: { bs: { mode: 'target', n: 1000 } } });
  run.requestScan(1000);
  run.report(rep('1', { phase: 'load' }), c, 2000);
  const t = [row('1'), { ...row('2'), uninhabitable: true }, { ...row('3'), tag: 'DP' }, row('4')];
  run.report(rep('1', { phase: 'table', scan: true, table: t }), c, 3000);
  const p = run.snapshot().preview;
  assert.deepEqual([p.tableSize, p.excluded, p.visit], [4, 2, 2]);
  assert.deepEqual(p.sample, ['P1', 'P4']);
});

test('neobyvatelná planeta nahlášená ze stránky: nic se nestaví, zapamatuje se a příště se do fronty nezařadí', () => {
  const ledger = { planets: {} };
  const run = createBuildRun({ ledger });
  const c = cfg({ plan: { bs: { mode: 'target', n: 1000 } } });
  run.start(c, 0);
  run.report(rep('1', { phase: 'load' }), c, 1);
  const t = [row('1'), row('2')];
  const first = run.report(rep('1', { phase: 'table', table: t }), c, 2);
  assert.deepEqual([first.action, first.plId], ['goto', '2']); // P1 nemá co stavět, jde se na P2
  // P2 se v tabulce tváří normálně, ale stránka planety hlásí neobyvatelnou
  const ins = run.report(rep('2', { phase: 'load', uninhabitable: true }), c, 10);
  assert.notEqual(ins.action, 'build');
  assert.equal(ledger.planets['2'].uninhabitable, true);
  assert.ok(run.snapshot().log.some((l) => /P2: neobyvatelná/.test(l.msg)));

  // další běh: P2 se do fronty nezařadí ani bez značky v tabulce
  const run2 = createBuildRun({ ledger });
  run2.start(c, 100);
  run2.report(rep('1', { phase: 'load' }), c, 101);
  run2.report(rep('1', { phase: 'table', table: [row('1'), row('2')] }), c, 102);
  assert.equal(run2.snapshot().queue.excluded, 1);
});

test('starý skript stavění (nehlásí neobyvatelnost) běh hned zastaví a nic nepostaví', () => {
  const run = mkRun();
  const c = cfg({ plan: { bs: { mode: 'target', n: 1000 } } });
  run.start(c, 0);
  const old = rep('1', { phase: 'load' });
  delete old.uninhabitable;
  assert.equal(run.report(old, c, 1).action, 'idle');
  assert.equal(run.snapshot().status, 'error');
});

test('zastaralý skript stavění: hláška jde do skriptu na stránce a do notify (server ji pošle jen do servisního chatu)', () => {
  const sent = [];
  const run = createBuildRun({ notify: (t) => sent.push(t) });
  const c = cfg({ plan: { bs: { mode: 'target', n: 1000 } } });
  run.start(c, 0);
  const old = rep('1', { phase: 'load' });
  delete old.uninhabitable;
  const r = run.report(old, c, 1);
  assert.equal(r.action, 'idle');
  assert.match(r.message, /Zastaralý skript stavění/);
  assert.equal(run.snapshot().status, 'error');
  run.start(c, 10);
  const r2 = run.report(rep('1', { phase: 'load', ver: '1.3.9' }), c, 11);
  assert.match(r2.message, /1\.3\.9/);
  assert.equal(sent.filter((t) => /Zastaralý skript/.test(t)).length, 2);
  run.start(c, 20);
  assert.notEqual(run.report(rep('1', { phase: 'load', ver: '1.4.2' }), c, 21).action, 'idle'); // nová verze jede
});

test('málo naquadahu: skript nahlásí nofunds, stavění se zastaví a hláška jde do skriptu (zpráva jen do notify = servisní chat)', () => {
  const sent = [];
  const run = createBuildRun({ notify: (t) => sent.push(t) });
  const c = cfg({ plan: { bs: { mode: 'target', n: 1000 } } });
  run.start(c, 0);
  const r = run.report(rep('1', { phase: 'nofunds', cost: 5_045_000, naquadah: 38_568_299, ver: '1.4.2' }), c, 1);
  assert.equal(r.action, 'idle');
  assert.match(r.message, /došel naquadah/);
  assert.equal(run.snapshot().status, 'error');
  assert.equal(sent.filter((t) => /došel naquadah/.test(t)).length, 1);
});

test('skript stavění starší než 1.4.2 (bez pojistky na naquadah) se nespustí', () => {
  const run = mkRun();
  const c = cfg({ plan: { bs: { mode: 'target', n: 1000 } } });
  run.start(c, 0);
  const r = run.report(rep('1', { phase: 'load', ver: '1.4.1' }), c, 1);
  assert.equal(r.action, 'idle');
  assert.match(r.message, /Zastaralý skript/);
});

test('města přes zelené maximum: při plánu „max“ jde bot na planetu klikem na odkaz měst (postaví maximum)', () => {
  const run = mkRun();
  const c = cfg({ plan: { mesto: { mode: 'max', n: 0 } } });
  run.start(c, 0);
  run.report(rep('1', { phase: 'load' }), c, 1);
  const t = [{ ...row('2', { mesto: 52 }), mestaLink: true, mestaMax: 103 }, { ...row('3', { mesto: 10 }) }];
  const ins = run.report(rep('1', { phase: 'table', table: t }), c, 2);
  assert.equal(ins.action, 'goto');
  assert.equal(ins.plId, '2');
  assert.equal(ins.viaCities, true);
  assert.equal(ins.cityAdd, 51);
});

test('města přes zelené maximum: při cíli pod maximem se odkaz nepoužije (postavil by víc)', () => {
  const run = mkRun();
  const c = cfg({ plan: { mesto: { mode: 'target', n: 60 } } });
  run.start(c, 0);
  run.report(rep('1', { phase: 'load' }), c, 1);
  const t = [{ ...row('2', { mesto: 52 }), mestaLink: true, mestaMax: 103 }];
  const ins = run.report(rep('1', { phase: 'table', table: t }), c, 2);
  assert.equal(ins.action, 'goto');
  assert.equal(ins.viaCities, undefined);
});

// ---------- výrobny přes zelené maximum v seznamu planet ----------

test('výrobny přes zelené maximum: když planeta potřebuje JEN výrobny a plán chce maximum, jde se klikem v seznamu (bez formuláře)', () => {
  const run = mkRun();
  const c = cfg({ plan: { vyrobna: { mode: 'max', n: 0 } } });
  run.start(c, 0);
  run.report(rep('1', { phase: 'load' }), c, 1);
  const t = [{ ...row('2', { vyrobna: 70_345 }), vyrobnaLink: true, vyrobnaMax: 74_983 }];
  const ins = run.report(rep('1', { phase: 'table', table: t }), c, 2);
  assert.equal(ins.action, 'goto');
  assert.equal(ins.plId, '2');
  assert.equal(ins.viaMines, true);
  assert.equal(ins.mineAdd, 4_638);
});

test('výrobny přes zelené maximum: když je na planetě potřeba i něco dalšího (parky, laboratoř…), jde se na planetu a staví se normálně', () => {
  const run = mkRun();
  const c = cfg({ plan: { vyrobna: { mode: 'max', n: 0 }, laborator: { mode: 'target', n: 50 } } });
  run.start(c, 0);
  run.report(rep('1', { phase: 'load' }), c, 1);
  const t = [{ ...row('2', { vyrobna: 70_345, laborator: 0 }), vyrobnaLink: true, vyrobnaMax: 74_983 }];
  const ins = run.report(rep('1', { phase: 'table', table: t }), c, 2);
  assert.equal(ins.action, 'goto');
  assert.equal(ins.viaMines, undefined, 'laboratoř se musí vyplnit na planetě');
});

test('výrobny přes zelené maximum: při cíli pod maximem nebo bez odkazu se nepoužije', () => {
  for (const [plan, extra] of [[{ vyrobna: { mode: 'target', n: 60_000 } }, { vyrobnaLink: true, vyrobnaMax: 74_983 }], [{ vyrobna: { mode: 'max', n: 0 } }, { vyrobnaLink: false }]]) {
    const run = mkRun();
    const c = cfg({ plan });
    run.start(c, 0);
    run.report(rep('1', { phase: 'load' }), c, 1);
    const ins = run.report(rep('1', { phase: 'table', table: [{ ...row('2', { vyrobna: 50_000 }), ...extra }] }), c, 2);
    assert.equal(ins.action, 'goto');
    assert.equal(ins.viaMines, undefined);
  }
});

test('výrobny přes zelené maximum: po otevření planety se ověří, že se postavilo; planeta je hotová bez dalšího vyplňování; nepostavilo = selhání', () => {
  const mk = () => {
    const run = mkRun();
    const c = cfg({ plan: { vyrobna: { mode: 'max', n: 0 } } });
    run.start(c, 0);
    run.report(rep('1', { phase: 'load' }), c, 1);
    const ins = run.report(rep('1', { phase: 'table', table: [{ ...row('2', { vyrobna: 100 }), vyrobnaLink: true, vyrobnaMax: 500 }] }), c, 2);
    assert.equal(ins.viaMines, true);
    return { run, c };
  };
  // postavilo se na maximum
  let { run, c } = mk();
  let after = run.report(rep('2', { phase: 'load', buildings: page({ vyrobna: { cur: 500, max: 500 } }) }), c, 3);
  assert.notEqual(after.action, 'build', 'nic dalšího se nevyplňuje');
  assert.equal(run.snapshot().planets.at(-1).state, 'built');
  assert.match(run.snapshot().planets.at(-1).note, /naquadahový důl/);
  // nepostavilo se nic (málo surovin): selhání, ne tichý úspěch
  ({ run, c } = mk());
  after = run.report(rep('2', { phase: 'load', buildings: page({ vyrobna: { cur: 100, max: 500 } }) }), c, 3);
  assert.equal(run.snapshot().planets.at(-1).state, 'failed');
  assert.match(run.snapshot().planets.at(-1).note, /nic nepostavilo/);
});
