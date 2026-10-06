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
