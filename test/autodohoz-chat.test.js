import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAutoArmy, AUTO_ARMY_DEFAULTS } from '../src/autodohoz.js';

// Regresní pojistka: zprávy auto-dohozu nesmí nikdy skončit v hlavní skupině (ať v chatu vypadá, že dohazuje člověk).
const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

test('sendDohoz posílá jen do servisního chatu, ne do hlavní skupiny ani na Discord', () => {
  const i = server.indexOf('function sendDohoz');
  assert.ok(i > 0, 'funkce sendDohoz chybí');
  const body = server.slice(i, server.indexOf('\n}', i));
  assert.match(body, /sendService\(/);
  assert.doesNotMatch(body, /sendText\(/);
});

test('události auto-dohozu se do chatu posílají jen přes sendDohoz (ne přes sendText)', () => {
  const m = server.match(/autoArmy\.tick\([\s\S]*?\n\}, \d+\);/);
  assert.ok(m, 'smyčka auto-dohozu nenalezena');
  assert.doesNotMatch(m[0], /sendText\(/);
  assert.match(m[0], /sendDohoz\(/);
});

test('alert hlídání vlastního hráče (do skupiny) se auto-dohozem nijak nemění: onAlert nic nepíše a nic nevrací k odeslání', () => {
  const a = createAutoArmy({ rand: () => 0 });
  const r = a.onAlert({ name: 'X', reason: 'threshold', power: 1, threshold: 100 }, { ...AUTO_ARMY_DEFAULTS, enabled: true }, 0);
  assert.deepEqual(Object.keys(r).sort(), ['deferred', 'dueAt', 'scheduled']); // jen plán, žádný text pro chat
});
