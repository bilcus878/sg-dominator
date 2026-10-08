// ==UserScript==
// @name         Stargate dominator – hvězdné brány
// @namespace    sg-dominator
// @version      1.0.0
// @description  Obchod → Hvězdné brány: jako člověk si občas obnoví nabídku, těsně po změně (každé 3 minuty) ji načte znovu a když je cena pod limitem z aplikace, klikne na Koupit, dokud je co kupovat
// @match        https://stargate-game.cz/obchod.php*
// @match        https://www.stargate-game.cz/obchod.php*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @noframes
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  if (new URLSearchParams(location.search).get('page') !== '4') return; // jen Obchod → Hvězdné brány
  const SERVER = '__SERVER__';
  const TOKEN = '__TOKEN__';
  const VERSION = '1.0.0'; // stejné jako @version
  const PAGE = `${location.origin}${location.pathname}?page=4`;
  const src = Math.random().toString(36).slice(2, 10);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const fire = (el, type, init = {}) => {
    const pt = { mouseover: 'pointerover', mousemove: 'pointermove', mousedown: 'pointerdown', mouseup: 'pointerup' }[type];
    if (pt && typeof PointerEvent === 'function') {
      try { el.dispatchEvent(new PointerEvent(pt, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, pressure: type === 'mousedown' ? 0.5 : 0, ...init })); } catch { /* bez pointer událostí */ }
    }
    return el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  };

  // <parse> čistá logika čtení textu stránky (testuje se v test/gates-script.test.js), nesmí používat DOM
  const num = (s) => { const d = String(s ?? '').replace(/\D/g, ''); return d ? Number(d) : null; };
  function parseGates(t) {
    const price = num((t.match(/nabízena za\s+([\d\s ]+?)\s*kg/i) || [])[1]);
    const count = num((t.match(/nabízeno\s+([\d\s ]+?)\s+hv[ěe]zdn/i) || [])[1]);
    const rm = t.match(/Další změna bude za\s+(?:(\d+)\s*minut\S*\s*)?(?:a\s+)?(?:(\d+)\s*sekund\S*)?/i);
    const remainingSec = rm && (rm[1] || rm[2]) ? (Number(rm[1]) || 0) * 60 + (Number(rm[2]) || 0) : null;
    const naq = num((t.match(/Máš k dispozici\s+([\d\s ]+?)\s*kg/i) || [])[1]);
    return { price, count, remainingSec, naq };
  }
  // </parse>

  function readPage() {
    const base = parseGates(document.body?.innerText ?? '');
    const form = [...document.forms].find((f) => f.querySelector('input[name="hb_koupit"]'));
    const sel = form?.elements?.id_pl;
    const btn = form?.querySelector('input[type="image"]');
    const planets = sel?.options?.length ?? 0;
    return { ...base, planets, canBuy: !!(form && btn && sel && planets > 0), btn };
  }

  function post(path, data) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'POST', url: `${SERVER}${path}`, headers: { 'content-type': 'application/json', 'x-token': TOKEN },
        data: JSON.stringify({ ver: VERSION, src, ...data }), timeout: 6000,
        onload: (r) => { try { resolve(JSON.parse(r.responseText)); } catch { resolve(null); } },
        onerror: () => resolve(null), ontimeout: () => resolve(null),
      });
    });
  }

  // klik jako od myši (stejný postup jako u ostatních skriptů): pohyb po křivce, stisk, pauza, puštění, klik se souřadnicemi
  let mouse = { x: 300 + Math.random() * 400, y: 200 + Math.random() * 200 };
  async function humanClick(el) {
    for (let i = 0; i < 40; i++) {
      const r = el.getBoundingClientRect();
      if (r.top > 80 && r.bottom < innerHeight - 80) break;
      window.scrollBy(0, (r.top < 80 ? -1 : 1) * rnd(60, 140));
      await sleep(rnd(25, 80));
    }
    const r = el.getBoundingClientRect();
    const t = { x: r.left + r.width * rnd(0.25, 0.75), y: r.top + r.height * rnd(0.3, 0.7) };
    const c = { x: mouse.x + (t.x - mouse.x) * rnd(0.2, 0.6) + rnd(-80, 80), y: mouse.y + (t.y - mouse.y) * rnd(0.2, 0.6) + rnd(-80, 80) };
    const from = { ...mouse }, steps = Math.round(rnd(18, 34));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const x = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * c.x + e * e * t.x + rnd(-1, 1);
      const y = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * c.y + e * e * t.y + rnd(-1, 1);
      fire(document.elementFromPoint(x, y) || document.body, 'mousemove', { clientX: x, clientY: y });
      await sleep(rnd(6, 22));
    }
    mouse = t;
    fire(el, 'mouseover', { clientX: t.x, clientY: t.y });
    await sleep(rnd(120, 380));
    const pt = { clientX: Math.round(t.x), clientY: Math.round(t.y), screenX: Math.round(t.x) + 10, screenY: Math.round(t.y) + 80, button: 0, detail: 1 };
    fire(el, 'mousedown', pt);
    await sleep(rnd(50, 140));
    fire(el, 'mouseup', pt);
    fire(el, 'click', pt); // klik se souřadnicemi: u obrázkového tlačítka z nich hra dostane x/y
  }

  const reloadLater = (ms) => setTimeout(() => location.assign(PAGE), Math.max(500, ms)); // GET na stejnou stránku (location.reload() by po nákupu znovu odeslal POST!)

  // kliknutí na Koupit přenačte stránku, proto si značka „kliknuto“ přežije v sessionStorage a další hlášení ji pošle serveru
  const CLICKED = 'sgd_gate_clicked';
  const markClicked = () => { try { sessionStorage.setItem(CLICKED, String(Date.now())); } catch { /* nic */ } };
  const takeClicked = () => { try { const t = Number(sessionStorage.getItem(CLICKED)); sessionStorage.removeItem(CLICKED); return !!t && Date.now() - t < 90_000; } catch { return false; } };

  async function tick() {
    const rep = readPage();
    const { btn, ...data } = rep;
    const ins = await post('/gates/report', { ...data, clicked: takeClicked() });
    if (!ins) { reloadLater(rnd(15_000, 25_000)); return; } // server nedostupný: za chvíli znovu
    if (ins.action === 'buy') {
      await sleep(ins.delayMs ?? 1000);
      const now = readPage(); // těsně před kliknutím: pořád to samé a pořád pod limitem?
      if (!now.canBuy || now.price !== ins.price || now.price > ins.maxPrice) { setTimeout(tick, 500); return; }
      markClicked();
      try { await humanClick(now.btn); } catch (e) { console.error('[dominator brány]', e); }
      // po kliknutí se stránka přenačte (POST) a tenhle skript poběží znovu; kdyby ne, ať server pozná, že naquadah neubyl
      setTimeout(tick, 12_000);
      return;
    }
    if (ins.action === 'wait') { reloadLater(ins.reloadInMs ?? 30_000); return; }
    setTimeout(tick, rnd(8_000, 14_000)); // idle: nákup je vypnutý nebo nakupuje jiná karta; po zapnutí to server pozná
  }

  setTimeout(tick, rnd(400, 1200));
})();
