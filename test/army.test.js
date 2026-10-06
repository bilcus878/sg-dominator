import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArmy } from '../src/army.js';

test('dohodit: bez otevřené stránky Rasová armáda se nic nezařadí', () => {
  const a = createArmy();
  const r = a.request('Wernt', 1000);
  assert.equal(r.ok, false);
  assert.match(r.error, /Rasová armáda/);
});

test('dohodit: požadavek se vydá skriptu jen jednou a výsledek se zapíše', () => {
  const a = createArmy();
  a.poll(0); // stránka je otevřená
  const r = a.request('Wernt', 1000);
  assert.equal(r.ok, true);
  assert.deepEqual(a.poll(1500), { action: 'send', id: r.id, name: 'Wernt' });
  assert.deepEqual(a.poll(2000), { action: 'none' }, 'nikdy dvakrát');
  assert.equal(a.request('Mave', 2100).ok, false, 'během odesílání další ne');
  a.report({ id: r.id, ok: true });
  assert.equal(a.status(2200).req.status, 'sent');
  assert.equal(a.request('Mave', 2300).ok, true, 'po odeslání může další');
});

test('dohodit: nevyzvednutý požadavek po 15 s propadne a neodešle se', () => {
  const a = createArmy();
  a.poll(0);
  a.request('Wernt', 1000);
  // stránka se mezitím neozvala; ozve se až po 20 s
  assert.deepEqual(a.poll(21_000), { action: 'none' });
  assert.equal(a.status(21_000).req.status, 'expired');
});

test('dohodit: chyba ze skriptu (nevyplněné jednotky) se ukáže', () => {
  const a = createArmy();
  a.poll(0);
  const { id } = a.request('Wernt', 100);
  a.poll(200);
  a.report({ id, ok: false, error: 'na stránce nejsou vyplněné žádné jednotky' });
  assert.deepEqual(a.status(300).req, { id, name: 'Wernt', status: 'error', error: 'na stránce nejsou vyplněné žádné jednotky' });
});

test('dohodit: skript čekající dlouhým dotazováním = stránka je otevřená (i bez běžného dotazu)', () => {
  const a = createArmy();
  a.waitStart(0);
  assert.equal(a.status(60_000).pageLive, true, 'čeká, takže žije');
  const r = a.request('Wernt', 60_000);
  assert.equal(r.ok, true);
  a.waitEnd(61_000);
  assert.equal(a.status(61_500).pageLive, true, 'právě se ozval');
  assert.equal(a.status(70_000).pageLive, false, 'po skončení čekání a 5 s ticha už ne');
});

test('obnovení stránky: nový dohoz čeká na obnovení, obnovit se má jen ta kopie stránky, která se ozvala první; požadavek vrácený skriptem se vydá znovu', () => {
  const a = createArmy();
  a.poll(0, 'stara');
  assert.deepEqual(a.poll(1, 'stara'), { action: 'none' });
  a.requestReload(100);
  assert.match(a.request('Bob', 150).error, /^Ještě se dohazuje/, 'během obnovení se nic nezadává');
  assert.deepEqual(a.poll(200, 'stara'), { action: 'reload' });
  assert.deepEqual(a.poll(300, 'stara'), { action: 'reload' }, 'stará kopie ještě nestihla přejít');
  assert.deepEqual(a.poll(900, 'nova'), { action: 'none' }, 'nová kopie = stránka je obnovená');
  const r = a.request('Bob', 1000);
  assert.equal(r.ok, true);
  assert.equal(a.poll(1100, 'nova').action, 'send');
  a.report({ id: r.id, ok: false, retry: true, error: 'zastaralá' }); // skript stránku obnovuje
  assert.equal(a.status(1200).req.status, 'pending');
  assert.equal(a.poll(1300, 'nova2').action, 'send', 'po obnovení se vyzvedne znovu');
  a.report({ id: r.id, ok: false, retry: true });
  a.poll(1400, 'nova3');
  a.report({ id: r.id, ok: false, retry: true });
  assert.equal(a.status(1500).req.status, 'error', 'po třetím vrácení se to vzdá (žádná nekonečná smyčka)');
});

test('obnovení stránky: když se stránka nevrátí, žádost propadne a normální chyba „otevři stránku“ platí', () => {
  const a = createArmy();
  a.poll(0, 'x');
  a.requestReload(0);
  assert.equal(a.poll(100, 'x').action, 'reload');
  assert.equal(a.request('Bob', 20_000).ok, false); // stránka se 20 s neozvala
  assert.match(a.request('Bob', 20_000).error, /^Otevři ve hře/);
});
