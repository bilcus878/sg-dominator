// Zkoušky rozhraní v headless Chrome: npm run test:ui (potřebuje nainstalovaný Chrome; jinak se přeskočí).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, launchChrome, openApp, findChrome, makePlayers, sleep } from './harness.mjs';

const skip = findChrome() ? false : 'Chrome nenalezen (nastav CHROME_PATH)';
const P = '.rpanel[data-p="20"]';
let app, b;
const ours = makePlayers(8, 'Nas');
const foreign = makePlayers(6, 'Cizi', 600_000_000);

before(async () => {
  if (skip) return;
  app = await startApp();
  await app.ingest(20, 'Bedrosian', ours);
  await app.ingest(5, 'Aschen', foreign);
  await app.api('/api/config', 'PUT', { myRace: '20', races: { 20: { mode: 'all', threshold: 100_000_000 }, 5: { mode: 'all' } } });
  b = await launchChrome({ width: 900, height: 900 });
  await openApp(app, b, 20);
  await app.ingest(20, 'Bedrosian', ours);
  await sleep(1200);
}, { timeout: 60_000 });
after(async () => { await b?.close(); app?.stop(); });

test('hlavička je jeden štíhlý řádek a tlačítka jsou ve správném pořadí', { skip }, async () => {
  assert.ok(await b.eval(`document.querySelector('header').getBoundingClientRect().height`) < 70);
  const order = await b.eval(`[...document.querySelectorAll('.ctl > *')].map(e => e.id || e.className.split(' ')[0]).join('>')`);
  assert.equal(order, 'hlwrap>opTgl>armyTgl>addwrap>ntwrap>alwrap>openSettings');
});

test('tabulka: záhlaví přesně nad daty, čísla na středu řádku, výška řádku se zapnutím ± nemění', { skip }, async () => {
  const measure = () => b.eval(`(() => { const p = document.querySelector('${P}'); const R = (e) => Math.round(e.getBoundingClientRect().right), L = (e) => Math.round(e.getBoundingClientRect().left);
    const rows = [...p.querySelectorAll('tbody tr')], th = p.querySelectorAll('thead th'), u = (a) => [...new Set(a)].join(',');
    const tr = rows[0], r = tr.getBoundingClientRect(), mid = (r.top + r.bottom) / 2, c = (e) => { const x = e.getBoundingClientRect(); return Math.round((x.top + x.bottom) / 2 - mid); };
    return { planetyH: R(th[1].querySelector('.hl')), planetyC: u(rows.map((t) => R(t.querySelector('.pv')))), silaH: R(th[2].querySelector('.hl')), silaC: u(rows.map((t) => R(t.querySelectorAll('.pv')[1]))),
      jmenoH: L(th[0].querySelector('.nlbl')), jmena: u(rows.map((t) => L(t.querySelector('.nm')))), vysky: u(rows.map((t) => Math.round(t.getBoundingClientRect().height))),
      stred: [c(tr.querySelector('.nm')), c(tr.querySelector('.pcw .pv')), c(tr.querySelectorAll('.pv')[1]), c(tr.querySelector('.dohodit'))].join(',') }; })()`);
  const a = await measure();
  assert.equal(String(a.planetyH), a.planetyC); assert.equal(String(a.silaH), a.silaC); assert.equal(String(a.jmenoH), a.jmena);
  assert.equal(a.stred, '0,0,0,0'); assert.ok(!a.vysky.includes(','), 'řádky mají stejnou výšku: ' + a.vysky);
  await b.eval(`document.querySelector('${P} .ddbtn').click(); 1`); await sleep(400);
  const z = await measure();
  assert.deepEqual([z.planetyH, z.planetyC, z.silaC, z.vysky], [a.planetyH, a.planetyC, a.silaC, a.vysky], 'zapnutí ± nic neposune');
  await b.eval(`document.querySelector('${P} .ddbtn').click(); 1`);
});

test('hledání lupou ve sloupci Jméno filtruje a Esc ho zruší', { skip }, async () => {
  await b.eval(`document.querySelector('${P} .srch').click(); 1`); await sleep(200);
  await b.send('Input.insertText', { text: 'nas3' }); await sleep(400);
  assert.equal(await b.eval(`document.querySelectorAll('${P} tbody tr').length`), 1);
  await b.eval(`document.querySelector('${P} .rfilter').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1`); await sleep(400);
  assert.equal(await b.eval(`document.querySelectorAll('${P} tbody tr').length`), ours.length);
});

test('Moje rasa: vybraná je naše, ostatní cizí; hranice k dobytí se nastavují zvlášť pro rasu', { skip }, async () => {
  const roles = (await app.api('/api/state')).races.filter((r) => r.at).map((r) => `${r.name}:${r.role}`).sort();
  assert.deepEqual(roles, ['Aschen:attack', 'Bedrosian:defend']);
  await b.eval(`(async () => { const w = (ms) => new Promise(r => setTimeout(r, ms)); document.getElementById('addPanel').click(); await w(300); document.querySelector('#addMenu [data-add="5"]')?.click(); await w(600); document.body.click(); return 1; })()`); await sleep(800);
  const A = '.rpanel[data-p="5"]';
  await b.eval(`document.querySelector('${A} .rcfgbtn').click(); 1`); await sleep(300);
  assert.equal(await b.eval(`!document.querySelector('${A} .rcfg').hidden`), true);
  await b.eval(`document.querySelector('${A} .rqb').focus(); 1`); await b.send('Input.insertText', { text: '123000000' });
  await b.eval(`document.querySelector('${A} .rqb').blur(); 1`); await sleep(1200);
  const asch = (await app.api('/api/state')).races.find((r) => r.id === '5');
  assert.equal(asch.conquestOwn.below, 123_000_000);
  assert.equal((await app.api('/api/state')).races.find((r) => r.id === '20').conquestOwn, null);
});

test('pokles pod práh spustí poplach s tlačítkem Ztlumit; návrat nad práh zruší červený řádek', { skip }, async () => {
  ours[1].power = 40_000_000; await app.ingest(20, 'Bedrosian', ours); await sleep(1200); await app.ingest(20, 'Bedrosian', ours);
  assert.ok(await b.waitFor(`!document.getElementById('alarmBar').hidden`, 6000), 'poplach se nespustil');
  assert.ok(await b.eval(`!!document.querySelector('${P} tr.below')`), 'řádek pod prahem není červený');
  await b.eval(`document.getElementById('alarmStop').click(); 1`); await sleep(200);
  assert.equal(await b.eval(`document.getElementById('alarmBar').hidden`), true);
  ours[1].power = 500_000_000; await app.ingest(20, 'Bedrosian', ours); await sleep(1500);
  assert.equal(await b.eval(`!!document.querySelector('${P} tr.below')`), false);
});

test('Alerty: vypnutí druhu zprávy do chatu se uloží na server', { skip }, async () => {
  await b.eval(`document.getElementById('notifyCaret').click(); 1`); await sleep(200);
  await b.eval(`document.querySelector('#ntMenu [data-nt=threshold]').click(); 1`); await sleep(1000);
  assert.equal((await app.api('/api/config')).notifyTypes.threshold, false);
  await b.eval(`document.querySelector('#ntMenu [data-nt=threshold]').click(); document.body.click(); 1`); await sleep(800);
  assert.equal((await app.api('/api/config')).notifyTypes.threshold, undefined);
});

test('Nastavení → Vzhled: malá velikost zmenší řádky a zkrácená čísla zkrátí sílu', { skip }, async () => {
  const h0 = await b.eval(`document.querySelector('${P} tbody tr').getBoundingClientRect().height`);
  await b.eval(`document.getElementById('openSettings').click(); document.querySelector('[data-tab=look]').click(); 1`); await sleep(300);
  await b.eval(`document.querySelector('#uiDens [data-v=s]').click(); document.getElementById('uiShort').click(); 1`); await sleep(500);
  assert.ok(await b.eval(`document.querySelector('${P} tbody tr').getBoundingClientRect().height`) < h0);
  assert.match(await b.eval(`document.querySelectorAll('${P} tbody tr .pv')[1].textContent`), /mil/);
  await b.eval(`document.querySelector('#uiDens [data-v=l]').click(); document.getElementById('uiShort').click(); document.getElementById('closeSettings').click(); 1`); await sleep(300);
});

test('sbalený panel ukazuje název a nabídka ⋮ se ukáže celá (neuřízne ji panel)', { skip }, async () => {
  await b.eval(`document.querySelector('${P} [data-act=fold]').click(); 1`); await sleep(500);
  const f = await b.eval(`(() => { const p = document.querySelector('${P}'); const n = p.querySelector('.rname').getBoundingClientRect(); return { jmeno: Math.round(n.width), rezim: getComputedStyle(p.querySelector('.rmode')).display, text: p.querySelector('.rname').textContent }; })()`);
  assert.ok(f.jmeno > 30 && f.text.length > 2, 'název sbaleného panelu není vidět'); assert.equal(f.rezim, 'none');
  await b.eval(`document.querySelector('${P} [data-act=menu]').click(); 1`); await sleep(300);
  const m = await b.eval(`(() => { const r = document.querySelector('.rmenu').getBoundingClientRect(); return { viditelne: !document.querySelector('.rmenu').hidden, uvnitr: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, vyska: Math.round(r.height) }; })()`);
  assert.ok(m.viditelne && m.uvnitr && m.vyska > 60, JSON.stringify(m));
  await b.eval(`document.body.click(); document.querySelector('${P} [data-act=fold]').click(); 1`); await sleep(400);
});

test('nadpis panelu: štítky se v úzkém panelu nepřekrývají', { skip }, async () => {
  for (const w of ['520px', '440px', '380px']) {
    await b.eval(`document.querySelector('${P}').style.width = '${w}'; 1`); await sleep(500);
    const r = await b.eval(`(() => { const k = [...document.querySelectorAll('${P} .rtitle > *')].filter((e) => e.offsetWidth > 0 && getComputedStyle(e).display !== 'none').map((e) => e.getBoundingClientRect()); for (let i = 1; i < k.length; i++) if (k[i].left < k[i - 1].right - 1) return 'překryv ' + i; return 'ok'; })()`);
    assert.equal(r, 'ok', w);
  }
  await b.eval(`document.querySelector('${P}').style.width = ''; 1`);
});

test('široký panel nic nezkracuje: tužka prahu i sloupec ± zůstávají, dokud je místo', { skip }, async () => {
  await b.eval(`document.querySelector('${P}').style.width = '720px'; 1`); await sleep(600);
  const w = await b.eval(`(() => { const p = document.querySelector('${P}'); return { fit: p.dataset.fit, tuzka: getComputedStyle(p.querySelector('.thl')).display, slot: getComputedStyle(p.querySelector('.ddslot')).display }; })()`);
  assert.ok(!/s\d/.test(w.fit), 'zkráceno: ' + w.fit); assert.notEqual(w.tuzka, 'none'); assert.notEqual(w.slot, 'none');
  await b.eval(`document.querySelector('${P}').style.width = ''; 1`);
});

test('úzký panel zkrátí sloupce místo přetékání', { skip }, async () => {
  await b.eval(`document.querySelector('${P}').style.width = '380px'; 1`); await sleep(500);
  assert.equal(await b.eval(`(() => { const r = document.querySelector('${P} .rbody'); return r.scrollWidth > r.clientWidth + 2; })()`), false);
  await b.eval(`document.querySelector('${P}').style.width = ''; 1`);
});

test('stav systému hlídá jen rasy otevřené jako panel (zavřený panel se nepočítá)', { skip }, async () => {
  await b.eval(`panels = panels.filter((x) => x !== '5'); renderBoard(); 1`); await sleep(400); // panel Aschen zavřu
  await b.eval(`document.getElementById('hlBtn').click(); 1`); await sleep(700);
  const t = await b.eval(`document.getElementById('hlMenu').innerText`);
  assert.match(t, /Bedrosian/); assert.ok(!/Aschen/.test(t), 'zavřená rasa je ve stavu systému: ' + t);
  await b.eval(`document.body.click(); 1`);
});

test('staré údaje (10 s bez příjmu): tabulka ztlumená, okraj červený, LED červená, nápověda Proč', { skip, timeout: 40_000 }, async () => {
  await app.ingest(20, 'Bedrosian', ours); // poslední příjem, pak ticho
  assert.ok(await b.waitFor(`document.querySelector('${P}').dataset.fresh === 'bad'`, 20_000), 'panel nezestárl');
  await sleep(900); // dohrání přechodu průhlednosti
  assert.ok(Number(await b.eval(`getComputedStyle(document.querySelector('${P} tbody')).opacity`)) < 0.6);
  assert.equal(await b.eval(`document.getElementById('hlLed').className`), 'led bad');
  await b.eval(`document.querySelector('${P} .rage').click(); 1`); await sleep(300);
  assert.match(await b.eval(`document.querySelector('.whypop').innerText`), /Síla hráčů/);
  await app.ingest(20, 'Bedrosian', ours);
  assert.ok(await b.waitFor(`document.querySelector('${P}').dataset.fresh === 'ok'`, 5000), 'panel se po návratu dat neoživil');
});

test('nastavení hráče: jedno tlačítko ⚙ otevře okno s dolním prahem i horní hranicí; validace, uložení, výchozí, zavření', { skip, timeout: 40_000 }, async () => {
  const btn = `${P} tbody tr .pset`;
  assert.equal(await b.eval(`document.querySelectorAll('${P} tbody tr:first-child .pset').length`), 1, 'u hráče je jediné tlačítko nastavení');
  assert.equal(await b.eval(`document.querySelectorAll('${P} tbody tr:first-child .thv, ${P} tbody tr:first-child input.thin').length`), 0, 'staré odznaky pryč');
  assert.match(await b.eval(`document.querySelector('${btn}').title`), /Dolní práh[\s\S]*Horní hranice/);
  const name = await b.eval(`document.querySelector('${P} tbody tr .nm').textContent`);
  await b.eval(`document.querySelector('${btn}').click(); 1`); await sleep(300);
  assert.equal(await b.eval(`document.getElementById('psetPop').hidden`), false);
  assert.equal(await b.eval(`document.getElementById('psName').textContent`), name);
  assert.match(await b.eval(`document.getElementById('psLowHelp').textContent`), /pod toto číslo/);
  assert.match(await b.eval(`document.getElementById('psTopHelp').textContent`), /nepřekročí/);
  const set = (id, v) => b.eval(`(() => { const e = document.getElementById('${id}'); e.value = '${v}'; e.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`);
  await set('psLow', '200000000'); await set('psTop', '150000000'); // horní pod dolním: nejde uložit
  await b.eval(`document.getElementById('psSave').click(); 1`); await sleep(300);
  assert.match(await b.eval(`document.getElementById('psErr').textContent`), /musí být vyšší/);
  assert.equal(await b.eval(`document.getElementById('psetPop').hidden`), false);
  await set('psTop', '800000000');
  await b.eval(`document.getElementById('psSave').click(); 1`); await sleep(900);
  assert.equal(await b.eval(`document.getElementById('psetPop').hidden`), true);
  const players = (await app.api('/api/config')).players;
  assert.deepEqual(players[name], { threshold: 200_000_000, topTarget: 800_000_000 });
  assert.match(await b.eval(`document.querySelector('${btn}').innerText`), /↓.*↑/); // vlastní hodnoty na tlačítku
  await b.eval(`document.querySelector('${btn}').click(); 1`); await sleep(300); // znovu: předvyplněno, „výchozí“ vyprázdní pole
  assert.equal(await b.eval(`document.getElementById('psTop').value.split('.').join('')`), '800000000');
  await b.eval(`document.querySelector('[data-reset="low"]').click(); document.querySelector('[data-reset="top"]').click(); 1`);
  assert.equal(await b.eval(`document.getElementById('psLow').value + document.getElementById('psTop').value`), '');
  await b.eval(`document.getElementById('psetPop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1`); // Esc zavře bez uložení
  assert.equal(await b.eval(`document.getElementById('psetPop').hidden`), true);
  assert.equal((await app.api('/api/config')).players[name].topTarget, 800_000_000);
  await b.eval(`document.querySelector('${btn}').click(); 1`); await sleep(300);
  await set('psLow', ''); await set('psTop', '');
  await b.eval(`document.getElementById('psSave').click(); 1`); await sleep(900);
  assert.equal(name in (await app.api('/api/config')).players, false, 'vlastní hodnoty smazány');
});


test('zvuk: nastavení je sdílené přes server (vypnutí v jednom okně vypne všechna, změna na serveru se projeví v okně)', { skip, timeout: 40_000 }, async () => {
  // vypnutí v nabídce Alerty se uloží na server
  await b.eval(`(() => { const cb = document.getElementById('sndOn'); cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); })(); 1`);
  await sleep(1200);
  assert.equal((await app.api('/api/config')).sound.on, false);
  // změna z jiného okna / z konfigurace se do tohoto okna přenese (a nepřepíše se zpět)
  await app.api('/api/config', 'PUT', { sound: { on: true, types: { service: true } } });
  assert.ok(await b.waitFor(`document.getElementById('sndOn').checked === true`, 5000), 'okno nepřevzalo nastavení ze serveru');
  assert.equal(await b.eval(`JSON.parse(localStorage.getItem('sndcfg')).types.service`), true);
  assert.equal((await app.api('/api/config')).sound.on, true);
  await app.api('/api/config', 'PUT', { sound: { on: false } }); // aby další zkoušky nepípaly
});

test('Dohodit svítí při najetí jen na samotné tlačítko, ne na celý řádek', { skip }, async () => {
  const sel = await b.eval(`(() => { const out = []; for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) { if (r.selectorText && /dohodit/.test(r.selectorText) && /:hover/.test(r.selectorText)) out.push(r.selectorText); } } catch {} } return out; })()`);
  assert.ok(sel.length >= 1, 'hover styl tlačítka chybí');
  for (const s of sel) assert.doesNotMatch(s, /(tr|td|\.rbody|tbody)[^,]*:hover[^,]*\.dohodit/, `podsvícení celým řádkem: ${s}`);
});

test('OP v hlavičce: víc teček = jeden odznak s počtem, sektory v rozbalovacím seznamu; hlavička se nerozbije', { skip, timeout: 30_000 }, async () => {
  const dots = [['30', '30'], ['25', '25'], ['68', 'Tokra'], ['86', '86'], ['51', '51']].map(([id, label]) => `{ id: '${id}', label: '${label}' }`).join(', ');
  await b.eval(`S.op = { enabled: true, at: Date.now(), dots: [${dots}], vigilance: { count: 0, lastClickedAt: 0, pendingSince: 0 }, telescope: {} }; renderOp(); 1`);
  assert.equal(await b.eval(`document.querySelectorAll('#opDots .opdot').length`), 1, 'jediný odznak místo jednoho na každý sektor');
  assert.match(await b.eval(`document.querySelector('#opDots .opsum').firstChild.textContent`), /5/);
  assert.equal(await b.eval(`document.querySelectorAll('#opDots .opsec').length`), 5);
  assert.match(await b.eval(`document.querySelector('#opDots .oppop').textContent`), /Sektor 68 · Tokra/);
  assert.equal(await b.eval(`getComputedStyle(document.querySelector('#opDots .oppop')).display`), 'none', 'sektory jsou skryté, dokud se nenajede');
  await b.eval(`document.querySelector('#opDots .opsum').focus(); 1`);
  assert.equal(await b.eval(`getComputedStyle(document.querySelector('#opDots .oppop')).display`), 'block', 'po najetí/kliknutí se ukážou');
  assert.ok(await b.eval(`document.querySelector('header').getBoundingClientRect().height`) < 70, 'hlavička zůstala štíhlá');
  // překreslení beze změny nezahodí odznak (seznam pod myší nemizí)
  await b.eval(`window.__opNode = document.querySelector('#opDots .opsum'); renderOp(); 1`);
  assert.equal(await b.eval(`window.__opNode === document.querySelector('#opDots .opsum')`), true);
  await b.eval(`S.op.dots = []; renderOp(); 1`);
  assert.equal(await b.eval(`document.getElementById('opDots').innerHTML`), '');
});
