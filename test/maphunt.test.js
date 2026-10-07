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
  const c = pickCandidates(circles, exp, 30, [], [{ x: 230, y: 84, sp: false }, { x: 322, y: 266, sp: true }]);
  assert.equal(c.length, 1, 've vzdálenosti 30 px je jen pravá tečka');
  assert.deepEqual({ x: c[0].x, y: c[0].y }, { x: 230, y: 84 });
});

test('kandidáti: jen velké tečky, sektorová planeta se vynechá, zkoušené se přeskočí, daleké se nebere', () => {
  const exp = { x: 100, y: 100 };
  const circles = [{ x: 108, y: 100 }, { x: 100, y: 118 }, { x: 300, y: 300 }, { x: 104, y: 96 }];
  // jen planeta (malý křížek) 108,100 a velká tečka 100,118: bere se jen velká
  const big = [{ x: 100, y: 118, sp: false }];
  assert.deepEqual(pickCandidates(circles, exp, 30, [], big).map((c) => c.i), [1]);
  // žádná velká tečka (už ji někdo osídlil): žádný kandidát, bot se vrací na velkou mapu a na nic neklikne
  assert.deepEqual(pickCandidates(circles, exp, 30, [], []), []);
  // červená sektorová planeta u očekávané polohy se nikdy nevybere
  assert.deepEqual(pickCandidates(circles, exp, 30, [], [{ x: 104, y: 96, sp: true }]), []);
  assert.deepEqual(pickCandidates(circles, exp, 30, [], [{ x: 104, y: 96, sp: true }, { x: 100, y: 118, sp: false }]).map((c) => c.i), [1]);
  // vyzkoušená tečka se nezkouší znovu
  assert.deepEqual(pickCandidates(circles, exp, 30, [{ x: 100, y: 118 }], big), []);
  // daleko od očekávané polohy = falešná
  assert.deepEqual(pickCandidates(circles, exp, 5, [], big), []);
  // značky nejdou přečíst (null): řadí se jen podle vzdálenosti
  assert.deepEqual(pickCandidates(circles, exp, 30, [], null).map((c) => c.i), [3, 0, 1]);
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
  assert.equal(d[0].sp, false, 'bílý/oranžový kosočtverec není sektorová planeta');
  // červený kosočtverec = sektorová planeta
  const red = new Uint8ClampedArray(w * h * 4);
  for (let dd = -4; dd <= 4; dd++) for (let e = -(4 - Math.abs(dd)); e <= 4 - Math.abs(dd); e++) { const p = ((40 + e) * w + 60 + dd) * 4; red[p] = 221; red[p + 1] = 5; red[p + 2] = 34; red[p + 3] = 255; }
  const r2 = findDiamonds(red, w, h);
  assert.equal(r2.length, 1);
  assert.equal(r2[0].sp, true);
});
