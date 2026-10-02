// ==UserScript==
// @name         Stargate dominator – OP na mapě
// @namespace    sg-dominator
// @version      1.2.1
// @description  Hledá na mapě galaxie svítící tečky (opuštěné planety) a hlásí je lokálnímu notifikátoru; potvrzuje tlačítko bdělosti (po náhodné prodlevě) a zapíná zastavený teleskop
// @match        https://stargate-game.cz/mapa.php*
// @match        https://www.stargate-game.cz/mapa.php*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  const SERVER = '__SERVER__';
  const TOKEN = '__TOKEN__';

  // <detect> čistá logika (testuje se v test/mapdetect.test.js), nesmí používat DOM
  const DOT = [255, 178, 0]; // barva tečky OP (#FFB200); popisky sektorů mají jinou (#CC6633)

  /** Najde shluky pixelů barvy tečky. data = RGBA pole obrázku. Vrací středy [{x,y,size}]. */
  function findDots(data, w, h) {
    const hits = new Map(); // klíč y*w+x -> true
    for (let p = 0, i = 0; i < data.length; i += 4, p++) {
      if (data[i] === DOT[0] && data[i + 1] === DOT[1] && data[i + 2] === DOT[2]) hits.set(p, true);
    }
    const dots = [];
    const seen = new Set();
    for (const start of hits.keys()) {
      if (seen.has(start)) continue;
      // tečka je 7×7 s dutinami, proto spojujeme pixely do vzdálenosti 2
      const stack = [start];
      seen.add(start);
      let sx = 0, sy = 0, n = 0;
      while (stack.length) {
        const p = stack.pop();
        const x = p % w, y = (p - x) / w;
        sx += x; sy += y; n++;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const q = ny * w + nx;
            if (hits.has(q) && !seen.has(q)) { seen.add(q); stack.push(q); }
          }
        }
      }
      if (n >= 8) dots.push({ x: sx / n, y: sy / n, size: n });
    }
    return dots;
  }

  function inPolygon(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
      const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** sektory = [{id, label, pts:[x1,y1,x2,y2,…]}] -> sektor, ve kterém leží bod */
  function sectorAt(x, y, sectors) {
    return sectors.find((s) => inPolygon(x, y, s.pts)) ?? null;
  }
  // </detect>

  function readSectors() {
    return [...document.querySelectorAll('map area')].map((a) => {
      const id = (a.getAttribute('href') || '').match(/id_sektor=(\d+)/)?.[1];
      const label = (a.getAttribute('title') || '').replace(/^Sektor\s*/i, '').trim();
      const pts = (a.getAttribute('coords') || '').split(',').map((v) => Number(v.trim()));
      return id && pts.length >= 6 ? { id, label, pts } : null;
    }).filter(Boolean);
  }

  let sectors = [];
  let lastKey = '';
  let lastSendAt = 0;
  const src = Math.random().toString(36).slice(2, 10);

  function scan() {
    const img = document.getElementById('galaxie');
    if (!img || !img.naturalWidth) return;
    if (!sectors.length) sectors = readSectors();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    let data;
    try { ctx.drawImage(img, 0, 0); data = ctx.getImageData(0, 0, c.width, c.height).data; } catch { return; }

    const found = findDots(data, c.width, c.height)
      .map((d) => sectorAt(d.x, d.y, sectors))
      .filter(Boolean)
      .map((s) => ({ id: s.id, label: s.label }));
    const key = found.map((s) => s.id).sort().join(',');
    const now = Date.now();
    // změna = okamžitě, jinak jen heartbeat max 1× za vteřinu
    if (key === lastKey && now - lastSendAt < 800) return;
    lastKey = key; lastSendAt = now;
    GM_xmlhttpRequest({
      method: 'POST',
      url: `${SERVER}/ingest-op`,
      headers: { 'content-type': 'application/json', 'x-token': TOKEN },
      data: JSON.stringify({ src, sectors: found }),
      timeout: 5000,
      onload: (r) => { try { const j = JSON.parse(r.responseText); if (j.vigilance) vig = j.vigilance; } catch { /* zůstane poslední známé nastavení */ } },
    });
  }

  // ---------- člověk u mapy: tlačítko bdělosti a teleskop ----------
  // Tlačítko bdělosti hra tu a tam vytvoří (<input id="kliknout" value="Povrdit">); handler hry na #checked bere
  // jen klik s nenulovými souřadnicemi (clientX/clientY), proto se klikne uměle vyrobenou událostí se souřadnicemi.
  // Klikne se až po náhodné prodlevě; jednou za pár potvrzení ho server nechá záměrně vynechat. Zastavený teleskop
  // se po lidské prodlevě znovu aktivuje, po vynechané bdělosti až po delší „pauze“. Rozhoduje server (drží stav).
  let vig = { enabled: true, minSec: 5, maxSec: 10 }; // přepíše server v odpovědi na /ingest-op
  let vigSeen = false, vigClicking = false, vigTries = 0;
  let teleScheduled = false, teleClicking = false, teleLastPost = 0, teleLastActive = 0;
  let mouse = { x: 300 + Math.random() * 400, y: 200 + Math.random() * 200 };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (el, type, init = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  const isVisible = (el) => !!(el && (el.offsetWidth || el.offsetHeight) && !el.disabled);

  /** POST na server; vrací Promise s odpovědí (JSON) nebo null při chybě. */
  function postJson(path, data) {
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

  /** Doscrolluje k prvku, přejede k němu myší po zakřivené dráze a klikne (stisk, pauza, puštění, klik se souřadnicemi). */
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
    const from = { ...mouse };
    const steps = Math.round(rnd(18, 34));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const x = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * c.x + e * e * t.x + rnd(-1, 1);
      const y = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * c.y + e * e * t.y + rnd(-1, 1);
      fire(document.elementFromPoint(x, y) || document.body, 'mousemove', { clientX: x, clientY: y });
      await sleep(rnd(6, 22));
    }
    mouse = t;
    fire(el, 'mouseover', { clientX: t.x, clientY: t.y });
    await sleep(rnd(120, 380));
    const pt = { clientX: Math.round(t.x) || 1, clientY: Math.round(t.y) || 1, screenX: Math.round(t.x) + 10, screenY: Math.round(t.y) + 80, button: 0, detail: 1 };
    fire(el, 'mousedown', pt);
    el.focus();
    await sleep(rnd(50, 140));
    fire(el, 'mouseup', pt);
    fire(el, 'click', pt); // el.click() posílá souřadnice 0,0 a hra takový klik ignoruje
  }

  async function vigilanceTick() {
    const btn = document.getElementById('kliknout');
    if (!isVisible(btn)) {
      if (vigSeen && !vigClicking) { vigSeen = false; vigTries = 0; } // tlačítko zmizelo (potvrzeno nebo vypršelo)
      return;
    }
    if (!vig.enabled || vigSeen) return;
    vigSeen = true;
    const lo = Math.max(1, Number(vig.minSec) || 5);
    const hi = Math.max(lo, Number(vig.maxSec) || 10);
    const delay = rnd(lo, hi) * 1000;
    const dec = await postJson('/vigilance', { event: 'seen', delayMs: Math.round(delay) });
    if (dec?.action === 'ignore') { setTimeout(() => { vigSeen = false; }, 4000); return; } // OP je vypnuté; za chvíli se zeptá znovu
    if (dec?.action === 'skip') return; // záměrně vynecháno; vigSeen zůstane, dokud tlačítko nezmizí
    setTimeout(async () => {
      const b = document.getElementById('kliknout');
      if (!isVisible(b)) return; // mezitím zmizelo
      vigClicking = true;
      try { await humanClick(b); postJson('/vigilance', { event: 'clicked' }); } catch (e) { postJson('/vigilance', { event: 'failed', error: `${e?.name}: ${e?.message}` }); }
      vigClicking = false;
      setTimeout(() => { // když tlačítko po kliknutí zůstalo, zkusí to znovu (nejvýš 3×)
        if (!isVisible(document.getElementById('kliknout'))) return;
        if (++vigTries >= 3) { postJson('/vigilance', { event: 'failed', error: 'tlačítko po 3 kliknutích zůstává' }); return; }
        vigSeen = false;
      }, 5000);
    }, delay);
  }

  /** Stav teleskopu ze stránky: tlačítko „Aktivovat teleskop“ = stojí, „Zastavit teleskop“ = jede. */
  function readTelescope() {
    const btn = document.querySelector('input[name="zmen_teleskop"]');
    if (!btn) return null;
    const m = document.body.innerText.match(/Zbývající čas:\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i);
    const remainingSec = m && (m[1] || m[2] || m[3]) ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : null;
    return { btn, stopped: /aktivovat/i.test(btn.value), remainingSec };
  }

  async function telescopeTick() {
    const t = readTelescope();
    if (!t || teleClicking) return;
    const now = Date.now();
    if (!t.stopped) {
      teleScheduled = false;
      if (now - teleLastActive > 30000) { teleLastActive = now; postJson('/telescope', { event: 'state', state: 'active', remainingSec: t.remainingSec }); }
      return;
    }
    if (teleScheduled || now - teleLastPost < 10000) return; // zeptat se serveru max jednou za 10 s
    teleLastPost = now;
    const dec = await postJson('/telescope', { event: 'state', state: 'stopped', remainingSec: t.remainingSec });
    if (dec?.action !== 'activate') return;
    teleScheduled = true;
    setTimeout(async () => {
      const t2 = readTelescope();
      if (!t2 || !t2.stopped) { teleScheduled = false; return; }
      teleClicking = true;
      await postJson('/telescope', { event: 'attempt' });
      try { await humanClick(t2.btn); } catch (e) { console.error('[dominator teleskop]', e); }
      teleClicking = false;
      teleScheduled = false; // stránka se po odeslání přenačte; kdyby ne, po prodlevě se server zeptá znovu
    }, dec.delayMs ?? 15000);
  }
  setInterval(vigilanceTick, 500);
  setInterval(telescopeTick, 3000);

  // hra přenačítá obrázek mapy každou vteřinu; čteme ho přesně ve chvíli, kdy se dokončí načtení
  document.addEventListener('load', (e) => { if (e.target && e.target.id === 'galaxie') scan(); }, true);
  setTimeout(scan, 500);
  setInterval(scan, 3000);
})();
