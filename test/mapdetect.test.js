import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** Logika detekce je v userscriptu mezi značkami <detect>; tady ji vytáhneme a spustíme. */
const src = readFileSync(new URL('../userscript/stargate-mapa.user.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// <detect>'), src.indexOf('// </detect>'));
const { findDots, sectorAt } = new Function(`${block}; return { findDots, sectorAt };`)();

/** Minimální dekodér PNG (8bit RGB/RGBA, bez prokládání) – stačí pro obrázek z canvasu. */
function decodePng(buf) {
  let p = 8, w, h, ch, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); ch = { 2: 3, 6: 4 }[body[9]]; assert.equal(body[8], 8); }
    if (type === 'IDAT') idat.push(body);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(w * h * 4, 255);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      line[i] = (line[i] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) out[(y * w + x) * 4 + k] = line[x * ch + k];
    prev = line;
  }
  return { w, h, data: out };
}

function readSectors() {
  const html = readFileSync(new URL('./fixtures/mapa-areas.html', import.meta.url), 'utf8');
  return [...html.matchAll(/<area[^>]*>/g)].map(([tag]) => {
    const get = (a) => tag.match(new RegExp(`${a}="([^"]*)"`))?.[1] ?? '';
    return {
      id: get('href').match(/id_sektor=(\d+)/)?.[1],
      label: get('title').replace(/^Sektor\s*/i, '').trim(),
      pts: get('coords').split(',').map(Number),
    };
  });
}

test('na skutečné mapě najde právě jednu tečku a ta leží v sektoru 129', () => {
  const img = decodePng(readFileSync(new URL('./fixtures/mapa-base.png', import.meta.url)));
  assert.equal(img.w, 711);
  const dots = findDots(img.data, img.w, img.h);
  assert.equal(dots.length, 1);
  assert.ok(dots[0].size >= 20, `velikost ${dots[0].size}`);
  const s = sectorAt(dots[0].x, dots[0].y, readSectors());
  assert.equal(s?.id, '129');
});

test('prázdná mapa nemá žádné tečky; oranžový popisek (#CC6633) se nebere', () => {
  const w = 40, h = 40, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 0xcc; data[i + 1] = 0x66; data[i + 2] = 0x33; data[i + 3] = 255; }
  assert.equal(findDots(data, w, h).length, 0);
});

test('izolovaný pixel barvy tečky (šum) se ignoruje, 7×7 tečka ne', () => {
  const w = 60, h = 30, data = new Uint8ClampedArray(w * h * 4);
  const put = (x, y) => { const i = (y * w + x) * 4; data[i] = 255; data[i + 1] = 178; data[i + 2] = 0; };
  put(3, 3);
  for (let y = 10; y < 17; y++) for (let x = 30; x < 37; x++) if ((x + y) % 2 === 0) put(x, y);
  const dots = findDots(data, w, h);
  assert.equal(dots.length, 1);
  assert.ok(Math.abs(dots[0].x - 33) < 1 && Math.abs(dots[0].y - 13) < 1);
});

test('sectorAt: bod mimo všechny sektory vrací null', () => {
  assert.equal(sectorAt(-5, -5, readSectors()), null);
});
