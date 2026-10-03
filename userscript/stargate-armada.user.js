// ==UserScript==
// @name         Stargate dominator – rasová armáda
// @namespace    sg-dominator
// @version      1.0.0
// @description  Na pokyn z aplikace (tlačítko Dohodit) vepíše jméno hráče do „Odeslat hráči“ a klikne na Odeslat. Počty jednotek vyplňuješ ty.
// @match        https://stargate-game.cz/jednotky.php*
// @match        https://www.stargate-game.cz/jednotky.php*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  const SERVER = '__SERVER__';
  const TOKEN = '__TOKEN__';

  const nameInput = document.getElementById('hrac_jmeno'); // „Odeslat hráči“ v sekci Poslání
  if (!nameInput || !nameInput.form) return; // není stránka Rasová armáda
  const form = nameInput.form;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function post(path, data) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: `${SERVER}${path}`,
        headers: { 'content-type': 'application/json', 'x-token': TOKEN },
        data: JSON.stringify(data),
        timeout: 5000,
        onload: (r) => { try { resolve(JSON.parse(r.responseText)); } catch { resolve(null); } },
        onerror: () => resolve(null),
        ontimeout: () => resolve(null),
      });
    });
  }

  /** Vyplněné počty jednotek ve formuláři Poslání (jed1, jed2…); bez nich se nic neodešle. */
  const filledUnits = () => [...form.querySelectorAll('input[type="text"][name^="jed"]')].filter((i) => /\d/.test(i.value) && Number(i.value.replace(/\D/g, '')) > 0);

  let busy = false;
  async function tick() {
    if (busy) return;
    const ins = await post('/army/poll', {});
    if (ins?.action !== 'send' || !ins.name) return;
    busy = true;
    try {
      if (!filledUnits().length) { await post('/army/report', { id: ins.id, ok: false, error: 'na stránce nejsou vyplněné žádné jednotky' }); return; }
      nameInput.focus();
      nameInput.value = ins.name;
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(rnd(150, 400));
      const btn = form.querySelector('#odeslat') || form.querySelector('input[type="image"], input[type="submit"], button[type="submit"]');
      if (!btn) { await post('/army/report', { id: ins.id, ok: false, error: 'tlačítko Odeslat nenalezeno' }); return; }
      await post('/army/report', { id: ins.id, ok: true, units: filledUnits().length });
      const r = btn.getBoundingClientRect();
      const pt = { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: Math.round(r.left + r.width * rnd(0.3, 0.7)), clientY: Math.round(r.top + r.height * rnd(0.3, 0.7)) };
      btn.dispatchEvent(new MouseEvent('mousedown', pt));
      await sleep(rnd(40, 110));
      btn.dispatchEvent(new MouseEvent('mouseup', pt));
      btn.dispatchEvent(new MouseEvent('click', pt)); // stránka se odešle a přenačte
    } finally {
      busy = false;
    }
  }
  setInterval(tick, 700);
  tick();
})();
