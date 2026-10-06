import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { sanitizeUpdate, DEFAULTS, applyMyRace } from '../src/config.js';

const base = () => {
  const c = structuredClone(DEFAULTS);
  c.races = { 20: { name: 'Bedrosian', mode: 'all', threshold: null, criticalPct: null }, 7: { name: 'Vyvrhel', mode: 'all', threshold: null, criticalPct: null } };
  c.players = {
    Skip: { watch: false },
    Vip: { watch: true, threshold: 500 },
    Other: { watch: false }, // z jiné rasy
    OnlyTh: { threshold: 42 },
  };
  return c;
};
const ctx = { playersOfRace: (id) => (id === '20' ? ['Skip', 'Vip', 'OnlyTh'] : ['Other']) };

test('změna režimu rasy smaže výjimky "hlídat" jejích hráčů, vlastní prahy nechá', () => {
  const next = sanitizeUpdate(base(), { races: { 20: { mode: 'selected' } } }, ctx);
  assert.equal(next.races[20].mode, 'selected');
  assert.equal(next.players.Skip, undefined);
  assert.deepEqual(next.players.Vip, { threshold: 500 });
  assert.deepEqual(next.players.OnlyTh, { threshold: 42 });
  assert.deepEqual(next.players.Other, { watch: false }); // jiná rasa se nedotkne
});

test('stejný režim nic nemaže', () => {
  const next = sanitizeUpdate(base(), { races: { 20: { mode: 'all' } } }, ctx);
  assert.deepEqual(next.players.Skip, { watch: false });
});

test('změna režimu a zároveň výjimky hráče v jednom požadavku: nejdřív se smaže staré, pak platí nové', () => {
  const next = sanitizeUpdate(base(), { races: { 20: { mode: 'selected' } }, players: { Newbie: { watch: true } } }, ctx);
  assert.deepEqual(next.players.Newbie, { watch: true });
  assert.equal(next.players.Skip, undefined);
});

test('konfigurace uložená s BOM (Poznámkový blok, PowerShell) se načte', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'sgn-bom-'));
  writeFileSync(join(dir, 'config.json'), '﻿{"token":"t1","threshold":77}');
  const out = execFileSync(process.execPath, ['-e', "import('./src/config.js').then(m => { const c = m.loadConfig(); console.log(c.token, c.threshold); })"], {
    env: { ...process.env, SG_DATA_DIR: dir }, cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8',
  });
  assert.equal(out.trim(), 't1 77');
});

test('notify: výchozí zapnuto, jde vypnout a zapnout', () => {
  assert.equal(DEFAULTS.notify, true);
  const off = sanitizeUpdate(base(), { notify: false }, ctx);
  assert.equal(off.notify, false);
  assert.equal(sanitizeUpdate(off, { notify: true }, ctx).notify, true);
  assert.equal(sanitizeUpdate(off, { threshold: 5 }, ctx).notify, false); // jiná změna ho nezmění
});

test('notifyTypes: vypnutý druh se uloží jako false, zapnutý se smaže, neznámé druhy se ignorují', () => {
  const off = sanitizeUpdate(base(), { notifyTypes: { threshold: false, op: false, nesmysl: false } }, ctx);
  assert.deepEqual(off.notifyTypes, { threshold: false, op: false });
  const back = sanitizeUpdate(off, { notifyTypes: { threshold: true } }, ctx);
  assert.deepEqual(back.notifyTypes, { op: false });
  assert.deepEqual(sanitizeUpdate(back, { threshold: 5 }, ctx).notifyTypes, { op: false });
});

test('naše rasa: vybraná rasa je defend, všechny ostatní attack; role z těla se při vybrané rase ignorují', () => {
  const a = sanitizeUpdate(base(), { myRace: '20' }, ctx);
  assert.equal(a.myRace, '20');
  assert.equal(a.races[20].role, 'defend');
  assert.equal(a.races[7].role, 'attack');
  // přepnutí naší rasy otočí role
  const b = sanitizeUpdate(a, { myRace: '7' }, ctx);
  assert.deepEqual([b.races[20].role, b.races[7].role], ['attack', 'defend']);
  // ruční změna role je při vybrané rase ignorována
  const c = sanitizeUpdate(b, { races: { 20: { role: 'defend' } } }, ctx);
  assert.equal(c.races[20].role, 'attack');
  // neznámá rasa se nepřijme, prázdná zruší výběr (role zůstanou)
  assert.equal(sanitizeUpdate(b, { myRace: '999' }, ctx).myRace, '7');
  assert.equal(sanitizeUpdate(b, { myRace: '' }, ctx).myRace, '');
});

test('naše rasa: applyMyRace bez vybrané rasy nic nemění', () => {
  const c = base(); c.races[20].role = 'defend'; c.races[7].role = 'defend';
  applyMyRace(c);
  assert.deepEqual([c.races[20].role, c.races[7].role], ['defend', 'defend']);
});

test('hranice k dobytí zvlášť pro rasu: vlastní hodnoty, prázdné = společné, konec nikdy pod začátkem', () => {
  const a = sanitizeUpdate(base(), { races: { 7: { conquest: { below: 5_000_000, above: 8_000_000 } } } }, ctx);
  assert.deepEqual(a.races[7].conquest, { below: 5_000_000, above: 8_000_000 });
  const b = sanitizeUpdate(a, { races: { 7: { conquest: { above: 1_000_000 } } } }, ctx); // konec pod začátkem se srovná
  assert.deepEqual(b.races[7].conquest, { below: 5_000_000, above: 5_000_000 });
  const c = sanitizeUpdate(b, { races: { 7: { conquest: { below: '' } } } }, ctx); // smazání jedné hodnoty
  assert.deepEqual(c.races[7].conquest, { above: 5_000_000 });
  const d = sanitizeUpdate(c, { races: { 7: { conquest: { above: null } } } }, ctx); // smazány obě = zpět na společné
  assert.equal(d.races[7].conquest, undefined);
  assert.equal(sanitizeUpdate(a, { races: { 7: { conquest: null } } }, ctx).races[7].conquest, undefined);
});
