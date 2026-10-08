import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGates, GATES_DEFAULTS } from '../src/gates.js';
import { sanitizeUpdate, DEFAULTS } from '../src/config.js';

const cfg = (x = {}) => ({ ...GATES_DEFAULTS, enabled: true, dryRun: false, maxPrice: 5_000_000, midChance: 0, afterMinSec: 2, afterMaxSec: 2, firstMinSec: 1, firstMaxSec: 1, stepMinSec: 1, stepMaxSec: 1, ...x });
const rep = (x = {}) => ({ src: 'a', price: 4_000_000, count: 10, remainingSec: 100, naq: 100_000_000, planets: 50, canBuy: true, clicked: false, ...x });
const mk = () => createGates({ rand: () => 0 });

test('vypnuto: nic se neděje; po zapnutí se nejdřív načte čerstvá stránka a teprve podle ní se nakupuje', () => {
  const g = mk();
  assert.equal(g.report(rep(), cfg({ enabled: false }), 0).action, 'idle');
  const on = g.report(rep({ fresh: false }), cfg(), 3000); // hlášení ze staré stránky
  assert.equal(on.action, 'wait');
  assert.equal(on.kind, 'enable');
  assert.ok(on.reloadInMs >= 500 && on.reloadInMs <= 1800, 'rychlé obnovení');
  assert.equal(g.report(rep({ fresh: true }), cfg(), 5000).action, 'buy', 'čerstvá data: rozhoduje se podle nich');
  // čerstvě načtená stránka po zapnutí se znovu nenačítá, rozhoduje se hned
  const g2 = mk();
  g2.report(rep(), cfg({ enabled: false }), 0);
  assert.equal(g2.report(rep({ fresh: true }), cfg(), 1000).action, 'buy');
});

test('drahá nabídka se nekupuje, obnoví se těsně po změně (odpočet + 1–5 s)', () => {
  const g = mk();
  const r = g.report(rep({ price: 9_000_000, remainingSec: 56 }), cfg(), 0);
  assert.equal(r.action, 'wait');
  assert.equal(r.why, 'expensive');
  assert.equal(r.reloadInMs, 56_000 + 2_000, 'za 56 s + 2 s po změně');
  assert.equal(r.kind, 'change');
});

test('občas se stránka uprostřed cyklu obnoví (šance), ale ne těsně před změnou', () => {
  const g = createGates({ rand: () => 0 }); // rand 0 -> vždy pod šancí a nejkratší doba
  const mid = g.report(rep({ price: 9e6, remainingSec: 150 }), cfg({ midChance: 100, midMinSec: 30, midMaxSec: 60 }), 0);
  assert.equal(mid.kind, 'mid');
  assert.equal(mid.reloadInMs, 30_000);
  const near = mk().report(rep({ price: 9e6, remainingSec: 20 }), cfg({ midChance: 100, midMinSec: 30, midMaxSec: 60 }), 0);
  assert.equal(near.kind, 'change', 'zbývá málo: čeká se na změnu');
});

test('dobrá nabídka: kupuje se, po každém kliknutí se ověří úbytek naquadahu, souhrn až na konci nabídky', () => {
  const g = mk();
  const r1 = g.report(rep(), cfg(), 0);
  assert.equal(r1.action, 'buy');
  assert.equal(r1.delayMs, 1000);
  assert.equal(r1.maxPrice, 5_000_000);
  // po kliknutí: naquadah ubyl o cenu
  const r2 = g.report(rep({ naq: 96_000_000, count: 9, clicked: true }), cfg(), 5000);
  assert.equal(r2.action, 'buy');
  const r3 = g.report(rep({ naq: 92_000_000, count: 8, clicked: true }), cfg(), 10_000);
  assert.equal(r3.action, 'buy');
  // nabídka vyprodána: souhrn přijde HNED (ne až při další změně nabídky)
  const r4 = g.report(rep({ naq: 88_000_000, count: 0, clicked: true }), cfg(), 15_000);
  assert.equal(r4.action, 'wait');
  assert.equal(r4.why, 'sold-out');
  assert.match(r4.notify, /koupeno 3× po 4\s000\s000 kg za kus, celkem 12\s000\s000 kg/);
  assert.match(r4.notify, /Nabídka měla 10 bran, zbývá jich 0/);
  assert.match(r4.notify, /Zbývá 88\s000\s000 kg naquadahu/);
  // další hlášení téže nabídky už totéž neposílá a nová nabídka nic neohlašuje podruhé
  assert.equal(g.report(rep({ naq: 88_000_000, count: 0 }), cfg(), 20_000).notify, undefined);
  const r5 = g.report(rep({ price: 4_500_000, naq: 88_000_000, remainingSec: 175, count: 3 }), cfg({ dryRun: true }), 200_000);
  assert.ok(!/koupeno/.test(r5.notify ?? ''), 'nic dvakrát');
  assert.equal(g.snapshot(200_000).totals.bought, 3);
});

test('kliknutí bez úbytku naquadahu: dvakrát a nákup v nabídce stojí, zpráva', () => {
  const g = mk();
  g.report(rep(), cfg(), 0);
  const a = g.report(rep({ clicked: true }), cfg(), 5000); // naquadah neubyl
  assert.equal(a.action, 'buy', 'jednou se to ještě zkusí');
  const b = g.report(rep({ clicked: true }), cfg(), 10_000);
  assert.equal(b.action, 'wait');
  assert.equal(b.why, 'stopped');
  assert.match(b.notify, /naquadah neubyl/);
});

test('bez kliknutí se čekající výsledek nevyhodnocuje (stránka se jen obnovila)', () => {
  const g = mk();
  g.report(rep(), cfg(), 0); // buy
  const r = g.report(rep({ clicked: false }), cfg(), 3000);
  assert.equal(r.action, 'buy', 'žádný neúspěch se nezapočítal');
  assert.equal(g.snapshot(3000).batch.fails, 0);
});

test('rezerva naquadahu, limit kusů, vyprodáno, bez formuláře, zkušební režim', () => {
  const g = mk();
  assert.equal(g.report(rep({ naq: 4_500_000 }), cfg({ reserveNaq: 1_000_000 }), 0).why, 'no-naq');
  const g2 = mk();
  g2.report(rep(), cfg({ maxPerOffer: 1 }), 0);
  assert.equal(g2.report(rep({ naq: 96e6, clicked: true }), cfg({ maxPerOffer: 1 }), 5000).why, 'limit');
  assert.equal(mk().report(rep({ count: 0 }), cfg(), 0).why, 'sold-out');
  assert.equal(mk().report(rep({ canBuy: false }), cfg(), 0).why, 'no-form');
  const dry = mk();
  const d = dry.report(rep({ count: 10, planets: 4 }), cfg({ dryRun: true }), 0);
  assert.equal(d.action, 'wait');
  assert.match(d.notify, /zkušební režim.*koupil bych 4×/);
  assert.equal(dry.report(rep({ count: 10, planets: 4 }), cfg({ dryRun: true }), 1000).notify, undefined, 'zpráva jen jednou za nabídku');
});

test('jedna karta nakupuje, druhá čeká', () => {
  const g = mk();
  assert.equal(g.report(rep({ src: 'a' }), cfg(), 0).action, 'buy');
  assert.deepEqual({ a: g.report(rep({ src: 'b' }), cfg(), 1000).action }, { a: 'idle' });
  assert.equal(g.report(rep({ src: 'b' }), cfg(), 40_000).action, 'buy', 'po 30 s ticha přebírá druhá');
});

test('nastavení bran: meze a konec nikdy pod začátkem', () => {
  const a = sanitizeUpdate(structuredClone(DEFAULTS), { gates: { enabled: true, dryRun: false, maxPrice: '7000000', afterMinSec: 9, afterMaxSec: 2, midChance: 500, maxPerOffer: -5 } }).gates;
  assert.equal(a.enabled, true);
  assert.equal(a.dryRun, false);
  assert.equal(a.maxPrice, 7_000_000);
  assert.equal(a.afterMaxSec, 9);
  assert.equal(a.midChance, 100);
  assert.equal(DEFAULTS.gates.enabled, false);
  assert.equal(DEFAULTS.gates.dryRun, true, 'výchozí je zkušební režim');
});

// --- čtení stránky (userscript) ---
const src = readFileSync(new URL('../userscript/stargate-brany.user.js', import.meta.url), 'utf8');
const { parseGates } = new Function(`${src.slice(src.indexOf('// <parse>'), src.indexOf('// </parse>'))}; return { parseGates };`)();
test('čtení stránky Hvězdné brány: cena, počet, odpočet, naquadah', () => {
  const t = 'Máš k dispozici 116 319 547 kg naquadahu.\nHvězdná brána\nJedná se o neutrální nabídku, která se mění každé 3 minuty. Další změna bude za 56 sekund.\n\nJedna hvězdná brána je momentálně nabízena za 11 049 667 kg naquadahu.\nZa tuto cenu je nabízeno 22 hvězdných bran.';
  assert.deepEqual(parseGates(t), { price: 11_049_667, count: 22, remainingSec: 56, naq: 116_319_547 });
  assert.equal(parseGates('Další změna bude za 1 minutu 5 sekund.').remainingSec, 65);
  assert.equal(parseGates('nic').price, null);
});

import { stripSecrets, mergeProfileConfig } from '../src/profiles.js';
test('kupování bran se nesdílí v profilu a načtení profilu ho nezapne', () => {
  const local = structuredClone(DEFAULTS); local.gates.enabled = false;
  const mine = structuredClone(DEFAULTS); mine.gates.enabled = true;
  assert.equal(stripSecrets(mine).gates.enabled, false, 'do profilu se zapnuto neuloží');
  const profile = structuredClone(DEFAULTS); profile.gates.enabled = true; profile.gates.maxPrice = 3_000_000;
  const merged = mergeProfileConfig(local, profile);
  assert.equal(merged.gates.enabled, false, 'profil kupování nezapne');
  assert.equal(merged.gates.maxPrice, 3_000_000, 'ostatní nastavení bran se z profilu přebírá');
  const on = structuredClone(DEFAULTS); on.gates.enabled = true;
  assert.equal(mergeProfileConfig(on, profile).gates.enabled, true, 'co si uživatel zapnul sám, profil nevypne');
});
