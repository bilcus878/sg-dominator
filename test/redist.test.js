import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRedist, pickSources, pickTargets, acceptance, REDIST_DEFAULTS } from '../src/redist.js';

const M = 1e6;
const row = (name, people, unemployed, free) => ({ name, cities: 100, people: people * M, unemployed: unemployed * M, free: free * M });
const S = { ...REDIST_DEFAULTS, dry: false };

test('zdroje: nezaměstnaných 100–300 mil. a plná planeta (zbývá 0); největší první; hotové se přeskočí', () => {
  const rows = [row('A', 5000, 250, 0), row('B', 5000, 150, 0), row('C', 5000, 150, 20), row('D', 5000, 50, 0), row('E', 5000, 350, 0), row('F', 100, 200, 0)];
  assert.deepEqual(pickSources(rows, S).map((r) => r.name), ['A', 'F', 'B']);
  assert.deepEqual(pickSources(rows, S, new Set(['A'])).map((r) => r.name), ['F', 'B']);
  assert.deepEqual(pickSources(rows, { ...S, minM: 50, freeMaxM: 25 }).map((r) => r.name), ['A', 'F', 'B', 'C', 'D']);
});

test('cíle: vejde se celý přesun a po něm zůstane lidí ≤ zbývá míst; největší rezerva první; jen planety z nabídky', () => {
  const rows = [row('S', 5000, 250, 0), row('T1', 100, 0, 700), row('T2', 300, 0, 400), row('T3', 650, 0, 700), row('T4', 50, 0, 120)];
  assert.equal(acceptance(rows[1]), 300 * M); // (700 − 100) / 2
  assert.deepEqual(pickTargets(rows, 'S', 250 * M).map((r) => r.name), ['T1']); // T2: (400−300)/2 = 50, T3: 25, T4: 35 – nevejde se
  assert.deepEqual(pickTargets(rows, 'S', 40 * M).map((r) => r.name), ['T1', 'T2']);
  assert.deepEqual(pickTargets(rows, 'S', 40 * M, new Set(['T2'])).map((r) => r.name), ['T2'], 'jen planety z nabídky');
  assert.deepEqual(pickTargets(rows, 'S', 400 * M), [], 'nikam se nevejde celý přesun');
});

const rowsOk = () => [row('SRC', 5000, 280, 0), row('T1', 100, 0, 900), row('T2', 400, 0, 500), row('X', 5000, 20, 0)];

test('běh: seřadit -> poslat tabulku -> otevřít zdroj -> vybrat cíl -> přesunout -> zpět -> konec, když nic dalšího nesplňuje podmínky', () => {
  const r = createRedist();
  assert.deepEqual(r.report({ page: 'list', sorted: true }, 0), { action: 'idle' }, 'neběží');
  assert.equal(r.start(S, 1), true);
  assert.equal(r.start(S, 1), false);
  assert.equal(r.report({ page: 'list', sorted: false }, 2).action, 'sort');
  assert.equal(r.report({ page: 'list', sorted: true }, 3).action, 'send-rows');
  const open = r.report({ page: 'list', sorted: true, rows: rowsOk() }, 4);
  assert.deepEqual([open.action, open.name], ['open', 'SRC']);
  assert.deepEqual(r.report({ page: 'planet', name: 'CIZI', count: 280 * M, options: ['T1'] }, 5), { action: 'idle' });
  const mv = r.report({ page: 'planet', name: 'SRC', count: 280 * M, options: ['SRC', 'T1', 'T2'] }, 6);
  assert.deepEqual([mv.action, mv.target], ['move', 'T1']); // T1: (900−100)/2 = 400 mil. rezerva > T2: 50
  assert.equal(r.report({ page: 'moved', name: 'SRC' }, 7).action, 'back');
  // čerstvý seznam: SRC je vyřízený, X má 20 mil. (pod hranicí) -> konec
  const fresh = [row('SRC', 5000, 0, 0), row('T1', 380, 0, 620), row('T2', 400, 0, 500), row('X', 5000, 20, 0)];
  const end = r.report({ page: 'list', sorted: true, rows: fresh }, 8);
  assert.equal(end.action, 'idle');
  assert.match(end.summary, /Přesunuto 1× \(280 mil\./);
  const snap = r.snapshot();
  assert.deepEqual([snap.status, snap.count, snap.movedTotal], ['finished', 1, 280 * M]);
});

test('seznam po návratu z mezipaměti ukazuje starou hodnotu: znovu se načte (nejvýš 3×), pak chyba', () => {
  const r = createRedist(); r.start(S, 0);
  r.report({ page: 'list', sorted: true, rows: rowsOk() }, 1);
  r.report({ page: 'planet', name: 'SRC', count: 280 * M, options: ['T1'] }, 2);
  r.report({ page: 'moved', name: 'SRC' }, 3);
  for (let i = 0; i < 3; i++) assert.equal(r.report({ page: 'list', sorted: true, rows: rowsOk() }, 4 + i).action, 'reload');
  const e = r.report({ page: 'list', sorted: true, rows: rowsOk() }, 8);
  assert.equal(e.action, 'idle'); assert.equal(r.snapshot().status, 'error');
});

test('planeta bez vhodného cíle nebo s málo lidmi k přesunu se přeskočí a běh jde dál', () => {
  const r = createRedist(); r.start(S, 0);
  const rows = [row('A', 5000, 290, 0), row('B', 5000, 200, 0), row('T', 100, 0, 150)]; // cíl T přijme jen 25 mil.
  assert.equal(r.report({ page: 'list', sorted: true, rows }, 1).name, 'A');
  assert.equal(r.report({ page: 'planet', name: 'A', count: 290 * M, options: ['T'] }, 2).action, 'back'); // nikam se nevejde
  assert.equal(r.report({ page: 'list', sorted: true, rows }, 3).name, 'B', 'A se už neotvírá');
  assert.equal(r.report({ page: 'planet', name: 'B', count: 60 * M, options: ['T'] }, 4).action, 'back'); // jen 60 mil. (pod minimem)
  const end = r.report({ page: 'list', sorted: true, rows }, 5);
  assert.equal(end.action, 'idle'); assert.equal(r.snapshot().count, 0); assert.equal(r.snapshot().skipped, 2);
});

test('zkušební běh: plán se vypíše, nic se neposílá (žádná akce move) a každý zdroj se vyřídí jednou', () => {
  const r = createRedist(); r.start({ ...S, dry: true }, 0);
  const rows = [row('A', 5000, 290, 0), row('B', 5000, 150, 0), row('T1', 100, 0, 900), row('T2', 100, 0, 900)];
  assert.equal(r.report({ page: 'list', sorted: true, rows }, 1).name, 'A');
  assert.equal(r.report({ page: 'planet', name: 'A', count: 290 * M, options: ['T1', 'T2'] }, 2).action, 'back');
  assert.equal(r.report({ page: 'list', sorted: true, rows }, 3).name, 'B');
  assert.equal(r.report({ page: 'planet', name: 'B', count: 150 * M, options: ['T1', 'T2'] }, 4).action, 'back');
  const end = r.report({ page: 'list', sorted: true, rows }, 5);
  assert.match(end.summary, /Přesunul bych 2×/);
  assert.equal(r.snapshot().dry, true);
});

test('pojistky: maximum přesunů, ruční zastavení a nečinný skript', () => {
  const r = createRedist(); r.start({ ...S, maxMoves: 1 }, 0);
  const rows = [row('A', 5000, 290, 0), row('B', 5000, 150, 0), row('T', 100, 0, 2000)];
  r.report({ page: 'list', sorted: true, rows }, 1);
  r.report({ page: 'planet', name: 'A', count: 290 * M, options: ['T'] }, 2);
  const end = r.report({ page: 'moved', name: 'A' }, 3);
  assert.match(end.summary, /pojistka: 1 přesunů/);
  const s = createRedist(); s.start(S, 0);
  assert.match(s.stop(5), /zastaveno ručně/);
  assert.equal(s.report({ page: 'list', sorted: true }, 6).action, 'idle');
  const t = createRedist(); t.start(S, 0);
  assert.equal(t.staleCheck(60_000), null);
  assert.match(t.staleCheck(130_000), /přestal hlásit/);
});

import { isGiant } from '../src/redist.js';
test('obří planety: víc měst nebo lidí, než je nastaveno, se nepoužijí jako cíl; 0 = bez omezení', () => {
  const big = { name: 'OBR', cities: 3000, people: 13_000 * M, free: 25_000 * M, unemployed: 0 };
  const small = { name: 'MALA', cities: 120, people: 100 * M, free: 700 * M, unemployed: 0 };
  assert.equal(isGiant(big, {}), false);
  assert.equal(isGiant(big, { ignoreCities: 500 }), true);
  assert.equal(isGiant(big, { ignorePeopleM: 5000 }), true);
  assert.equal(isGiant(small, { ignoreCities: 500, ignorePeopleM: 5000 }), false);
  assert.deepEqual(pickTargets([big, small], 'S', 100 * M).map((r) => r.name), ['OBR', 'MALA'], 'bez omezení vede obří planeta (největší rezerva)');
  assert.deepEqual(pickTargets([big, small], 'S', 100 * M, null, { ignoreCities: 500 }).map((r) => r.name), ['MALA']);
  // celý běh: cíl je ten malý, obří se přeskočí
  const r = createRedist(); r.start({ ...S, ignoreCities: 500 }, 0);
  const rows = [row('SRC', 5000, 200, 0), { ...big }, { ...small }];
  r.report({ page: 'list', sorted: true, rows }, 1);
  const mv = r.report({ page: 'planet', name: 'SRC', count: 200 * M, options: ['OBR', 'MALA'] }, 2);
  assert.deepEqual([mv.action, mv.target], ['move', 'MALA']);
});

test('přednostně planety bez lidí: při zapnutí se naplní jako první (i když jiná planeta má větší rezervu); bez zapnutí vede největší rezerva', () => {
  const rows = [row('S', 5000, 200, 0), row('MA_LIDI', 100, 0, 2000), row('PRAZDNA', 0, 0, 800)];
  assert.deepEqual(pickTargets(rows, 'S', 100 * M).map((r) => r.name), ['MA_LIDI', 'PRAZDNA']);
  assert.deepEqual(pickTargets(rows, 'S', 100 * M, null, { prioEmpty: true }).map((r) => r.name), ['PRAZDNA', 'MA_LIDI']);
  const r = createRedist(); r.start({ ...S, prioEmpty: true }, 0);
  r.report({ page: 'list', sorted: true, rows }, 1);
  assert.equal(r.report({ page: 'planet', name: 'S', count: 200 * M, options: ['MA_LIDI', 'PRAZDNA'] }, 2).target, 'PRAZDNA');
});
