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
