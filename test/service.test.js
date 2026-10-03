import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendService, sendText, notifyOn } from '../src/notifiers.js';

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

test('hlavní vypínač upozornění: notify=false nepošle nic (ani hlavní, ani servisní chat)', async () => {
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: true, text: async () => '' }; };
  try {
    const off = { ...cfg({ serviceChatId: '-2' }), notify: false, discord: { enabled: true, webhookUrl: 'http://x' } };
    assert.deepEqual(await sendText(off, 'x'), { sent: 0, total: 0 });
    assert.deepEqual(await sendService(off, 'x'), { sent: 0, total: 0 });
    assert.equal(calls, 0);
    await sendText({ ...off, notify: true }, 'x'); // zapnuto = posílá
    assert.ok(calls >= 1);
  } finally { globalThis.fetch = orig; }
});

test('druhy upozornění: notifyOn respektuje hlavní vypínač i vypnutý druh; servisní zprávy se dají vypnout zvlášť', async () => {
  assert.equal(notifyOn({}, 'threshold'), true);
  assert.equal(notifyOn({ notifyTypes: { threshold: false } }, 'threshold'), false);
  assert.equal(notifyOn({ notifyTypes: { threshold: false } }, 'critical'), true);
  assert.equal(notifyOn({ notify: false }, 'critical'), false);
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: true, text: async () => '' }; };
  try {
    assert.deepEqual(await sendService({ ...cfg({ serviceChatId: '-2' }), notifyTypes: { service: false } }, 'x'), { sent: 0, total: 0 });
    assert.equal(calls, 0);
  } finally { globalThis.fetch = orig; }
});
