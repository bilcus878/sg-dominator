import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { sanitizeUpdate, DEFAULTS } from '../src/config.js';

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
