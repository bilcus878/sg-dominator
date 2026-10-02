import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendService } from '../src/notifiers.js';

const cfg = (tg) => ({ telegram: { enabled: true, botToken: 'T', chatId: '-1', serviceChatId: '', ...tg }, discord: { enabled: false } });

test('servisní chat: bez vyplněného ID se nic neposílá (ani do hlavní skupiny)', async () => {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true, text: async () => '' }; };
  try {
    assert.deepEqual(await sendService(cfg({}), 'x'), { sent: 0, total: 0 });
    assert.equal(calls.length, 0);
    assert.deepEqual(await sendService(cfg({ serviceChatId: '-200' }), 'Výpadek'), { sent: 1, total: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.chat_id, '-200');
    assert.equal(calls[0].body.text, '🛠 Výpadek');
    assert.deepEqual(await sendService(cfg({ serviceChatId: '-200', enabled: false }), 'x'), { sent: 0, total: 0 });
  } finally { globalThis.fetch = orig; }
});
