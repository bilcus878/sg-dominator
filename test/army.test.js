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
