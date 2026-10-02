// ==UserScript==
// @name         Stargate dominator – OP na mapě
// @namespace    sg-dominator
// @version      1.0.0
// @description  Hledá na mapě galaxie svítící tečky (opuštěné planety) a hlásí je lokálnímu notifikátoru (bez zásahu do stránky)
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
    });
  }

  // hra přenačítá obrázek mapy každou vteřinu; čteme ho přesně ve chvíli, kdy se dokončí načtení
  document.addEventListener('load', (e) => { if (e.target && e.target.id === 'galaxie') scan(); }, true);
  setTimeout(scan, 500);
  setInterval(scan, 3000);
})();
