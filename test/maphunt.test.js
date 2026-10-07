import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** Čistá logika automatu na OP je v userscriptu mezi značkami <hunt>; tady ji vytáhneme a spustíme. */
const src = readFileSync(new URL('../userscript/stargate-mapa.user.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// <hunt>'), src.indexOf('// </hunt>'));
const { polyBox, normPos, findDiamonds, pickCandidates } = new Function(`${block}; return { polyBox, normPos, findDiamonds, pickCandidates };`)();

// sektor 27 z velké mapy (souřadnice z hry) a sektorová mapa 602×367
const S27 = [335, 126, 373, 151, 414, 103, 340, 103];

test('poloha v sektoru: roh obdélníku je 0/1, střed 0.5', () => {
  assert.deepEqual(polyBox(S27), { minx: 335, maxx: 414, miny: 103, maxy: 151 });
  assert.deepEqual(normPos(335, 103, S27), { u: 0, v: 0 });
  assert.deepEqual(normPos(414, 151, S27), { u: 1, v: 1 });
  const m = normPos(374.5, 127, S27);
  assert.equal(m.u, 0.5); assert.equal(m.v, 0.5);
  assert.deepEqual(normPos(0, 999, S27), { u: 0, v: 1 }, 'mimo obdélník se ořízne');
});

test('skutečný případ: OP ze screenshotu velké mapy se najde na sektorové mapě mezi falešnými tečkami', () => {
  // OP na velké mapě ~(364; 112,8) -> očekávaná poloha v sektorové mapě
  const { u, v } = normPos(364, 112.8, S27);
  const exp = { x: u * 602, y: v * 367 };
  // planety/značky na sektorové mapě 27 (poloha kruhů z hry): pravá je (230, 84), ostatní velké značky jsou jinde
  const circles = [{ x: 322, y: 266 }, { x: 476, y: 73 }, { x: 230, y: 84 }, { x: 78, y: 132 }, { x: 560, y: 13 }, { x: 365, y: 147 }];
  const c = pickCandidates(circles, exp, 30, [], []);
  assert.equal(c.length, 1, 've vzdálenosti 30 px je jen pravá tečka');
  assert.deepEqual({ x: c[0].x, y: c[0].y }, { x: 230, y: 84 });
});

test('kandidáti: značka má přednost, zkoušené se přeskočí, daleké se nebere', () => {
  const exp = { x: 100, y: 100 };
  const circles = [{ x: 108, y: 100 }, { x: 100, y: 118 }, { x: 300, y: 300 }];
  const noDiamond = pickCandidates(circles, exp, 30);
  assert.deepEqual(noDiamond.map((c) => c.i), [0, 1], 'nejbližší první');
  const withDiamond = pickCandidates(circles, exp, 30, [], [{ x: 100, y: 118 }]);
  assert.equal(withDiamond[0].i, 1, 'kosočtverec má přednost před blíže ležící planetou');
  const afterTry = pickCandidates(circles, exp, 30, [{ x: 100, y: 118 }], [{ x: 100, y: 118 }]);
  assert.deepEqual(afterTry.map((c) => c.i), [0], 'vyzkoušená tečka se nezkouší znovu');
  assert.deepEqual(pickCandidates(circles, exp, 5), []);
});

test('značky: kosočtverec 9×9 se pozná, malý křížek a obří obrys ne', () => {
  const w = 120, h = 80, data = new Uint8ClampedArray(w * h * 4);
  const put = (x, y) => { const p = (y * w + x) * 4; data[p] = data[p + 1] = data[p + 2] = 255; data[p + 3] = 255; };
  for (let d = -4; d <= 4; d++) for (let e = -(4 - Math.abs(d)); e <= 4 - Math.abs(d); e++) put(60 + d, 40 + e); // kosočtverec
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) put(20 + dx, 20 + dy); // křížek 3×3
  for (let x = 0; x < w; x++) { put(x, 0); put(x, h - 1); } // obrys
  const d = findDiamonds(data, w, h);
  assert.equal(d.length, 1);
  assert.ok(Math.abs(d[0].x - 60) < 1 && Math.abs(d[0].y - 40) < 1);
});
