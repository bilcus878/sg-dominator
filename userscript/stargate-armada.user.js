// ==UserScript==
// @name         Stargate dominator – rasová armáda
// @namespace    sg-dominator
// @version      2.1.0
// @description  Na pokyn z aplikace (tlačítko Dohodit) vepíše jméno hráče do „Odeslat hráči“ a klikne na Odeslat; pak se vrátí zpět a znovu vyplní počty jednotek podle nastavení v aplikaci (Nastavení → Dohoz).
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

  const rnd = (a, b) => a + Math.random() * (b - a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const BACK_KEY = 'sgd-army-back'; // po odeslání: ze stránky s výsledkem zpět v prohlížeči
  const REFILL_KEY = 'sgd-army-refill'; // po návratu: znovu vyplnit jednotky podle nastavení

  /** Klik se souřadnicemi (stisk, pauza, puštění), jako myší. */
  async function clickEl(el) {
    const r = el.getBoundingClientRect();
    const pt = { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: Math.round(r.left + r.width * rnd(0.3, 0.7)), clientY: Math.round(r.top + r.height * rnd(0.3, 0.7)) };
    el.dispatchEvent(new MouseEvent('mousedown', pt));
    await sleep(rnd(40, 110));
    el.dispatchEvent(new MouseEvent('mouseup', pt));
    el.dispatchEvent(new MouseEvent('click', pt));
  }

  // stránka po odeslání: zpět v prohlížeči (←), ať se vrátí formulář s vyplněnými jednotkami
  let backAt = 0;
  try { backAt = Number(sessionStorage.getItem(BACK_KEY)) || 0; sessionStorage.removeItem(BACK_KEY); } catch { /* bez sessionStorage se zpět nevrátí */ }
  if (backAt && Date.now() - backAt < 60_000) {
    try { sessionStorage.setItem(REFILL_KEY, String(Date.now())); } catch { /* bez úložiště se jen nevyplní znovu */ }
    setTimeout(() => history.back(), rnd(400, 900));
    return;
  }

  const nameInput = document.getElementById('hrac_jmeno'); // „Odeslat hráči“ v sekci Poslání
  if (!nameInput || !nameInput.form) return; // není stránka Rasová armáda
  const form = nameInput.form;

  function post(path, data, method = 'POST', timeout = 5000) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method,
        url: `${SERVER}${path}`,
        headers: { 'content-type': 'application/json', 'x-token': TOKEN },
        data: data ? JSON.stringify(data) : undefined,
        timeout,
        onload: (r) => { try { resolve(JSON.parse(r.responseText)); } catch { resolve(null); } },
        onerror: () => resolve(null),
        ontimeout: () => resolve(null),
      });
    });
  }

  const strip = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const toNum = (t) => { const m = String(t ?? '').replace(/[\s\u00a0]/g, '').match(/\d+/); return m ? Number(m[0]) : null; };
  const unitInputs = () => [...form.querySelectorAll('input[type="text"][name^="jed"]')];
  function setValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    if (setter) setter.call(el, String(value)); else el.value = String(value);
    for (const t of ['input', 'change', 'keyup']) el.dispatchEvent(new Event(t, { bubbles: true }));
  }
  /** Název jednotky (první buňka řádku) a kolik jí je v armádě (první číslo ve třetí buňce „V armádě“). */
  function rowInfo(input) {
    const cells = [...(input.closest('tr')?.children ?? [])];
    return { name: strip(cells[0]?.textContent), available: toNum(cells[2]?.textContent) };
  }

  /** Vyplní počty podle nastavení z aplikace: počet (nejvýš co je v armádě) nebo Max = všechny. Vrací, kolik polí vyplnil. */
  async function fillFromConfig(overwrite) {
    const cfg = await post('/army/config', null, 'GET');
    if (!cfg || !Array.isArray(cfg.units)) return 0;
    const byName = new Map(cfg.units.map((u) => [strip(u.name), u]));
    let n = 0;
    for (const input of unitInputs()) {
      const { name, available } = rowInfo(input);
      const u = byName.get(name);
      if (!u) continue;
      if (!overwrite && /\d/.test(input.value)) continue; // co už někdo vyplnil, se nepřepisuje
      const value = u.max ? available : u.count > 0 ? (available != null ? Math.min(u.count, available) : u.count) : 0;
      if (!(value > 0)) continue; // v aplikaci nic nastaveno: pole nechat, jak je (třeba ručně vyplněné / obnovené prohlížečem)
      await sleep(rnd(25, 70));
      setValue(input, value);
      n += 1;
    }
    return n;
  }

  // jména jednotek ze stránky jdou do nastavení v aplikaci (s počtem 0), ať je stačí jen přepsat
  post('/army/seen', { units: unitInputs().map((i) => ({ name: [...(i.closest('tr')?.children ?? [])][0]?.textContent.trim() ?? '', available: rowInfo(i).available })).filter((u) => u.name) });

  // po odeslání a návratu zpět: znovu vyplnit (přepíše to, co tam zbylo); jinak jen prázdná pole
  let refill = false;
  try { refill = Date.now() - (Number(sessionStorage.getItem(REFILL_KEY)) || 0) < 60_000; sessionStorage.removeItem(REFILL_KEY); } catch { /* nic */ }
  fillFromConfig(refill);
  window.addEventListener('pageshow', (e) => { // návrat z mezipaměti prohlížeče: stránka se nenačte znovu, skript se nespustí
    if (!e.persisted) return;
    try { if (Date.now() - (Number(sessionStorage.getItem(REFILL_KEY)) || 0) < 60_000) { sessionStorage.removeItem(REFILL_KEY); fillFromConfig(true); } } catch { /* nic */ }
  });

  /** Vyplněné počty jednotek ve formuláři Poslání (jed1, jed2…); bez nich se nic neodešle. */
  const filledUnits = () => [...form.querySelectorAll('input[type="text"][name^="jed"]')].filter((i) => /\d/.test(i.value) && Number(i.value.replace(/\D/g, '')) > 0);

  let busy = false;
  async function tick() {
    if (busy) return;
    const ins = await post('/army/poll', {}, 'POST', 30_000); // dlouhé dotazování: server odpoví hned, jak aplikace zadá Dohodit
    if (!ins) { await sleep(1000); return; } // server nedostupný: chvíli počkat
    if (ins?.action !== 'send' || !ins.name) return;
    busy = true;
    try {
      if (!filledUnits().length) await fillFromConfig(false); // nic nevyplněno: vyplníme podle nastavení
      if (!filledUnits().length) { await post('/army/report', { id: ins.id, ok: false, error: 'nejsou vyplněné žádné jednotky (nastav je v aplikaci: Nastavení → Dohoz)' }); return; }
      nameInput.focus();
      nameInput.value = ins.name;
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(rnd(50, 130));
      const btn = form.querySelector('#odeslat') || form.querySelector('input[type="image"], input[type="submit"], button[type="submit"]');
      if (!btn) { await post('/army/report', { id: ins.id, ok: false, error: 'tlačítko Odeslat nenalezeno' }); return; }
      await post('/army/report', { id: ins.id, ok: true, units: filledUnits().length });
      try { sessionStorage.setItem(BACK_KEY, String(Date.now())); } catch { /* jen se neklikne Zpět */ }
      await clickEl(btn); // stránka se odešle a přenačte; z výsledku se skript vrátí zpět
    } finally {
      busy = false;
    }
  }
  (async () => { for (;;) { try { await tick(); } catch { await sleep(1000); } } })();
})();
