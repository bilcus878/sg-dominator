import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './ui/harness.mjs';

const TOKEN = 'testtoken';
const M = 1e6;
const rep = (app, body) => fetch(app.base + '/unemp/report', { method: 'POST', headers: { 'x-token': TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const row = (name, people, unemployed, free) => ({ name, cities: 100, people: people * M, unemployed: unemployed * M, free: free * M });

test('přerozdělení nezaměstnaných přes server: nastavení, spuštění, hlášení skriptu, zákaz souběhu s doplňováním, konec se shrnutím', async () => {
  const app = await startApp();
  try {
    const cfg = await app.api('/api/config', 'PUT', { redist: { minM: 120, maxM: 50, freeMaxM: 0, maxMoves: 5, dry: false } });
    assert.equal(cfg.redist.minM, 120); assert.equal(cfg.redist.maxM, 120, 'horní hranice nikdy pod dolní'); assert.equal(cfg.redist.dry, false);
    assert.deepEqual(await rep(app, { page: 'list', sorted: true }), { action: 'idle' }, 'bez spuštění nic');
    const st = await app.api('/api/redist/start', 'POST');
    assert.equal(st.status, 'running');
    const clash = await fetch(app.base + '/api/unemp/start', { method: 'POST', headers: { 'x-token': TOKEN } });
    assert.equal(clash.status, 409, 'doplňování se nespustí, když běží přerozdělení');
    assert.equal((await rep(app, { page: 'list', sorted: false })).action, 'sort');
    assert.equal((await rep(app, { page: 'list', sorted: true })).action, 'send-rows');
    const rows = [row('SRC', 5000, 120, 0), row('T1', 100, 0, 900), row('X', 5000, 20, 0)];
    const open = await rep(app, { page: 'list', sorted: true, rows });
    assert.deepEqual([open.action, open.name], ['open', 'SRC']);
    const mv = await rep(app, { page: 'planet', name: 'SRC', count: 120 * M, options: ['SRC', 'T1'] });
    assert.deepEqual([mv.action, mv.target], ['move', 'T1']);
    assert.equal((await rep(app, { page: 'moved', name: 'SRC' })).action, 'back');
    const end = await rep(app, { page: 'list', sorted: true, rows: [row('SRC', 5000, 0, 0), row('T1', 220, 0, 780), row('X', 5000, 20, 0)] });
    assert.equal(end.action, 'idle');
    const snap = await app.api('/api/redist');
    assert.deepEqual([snap.status, snap.count, snap.movedTotal], ['finished', 1, 120 * M]);
    // po skončení jde zase spustit doplňování
    assert.equal((await app.api('/api/unemp/start', 'POST')).status, 'running');
    await app.api('/api/unemp/stop', 'POST');
  } finally { app.stop(); }
});

test('přerozdělení: zkušební běh je ve výchozím nastavení zapnutý a nic neposílá', async () => {
  const app = await startApp();
  try {
    const cfg = await app.api('/api/config');
    assert.equal(cfg.redist.dry, true); assert.equal(cfg.redist.minM, 100); assert.equal(cfg.redist.maxM, 300);
    await app.api('/api/redist/start', 'POST');
    await rep(app, { page: 'list', sorted: true, rows: [row('A', 5000, 200, 0), row('T', 100, 0, 900)] });
    const r = await rep(app, { page: 'planet', name: 'A', count: 200 * M, options: ['T'] });
    assert.equal(r.action, 'back', 'zkušebně se nic nepřesouvá');
    const snap = await app.api('/api/redist');
    assert.equal(snap.dry, true); assert.equal(snap.moves[0].dry, true); assert.match(snap.log.map((l) => l.msg).join('\n'), /A → T/);
  } finally { app.stop(); }
});
