import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../userscript/stargate-prihlaseni.user.js', import.meta.url), 'utf8');
const maintenanceWaitMs = new Function(`${src.match(/\/\/ <maint>([\s\S]*?)\/\/ <\/maint>/)[1]}; return maintenanceWaitMs;`)();
const EXPIRED_RE = new Function(`${src.match(/const EXPIRED_RE = .*?;/)[0]}; return EXPIRED_RE;`)();

const at = (h, m, s = 0) => new Date(2026, 9, 6, h, m, s);

test('údržba 3:00:00–3:31: čeká se do 3:31:20, jinak se nečeká', () => {
  assert.equal(maintenanceWaitMs(at(12, 0)), 0);
  assert.equal(maintenanceWaitMs(at(2, 56)), 0);
  assert.equal(maintenanceWaitMs(at(3, 31, 20)), 0);
  assert.equal(maintenanceWaitMs(at(3, 40)), 0);
  assert.equal(maintenanceWaitMs(at(3, 0)), 31 * 60_000 + 20_000);
  assert.equal(maintenanceWaitMs(at(2, 59, 59)), 0, 'před 3:00:00 se nečeká');
  assert.equal(maintenanceWaitMs(at(3, 0, 1)), 31 * 60_000 + 19_000);
  assert.equal(maintenanceWaitMs(at(3, 31, 0)), 20_000);
});

test('hláška o vypršení se pozná v UTF-8 i ve Windows-1250, běžné stránky ne', () => {
  const msg = 'Vypršela platnost přihlášení. Pokud chcete, můžete jít na přihlašovací stránku a znovu se přihlásit.';
  assert.ok(EXPIRED_RE.test(msg));
  const cp1250 = new TextDecoder('windows-1250').decode(Buffer.from('Vypr\u009Aela platnost pøihlá\u009Aení.', 'latin1'));
  assert.ok(EXPIRED_RE.test(cp1250), cp1250);
  assert.ok(EXPIRED_RE.test('Vypr?ela platnost p?ihl?en?'));
  assert.ok(!EXPIRED_RE.test('Hráči rasy Bedrosian, Síla armády 779 327 705'));
  assert.ok(!EXPIRED_RE.test('Login: Heslo: Přihlas'));
});

import { sanitizeUpdate } from '../src/config.js';
test('prodlevy přihlášení: meze a konec nikdy pod začátkem', () => {
  const base = { session: { reactMinSec: 1.5, reactMaxSec: 3, maintMinSec: 8, maintMaxSec: 70 } };
  const a = sanitizeUpdate(base, { session: { maintMinSec: 20, maintMaxSec: 5 } }).session;
  assert.equal(a.maintMinSec, 20); assert.equal(a.maintMaxSec, 20);
  const b = sanitizeUpdate(base, { session: { reactMinSec: 0, reactMaxSec: 999 } }).session;
  assert.equal(b.reactMinSec, 0.5); assert.equal(b.reactMaxSec, 30);
});

import { sanitizeSession, SESSION_DEFAULTS } from '../src/config.js';
test('nastavení přihlášení: pokusy, časy údržby, přepínače a zprávy se ošetří', () => {
  const s = sanitizeSession(SESSION_DEFAULTS, { maxAttempts: 99, tabWaitMin: 0, enabled: false, closeTab: false, maintStart: '02:30', maintEnd: '03:10', notify: { ok: false, nesmysl: false } });
  assert.equal(s.maxAttempts, 5); assert.equal(s.tabWaitMin, 2);
  assert.equal(s.enabled, false); assert.equal(s.closeTab, false); assert.equal(s.reloadOthers, true);
  assert.equal(s.maintStart, '02:30'); assert.equal(s.maintEnd, '03:10');
  assert.equal(s.notify.ok, false); assert.equal(s.notify.failed, true); assert.ok(!('nesmysl' in s.notify));
  const bad = sanitizeSession(s, { maintStart: '25:99', maintEnd: '01:00' }); // neplatný čas / konec před začátkem se nepřijme
  assert.equal(bad.maintStart, '02:30'); assert.equal(bad.maintEnd, '03:10');
  const r = sanitizeSession(SESSION_DEFAULTS, { retryFirstMinSec: 500, retryFirstMaxSec: 100, probeMinSec: 1 });
  assert.equal(r.retryFirstMaxSec, 500); assert.equal(r.probeMinSec, 20);
});

test('údržba z nastavení: vlastní okno se respektuje', () => {
  const cfg = { maintStart: '02:00', maintEnd: '02:30' };
  assert.equal(maintenanceWaitMs(at(2, 10), cfg), 20 * 60_000 + 20_000);
  assert.equal(maintenanceWaitMs(at(3, 10), cfg), 0);
});

import { publicConfig, DEFAULTS } from '../src/config.js';
test('uložené heslo ke hře: prázdné pole nic nemění, smazání funguje a do rozhraní se heslo nikdy nevrací', () => {
  const base = { ...DEFAULTS, token: 'x' };
  const a = sanitizeUpdate(base, { login: { enabled: true, user: '  bilcus87 ', password: 'tajne' } });
  assert.deepEqual(a.login, { enabled: true, user: 'bilcus87', password: 'tajne' });
  const b = sanitizeUpdate(a, { login: { password: '', user: 'bilcus87' } }); // prázdné = beze změny
  assert.equal(b.login.password, 'tajne');
  const pub = publicConfig(b);
  assert.deepEqual(pub.login, { enabled: true, user: 'bilcus87', hasPassword: true });
  assert.ok(!JSON.stringify(pub).includes('tajne'));
  const c = sanitizeUpdate(b, { login: { clearPassword: true, enabled: false } });
  assert.equal(c.login.password, ''); assert.equal(c.login.enabled, false);
});

import { sendService } from '../src/notifiers.js';
test('kritická výstraha (ztráta hodnosti) obejde vypnuté systémové zprávy, ne hlavní ztlumení', async () => {
  const cfg = (extra) => ({ notify: true, notifyTypes: { service: false }, telegram: { enabled: false, botToken: '', serviceChatId: '' }, ...extra });
  // bez nastaveného Telegramu se nic neposílá, ale nepadá to; rozdíl je v tom, co se dostane k odeslání
  assert.deepEqual(await sendService(cfg(), 'x'), { sent: 0, total: 0 });
  assert.deepEqual(await sendService(cfg(), 'x', console, { critical: true }), { sent: 0, total: 0 });
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => { calls.push(JSON.parse(o.body).text); return { ok: true, json: async () => ({ ok: true }), text: async () => '{}' }; };
  try {
    const tg = { enabled: true, botToken: 't', serviceChatId: '1' };
    assert.equal((await sendService(cfg({ telegram: tg }), 'běžná')).sent, 0, 'běžná servisní zpráva při vypnutých systémových zprávách nejde');
    assert.equal((await sendService(cfg({ telegram: tg }), 'KRITICKÁ', console, { critical: true })).sent, 1, 'kritická jde');
    assert.equal((await sendService(cfg({ telegram: tg, notify: false }), 'ticho', console, { critical: true })).sent, 0, 'hlavní ztlumení platí');
  } finally { globalThis.fetch = realFetch; }
  assert.equal(calls.length, 1);
});

test('přihlašovací panel se zavírá jako první a teprve potom se obnovují ostatní karty', () => {
  assert.match(src, /^\/\/ @grant\s+window\.close$/m, 'skript smí zavřít kartu (bez toho window.close() u panelu otevřeného přes GM_openInTab nefunguje)');
  assert.match(src, /loginTab = GM_openInTab\(/, 'vedoucí karta si drží odkaz na panel a umí ho zavřít');
  assert.match(src, /loginTab\?\.close\(\)/);
  // zpráva „done“ nese pauzu na zavření a každá karta ji přičte ke své prodlevě před obnovením
  assert.match(src, /closeMs: cfg\.closeTab \? CLOSE_GRACE_MS : 0/);
  assert.match(src, /\(msg\.closeMs \?\? 0\) \+ rnd\(msg\.reload\[0\]/, 'každá karta počká na zavření panelu');
  assert.equal((src.match(/scheduleReload\(m\.data\)/g) ?? []).length, 2, 'vedoucí i ostatní karty se obnovují přes jednu frontu');
  assert.match(src, /k \* rnd\(gap\[0\] \* 1000, gap\[1\] \* 1000\)/, 'karty se obnovují po jedné s pauzou mezi nimi');
  // když se panel přesto nezavře, ohlásí to
  assert.match(src, /Zavři ho prosím ručně, překrývá kartu s daty/);
});
