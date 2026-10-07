import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Ochrana před tichým rozbitím rozhraní: každé id, na které se skripty odvolávají přes $('id') / getElementById('id'),
// musí existovat v index.html nebo vznikat v samotných skriptech. Chybějící prvek (třeba po přestavbě hlavičky) jinak
// způsobí „Cannot read properties of null“ a zastaví vykreslování celé části aplikace (např. stavu stavění).
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('každé id, které skripty rozhraní používají, existuje v index.html (nebo ho vytvářejí samy)', () => {
  const html = read('../public/index.html');
  const dir = new URL('../public/js/', import.meta.url);
  const js = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  const ids = new Set();
  for (const m of js.matchAll(/\$\('([A-Za-z][A-Za-z0-9_-]*)'\)|getElementById\('([A-Za-z][A-Za-z0-9_-]*)'\)/g)) ids.add(m[1] ?? m[2]);
  const exists = (id) => html.includes(`id="${id}"`) || js.includes(`id="${id}"`) || js.includes(`id=\\"${id}`) || js.includes(`id='${id}`) || js.includes(`.id = '${id}'`);
  const missing = [...ids].filter((id) => !exists(id));
  assert.deepEqual(missing, [], `skripty používají prvky, které v index.html nejsou: ${missing.join(', ')}`);
});
