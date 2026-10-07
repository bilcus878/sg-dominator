// ==UserScript==
// @name         Stargate dominator – OP na mapě
// @namespace    sg-dominator
// @version      1.4.2
// @description  Hledá na mapě galaxie svítící tečky (opuštěné planety) a hlásí je lokálnímu notifikátoru; potvrzuje tlačítko bdělosti (po náhodné prodlevě), zapíná zastavený teleskop a (je-li zapnutý automat na OP) opuštěnou planetu sám osídlí
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

  // <hunt> čistá logika automatu na OP (testuje se v test/maphunt.test.js), nesmí používat DOM
  /** Obdélník, do kterého se vejde sektor na velké mapě; sektorová mapa je přesně tenhle obdélník zvětšený na celý obrázek. */
  function polyBox(pts) {
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (let i = 0; i < pts.length; i += 2) { minx = Math.min(minx, pts[i]); maxx = Math.max(maxx, pts[i]); miny = Math.min(miny, pts[i + 1]); maxy = Math.max(maxy, pts[i + 1]); }
    return { minx, maxx, miny, maxy };
  }

  /** Poloha bodu z velké mapy v sektoru jako zlomky 0–1 (u zleva doprava, v shora dolů). */
  function normPos(x, y, pts) {
    const b = polyBox(pts);
    const clamp = (n) => Math.min(1, Math.max(0, n));
    return { u: clamp((x - b.minx) / Math.max(1, b.maxx - b.minx)), v: clamp((y - b.miny) / Math.max(1, b.maxy - b.miny)) };
  }

  /** Velké značky (kosočtverce ~9×9 px) na sektorové mapě; planety jsou malé křížky, obrys sektoru je obří. RGBA data obrázku. */
  function findDiamonds(data, w, h) {
    const seen = new Uint8Array(w * h), out = [];
    const lit = (p) => data[p * 4] + data[p * 4 + 1] + data[p * 4 + 2] > 150;
    for (let start = 0; start < w * h; start++) {
      if (seen[start] || !lit(start)) continue;
      const st = [start]; seen[start] = 1;
      let n = 0, sx = 0, sy = 0, x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
      while (st.length) {
        const p = st.pop(), x = p % w, y = (p - x) / w;
        n++; sx += x; sy += y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (!seen[q] && lit(q)) { seen[q] = 1; st.push(q); }
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (n >= 14 && bw >= 8 && bw <= 18 && bh >= 8 && bh <= 18) out.push({ x: sx / n, y: sy / n });
    }
    return out;
  }

  /**
   * Kandidáti na pravou tečku OP: kruhy (planety) z mapy sektoru, které leží poblíž očekávané polohy. Velká značka (kosočtverec)
   * má přednost před obyčejnou planetou. Už zkoušené polohy se přeskočí.
   */
  function pickCandidates(circles, exp, tol, tried = [], diamonds = []) {
    return circles
      .map((c, i) => {
        const dist = Math.hypot(c.x - exp.x, c.y - exp.y);
        const diamond = diamonds.some((d) => Math.hypot(d.x - c.x, d.y - c.y) <= 6);
        return { ...c, i, dist, diamond, score: dist - (diamond ? 25 : 0) };
      })
      .filter((c) => c.dist <= tol && !tried.some((t) => Math.hypot(t.x - c.x, t.y - c.y) <= 4))
      .sort((a, b) => a.score - b.score);
  }
  // </hunt>

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
      .map((d) => { const s = sectorAt(d.x, d.y, sectors); return s && { id: s.id, label: s.label, ...normPos(d.x, d.y, s.pts) }; }) // + poloha tečky v sektoru (pro automat na OP)
      .filter(Boolean);
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
      onload: (r) => { try { const j = JSON.parse(r.responseText); if (j.vigilance) vig = j.vigilance; if (j.hunt) startHunt(j.hunt); } catch { /* zůstane poslední známé nastavení */ } },
    });
  }

  // ---------- člověk u mapy: tlačítko bdělosti a teleskop ----------
  // Tlačítko bdělosti hra tu a tam vytvoří (<input id="kliknout" value="Povrdit">); handler hry na #checked bere
  // jen klik s nenulovými souřadnicemi (clientX/clientY), proto se klikne uměle vyrobenou událostí se souřadnicemi.
  // Klikne se až po náhodné prodlevě; jednou za pár potvrzení ho server nechá záměrně vynechat. Zastavený teleskop
  // se po lidské prodlevě znovu aktivuje, po vynechané bdělosti až po delší „pauze“. Rozhoduje server (drží stav).
  let vig = { enabled: true, minSec: 5, maxSec: 10 }; // přepíše server v odpovědi na /ingest-op
  let vigSeen = false, vigClicking = false, vigTries = 0, vigStillAt = 0;
  let teleScheduled = false, teleClicking = false, teleStopping = false, teleLastPost = 0, teleLastActive = 0;
  let mouse = { x: 300 + Math.random() * 400, y: 200 + Math.random() * 200 };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // skutečná myš posílá vedle mouse* událostí i pointer* (pointerover/move/down/up); stránka, která události sleduje, by jejich absenci poznala
  const POINTER_OF = { mouseover: 'pointerover', mousemove: 'pointermove', mousedown: 'pointerdown', mouseup: 'pointerup' };
  const fire = (el, type, init = {}) => {
    const pt = POINTER_OF[type];
    if (pt && typeof PointerEvent === 'function') {
      try { el.dispatchEvent(new PointerEvent(pt, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, pressure: type === 'mousedown' ? 0.5 : 0, ...init })); } catch { /* bez pointer událostí */ }
    }
    return el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  };

  // Všechny klikací akce (bdělost, teleskop, lovení OP) jdou jednou frontou: člověk má jednu myš, takže se dva pohyby nikdy neprolnou
  // a mezi akcemi je lidská pauza.
  let clickChain = Promise.resolve();
  const exclusive = (fn) => {
    const run = clickChain.then(fn, fn);
    clickChain = run.then(() => sleep(rnd(700, 2200)), () => sleep(rnd(700, 2200)));
    return run;
  };
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
  const humanClick = (el) => exclusive(() => humanClickRaw(el));
  async function humanClickRaw(el) {
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
      if (vigSeen && !vigClicking) { vigSeen = false; vigTries = 0; postJson('/vigilance', { event: 'gone' }); } // tlačítko zmizelo (potvrzeno nebo vypršelo): server nemá na co čekat
      return;
    }
    if (vigSeen) { // pořád visí: server se dozví, že upozornění na nepotvrzené tlačítko je oprávněné (a nechodí, když tlačítko už dávno zmizelo)
      if (Date.now() - vigStillAt > 10_000) { vigStillAt = Date.now(); postJson('/vigilance', { event: 'still' }); }
      return;
    }
    if (!vig.enabled) return;
    vigSeen = true;
    const lo = Math.max(1, Number(vig.minSec) || 5);
    const hi = Math.max(lo, Number(vig.maxSec) || 10);
    // člověk reaguje většinou rychle a občas se zdrží; rovnoměrná prodleva je strojová. Maximálně o ~35 s víc (hra dává minuty)
    const delay = (lo + (hi - lo) * Math.pow(Math.random(), 1.6) + (Math.random() < 0.08 ? rnd(8, 25) : 0)) * 1000;
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
      if (teleStopping || now - teleLastActive < 10000) return; // jede: hlásit max jednou za 10 s (server může po OP říct „zastav“)
      teleLastActive = now;
      const dec = await postJson('/telescope', { event: 'state', state: 'active', remainingSec: t.remainingSec });
      if (dec?.action !== 'stop') return;
      teleStopping = true; // šetření po OP: zastavit po krátké lidské prodlevě
      setTimeout(async () => {
        const t2 = readTelescope();
        if (t2 && !t2.stopped) { teleClicking = true; try { await humanClick(t2.btn); } catch (e) { console.error('[dominator teleskop]', e); } teleClicking = false; }
        teleStopping = false;
      }, dec.delayMs ?? 1000);
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
  // ---------- automat na OP: velká mapa -> sektor -> tečka na stejné poloze -> „Získat souřadnice“ ----------
  // Stav zakázky drží server (id zakázky), tahle karta si mezi stránkami pamatuje jen id, fázi a vyzkoušené tečky (sessionStorage).
  // Pravá tečka je ta, která na sektorové mapě leží na stejné poloze jako na velké mapě; ostatní jsou falešné.
  const HUNT_KEY = 'sgd_hunt';
  const hGet = () => { try { const j = JSON.parse(sessionStorage.getItem(HUNT_KEY)); return j && Date.now() - j.at < 5 * 60_000 ? j : null; } catch { return null; } };
  const hSet = (j) => { try { sessionStorage.setItem(HUNT_KEY, JSON.stringify(j)); } catch { /* bez úložiště se nelovi */ } };
  const hClear = () => { try { sessionStorage.removeItem(HUNT_KEY); } catch { /* nic */ } };
  const hEvent = (id, event, extra = {}) => postJson('/op/hunt', { id, event, ...extra });
  let huntBusy = false;
  const pauseSec = (lo, hi) => sleep(rnd(lo, hi) * 1000);
  const snippet = () => (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);

  /** Vrátí se na velkou mapu a hledá se dál. */
  async function huntHome() {
    hClear();
    await sleep(rnd(900, 2200));
    location.assign('/mapa.php');
  }

  /** Klik na bod obrázku s mapou (area se v elementFromPoint nevrací, proto se události posílají přímo na area). */
  const humanClickAt = (img, target, x, y) => exclusive(() => humanClickAtRaw(img, target, x, y));
  async function humanClickAtRaw(img, target, x, y) {
    for (let i = 0; i < 40; i++) {
      const py = img.getBoundingClientRect().top + y;
      if (py > 90 && py < innerHeight - 90) break;
      window.scrollBy(0, (py < 90 ? -1 : 1) * rnd(60, 140));
      await sleep(rnd(25, 80));
    }
    const rc = img.getBoundingClientRect();
    const t = { x: rc.left + x + rnd(-2, 2), y: rc.top + y + rnd(-2, 2) };
    const c = { x: mouse.x + (t.x - mouse.x) * rnd(0.2, 0.6) + rnd(-80, 80), y: mouse.y + (t.y - mouse.y) * rnd(0.2, 0.6) + rnd(-80, 80) };
    const from = { ...mouse }, steps = Math.round(rnd(18, 34));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const px = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * c.x + e * e * t.x + rnd(-1, 1);
      const py = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * c.y + e * e * t.y + rnd(-1, 1);
      fire(document.elementFromPoint(px, py) || document.body, 'mousemove', { clientX: px, clientY: py });
      await sleep(rnd(6, 22));
    }
    mouse = t;
    fire(img, 'mousemove', { clientX: t.x, clientY: t.y });
    await sleep(rnd(120, 380));
    const pt = { clientX: Math.round(t.x), clientY: Math.round(t.y), screenX: Math.round(t.x) + 10, screenY: Math.round(t.y) + 80, button: 0, detail: 1 };
    fire(target, 'mousedown', pt);
    await sleep(rnd(50, 140));
    fire(target, 'mouseup', pt);
    fire(target, 'click', pt);
  }

  const areaUrl = (a) => a.href || (a.getAttribute('onclick') || '').match(/location\.href\s*=\s*'([^']+)'/)?.[1] || null;

  /** 1. krok: na velké mapě klikne na sektor s OP. */
  async function startHunt(h) {
    if (huntBusy || hGet() || !document.getElementById('galaxie')) return;
    huntBusy = true;
    try {
      const r = await hEvent(h.id, 'start');
      if (!r?.ok) { huntBusy = false; return; } // zakázku už převzala jiná karta / neexistuje
      const spec = r.spec;
      hSet({ id: spec.id, sector: spec.sector, stage: 'sector', tried: [], at: Date.now() });
      await pauseSec(spec.stepMinSec, spec.stepMaxSec);
      const area = [...document.querySelectorAll('map area')].find((a) => (a.getAttribute('href') || '').match(/id_sektor=(\d+)/)?.[1] === String(spec.sector));
      const img = document.getElementById('galaxie');
      if (!area || !img) { await hEvent(spec.id, 'abort', { text: 'sektor na velké mapě nenalezen' }); hClear(); huntBusy = false; return; }
      const box = polyBox((area.getAttribute('coords') || '').split(',').map(Number));
      await humanClickAt(img, area, (box.minx + box.maxx) / 2, (box.miny + box.maxy) / 2);
      await sleep(4000);
      const url = areaUrl(area); // klik nepřešel (hra ho ignorovala): přímý přechod
      if (url) location.assign(url);
    } catch (e) {
      await hEvent(h.id, 'abort', { text: `${e?.name}: ${e?.message}` });
      hClear(); huntBusy = false;
    }
  }

  /** 2. krok: na sektorové mapě najde tečku na očekávané poloze a klikne na ni. */
  async function huntOnSectorPage() {
    const job = hGet();
    if (!job || job.stage !== 'sector') return;
    const img = document.querySelector('img[usemap="#sektor_zobrazit"]');
    if (!img) return;
    if (!img.complete || !img.naturalWidth) await new Promise((res) => { img.addEventListener('load', res, { once: true }); setTimeout(res, 5000); });
    const st = await hEvent(job.id, 'state');
    if (!st?.ok) { hClear(); return; }
    const spec = st.spec;
    await hEvent(job.id, 'sector');
    const exp = { x: spec.u * img.naturalWidth, y: spec.v * img.naturalHeight };
    const circles = [...document.querySelectorAll('#sektor_zobrazit area')].map((el) => {
      const [x, y, rad] = (el.getAttribute('coords') || '').split(',').map(Number);
      return { el, x, y, rad };
    }).filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y));
    let diamonds = [];
    try {
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      diamonds = findDiamonds(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
    } catch { /* bez značek se řadí jen podle vzdálenosti */ }
    await pauseSec(spec.stepMinSec, spec.stepMaxSec); // jako když se člověk podívá na mapu
    const cands = pickCandidates(circles, exp, spec.tolerancePx, job.tried, diamonds);
    if (!cands.length || job.tried.length >= spec.maxTries) {
      const nearest = circles.length ? Math.round(Math.min(...circles.map((c) => Math.hypot(c.x - exp.x, c.y - exp.y)))) : null;
      await hEvent(job.id, 'no-dot', { text: `zkoušeno ${job.tried.length}×, očekávaná poloha ${Math.round(exp.x)},${Math.round(exp.y)}, nejbližší planeta ${nearest ?? '?'} px, značek ${diamonds.length}` });
      await huntHome();
      return;
    }
    const c = cands[0];
    hSet({ ...job, stage: 'planet', tried: [...job.tried, { x: c.x, y: c.y }] });
    await hEvent(job.id, 'try', { x: c.x, y: c.y });
    await humanClickAt(img, circles[c.i].el, c.x, c.y);
    await sleep(4000);
    const url = areaUrl(circles[c.i].el);
    if (url) location.assign(url);
  }

  const claimButton = () => [...document.querySelectorAll('input[type="button"],input[type="submit"],button,a')]
    .find((b) => /z[ií]skat\s+sou[rř]adnice/i.test(b.value || b.textContent || '') && isVisible(b));
  /** Texty červenou barvou (chybové hlášky hry). Stálé upozornění SGC se ignoruje. */
  const redTexts = () => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
      if (own.length < 3 || own.length > 300 || /SG týmy|velitelství SGC/i.test(own)) continue;
      const m = getComputedStyle(el).color.match(/\d+/g);
      if (m && Number(m[0]) >= 200 && Number(m[1]) <= 90 && Number(m[2]) <= 90) out.push(own);
    }
    return [...new Set(out)];
  };
  const claimFailed = async (job, text) => {
    await hEvent(job.id, /naquad|nedostat|nem[aá]te\s+dost|prost[rř]edk/i.test(text) ? 'no-naquadah' : 'fail', { text });
    await huntHome();
  };

  /** 3. krok: na stránce tečky hledá „Získat souřadnice“; není-li, vrátí se do sektoru k další tečce. */
  async function huntOnPlanetPage() {
    const job = hGet();
    if (!job || job.stage !== 'planet') return;
    const st = await hEvent(job.id, 'state');
    if (!st?.ok) { hClear(); return; }
    const spec = st.spec;
    await pauseSec(spec.stepMinSec, spec.stepMaxSec); // „přečtení“ stránky
    const btn = claimButton();
    if (!btn) {
      await hEvent(job.id, 'no-button');
      hSet({ ...job, stage: 'sector' });
      await pauseSec(spec.stepMinSec, spec.stepMaxSec);
      location.assign('/mapa.php?id_sektor=' + encodeURIComponent(job.sector)); // zpět do sektoru, další tečka
      return;
    }
    const cost = (document.body.innerText.match(/za\s+([\d\s ]+?)\s*kg\s+naquadahu/i) || [])[1]?.replace(/\s+/g, ' ').trim();
    if (spec.dryRun) { await hEvent(job.id, 'dry', { text: cost ? `cena ${cost} kg naquadahu` : '' }); await huntHome(); return; }
    await pauseSec(spec.claimMinSec, spec.claimMaxSec);
    const base = redTexts();
    hSet({ ...job, stage: 'claim' });
    await humanClick(btn);
    const until = Date.now() + 12_000; // hra mohla hlášku vypsat bez přenačtení stránky
    while (Date.now() < until) {
      await sleep(400);
      const fresh = redTexts().filter((t) => !base.includes(t));
      if (fresh.length) { await claimFailed(job, fresh.join(' | ')); return; }
    }
    await claimFailed(job, `po kliknutí se nic nestalo: ${snippet()}`);
  }

  /** Po kliknutí na „Získat souřadnice“ se stránka přenačetla: velká mapa = osídleno, jinak se čte výsledek. */
  async function huntAfterClaim() {
    const job = hGet();
    if (!job || job.stage !== 'claim') return false;
    if (document.getElementById('galaxie')) { await hEvent(job.id, 'success'); hClear(); return true; }
    await sleep(1500);
    if (claimButton()) { await claimFailed(job, redTexts().join(' | ') || `tlačítko zůstalo: ${snippet()}`); return true; }
    await hEvent(job.id, 'success', { text: snippet() });
    await huntHome();
    return true;
  }

  async function huntResume() {
    try {
      if (await huntAfterClaim()) return;
      if (document.querySelector('img[usemap="#sektor_zobrazit"]')) await huntOnSectorPage();
      else if (!document.getElementById('galaxie')) await huntOnPlanetPage();
    } catch (e) {
      const job = hGet();
      if (job) { await hEvent(job.id, 'abort', { text: `${e?.name}: ${e?.message}` }); hClear(); }
    }
  }
  setTimeout(huntResume, 400);

  setInterval(vigilanceTick, 500);
  setInterval(telescopeTick, 3000);

  // hra přenačítá obrázek mapy každou vteřinu; čteme ho přesně ve chvíli, kdy se dokončí načtení
  document.addEventListener('load', (e) => { if (e.target && e.target.id === 'galaxie') scan(); }, true);
  setTimeout(scan, 500);
  setInterval(scan, 3000);
})();
