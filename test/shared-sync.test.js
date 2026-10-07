import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, sleep } from './ui/harness.mjs';
import { buildShared, writeShared, sharedFileName } from '../src/shared-data.js';

test('sdílení mezi počítači: aplikace načte data z cizího souboru, zapíše svůj a náhrobek vymaže cizí záznamy', async () => {
  const pdir = mkdtempSync(join(tmpdir(), 'sgd-shared-int-'));
  const t = new Date(2026, 9, 6, 14, 0, 0).getTime();
  const now = Date.now();
  // „druhý počítač“ nasbíral přepočet hráče Bob
  writeShared(pdir, sharedFileName('KAMARAD'), buildShared('KAMARAD', { '4|Bob': { at: now - 3_600_000, hour: new Date(now - 3_600_000).getHours(), history: [now - 3_600_000] } }, { '4|Eva': { events: [{ at: now - 7_200_000, popGain: 500, online: true, colon: 3, planetsBefore: 40 }] } }, { military: 0, economic: 0 }, now));
  const app = await startApp({ profilesDir: pdir, host: 'MUJ' });
  try {
    await app.api('/api/recalc/sync', 'POST', {});
    const st = await app.api('/api/state');
    assert.equal(st.recalcStats.military, 1); assert.equal(st.recalcStats.economic, 1);
    assert.equal(st.shared.on, true); assert.equal(st.shared.files, 2);
    const own = join(pdir, sharedFileName('MUJ'));
    assert.ok(existsSync(own), 'vlastní soubor je zapsaný');
    assert.ok(JSON.parse(readFileSync(own, 'utf8')).recalc['4|Bob'], 'vlastní soubor obsahuje i převzatá data (rozšíří se dál)');
    // vypnuté sdílení nic nečte ani nezapisuje
    await app.api('/api/config', 'PUT', { recalc: { shared: false } });
    assert.equal((await app.api('/api/state')).shared.on, false);
    await app.api('/api/config', 'PUT', { recalc: { shared: true } });
    // nový věk: vymazání vojenských přepočtů se přenese náhrobkem a cizí starší záznam se už nevrátí
    await app.api('/api/recalc/military', 'DELETE');
    await sleep(100);
    await app.api('/api/recalc/sync', 'POST', {});
    const after = await app.api('/api/state');
    assert.equal(after.recalcStats.military, 0, 'vymazané se po sloučení s cizím souborem nevrátí');
    assert.equal(after.recalcStats.economic, 1, 'ekonomické zůstaly');
    assert.ok(JSON.parse(readFileSync(own, 'utf8')).clearedAt.military > 0);
  } finally { app.stop(); rmSync(pdir, { recursive: true, force: true }); }
});

test('stop.cmd: /api/share/stop jde volat bez tokenu z počítače; vypnuté odesílání se přeskočí, mimo git repozitář vrátí srozumitelnou chybu', async () => {
  const pdir = mkdtempSync(join(tmpdir(), 'sgd-stop-'));
  const app = await startApp({ profilesDir: pdir, host: 'STOP' });
  try {
    await app.api('/api/recalc/sync', 'POST', {});
    const raw = (path) => fetch(app.base + path, { method: 'POST' }).then((r) => r.json());
    const r1 = await raw('/api/share/stop'); // stejně jako ho volá stop.ps1: bez hlaviček
    assert.equal(r1.ok, false); assert.match(r1.error, /git/i, 'dočasná složka není repozitář');
    await app.api('/api/config', 'PUT', { recalc: { pushOnStop: false } });
    assert.deepEqual(await raw('/api/share/stop'), { ok: true, skipped: true });
    const r2 = await raw('/api/share/push'); // tlačítko v Nastavení funguje i při vypnutém odesílání při zastavení
    assert.equal(r2.ok, false);
  } finally { app.stop(); rmSync(pdir, { recursive: true, force: true }); }
});

test('Zavřít aplikaci z rozhraní: odešle data (když jde), zapíše značku pro hlídače a server se ukončí', async () => {
  const pdir = mkdtempSync(join(tmpdir(), 'sgd-shut-'));
  const app = await startApp({ profilesDir: pdir, host: 'SHUT' });
  try {
    const r = await app.api('/api/shutdown', 'POST', {});
    assert.equal(r.ok, true);
    assert.ok(r.share && (r.share.ok === false || r.share.skipped || r.share.ok === true), 'výsledek odeslání dat je součástí odpovědi');
    await sleep(1500);
    let alive = true; try { await fetch(app.base + '/api/state'); } catch { alive = false; }
    assert.equal(alive, false, 'server po zavření neodpovídá');
    assert.ok(existsSync(join(app.dir, 'hlidac.stop')), 'hlídač dostal značku, ať server nespouští znovu');
  } finally { app.stop(); rmSync(pdir, { recursive: true, force: true }); }
});
