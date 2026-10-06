import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutoArmy, sanitizeAutoArmy, migrateAutoArmy, AUTO_ARMY_DEFAULTS } from '../src/autodohoz.js';
import { sanitizeArmy, ARMY_DEFAULTS } from '../src/attack.js';
import { sanitizeUpdate, DEFAULTS } from '../src/config.js';

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
  assert.equal(createAutoArmy().onAlert(alert('X', 'threshold', { repeat: true }), ON, 0).why, 'repeat');
  assert.equal(createAutoArmy().onAlert(alert('X', 'threshold', { repeat: true }), { ...ON, repeat: true }, 0).scheduled, true);
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

test('tick: pauza mezi dohozy téhož hráče (cooldown)', () => {
  const a = createAutoArmy({ rand: () => 0 }); // 2 s
  const io = mkIo();
  a.onAlert(alert('X'), ON, 0);
  a.tick(2000, io);
  assert.equal(a.onAlert(alert('X', 'threshold', { repeat: true }), { ...ON, repeat: true }, 30_000).why, 'cooldown');
  assert.equal(a.onAlert(alert('X', 'threshold', { repeat: true }), { ...ON, repeat: true }, 62_001).scheduled, true);
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
  const e1 = a.tick(1000, closed)[0];
  assert.deepEqual([e1.type, e1.page, e1.notify], ['fail', true, true]);
  a.onAlert(alert('Y'), { ...ON, minSec: 0, maxSec: 0 }, 5000);
  const e2 = a.tick(7000, closed)[0];
  assert.deepEqual([e2.page, e2.notify], [true, false]); // hlášeno před chvílí
  a.onAlert(alert('Z'), { ...ON, minSec: 0, maxSec: 0 }, 700_000);
  assert.equal(a.tick(702_000, closed)[0].notify, true);
});

test('sanitizeAutoArmy: meze, max nikdy pod min, nesmysly se ignorují', () => {
  const n = sanitizeAutoArmy(AUTO_ARMY_DEFAULTS, { enabled: 1, minSec: '5', maxSec: '2', repeat: 1, cooldownMinSec: '90', cooldownMaxSec: '30', roundMinSec: '6', roundMaxSec: '3' });
  assert.deepEqual(n, { ...AUTO_ARMY_DEFAULTS, enabled: true, minSec: 5, maxSec: 5, repeat: true, cooldownMinSec: 90, cooldownMaxSec: 90, roundMinSec: 6, roundMaxSec: 6 });
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
const TOP = { ...ON, minSec: 1, maxSec: 1, roundMinSec: 1, roundMaxSec: 1, gapMinSec: 0, gapMaxSec: 0, topUp: true, topUpTarget: 750, topUpMaxRounds: 10, cooldownMinSec: 0, cooldownMaxSec: 0 };
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
  const a = createAutoArmy({ rand: () => 0 });
  const io = mkTopIo(state, { boost: 1 }); // roste, ale strašně pomalu
  a.onAlert(alert('X'), { ...TOP, topUpMaxRounds: 3 }, 0);
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
  assert.equal(a.onAlert(alert('X', 'threshold', { repeat: true }), { ...TOP, repeat: true }, 100).why, 'queued');
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

test('sanitizeAutoArmy: nastavení horní hranice se ořezává', () => {
  const n = sanitizeAutoArmy(AUTO_ARMY_DEFAULTS, { topUp: 1, topUpTarget: '750000000.7', topUpMaxRounds: '8' });
  assert.deepEqual([n.topUp, n.topUpTarget, n.topUpMaxRounds], [true, 750000000, 8]);
  const c = sanitizeAutoArmy(n, { topUpTarget: -5, topUpMaxRounds: 999 });
  assert.deepEqual([c.topUpTarget, c.topUpMaxRounds], [0, 50]);
  assert.equal(sanitizeAutoArmy(n, { topUpMaxRounds: 0 }).topUpMaxRounds, 1);
  assert.equal(sanitizeAutoArmy(n, { topUpTarget: 'abc' }).topUpTarget, 750000000);
  assert.equal(AUTO_ARMY_DEFAULTS.topUp, false);
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
  const cfg = { ...TWO, topUpMaxRounds: 50 };
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
  const cfg = { ...ON, minSec: 0, maxSec: 0, gapMinSec: 0, gapMaxSec: 0, cooldownMinSec: 20, cooldownMaxSec: 40, repeat: true };
  const unblock = new Set();
  for (let i = 0; i < 80; i++) {
    const a = createAutoArmy();
    const io = mkIo();
    a.onAlert(alert('X'), cfg, 0);
    a.tick(0, io); // dohodí hned (prodleva 0) a zablokuje na náhodnou dobu
    let t = 0;
    while (!a.onAlert(alert('X', 'threshold', { repeat: true }), cfg, t).scheduled && t < 60_000) t += 100;
    assert.ok(t >= 20_000 && t <= 40_100, `odblokováno po ${t} ms`);
    unblock.add(t);
  }
  assert.ok(unblock.size > 20, 'pauza se vždy opakuje – není náhodná');
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
