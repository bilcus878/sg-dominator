import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, sleep } from './ui/harness.mjs';

const TOKEN = 'testtoken';
const raw = (app, path, method = 'POST', body = {}) => fetch(app.base + path, { method, headers: { 'x-token': TOKEN, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body) }).then((r) => r.json());

test('statistika dohozů: ruční dohoz od pádu pod práh po návrat se zapíše s časy a jde filtrovat; mazání a vypnutí fungují', async () => {
  const app = await startApp();
  try {
    const p = (bob) => [{ name: 'Bob', power: bob, planets: 50 }, { name: 'Eva', power: 500_000_000, planets: 50 }];
    await app.ingest(20, 'Bedrosian', p(300_000_000));
    await app.api('/api/config', 'PUT', { myRace: '20', races: { 20: { mode: 'all', threshold: 100_000_000 } } });
    await app.ingest(20, 'Bedrosian', p(300_000_000));
    await sleep(300);
    await app.ingest(20, 'Bedrosian', p(60_000_000)); // pád pod práh
    await sleep(400);
    await raw(app, '/army/poll?short=1', 'POST', { inst: 'a' }); // stránka Rasová armáda je „otevřená“
    const rq = await app.api('/api/army', 'POST', { name: 'Bob' }); // tlačítko Dohodit
    assert.equal(rq.ok, true);
    const send = await raw(app, '/army/poll?short=1', 'POST', { inst: 'a' });
    assert.equal(send.action, 'send');
    await sleep(250);
    await raw(app, '/army/report', 'POST', { id: send.id, ok: true }); // skript odeslal
    await sleep(300);
    await app.ingest(20, 'Bedrosian', p(160_000_000)); // dohoz zabral, hráč je nad prahem
    let st = await app.api('/api/stats');
    assert.equal(st.open.length, 1, 'rozdělaná epizoda je vidět');
    assert.equal(st.open[0].source, 'manual');
    await sleep(4500); // po návratu nad práh se epizoda sama ukončí
    st = await app.api('/api/stats');
    assert.equal(st.episodes.length, 1);
    const e = st.episodes[0];
    assert.equal(e.name, 'Bob'); assert.equal(e.source, 'manual'); assert.equal(e.outcome, 'done');
    assert.ok(e.fallAt > 0 && e.firstSendMs >= 500 && e.firstSendMs < 5000, `první odeslání ${e.firstSendMs}`);
    assert.ok(e.belowMs >= e.firstSendMs, 'pod prahem byl aspoň do odeslání');
    assert.equal(e.rounds[0].powerBefore, 60_000_000); assert.equal(e.rounds[0].gain, 100_000_000); assert.equal(e.rounds[0].status, 'ok');
    assert.ok(e.rounds[0].sendMs >= 200 && e.rounds[0].effectMs >= 200);
    assert.equal(st.summary.episodes, 1); assert.equal(st.summary.manual, 1); assert.equal(st.summary.auto, 0);
    // filtry
    assert.equal((await app.api('/api/stats?source=auto')).episodes.length, 0);
    assert.equal((await app.api('/api/stats?source=manual&name=bo')).episodes.length, 1);
    assert.equal((await app.api('/api/stats?outcome=bad')).episodes.length, 0);
    assert.equal((await app.api('/api/stats?slow=60')).episodes.length, 0);
    assert.ok((await app.api('/api/state')).statsRev > 0, 'rozhraní ví, že se statistika změnila');
    // vypnutí statistiky: nic dalšího se nezapisuje
    await app.api('/api/config', 'PUT', { dohozStats: { enabled: false, keep: 5 } });
    const cfg = await app.api('/api/config'); assert.deepEqual(cfg.dohozStats, { enabled: false, keep: 20 }, 'minimum je 20');
    await app.api('/api/stats', 'DELETE');
    assert.equal((await app.api('/api/stats')).episodes.length, 0);
  } finally { app.stop(); }
});

test('statistika dohozů: auto-dohoz se zapíše jako „auto“ a nezabralý dohoz po obnovení stránky se označí', async () => {
  const app = await startApp();
  try {
    const p = (bob) => [{ name: 'Bob', power: bob, planets: 50 }, { name: 'Eva', power: 500_000_000, planets: 50 }];
    await app.ingest(20, 'Bedrosian', p(300_000_000));
    await app.api('/api/config', 'PUT', { myRace: '20', races: { 20: { mode: 'all', threshold: 100_000_000 } }, army: { auto: { enabled: true, minSec: 0.2, maxSec: 0.3, quietMinSec: 0, quietMaxSec: 0 } } });
    await app.ingest(20, 'Bedrosian', p(300_000_000));
    await sleep(200);
    await app.ingest(20, 'Bedrosian', p(60_000_000));
    await sleep(500); // dvě čtení pod prahem po sobě (od sebe aspoň 400 ms)
    let sent = null;
    for (let i = 0; i < 40 && !sent; i++) { await app.ingest(20, 'Bedrosian', p(60_000_000)); const r = await raw(app, '/army/poll?short=1', 'POST', { inst: 'a' }); if (r.action === 'send') sent = r; else await sleep(200); }
    assert.ok(sent, 'auto-dohoz zadal požadavek');
    await sleep(200);
    await raw(app, '/army/report', 'POST', { id: sent.id, ok: true });
    // dohoz nezabral: po ~2,5 s auto-dohoz nechá stránku obnovit
    let reload = null;
    for (let i = 0; i < 40 && !reload; i++) { await app.ingest(20, 'Bedrosian', p(60_000_000)); const r = await raw(app, '/army/poll?short=1', 'POST', { inst: 'a' }); if (r.action === 'reload') reload = r; else await sleep(200); }
    assert.ok(reload, 'po nezabraném dohozu přišel pokyn k obnovení stránky');
    const st = await app.api('/api/stats');
    const ep = [...st.open, ...st.episodes].find((e) => e.name === 'Bob');
    assert.equal(ep.source, 'auto'); assert.equal(ep.rounds[0].reloaded, true);
    assert.ok(ep.firstSendMs > 0 && ep.fallAt > 0);
  } finally { app.stop(); }
});
