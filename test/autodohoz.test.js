import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutoArmy, sanitizeAutoArmy, migrateAutoArmy, AUTO_ARMY_DEFAULTS } from '../src/autodohoz.js';
import { sanitizeArmy, ARMY_DEFAULTS } from '../src/attack.js';
import { sanitizeUpdate, DEFAULTS } from '../src/config.js';
import { resolveWatch } from '../src/watch.js';

const ON = { ...AUTO_ARMY_DEFAULTS, enabled: true, minSec: 2, maxSec: 4, roundMinSec: 2, roundMaxSec: 4, cooldownMinSec: 60, cooldownMaxSec: 60 };
const alert = (name, reason = 'threshold', extra = {}) => ({ name, reason, power: 1, ...extra });
/** io, který zaznamenává požadavky; `result` řídí odpověď na request, `below` stav hráče. */
const mkIo = ({ result = () => ({ ok: true }), below = () => true } = {}) => {
  const sent = [];
  return { sent, stillBelow: below, request: (name) => { const r = result(name); if (r.ok) sent.push(name); return r; } };
};

test('vypnutý auto-dohoz nic neplánuje', () => {
  const a = createAutoArmy();
  assert.deepEqual(a.onAlert(alert('X'), { ...ON, enabled: false }, 0), { scheduled: false, why: 'off' });
  assert.equal(a.snapshot(0).pending.length, 0);
});

test('plánuje jen pád pod práh (threshold, critical); propad, návrat a jiné se ignorují', () => {
  const a = createAutoArmy();
  for (const reason of ['drop', 'recovered', 'target', 'op']) assert.equal(a.onAlert(alert('X', reason), ON, 0).scheduled, false, reason);
  assert.equal(a.onAlert(alert('X', 'threshold'), ON, 0).scheduled, true);
  assert.equal(a.onAlert(alert('Y', 'critical'), ON, 0).scheduled, true);
});

test('prodleva je v nastaveném rozmezí a náhodná', () => {
  const delays = new Set();
  for (let i = 0; i < 200; i++) {
    const a = createAutoArmy();
    const r = a.onAlert(alert('X'), ON, 1000);
    const d = r.dueAt - 1000;
    assert.ok(d >= 2000 && d <= 4000, `prodleva ${d}`);
    delays.add(d);
  }
  assert.ok(delays.size > 50, 'čas se opakuje, není náhodný');
});

test('víc hráčů naráz: dohazují se postupně s odstupem, ne ve stejnou vteřinu', () => {
  const a = createAutoArmy();
  const times = ['A', 'B', 'C'].map((n) => a.onAlert(alert(n), { ...ON, minSec: 3, maxSec: 3 }, 0).dueAt);
  assert.equal(times[0], 3000);
  assert.ok(times[1] - times[0] >= 900 && times[2] - times[1] >= 900, `odstupy ${times}`);
});

test('odstup mezi hráči jde nastavit (gapMinSec–gapMaxSec)', () => {
  for (let i = 0; i < 100; i++) {
    const a = createAutoArmy();
    const cfg = { ...ON, minSec: 1, maxSec: 1, gapMinSec: 5, gapMaxSec: 8 };
    const t = ['A', 'B', 'C'].map((n) => a.onAlert(alert(n), cfg, 0).dueAt);
    const gaps = [t[1] - t[0], t[2] - t[1]];
    for (const g of gaps) assert.ok(g >= 5000 && g <= 8000, `odstup ${g}`);
  }
  // nulový odstup: všichni hned po své prodlevě
  const z = createAutoArmy();
  const t = ['A', 'B'].map((n) => z.onAlert(alert(n), { ...ON, minSec: 2, maxSec: 2, gapMinSec: 0, gapMaxSec: 0 }, 0).dueAt);
  assert.deepEqual(t, [2000, 2000]);
});

test('jeden čekající požadavek na hráče; připomínky se bez opakování ignorují', () => {
  const a = createAutoArmy();
  assert.equal(a.onAlert(alert('X'), ON, 0).scheduled, true);
  assert.equal(a.onAlert(alert('X'), ON, 100).why, 'queued');
  assert.equal(createAutoArmy().onAlert(alert('X', 'threshold', { repeat: true }), ON, 0).why, 'repeat'); // připomínka není nový pád
  assert.equal(createAutoArmy().onAlert(alert('X', 'critical', { repeat: true }), { ...ON}, 0).why, 'repeat'); // ani se starým nastavením
});

test('tick: odešle až po termínu, jen když je hráč pořád pod prahem', () => {
  const a = createAutoArmy({ rand: () => 0.5 }); // 3 s
  a.onAlert(alert('X'), ON, 0);
  const io = mkIo();
  assert.deepEqual(a.tick(2999, io), []);
  assert.deepEqual(io.sent, []);
  assert.deepEqual(a.tick(3000, io), [{ type: 'sent', name: 'X' }]);
  assert.deepEqual(io.sent, ['X']);
  assert.equal(a.snapshot(3000).sent, 1);
  assert.equal(a.snapshot(3000).pending.length, 0);

  const b = createAutoArmy({ rand: () => 0.5 });
  b.onAlert(alert('Y'), ON, 0);
  const io2 = mkIo({ below: () => false }); // mezitím ho někdo dohodil
  assert.deepEqual(b.tick(5000, io2), [{ type: 'skip', name: 'Y' }]);
  assert.deepEqual(io2.sent, []);
  assert.equal(b.snapshot(5000).skipped, 1);
});

test('tick: pauza po dohození – nový pád se neztratí, dohoz se odloží na konec pauzy', () => {
  const a = createAutoArmy({ rand: () => 0 }); // 2 s
  const io = mkIo();
  a.onAlert(alert('X'), ON, 0);
  a.tick(2000, io); // dohodil; pauza 60 s -> do 62 000
  const r = a.onAlert(alert('X'), ON, 30_000);
  assert.equal(r.scheduled, true);
  assert.equal(r.deferred, true);
  assert.ok(r.dueAt >= 62_000 && r.dueAt <= 63_000, `dueAt ${r.dueAt}`);
  assert.equal(a.onAlert(alert('X'), ON, 31_000).why, 'queued'); // jen jeden čekající
  run(a, io, 30_000, 61_000);
  assert.equal(io.sent.length, 1, 'před koncem pauzy se nedohazuje');
  run(a, io, 61_000, 65_000);
  assert.equal(io.sent.length, 2, 'po pauze se dohodí');
});

test('pauza po dohození: hráč, který mezitím vyskočil nad práh, se po pauze přeskočí', () => {
  const a = createAutoArmy({ rand: () => 0 });
  let below = true;
  const io = mkIo({ below: () => below });
  a.onAlert(alert('X'), ON, 0);
  a.tick(2000, io);
  a.onAlert(alert('X'), ON, 30_000);
  below = false; // dohozem se dostal nad práh
  const ev = run(a, io, 30_000, 70_000);
  assert.equal(io.sent.length, 1);
  assert.ok(ev.some((e) => e.type === 'skip'));
});

test('tick: zadává se nejvýš jeden požadavek najednou', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkIo();
  a.onAlert(alert('A'), { ...ON, minSec: 1, maxSec: 1 }, 0);
  a.onAlert(alert('B'), { ...ON, minSec: 1, maxSec: 1 }, 0);
  a.tick(60_000, io); // oba jsou splatné
  assert.deepEqual(io.sent, ['A']);
  a.tick(60_001, io);
  assert.deepEqual(io.sent, ['A', 'B']);
});

test('tick: dohoz zaneprázdněný -> zkusí znovu; po 30 s se vzdá', () => {
  const a = createAutoArmy({ rand: () => 0 });
  a.onAlert(alert('X'), { ...ON, minSec: 1, maxSec: 1 }, 0);
  const busy = mkIo({ result: () => ({ ok: false, error: 'Ještě se dohazuje Y, chvíli počkej.' }) });
  assert.deepEqual(a.tick(1000, busy), []); // posunuto o chvíli
  assert.equal(a.snapshot(1000).pending.length, 1);
  assert.equal(a.snapshot(1000).failed, 0);
  const ev = a.tick(32_000, busy);
  assert.equal(ev[0].type, 'fail');
  assert.equal(a.snapshot(32_000).failed, 1);
  assert.equal(a.snapshot(32_000).pending.length, 0);
});

test('tick: stránka Rasová armáda není otevřená -> selhání, upozornění nejvýš jednou za 10 min', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const closed = mkIo({ result: () => ({ ok: false, error: 'Otevři ve hře stránku Jednotky → Rasová armáda (se skriptem) a vyplň počty jednotek.' }) });
  a.onAlert(alert('X'), { ...ON, minSec: 0, maxSec: 0, cooldownMinSec: 0, cooldownMaxSec: 0 }, 0);
  assert.deepEqual(a.tick(1000, closed), []); // stránka se může zrovna načítat: zatím jen čekání
  assert.deepEqual(a.tick(20_000, closed), []);
  const e1 = a.tick(31_000, closed)[0];
  assert.deepEqual([e1.type, e1.page, e1.notify], ['fail', true, true]);
  a.onAlert(alert('Y'), { ...ON, minSec: 0, maxSec: 0 }, 32_000);
  a.tick(33_000, closed);
  const e2 = a.tick(63_500, closed)[0];
  assert.deepEqual([e2.page, e2.notify], [true, false]); // hlášeno před chvílí
  a.onAlert(alert('Z'), { ...ON, minSec: 0, maxSec: 0 }, 700_000);
  a.tick(701_000, closed);
  assert.equal(a.tick(732_000, closed)[0].notify, true);

  // stránka se mezitím otevřela: žádné selhání, dohoz projde
  const b = createAutoArmy({ rand: () => 0 });
  let open = false;
  const io = mkIo({ result: () => (open ? { ok: true } : { ok: false, error: 'Otevři ve hře stránku Jednotky → Rasová armáda' }) });
  b.onAlert(alert('X'), { ...ON, minSec: 0, maxSec: 0 }, 0);
  assert.deepEqual(b.tick(1000, io), []);
  open = true;
  const ev = b.tick(2500, io);
  assert.deepEqual(ev.map((e) => e.type), ['sent']);
});

test('sanitizeAutoArmy: meze, max nikdy pod min, nesmysly se ignorují', () => {
  const n = sanitizeAutoArmy(AUTO_ARMY_DEFAULTS, { enabled: 1, minSec: '5', maxSec: '2', cooldownMinSec: '90', cooldownMaxSec: '30', roundMinSec: '6', roundMaxSec: '3' });
  assert.deepEqual(n, { ...AUTO_ARMY_DEFAULTS, enabled: true, minSec: 5, maxSec: 5, cooldownMinSec: 90, cooldownMaxSec: 90, roundMinSec: 6, roundMaxSec: 6 });
  const g = sanitizeAutoArmy(n, { gapMinSec: '7', gapMaxSec: '3' });
  assert.deepEqual([g.gapMinSec, g.gapMaxSec], [7, 7]); // max nikdy pod min
  assert.deepEqual([sanitizeAutoArmy(n, { gapMinSec: 999 }).gapMinSec, sanitizeAutoArmy(n, { gapMinSec: -1 }).gapMinSec], [60, 0]);
  const c = sanitizeAutoArmy(n, { minSec: 9999, maxSec: 'abc', cooldownMinSec: -4, roundMinSec: 9999 });
  assert.deepEqual([c.minSec, c.maxSec, c.cooldownMinSec, c.roundMinSec], [120, 120, 0, 120]);
  assert.deepEqual(sanitizeAutoArmy(n, {}), n);
});

test('army: nastavení auto-dohozu a jednotky se navzájem nemažou', () => {
  const cur = sanitizeArmy(ARMY_DEFAULTS, { units: [{ name: 'Jaffa', count: 5 }], auto: { enabled: true, minSec: 2, maxSec: 4 } });
  assert.equal(cur.units.length, 1);
  assert.equal(cur.auto.enabled, true);
  const onlyAuto = sanitizeArmy(cur, { auto: { enabled: false } }); // vypínač v hlavičce
  assert.equal(onlyAuto.units.length, 1);
  assert.equal(onlyAuto.auto.enabled, false);
  assert.deepEqual([onlyAuto.auto.minSec, onlyAuto.auto.maxSec], [2, 4]);
  const onlyUnits = sanitizeArmy(cur, { units: [] });
  assert.equal(onlyUnits.units.length, 0);
  assert.equal(onlyUnits.auto.enabled, true);
});

test('konfigurace: výchozí auto-dohoz je vypnutý a PUT ho zapne beze ztráty jednotek', () => {
  assert.equal(DEFAULTS.army.auto.enabled, false);
  const base = structuredClone(DEFAULTS);
  base.army = sanitizeArmy(base.army, { units: [{ name: 'Jaffa', count: 7 }] });
  const next = sanitizeUpdate(base, { army: { auto: { enabled: true, minSec: 1, maxSec: 3 } } });
  assert.equal(next.army.auto.enabled, true);
  assert.deepEqual([next.army.auto.minSec, next.army.auto.maxSec], [1, 3]);
  assert.equal(next.army.units[0].count, 7);
});


// ---------- dohazování až po horní hranici ----------
const TOP = { ...ON, minSec: 1, maxSec: 1, roundMinSec: 1, roundMaxSec: 1, gapMinSec: 0, gapMaxSec: 0, topUp: true, topUpTarget: 750, cooldownMinSec: 0, cooldownMaxSec: 0 };
/** io s měnitelnou sílou hráče: každý dohoz ji zvedne o `boost`. */
const mkTopIo = (state, { boost = 150, below = () => true } = {}) => {
  const sent = [];
  return {
    sent,
    stillBelow: below,
    power: () => state.power,
    request: (name) => { sent.push(name); state.power += boost; return { ok: true }; },
  };
};
/** Posune čas po půlvteřinách a vrací všechny události. */
const run = (a, io, from, to, step = 500) => { const ev = []; for (let t = from; t <= to; t += step) ev.push(...a.tick(t, io)); return ev; };

test('horní hranice: dohazuje opakovaně, dokud síla nepřekoná hranici, pak skončí zprávou', () => {
  const state = { power: 60 };
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(state, { boost: 200 });
  a.onAlert(alert('X'), TOP, 0);
  const ev = run(a, io, 0, 60_000);
  assert.equal(io.sent.length, 4); // 60 -> 260 -> 460 -> 660 -> 860 (>= 750)
  assert.equal(state.power, 860);
  const done = ev.find((e) => e.type === 'done');
  assert.ok(done && done.notify && /860/.test(done.text), 'čekal jsem hotovo se zprávou');
  assert.equal(ev.filter((e) => e.type === 'sent').length, 4);
  assert.deepEqual(a.snapshot(60_000).topping, []);
  assert.equal(run(a, io, 60_500, 90_000).length, 0); // nic dalšího se nedohazuje
});

test('horní hranice: další kolo hned, jak síla naskočí (bez pevného čekání)', () => {
  const state = { power: 60 };
  const a = createAutoArmy({ rand: () => 0 }); // prodleva mezi koly 1 s
  const io = mkTopIo(state, { boost: 200 }); // síla naskočí okamžitě po dohozu
  a.onAlert(alert('X'), TOP, 0);
  a.tick(1000, io); // 1. dohoz
  assert.equal(io.sent.length, 1);
  a.tick(1300, io); // účinek je vidět hned -> naplánuje se další kolo za 1 s
  assert.equal(io.sent.length, 1);
  a.tick(2200, io);
  assert.equal(io.sent.length, 1);
  a.tick(2300, io);
  assert.equal(io.sent.length, 2); // 1,3 s po prvním dohozu + prodleva, žádných 4 s navíc
});

test('horní hranice: dokud se síla po dohozu neobjeví v datech, nedohazuje se naslepo', () => {
  const state = { power: 60, pending: 0 };
  const a = createAutoArmy({ rand: () => 0 });
  const sent = [];
  const io = { stillBelow: () => true, power: () => state.power, request: (n) => { sent.push(n); state.pending = 200; return { ok: true }; } };
  a.onAlert(alert('X'), TOP, 0);
  a.tick(1000, io); // dohoz odešel, ale data se ještě nezměnila
  for (let t = 1500; t <= 6000; t += 500) a.tick(t, io);
  assert.equal(sent.length, 1, 'bez viditelného účinku se druhý dohoz poslat nesmí');
  state.power += state.pending; // síla naskočila
  a.tick(6500, io);
  a.tick(7600, io);
  assert.equal(sent.length, 2);
});

test('horní hranice: síla po dohozu nevzrostla -> dohoz nezabírá, skončí varováním a neposílá dál', () => {
  const state = { power: 60 };
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(state, { boost: 0 }); // dohoz nic nepřidá
  a.onAlert(alert('X'), TOP, 0);
  const ev = run(a, io, 0, 60_000);
  assert.equal(io.sent.length, 1);
  const stall = ev.find((e) => e.type === 'stall');
  assert.ok(stall && stall.notify);
  assert.deepEqual(a.snapshot(60_000).topping, []);
});

test('horní hranice: nejvyšší počet dohozů zastaví smyčku', () => {
  const state = { power: 10 };
  const a = createAutoArmy({ rand: () => 0, maxRounds: 3 }); // interní bezpečnostní strop (v nastavení se počet dohozů neomezuje)
  const io = mkTopIo(state, { boost: 3 }); // roste, ale pomalu
  a.onAlert(alert('X'), TOP, 0);
  const ev = run(a, io, 0, 120_000);
  assert.equal(io.sent.length, 3);
  const max = ev.find((e) => e.type === 'max');
  assert.ok(max && max.notify);
});

test('horní hranice: bez čerstvých dat o síle se nedohazuje donekonečna', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const sent = [];
  const io = { stillBelow: () => true, power: () => null, request: (n) => { sent.push(n); return { ok: true }; } };
  a.onAlert(alert('X'), TOP, 0);
  const ev = run(a, io, 0, 60_000);
  assert.equal(sent.length, 1);
  assert.ok(ev.some((e) => e.type === 'stall'));
});

test('horní hranice: první dohoz se přeskočí, když je hráč už nad prahem; po dokončení jde znovu začít', () => {
  const state = { power: 60 };
  const a = createAutoArmy({ rand: () => 0 });
  a.onAlert(alert('X'), TOP, 0);
  a.tick(1000, mkTopIo(state, { below: () => false }));
  assert.equal(a.snapshot(1000).topping.length, 0);
  assert.equal(a.onAlert(alert('X'), TOP, 2000).scheduled, true); // žádná zbytková epizoda
});

test('horní hranice: pro jednoho hráče běží jen jedna smyčka a víc hráčů se nepřetahuje', () => {
  const a = createAutoArmy({ rand: () => 0 });
  assert.equal(a.onAlert(alert('X'), TOP, 0).scheduled, true);
  assert.equal(a.onAlert(alert('X'), TOP, 100).why, 'queued');
  assert.equal(a.onAlert(alert('Y'), TOP, 100).scheduled, true);
  assert.deepEqual(a.snapshot(100).topping.map((t) => t.name).sort(), ['X', 'Y']);
});

test('horní hranice vypnutá nebo bez cíle: chová se jako jeden dohoz', () => {
  for (const cfg of [{ ...TOP, topUp: false }, { ...TOP, topUpTarget: 0 }]) {
    const state = { power: 60 };
    const a = createAutoArmy({ rand: () => 0 });
    const io = mkTopIo(state, { boost: 10 });
    a.onAlert(alert('X'), cfg, 0);
    run(a, io, 0, 60_000);
    assert.equal(io.sent.length, 1);
  }
});

test('sanitizeAutoArmy: nastavení horní hranice se ořezává; zrušené volby (opakování, limit kol) se zahazují', () => {
  const n = sanitizeAutoArmy(AUTO_ARMY_DEFAULTS, { topUp: 1, topUpTarget: '750000000.7' });
  assert.deepEqual([n.topUp, n.topUpTarget], [true, 750000000]);
  assert.equal(sanitizeAutoArmy(n, { topUpTarget: -5 }).topUpTarget, 0);
  assert.equal(sanitizeAutoArmy(n, { topUpTarget: 'abc' }).topUpTarget, 750000000);
  assert.equal(AUTO_ARMY_DEFAULTS.topUp, false);
  assert.equal(AUTO_ARMY_DEFAULTS.maxPerHour, 200);
  // stará konfigurace: repeat a topUpMaxRounds se ignorují (už nic neovlivní)
  const old = sanitizeAutoArmy(AUTO_ARMY_DEFAULTS, { enabled: true, repeat: true, topUpMaxRounds: 10, topUp: true, topUpTarget: 5 });
  assert.equal('repeat' in old, false);
  assert.equal('topUpMaxRounds' in old, false);
  const army = sanitizeArmy(ARMY_DEFAULTS, { units: [], auto: { enabled: true, repeat: true, topUpMaxRounds: 10 } });
  assert.equal('repeat' in army.auto || 'topUpMaxRounds' in army.auto, false);
});

// ---------- víc hráčů: nejdřív všechny nad práh, pak k horní hranici ----------
/** io pro víc hráčů: každý má svou sílu a sílu, kterou mu dohoz přidá; práh je společný. */
const mkMulti = (powers, boosts, threshold = 100) => {
  const sent = [];
  return {
    sent, powers,
    stillBelow: (n) => powers[n] < threshold,
    power: (n) => powers[n] ?? null,
    threshold: () => threshold,
    request: (n) => { sent.push(n); powers[n] += boosts[n]; return { ok: true }; },
  };
};
const TWO = { ...TOP, topUpTarget: 750 };

test('víc hráčů: nejdřív oba nad práh, teprve potom k horní hranici (jeden nespotřebuje všechno)', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkMulti({ Bob: 50, Eva: 60 }, { Bob: 150, Eva: 150 }); // jeden dohoz je dostane nad práh 100
  a.onAlert(alert('Bob'), TWO, 0);
  a.onAlert(alert('Eva'), TWO, 0);
  run(a, io, 0, 120_000);
  // záchrana: Bob, Eva; teprve pak se střídají k hranici 750
  assert.deepEqual(io.sent.slice(0, 2), ['Bob', 'Eva']);
  const rest = io.sent.slice(2);
  assert.ok(rest.length >= 6 && rest.includes('Bob') && rest.includes('Eva'));
  // střídání: nikdo nedostane dvě kola těsně po sobě, dokud druhý nedosáhl hranice
  assert.ok(io.powers.Bob >= 750 && io.powers.Eva >= 750, JSON.stringify(io.powers));
  assert.ok(Math.abs(io.sent.filter((n) => n === 'Bob').length - io.sent.filter((n) => n === 'Eva').length) <= 1, io.sent.join());
});

test('víc hráčů: hráč, který potřebuje víc dohozů nad práh, má přednost před dohazováním druhého k hranici', () => {
  const a = createAutoArmy({ rand: () => 0 });
  // Bob potřebuje 3 dohozy (20 -> 50 -> 80 -> 110), Eva stačí jeden (60 -> 160)
  const io = mkMulti({ Bob: 20, Eva: 60 }, { Bob: 30, Eva: 100 });
  const cfg = { ...TWO };
  a.onAlert(alert('Bob'), cfg, 0);
  a.onAlert(alert('Eva'), cfg, 0);
  run(a, io, 0, 400_000, 1000);
  const firstEvaTop = io.sent.indexOf('Eva', io.sent.indexOf('Eva') + 1); // druhý dohoz Evy = už k hranici
  const bobRescue = io.sent.slice(0, firstEvaTop).filter((n) => n === 'Bob').length;
  assert.equal(bobRescue, 3, `Bob má být zachráněn dřív, než se Eva dohazuje dál: ${io.sent.join()}`);
  assert.ok(io.powers.Bob >= 750 && io.powers.Eva >= 750);
});

test('víc hráčů: nový hráč pod prahem předběhne dohazování ostatních k hranici', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkMulti({ Bob: 50, Eva: 500 }, { Bob: 150, Eva: 150 });
  a.onAlert(alert('Bob'), TWO, 0);
  run(a, io, 0, 30_000); // Bob je dávno nad prahem a dohazuje se k hranici
  const before = io.sent.length;
  assert.ok(before >= 2);
  io.powers.Eva = 50; // Eva spadla pod práh uprostřed dohazování Boba
  a.onAlert(alert('Eva'), TWO, 30_000);
  const ev = run(a, io, 30_000, 31_000 + 6000);
  const next = io.sent.slice(before);
  assert.equal(next[0], 'Eva', `Eva má jít první: ${next.join()}`);
  assert.ok(ev.some((e) => e.type === 'sent' && e.name === 'Eva'));
});

test('záchrana: bez prahu u hráče (neznámý) se po prvním dohozu jde rovnou k hranici', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkMulti({ Bob: 50 }, { Bob: 200 });
  io.threshold = () => null;
  a.onAlert(alert('Bob'), TWO, 0);
  run(a, io, 0, 60_000);
  assert.ok(io.powers.Bob >= 750);
});

test('snapshot ukazuje fázi hráče (záchrana / k hranici)', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkMulti({ Bob: 50 }, { Bob: 200 });
  a.onAlert(alert('Bob'), TWO, 0);
  assert.equal(a.snapshot(0).topping[0].phase, 'rescue');
  run(a, io, 0, 1500); // po prvním dohozu je hráč nad prahem a dál se dohazuje jen k hranici
  assert.equal(a.snapshot(1500).topping[0].phase, 'topup');
});


// ---------- náhodné pauzy místo pevných ----------
test('pauza před opětovným dohazováním téhož hráče je náhodná v rozmezí (ne pevná)', () => {
  const cfg = { ...ON, minSec: 0, maxSec: 0, gapMinSec: 0, gapMaxSec: 0, cooldownMinSec: 20, cooldownMaxSec: 40 };
  const due = new Set();
  for (let i = 0; i < 80; i++) {
    const a = createAutoArmy();
    const io = mkIo();
    a.onAlert(alert('X'), cfg, 0);
    a.tick(0, io); // dohodí hned (prodleva 0) a zablokuje na náhodnou dobu
    a.tick(16_000, io); // ověřování dohozu doběhlo
    const r = a.onAlert(alert('X'), cfg, 17_000);
    assert.equal(r.deferred, true);
    assert.ok(r.dueAt >= 20_000 && r.dueAt <= 41_000, `další dohoz za ${r.dueAt} ms`);
    due.add(Math.round(r.dueAt / 100));
  }
  assert.ok(due.size > 20, 'pauza se vždy opakuje – není náhodná');
});

test('pauza mezi dohozy téhož hráče (kola k horní hranici) je náhodná v roundMin–roundMax', () => {
  const gaps = new Set();
  for (let i = 0; i < 40; i++) {
    const state = { power: 60 };
    const a = createAutoArmy();
    const times = [];
    const io = { stillBelow: () => true, power: () => state.power, request: () => { times.push(now); state.power += 100; return { ok: true }; } };
    var now = 0;
    a.onAlert(alert('X'), { ...TOP, roundMinSec: 3, roundMaxSec: 6, minSec: 0, maxSec: 0 }, 0);
    for (now = 0; now <= 60_000; now += 100) a.tick(now, io);
    for (let k = 1; k < times.length; k++) {
      const g = times[k] - times[k - 1];
      assert.ok(g >= 3000 && g <= 6300, `mezera ${g}`); // + max. jeden krok tiku
      gaps.add(Math.round(g / 100));
    }
  }
  assert.ok(gaps.size > 10, 'mezery mezi koly jsou pořád stejné');
});

test('migrace: stará pevná pauza cooldownSec a kola s prodlevou prvního dohozu se převedou na rozmezí', () => {
  const m = migrateAutoArmy({ enabled: true, minSec: 3, maxSec: 5, cooldownSec: 2 });
  assert.deepEqual([m.cooldownMinSec, m.cooldownMaxSec, m.roundMinSec, m.roundMaxSec, 'cooldownSec' in m], [2, 2, 3, 5, false]);
  const n = sanitizeAutoArmy(AUTO_ARMY_DEFAULTS, { minSec: 3, maxSec: 5, cooldownSec: 2 });
  assert.deepEqual([n.cooldownMinSec, n.cooldownMaxSec, n.roundMinSec, n.roundMaxSec], [2, 2, 3, 5]);
  assert.equal('cooldownSec' in n, false);
  // nové nastavení se nemění
  const k = migrateAutoArmy({ roundMinSec: 7, roundMaxSec: 8, cooldownMinSec: 9, cooldownMaxSec: 10 });
  assert.deepEqual([k.roundMinSec, k.cooldownMinSec], [7, 9]);
  // přes army (načtení konfigurace) taky
  const army = sanitizeArmy(ARMY_DEFAULTS, { units: [], auto: { enabled: true, cooldownSec: 5 } });
  assert.deepEqual([army.auto.cooldownMinSec, army.auto.cooldownMaxSec], [5, 5]);
});


// ---------- bezpečnost: nic se nesmí zacyklit, plýtvat ani poslat naslepo ----------
test('vypnutí auto-dohozu okamžitě zruší naplánované i rozjeté dohazování', () => {
  const state = { power: 60 };
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(state, { boost: 100 });
  a.onAlert(alert('X'), TOP, 0);
  a.onAlert(alert('Y'), TOP, 0);
  a.tick(1000, io); // první dohoz odešel
  assert.equal(io.sent.length, 1);
  assert.deepEqual(a.tick(1100, io, false), []); // uživatel vypnul
  assert.equal(a.snapshot(1100).pending.length, 0);
  assert.equal(a.snapshot(1100).topping.length, 0);
  run(a, io, 1200, 60_000); // dál se nesmí poslat nic
  assert.equal(io.sent.length, 1);
  assert.equal(a.snapshot(60_000).recent.at(-1).type, 'cancel');
});

test('bez čerstvých dat (null) se nedohazuje naslepo; po 30 s se hráč vzdá se zprávou', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const sent = [];
  const io = { stillBelow: () => null, power: () => null, threshold: () => 100, request: (n) => { sent.push(n); return { ok: true }; } };
  a.onAlert(alert('X'), { ...ON, minSec: 0, maxSec: 0 }, 0);
  const ev = run(a, io, 0, 29_000);
  assert.equal(sent.length, 0);
  assert.equal(ev.length, 0);
  const end = run(a, io, 29_500, 33_000);
  assert.equal(sent.length, 0);
  const fail = end.find((e) => e.type === 'fail');
  assert.ok(fail && fail.notify && /čerstvá data/.test(fail.error));
  // data se vrátila včas: dohoz projde
  const b = createAutoArmy({ rand: () => 0 });
  let fresh = false;
  const io2 = { stillBelow: () => (fresh ? true : null), power: () => (fresh ? 50 : null), threshold: () => 100, request: (n) => { sent.push(n); return { ok: true }; } };
  b.onAlert(alert('Y'), { ...ON, minSec: 0, maxSec: 0 }, 0);
  run(b, io2, 0, 5000);
  fresh = true;
  run(b, io2, 5500, 8000);
  assert.deepEqual(sent, ['Y']);
});

test('chyba skriptu na stránce armády ukončí dohazování se zprávou (nezůstane ticho)', () => {
  const state = { power: 60 };
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(state, { boost: 0 });
  let status = { status: 'sending' };
  io.request = (n) => { io.sent.push(n); return { ok: true, id: 7 }; };
  io.result = (id) => (id === 7 ? status : null);
  a.onAlert(alert('X'), TOP, 0);
  a.tick(1000, io);
  assert.deepEqual(a.tick(5000, io), []); // skript ještě pracuje: na účinek se nečeká a nic se neposílá
  status = { status: 'error', error: 'nejsou vyplněné žádné jednotky (nastav je v aplikaci: Nastavení → Dohoz)' };
  const ev = a.tick(5500, io);
  assert.equal(ev[0].type, 'fail');
  assert.ok(ev[0].notify && /nejsou vyplněné žádné jednotky/.test(ev[0].text));
  assert.equal(io.sent.length, 1);
  assert.equal(a.snapshot(5500).failed, 1);
  assert.equal(a.snapshot(5500).topping.length, 0);
  run(a, io, 6000, 40_000);
  assert.equal(io.sent.length, 1);
});

test('požadavek, který stránka armády nikdy nevyzvedla (expired), se ohlásí', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const io = { stillBelow: () => true, power: () => 60, threshold: () => 100, request: () => ({ ok: true, id: 3 }), result: () => ({ status: 'expired' }) };
  a.onAlert(alert('X'), TOP, 0);
  const ev = run(a, io, 0, 5000);
  const f = ev.find((e) => e.type === 'fail');
  assert.ok(f && f.notify && /nevyzvedla/.test(f.text));
});

test('dokud skript neodeslal, drobné kolísání síly se nebere jako účinek dohozu', () => {
  const state = { power: 1000 };
  const a = createAutoArmy({ rand: () => 0 });
  const sent = [];
  const io = {
    stillBelow: () => true, threshold: () => 2000, power: () => state.power,
    request: (n) => { sent.push(n); return { ok: true, id: 1 }; },
    result: () => ({ status: 'sending' }),
  };
  a.onAlert(alert('X'), { ...TOP, topUpTarget: 750_000 }, 0);
  a.tick(1000, io);
  state.power += 400; // náhodný růst, dohoz se ještě neprovedl
  run(a, io, 1500, 10_000);
  assert.equal(sent.length, 1, 'druhé kolo se nesmí poslat, dokud skript prvnímu dohozu neodeslal');
});

test('malé kolísání pod 0,1 % cíle není účinek: dohoz se bere jako nezabraný', () => {
  const state = { power: 1_000_000 };
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(state, { boost: 100 }); // jen +100 při cíli 750 mil. (0,1 % = 750 000)
  a.onAlert(alert('X'), { ...TOP, topUpTarget: 750_000_000 }, 0);
  const ev = run(a, io, 0, 60_000);
  assert.equal(io.sent.length, 1);
  assert.ok(ev.some((e) => e.type === 'stall' && e.notify));
});

test('bez horní hranice se jeden dohoz taky ověří: nezabral -> zpráva, zabral -> ticho', () => {
  const noTop = { ...ON, minSec: 0, maxSec: 0 };
  const bad = { power: 60 };
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(bad, { boost: 0 });
  a.onAlert(alert('X'), noTop, 0);
  const ev = run(a, io, 0, 60_000);
  assert.equal(io.sent.length, 1);
  assert.ok(ev.some((e) => e.type === 'stall' && e.notify), 'nezabralo -> musí být zpráva');

  const good = { power: 60 };
  const b = createAutoArmy({ rand: () => 0 });
  const io2 = mkTopIo(good, { boost: 200 }); // 60 -> 260, práh 100
  io2.threshold = () => 100;
  b.onAlert(alert('Y'), noTop, 0);
  const ev2 = run(b, io2, 0, 60_000);
  assert.equal(io2.sent.length, 1);
  assert.equal(ev2.filter((e) => e.notify).length, 0, 'když dohoz zabral, žádná zpráva');
  assert.equal(b.snapshot(60_000).recent.some((r) => r.type === 'verified'), true);
});

test('hráč, který se při dohazování k hranici znovu propadne pod práh, má opět přednost před ostatními', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkMulti({ Bob: 50, Eva: 60 }, { Bob: 100, Eva: 100 });
  const log = [];
  const orig = io.request;
  io.request = (n) => { log.push([n, { ...io.powers }]); return orig(n); };
  const cfg = { ...TWO, topUpTarget: 2000 };
  a.onAlert(alert('Bob'), cfg, 0);
  a.onAlert(alert('Eva'), cfg, 0);
  run(a, io, 0, 5000); // oba už jsou nad prahem a dohazují se k hranici
  assert.ok(io.powers.Bob >= 100 && io.powers.Eva >= 100);
  assert.equal(a.snapshot(5000).topping.every((t) => t.phase === 'topup'), true);
  io.powers.Bob = 40; // Bobovi někdo srazil sílu pod práh
  const from = log.length;
  const ev = run(a, io, 5000, 14_000);
  assert.ok(ev.length >= 0);
  assert.equal(a.snapshot(5001).topping.find((t) => t.name === 'Bob').phase === 'rescue' || log.slice(from)[0][0] === 'Bob', true);
  // dokud je Bob pod prahem, Eva se k hranici nedohazuje
  for (const [name, powers] of log.slice(from)) {
    if (name === 'Eva') assert.ok(powers.Bob >= 100, `Eva se dohodila, i když byl Bob pod prahem: ${JSON.stringify(powers)}`);
  }
  assert.equal(log.slice(from).some(([n]) => n === 'Bob'), true);
});

test('pojistka: příliš mnoho dohozů za hodinu auto-dohoz zastaví a pošle zprávu', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const sent = [];
  const io = { stillBelow: () => true, power: () => 50, threshold: () => 100, request: (n) => { sent.push(n); return { ok: true }; } };
  const cfg = { ...ON, minSec: 0, maxSec: 0, gapMinSec: 0, gapMaxSec: 0, cooldownMinSec: 0, cooldownMaxSec: 0, maxPerHour: 3 };
  let breaker = null;
  for (let i = 0; i < 10 && !breaker; i++) {
    const t = i * 20_000; // každých 20 s znovu spadne
    a.tick(t, io); // předchozí ověřování doběhne (síla nevzrostla -> stall)
    a.tick(t + 16_000, io);
    a.onAlert(alert('X'), cfg, t + 17_000);
    breaker = a.tick(t + 18_000, io).find((e) => e.type === 'breaker');
  }
  assert.equal(sent.length, 3, 'víc než limit se poslat nesmí');
  assert.ok(breaker && breaker.notify && /pojistkou/.test(breaker.text));
  assert.equal(a.snapshot(200_000).pending.length, 0);
});

test('pojistka počítá jen poslední hodinu', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const io = { stillBelow: () => true, power: () => 50, threshold: () => 100, request: () => ({ ok: true }) };
  const cfg = { ...ON, minSec: 0, maxSec: 0, gapMinSec: 0, gapMaxSec: 0, cooldownMinSec: 0, cooldownMaxSec: 0, quietMinSec: 0, quietMaxSec: 0, maxPerHour: 2 };
  for (const [i, base] of [0, 4_000_000].entries()) { // dvě skupiny dohozů s odstupem víc než hodina
    for (let k = 0; k < 2; k++) {
      const t = base + k * 40_000;
      a.onAlert(alert(`P${i}${k}`, 'threshold'), cfg, t);
      const ev = a.tick(t + 100, io);
      assert.equal(ev.some((e) => e.type === 'breaker'), false);
    }
  }
  assert.equal(a.snapshot(4_100_000).lastHour, 2);
});

test('konfigurace: pojistka maxPerHour se ořezává a výchozí je 200', () => {
  assert.equal(AUTO_ARMY_DEFAULTS.maxPerHour, 200);
  assert.equal(sanitizeAutoArmy(AUTO_ARMY_DEFAULTS, { maxPerHour: 0 }).maxPerHour, 1);
  assert.equal(sanitizeAutoArmy(AUTO_ARMY_DEFAULTS, { maxPerHour: 99999 }).maxPerHour, 1000);
  assert.equal(sanitizeAutoArmy(AUTO_ARMY_DEFAULTS, { maxPerHour: '30.9' }).maxPerHour, 30);
  assert.equal(sanitizeAutoArmy(AUTO_ARMY_DEFAULTS, { maxPerHour: 'abc' }).maxPerHour, 200);
});


test('nový pád krátce po úspěšném dohození (bez horní hranice) se neztratí', () => {
  const state = { power: 60 };
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(state, { boost: 200 });
  io.threshold = () => 100;
  const cfg = { ...ON, minSec: 1, maxSec: 1, gapMinSec: 0, gapMaxSec: 0, cooldownMinSec: 30, cooldownMaxSec: 30 };
  a.onAlert(alert('X'), cfg, 0);
  run(a, io, 0, 3000); // dohoz 60 -> 260, ověřeno
  assert.equal(io.sent.length, 1);
  state.power = 40; // hráče znovu někdo napadl
  const r = a.onAlert(alert('X'), cfg, 5000); // nový alert (není připomínka)
  assert.equal(r.scheduled, true);
  run(a, io, 5000, 40_000);
  assert.equal(io.sent.length, 2, 'po pauze 30 s se dohodí znovu');
});

test('během ověřování dohozu přijde nový pád: nové plánování nesmí zůstat blokované', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkIo();
  const cfg = { ...ON, minSec: 0, maxSec: 0, gapMinSec: 0, gapMaxSec: 0, cooldownMinSec: 0, cooldownMaxSec: 0 };
  a.onAlert(alert('X'), cfg, 0);
  a.tick(100, io); // odesláno, běží ověřování
  assert.equal(io.sent.length, 1);
  assert.equal(a.onAlert(alert('X'), cfg, 200).scheduled, true);
});


test('počet dohozů na hráče se v nastavení neomezuje: dohazuje se, dokud hráč hranici nepřekročí', () => {
  const state = { power: 10 };
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(state, { boost: 20 }); // 10 -> 750 = 37 dohozů
  a.onAlert(alert('X'), { ...TOP, maxPerHour: 1000 }, 0);
  const ev = run(a, io, 0, 400_000, 500);
  assert.ok(io.sent.length >= 37, `dohozů ${io.sent.length}`);
  assert.ok(state.power >= 750);
  assert.ok(ev.some((e) => e.type === 'done'));
});

test('horní hranice u hráče přebíjí výchozí (hráč se dohazuje jen do své hranice)', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkMulti({ Bob: 50, Eva: 60 }, { Bob: 100, Eva: 100 });
  // server pro každý alert dosadí hranici hráče: Bob 300, Eva výchozí 700
  a.onAlert(alert('Bob'), { ...TWO, topUpTarget: 300 }, 0);
  a.onAlert(alert('Eva'), { ...TWO, topUpTarget: 700 }, 0);
  run(a, io, 0, 120_000);
  assert.ok(io.powers.Bob >= 300 && io.powers.Bob < 400, `Bob ${io.powers.Bob}`);
  assert.ok(io.powers.Eva >= 700 && io.powers.Eva < 800, `Eva ${io.powers.Eva}`);
});

test('režim „jednou za pád“: jeden dohoz i když je horní hranice nastavená, pokud je topUp vypnuté', () => {
  const state = { power: 60 };
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(state, { boost: 10 });
  a.onAlert(alert('X'), { ...TOP, topUp: false, topUpTarget: 750 }, 0);
  run(a, io, 0, 60_000);
  assert.equal(io.sent.length, 1);
});


test('vlastní horní hranice hráče: ukládá se, maže se a čte se z resolveWatch', () => {
  const base = structuredClone(DEFAULTS);
  base.races = { 5: { name: 'Moje', mode: 'all', threshold: null, criticalPct: null } };
  let c = sanitizeUpdate(base, { players: { Bob: { topTarget: '750000000.9' } } });
  assert.deepEqual(c.players.Bob, { topTarget: 750000000 });
  assert.equal(resolveWatch(c, '5', 'Bob').ownTop, 750000000);
  assert.equal(resolveWatch(c, '5', 'Eva').ownTop, null);
  c = sanitizeUpdate(c, { players: { Bob: { threshold: 100 } } }); // práh se nepřepíše horní hranici
  assert.deepEqual(c.players.Bob, { topTarget: 750000000, threshold: 100 });
  assert.equal(sanitizeUpdate(c, { players: { Bob: { topTarget: 'abc' } } }).players.Bob.topTarget, 750000000); // nesmysl se ignoruje
  assert.equal(sanitizeUpdate(c, { players: { Bob: { topTarget: -5 } } }).players.Bob.topTarget, 750000000);
  c = sanitizeUpdate(c, { players: { Bob: { topTarget: null } } }); // prázdné = výchozí
  assert.deepEqual(c.players.Bob, { threshold: 100 });
  c = sanitizeUpdate(c, { players: { Bob: { threshold: null } } });
  assert.equal('Bob' in c.players, false); // prázdný záznam se uklidí
});


test('síla 0 je platná: hráč sražený dobyvacím útokem na 0 se dohodí a dohazuje se z nuly až na horní hranici', () => {
  const state = { power: 0 };
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(state, { boost: 200 });
  io.threshold = () => 100;
  a.onAlert(alert('X'), TOP, 0);
  const ev = run(a, io, 0, 60_000);
  assert.ok(io.sent.length >= 4, `dohozů ${io.sent.length}`);
  assert.ok(state.power >= 750);
  assert.ok(ev.some((e) => e.type === 'done'));
  assert.equal(ev.some((e) => e.type === 'stall' || e.type === 'fail'), false);
});

test('síla 0 se bere i při jednom dohození bez horní hranice (a ověří se podle nárůstu z nuly)', () => {
  const state = { power: 0 };
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(state, { boost: 150 });
  io.threshold = () => 100;
  a.onAlert(alert('X'), { ...ON, minSec: 0, maxSec: 0, gapMinSec: 0, gapMaxSec: 0 }, 0);
  const ev = run(a, io, 0, 60_000);
  assert.equal(io.sent.length, 1);
  assert.equal(ev.filter((e) => e.notify).length, 0, 'dohoz zabral, žádná zpráva');
  assert.equal(a.snapshot(60_000).recent.some((r) => r.type === 'verified'), true);
});

test('nečitelná síla (NaN, záporná) není platná a nedohazuje se podle ní', () => {
  for (const bad of [NaN, -5, null, undefined]) {
    const a = createAutoArmy({ rand: () => 0 });
    const sent = [];
    const io = { stillBelow: () => true, power: () => bad, threshold: () => 100, request: (n) => { sent.push(n); return { ok: true }; } };
    a.onAlert(alert('X'), { ...TOP, minSec: 0, maxSec: 0 }, 0);
    run(a, io, 0, 3000);
    // první dohoz se rozhoduje přes stillBelow (true), ale ověřování účinku bez čitelné síly skončí varováním
    const ev = run(a, io, 3000, 40_000);
    assert.ok(sent.length <= 1);
    assert.ok(sent.length === 0 || ev.some((e) => e.type === 'stall'), `bad=${bad}`);
  }
});

// ---------- přednostní dohoz pro uživatele samotného ----------
const ME = { ...ON, selfName: 'Já', selfMinSec: 0.2, selfMaxSec: 0.5, selfRoundMinSec: 0.3, selfRoundMaxSec: 0.6, gapMinSec: 3, gapMaxSec: 3, minSec: 4, maxSec: 4 };

test('přednostní dohoz: u mě se čeká jen mou krátkou dobu, u ostatních běžnou; jméno bez ohledu na velikost písmen', () => {
  const mine = new Set();
  for (let i = 0; i < 100; i++) {
    const a = createAutoArmy();
    const r = a.onAlert(alert('  já '), ME, 0);
    assert.ok(r.dueAt >= 200 && r.dueAt <= 500, `u mě ${r.dueAt}`);
    mine.add(r.dueAt);
  }
  assert.ok(mine.size > 20, 'náhodná prodleva');
  const a = createAutoArmy();
  assert.equal(a.onAlert(alert('Eva'), ME, 0).dueAt, 4000); // ostatní: běžná prodleva 4 s
  assert.equal(createAutoArmy().onAlert(alert('Eva'), { ...ME, selfName: '' }, 0).dueAt >= 3000, true); // bez jména se nic nemění
  assert.equal(createAutoArmy().onAlert(alert('Já'), { ...ME, selfName: '' }, 0).dueAt >= 3000, true);
});

test('přednostní dohoz: jdu první, i když ostatní spadli dřív; ostatním nic neposouvám', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkIo();
  const cfg = { ...ME, minSec: 1, maxSec: 1, gapMinSec: 1, gapMaxSec: 1 };
  a.onAlert(alert('Eva'), cfg, 0); // splatné ve 2 s (1 s prodleva + 1 s odstup od nuly)
  a.onAlert(alert('Bob'), cfg, 0); // +1 s odstup = 3 s
  a.onAlert(alert('Já'), cfg, 100); // splatné za 0,2 s
  const ev = run(a, io, 0, 30_000, 100);
  assert.deepEqual(io.sent.slice(0, 3), ['Já', 'Eva', 'Bob']);
  assert.equal(ev.filter((e) => e.type === 'sent').length, 3);
  // moje plánování neposunulo termín Boba (odstup se počítá jen mezi ostatními)
  const b = createAutoArmy({ rand: () => 0 });
  const t1 = b.onAlert(alert('Eva'), cfg, 0).dueAt;
  b.onAlert(alert('Já'), cfg, 0);
  assert.equal(b.onAlert(alert('Bob'), cfg, 0).dueAt - t1, 1000);
});

test('přednostní dohoz: když jsou splatní oba najednou, odešlu se nejdřív můj', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkIo();
  const cfg = { ...ME, minSec: 0, maxSec: 0, gapMinSec: 0, gapMaxSec: 0, selfMinSec: 0, selfMaxSec: 0 };
  a.onAlert(alert('Eva'), cfg, 0);
  a.onAlert(alert('Já'), cfg, 0);
  a.tick(10, io);
  a.tick(500, io);
  assert.deepEqual(io.sent, ['Já', 'Eva']);
});

test('přednostní dohoz: kola k horní hranici mám rychlá a nečekám za cizí záchranou; ostatní běžně', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkMulti({ Já: 50, Bob: 60 }, { Já: 150, Bob: 150 });
  const log = [];
  const orig = io.request;
  io.request = (n) => { log.push([n, Date.now()]); return orig(n); };
  const cfg = { ...ME, topUp: true, topUpTarget: 800, minSec: 3, maxSec: 3, roundMinSec: 3, roundMaxSec: 3, gapMinSec: 0, gapMaxSec: 0 };
  a.onAlert(alert('Já'), cfg, 0);
  a.onAlert(alert('Bob'), cfg, 0);
  const sentAt = {};
  const orig2 = io.request;
  io.request = (n) => { (sentAt[n] ??= []).push(now); return orig2(n); };
  let now = 0;
  for (now = 0; now <= 40_000; now += 50) a.tick(now, io);
  assert.ok(io.powers['Já'] >= 800 && io.powers.Bob >= 800);
  const mineGaps = sentAt['Já'].slice(1).map((t, i) => t - sentAt['Já'][i]);
  const bobGaps = sentAt.Bob.slice(1).map((t, i) => t - sentAt.Bob[i]);
  assert.ok(Math.max(...mineGaps) <= 900, `mé pauzy ${mineGaps}`); // 0,3–0,6 s (+ krok ticku)
  assert.ok(Math.min(...bobGaps) >= 3000, `cizí pauzy ${bobGaps}`); // běžných 3 s
  assert.ok(sentAt['Já'].length >= 5 && sentAt['Já'].at(-1) < sentAt.Bob.at(-1), 'jsem hotový dřív než Bob');
});

test('přednostní dohoz: nepodléhám pauze po dohození (po dalším pádu hned znovu)', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const state = { power: 50 };
  const io = mkTopIo(state, { boost: 200 });
  io.threshold = () => 100;
  const cfg = { ...ME, cooldownMinSec: 120, cooldownMaxSec: 120 };
  a.onAlert(alert('Já'), cfg, 0);
  run(a, io, 0, 2000, 50);
  assert.equal(io.sent.length, 1);
  state.power = 40; // znovu mě někdo srazil
  const r = a.onAlert(alert('Já'), cfg, 3000);
  assert.equal(r.scheduled, true);
  assert.equal(r.deferred, false, 'bez čekání na konec pauzy');
  assert.ok(r.dueAt - 3000 <= 500);
  run(a, io, 3000, 5000, 50);
  assert.equal(io.sent.length, 2);
  // u ostatních se pauza dál dodržuje
  const c = createAutoArmy({ rand: () => 0 });
  const io2 = mkTopIo({ power: 50 }, { boost: 200 });
  c.onAlert(alert('Eva'), cfg, 0);
  run(c, io2, 0, 8000, 50);
  assert.equal(c.onAlert(alert('Eva'), cfg, 9000).deferred, true);
});

test('přednostní dohoz: zaneprázdněný dohoz zkouším znovu rychle (150–350 ms)', () => {
  const a = createAutoArmy({ rand: () => 0 });
  let busy = true;
  const sent = [];
  const io = { stillBelow: () => true, power: () => 50, threshold: () => 100, request: (n) => (busy ? { ok: false, error: 'Ještě se dohazuje Bob, chvíli počkej.' } : (sent.push(n), { ok: true })) };
  a.onAlert(alert('Já'), ME, 0);
  a.tick(1000, io); // zaneprázdněno -> nový termín za 150 ms
  busy = false;
  a.tick(1200, io);
  assert.deepEqual(sent, ['Já']);
});

test('přednostní dohoz: nastavení jména a rozmezí se čistí', () => {
  const n = sanitizeAutoArmy(AUTO_ARMY_DEFAULTS, { selfName: '  Jacobjer  ', selfMinSec: '2', selfMaxSec: '1', selfRoundMinSec: 9999, selfRoundMaxSec: 'abc' });
  assert.equal(n.selfName, 'Jacobjer');
  assert.deepEqual([n.selfMinSec, n.selfMaxSec], [2, 2]);
  assert.deepEqual([n.selfRoundMinSec, n.selfRoundMaxSec], [60, 60]);
  assert.equal(AUTO_ARMY_DEFAULTS.selfName, '');
  assert.equal(sanitizeAutoArmy(n, { selfName: 'x'.repeat(200) }).selfName.length, 64);
  assert.equal(sanitizeAutoArmy(n, { selfName: 5 }).selfName, 'Jacobjer'); // nesmysl se ignoruje
  assert.equal(sanitizeAutoArmy(n, { selfName: '' }).selfName, ''); // prázdné = vypnuto
});

test('snapshot: epizoda přednostního hráče je označená', () => {
  const a = createAutoArmy({ rand: () => 0 });
  a.onAlert(alert('Já'), { ...ME, topUp: true, topUpTarget: 800 }, 0);
  a.onAlert(alert('Eva'), { ...ME, topUp: true, topUpTarget: 800 }, 0);
  const t = Object.fromEntries(a.snapshot(0).topping.map((x) => [x.name, x.self]));
  assert.deepEqual(t, { 'Já': true, Eva: false });
});


// ---------- režim „nad práh“: dohazuje se, dokud hráč není nad prahem ----------
const thrAlert = (name, threshold = 100, reason = 'threshold') => ({ name, reason, power: 1, threshold });
const ONCE = { ...ON, minSec: 1, maxSec: 1, roundMinSec: 1, roundMaxSec: 1, gapMinSec: 0, gapMaxSec: 0, cooldownMinSec: 0, cooldownMaxSec: 0, topUp: false };

test('nad práh: dohoz nestačil, dohazuje se znovu, dokud hráč není nad prahem, a pak se skončí', () => {
  const state = { power: 0 };
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(state, { boost: 40 }); // 0 -> 40 -> 80 -> 120 (práh 100)
  io.threshold = () => 100;
  a.onAlert(thrAlert('X', 100), ONCE, 0);
  const ev = run(a, io, 0, 60_000);
  assert.equal(io.sent.length, 3);
  assert.equal(state.power, 120);
  assert.ok(ev.some((e) => e.type === 'done' && e.notify), 'bylo potřeba víc dohozů -> zpráva');
  assert.equal(a.snapshot(60_000).topping.length, 0);
  assert.equal(run(a, io, 60_500, 90_000).length, 0); // dál nic
});

test('nad práh: stačil jeden dohoz -> jeden dohoz a žádná zpráva (běžná věc)', () => {
  const state = { power: 60 };
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(state, { boost: 200 });
  io.threshold = () => 100;
  a.onAlert(thrAlert('X', 100), ONCE, 0);
  const ev = run(a, io, 0, 30_000);
  assert.equal(io.sent.length, 1);
  assert.equal(ev.filter((e) => e.notify).length, 0);
  assert.equal(ev.some((e) => e.type === 'done'), true);
});

test('nad práh: dohoz nezabírá (síla nevzroste) -> konec se zprávou, neposílá se donekonečna', () => {
  const state = { power: 60 };
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(state, { boost: 0 });
  io.threshold = () => 100;
  a.onAlert(thrAlert('X', 100), ONCE, 0);
  const ev = run(a, io, 0, 60_000);
  assert.equal(io.sent.length, 1);
  assert.ok(ev.some((e) => e.type === 'stall' && e.notify));
});

test('nad práh: cílem je práh právě toho hráče (každý jiný)', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkMulti({ Bob: 10, Eva: 10 }, { Bob: 50, Eva: 50 });
  io.threshold = (n) => (n === 'Bob' ? 100 : 300);
  a.onAlert(thrAlert('Bob', 100), ONCE, 0);
  a.onAlert(thrAlert('Eva', 300), ONCE, 0);
  run(a, io, 0, 120_000);
  assert.ok(io.powers.Bob >= 100 && io.powers.Bob < 150, `Bob ${io.powers.Bob}`);
  assert.ok(io.powers.Eva >= 300 && io.powers.Eva < 350, `Eva ${io.powers.Eva}`);
});

test('horní hranice pod prahem hráče se nebere: cíl je vždy aspoň práh', () => {
  const state = { power: 10 };
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(state, { boost: 30 });
  io.threshold = () => 100;
  a.onAlert(thrAlert('X', 100), { ...ONCE, topUp: true, topUpTarget: 50 }, 0); // nesmyslná hranice 50 < práh 100
  run(a, io, 0, 60_000);
  assert.ok(state.power >= 100, `síla ${state.power}`);
});

test('nad práh: alert bez známého prahu se chová jako jeden dohoz (nelze určit cíl)', () => {
  const state = { power: 10 };
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(state, { boost: 5 });
  a.onAlert(alert('X'), ONCE, 0); // alert bez threshold
  run(a, io, 0, 60_000);
  assert.equal(io.sent.length, 1);
});

test('nad práh: přednostní dohoz (já) dohazuje rychle, dokud nejsem nad prahem', () => {
  const state = { power: 0 };
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(state, { boost: 40 });
  io.threshold = () => 100;
  const times = [];
  const orig = io.request;
  let now = 0;
  io.request = (n) => { times.push(now); return orig(n); };
  a.onAlert(thrAlert('Já', 100), { ...ME, ...ONCE, selfName: 'Já' }, 0);
  for (now = 0; now <= 20_000; now += 50) a.tick(now, io);
  assert.equal(io.sent.length, 3);
  assert.ok(times.at(-1) < 3000, `hotovo za ${times.at(-1)} ms`);
});

test('první pád po hodině klidu: k prodlevě 1 se přičte zpoždění 5; další pády ve stejném útoku už ne; já (přednostní) bez zpoždění', () => {
  const a = createAutoArmy({ rand: () => 0, startedAt: 0 });
  const cfg = { ...ON, minSec: 2, maxSec: 2, gapMinSec: 0, gapMaxSec: 0, quietMinSec: 30, quietMaxSec: 30, selfName: 'Ja' };
  const t0 = 2 * 3_600_000; // aplikace běží 2 h, nikdo nespadl
  const r1 = a.onAlert(alert('A', 'threshold'), cfg, t0);
  assert.equal(r1.dueAt - t0, 32_000, '2 s + 30 s po klidu');
  const r2 = a.onAlert(alert('B', 'threshold'), cfg, t0 + 60_000); // stejný útok, minutu po prvním pádu
  assert.equal(r2.dueAt - (t0 + 60_000), 2_000);
  const b = createAutoArmy({ rand: () => 0, startedAt: 0 });
  const r3 = b.onAlert(alert('Ja', 'threshold'), cfg, t0); // přednostní dohoz pro mě se nezdržuje
  assert.ok(r3.dueAt - t0 < 2_000);
});

test('první pád krátce po spuštění aplikace (méně než hodina) se nezdržuje – historii před spuštěním neznáme', () => {
  const a = createAutoArmy({ rand: () => 0, startedAt: 0 });
  const r = a.onAlert(alert('A', 'threshold'), { ...ON, minSec: 2, maxSec: 2, gapMinSec: 0, gapMaxSec: 0, quietMinSec: 30, quietMaxSec: 30 }, 10 * 60_000);
  assert.equal(r.dueAt - 10 * 60_000, 2_000);
});

test('konfigurace: zpoždění po klidu se ořezává (0–600 s) a max nikdy pod min', () => {
  const c = sanitizeAutoArmy({}, { quietMinSec: 50, quietMaxSec: 10 });
  assert.deepEqual([c.quietMinSec, c.quietMaxSec], [50, 50]);
  assert.equal(sanitizeAutoArmy({}, { quietMaxSec: 9999 }).quietMaxSec, 600);
  assert.deepEqual([AUTO_ARMY_DEFAULTS.quietMinSec, AUTO_ARMY_DEFAULTS.quietMaxSec], [5, 15]);
});

test('rychlá větev: pád se naplánuje hned při prvním čtení a prodleva se počítá do kliknutí (odečte se ~0,3 s)', () => {
  const a = createAutoArmy({ rand: () => 0 }); // vždy dolní mez rozmezí
  const r = a.onAlert(alert('X', 'threshold', { threshold: 100, early: true }), { ...ON, minSec: 1.5, maxSec: 2, quietMinSec: 0, quietMaxSec: 0 }, 1000);
  assert.equal(r.scheduled, true);
  assert.equal(r.dueAt, 1000 + 1500 - 300);
});

test('rychlá větev: potvrzený alert z pravidel o chvíli později se neplánuje podruhé (jinak by se dohazovalo dvakrát)', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const auto = { ...ON, minSec: 1.5, maxSec: 2, quietMinSec: 0, quietMaxSec: 0 };
  assert.equal(a.onAlert(alert('X', 'threshold', { threshold: 100, early: true }), auto, 0).scheduled, true);
  assert.deepEqual(a.onAlert(alert('X', 'threshold', { threshold: 100 }), auto, 1500), { scheduled: false, why: 'early' });
});

test('před prvním dohozem musí být hráč pod prahem ve dvou čteních: jedno čtení (výkyv dat) dohoz neodešle, druhé ho pustí', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const auto = { ...ON, minSec: 1, maxSec: 1, quietMinSec: 0, quietMaxSec: 0 };
  a.onAlert(alert('X', 'threshold', { threshold: 100, early: true }), auto, 0);
  let streak = 1;
  const io = mkIo({ below: () => true }); io.belowStreak = () => streak;
  a.tick(1200, io); assert.deepEqual(io.sent, [], 'po jednom čtení se neposílá');
  streak = 2;
  a.tick(1400, io); assert.deepEqual(io.sent, ['X'], 'po druhém čtení se pošle');
});

test('rychlá větev: když hráč mezitím vyskočil nad práh (výkyv dat), dohoz se přeskočí', () => {
  const a = createAutoArmy({ rand: () => 0 });
  a.onAlert(alert('X', 'threshold', { threshold: 100, early: true }), { ...ON, minSec: 1, maxSec: 1, quietMinSec: 0, quietMaxSec: 0 }, 0);
  const io = mkIo({ below: () => false }); io.belowStreak = () => 0;
  const ev = a.tick(1000, io);
  assert.deepEqual(io.sent, []); assert.ok(ev.some((e) => e.type === 'skip'));
});
