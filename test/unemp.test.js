import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUnemp, parseAvail } from '../src/unemp.js';

test('nezaměstnaní: „zbývá“ v milionech, tisících i bez jednotky', () => {
  assert.equal(parseAvail('Doplnit [zbývá: 17 892 miliónů] lidí'), 17_892_000_000);
  assert.equal(parseAvail('zbývá: 350 tisíc'), 350_000);
  assert.equal(parseAvail('zbývá: 0'), 0);
  assert.equal(parseAvail('nic'), null);
});

test('nezaměstnaní: celé kolo – seřadit, poslední červená, přesunout, zpět, další, konec když nic nechybí', () => {
  const u = createUnemp();
  assert.equal(u.report({ page: 'list', sorted: true, last: { name: 'A', missing: 5 } }, 0).action, 'idle', 'neběží');
  u.start(0);
  assert.equal(u.report({ page: 'list', sorted: false, last: null }, 1).action, 'sort');
  assert.deepEqual(u.report({ page: 'list', sorted: true, last: { name: 'I4X', missing: 289 } }, 2), { action: 'open', name: 'I4X' });
  assert.equal(u.report({ page: 'planet', name: 'JINA', need: 5, avail: 1000 }, 3).action, 'idle', 'cizí planeta');
  assert.deepEqual(u.report({ page: 'planet', name: 'I4X', need: 289, avail: 1000 }, 4), { action: 'move', name: 'I4X' });
  assert.equal(u.report({ page: 'moved', name: 'I4X' }, 5).action, 'back');
  // seznam z mezipaměti ještě ukazuje I4X -> obnovit
  assert.equal(u.report({ page: 'list', sorted: true, last: { name: 'I4X', missing: 289 } }, 6).action, 'reload');
  assert.deepEqual(u.report({ page: 'list', sorted: true, last: { name: 'Y2A', missing: 286 } }, 7), { action: 'open', name: 'Y2A' });
  u.report({ page: 'planet', name: 'Y2A', need: 286, avail: 711 }, 8);
  u.report({ page: 'moved', name: 'Y2A' }, 9);
  const end = u.report({ page: 'list', sorted: true, last: { name: 'K1', missing: 0 } }, 10);
  assert.equal(end.action, 'idle');
  assert.match(end.summary, /všechny planety mají dost lidí.*Doplněno 2 planet \(I4X, Y2A\)/);
  assert.equal(u.snapshot().status, 'finished');
  assert.equal(u.snapshot().moved, 289 + 286);
});

test('nezaměstnaní: „zbývá“ nestačí na celou planetu -> hra doplní, co je, a běh skončí (na další planetu už nejde)', () => {
  const u = createUnemp();
  u.start(0);
  u.report({ page: 'list', sorted: true, last: { name: 'A', missing: 500 } }, 1);
  assert.equal(u.report({ page: 'planet', name: 'A', need: 500, avail: 200 }, 2).action, 'move');
  const r = u.report({ page: 'moved', name: 'A' }, 3);
  assert.equal(r.action, 'idle');
  assert.match(r.summary, /nezaměstnaní došli/);
  assert.equal(u.snapshot().moved, 200);
});

test('nezaměstnaní: „zbývá“ chybí nebo je 0 -> hned konec, nic se nepřesune', () => {
  for (const avail of [0, null]) {
    const u = createUnemp();
    u.start(0);
    u.report({ page: 'list', sorted: true, last: { name: 'A', missing: 500 } }, 1);
    const r = u.report({ page: 'planet', name: 'A', need: 500, avail }, 2);
    assert.equal(r.action, 'idle');
    assert.match(r.summary, /nezbývají žádní nezaměstnaní/);
  }
});

test('nezaměstnaní: ruční zastavení a zastavení, když skript přestane hlásit', () => {
  const u = createUnemp();
  u.start(0);
  assert.match(u.stop(1), /zastaveno ručně/);
  assert.equal(u.report({ page: 'list', sorted: true, last: { name: 'A', missing: 5 } }, 2).action, 'idle');
  u.start(10);
  assert.equal(u.staleCheck(60_000), null);
  assert.match(u.staleCheck(200_000), /přestal hlásit/);
});

test('doplňování s omezením obřích planet: poslední planeta v seznamu, která není obří; bez omezení platí poslední řádek', () => {
  const mk = (name, cities, people, missing) => ({ name, cities, people, unemployed: 0, free: 0, missing });
  const rows = [mk('A', 100, 1e8, 5e7), mk('B', 150, 2e8, 9e7), mk('OBR1', 3000, 13e9, 25e9), mk('OBR2', 3000, 13e9, 25.3e9)];
  const u = createUnemp(); u.start(0, { ignoreCities: 500 });
  assert.equal(u.report({ page: 'list', sorted: true, last: { name: 'OBR2', missing: 25.3e9 } }, 1).action, 'send-rows', 'potřebuje celou tabulku');
  const open = u.report({ page: 'list', sorted: true, last: { name: 'OBR2', missing: 25.3e9 }, rows }, 2);
  assert.deepEqual([open.action, open.name], ['open', 'B'], 'obří planety se přeskočí');
  assert.match(u.snapshot().log.map((l) => l.msg).join('\n'), /Obří planety se přeskakují/);
  const plain = createUnemp(); plain.start(0);
  const o2 = plain.report({ page: 'list', sorted: true, last: { name: 'OBR2', missing: 25.3e9 } }, 1);
  assert.deepEqual([o2.action, o2.name], ['open', 'OBR2'], 'bez omezení beze změny');
  const none = createUnemp(); none.start(0, { ignorePeopleM: 1000 });
  const r3 = none.report({ page: 'list', sorted: true, last: { name: 'X', missing: 1 }, rows: [mk('OBR', 3000, 13e9, 25e9)] }, 1);
  assert.equal(r3.action, 'idle'); assert.match(none.snapshot().reason, /všechny planety mají dost lidí/);
});

test('doplňování: přednostně planety bez lidí, i když nejsou na konci seznamu; bez volby platí poslední řádek', () => {
  const mk = (name, people, missing) => ({ name, cities: 100, people, unemployed: 0, free: 0, missing });
  const rows = [mk('PRAZDNA', 0, 4e7), mk('B', 2e8, 9e7), mk('C', 3e8, 2e8)];
  const u = createUnemp(); u.start(0, { prioEmpty: true });
  assert.equal(u.report({ page: 'list', sorted: true, last: { name: 'C', missing: 2e8 } }, 1).action, 'send-rows');
  const open = u.report({ page: 'list', sorted: true, last: { name: 'C', missing: 2e8 }, rows }, 2);
  assert.deepEqual([open.action, open.name], ['open', 'PRAZDNA']);
  assert.match(u.snapshot().log.map((l) => l.msg).join('\n'), /Přednostně planety bez lidí \(1\)/);
  const plain = createUnemp(); plain.start(0);
  assert.equal(plain.report({ page: 'list', sorted: true, last: { name: 'C', missing: 2e8 } }, 1).name, 'C');
  const none = createUnemp(); none.start(0, { prioEmpty: true }); // žádná prázdná: normálně poslední
  assert.equal(none.report({ page: 'list', sorted: true, last: { name: 'C', missing: 2e8 }, rows: rows.slice(1) }, 1).name, 'C');
});
