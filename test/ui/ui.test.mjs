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
  assert.ok(await b.eval(`document.querySelector('header .bar').getBoundingClientRect().height`) < 70, 'horní technický řádek je štíhlý');
  assert.equal(await b.eval(`getComputedStyle(document.querySelector('header')).position`), 'relative', 'hlavička je statická, neposouvá se při rolování');
  assert.equal(await b.eval(`[...document.querySelectorAll('#viewMenu [data-nav]')].map((e) => e.dataset.nav).join('>')`), 'watch>build>shop>shop>shop>stats', 'rozcestník nabízí všechny pohledy (Obchod má pod sebou své funkce)');
  const order = await b.eval(`[...document.querySelectorAll('.ctl > *')].map(e => e.id || e.className.split(' ')[0]).join('>')`);
  assert.equal(order, 'statpill>mainwrap');
});

test('tabulka: záhlaví přesně nad daty, čísla na středu řádku, výška řádku se zapnutím ± nemění', { skip }, async () => {
  const measure = () => b.eval(`(() => { const p = document.querySelector('${P}'); const R = (e) => Math.round(e.getBoundingClientRect().right), L = (e) => Math.round(e.getBoundingClientRect().left);
    const rows = [...p.querySelectorAll('tbody tr')], th = p.querySelectorAll('thead th'), u = (a) => [...new Set(a)].join(',');
    const tr = rows[0], r = tr.getBoundingClientRect(), mid = (r.top + r.bottom) / 2, c = (e) => { const x = e.getBoundingClientRect(); return Math.round((x.top + x.bottom) / 2 - mid); };
    return { planetyH: R(th[1].querySelector('.hl')), planetyC: u(rows.map((t) => R(t.querySelector('.pv')))), silaH: R(th[2].querySelector('.hl')), silaC: u(rows.map((t) => R(t.querySelectorAll('.pv')[1]))),
      jmenoH: L(th[0].querySelector('.nlbl')), jmena: u(rows.map((t) => L(t.querySelector('.nm')))), vysky: u(rows.map((t) => Math.round(t.getBoundingClientRect().height))),
      stred: [c(tr.querySelector('.pname')), c(tr.querySelector('.pcw .pv')), c(tr.querySelectorAll('.pv')[1]), c(tr.querySelector('.dohodit'))].join(',') }; })()`);
  const a = await measure();
  assert.equal(String(a.planetyH), a.planetyC); assert.equal(String(a.silaH), a.silaC); assert.equal(String(a.jmenoH), a.jmena);
  assert.ok(a.stred.split(',').every((v) => Math.abs(Number(v)) <= 1), 'střed řádku: ' + a.stred); // tolerance 1 px (zaokrouhlení) assert.ok(!a.vysky.includes(','), 'řádky mají stejnou výšku: ' + a.vysky);
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
  // vše v jednom kroku: server mezitím posílá nový stav a přepsal by testovací OP
  const r = await b.eval(`(() => {
    S.op = { enabled: true, at: Date.now(), dots: [${dots}], vigilance: { count: 0, lastClickedAt: 0, pendingSince: 0 }, telescope: {} };
    const chip = document.getElementById('opChip'), pop = () => document.getElementById('opChipPop');
    renderData();
    const out = { visible: !document.getElementById('dstat').hidden, chips: document.querySelectorAll('#dstat .dsrc').length, text: chip.textContent.replace(pop().textContent, ''), sectors: document.querySelectorAll('#opChipPop .opsec').length, popText: pop().textContent, hidden: getComputedStyle(pop()).display };
    chip.focus();
    out.shown = getComputedStyle(pop()).display;
    out.header = document.querySelector('header .bar').getBoundingClientRect().height;
    const popNode = pop().firstChild; renderData(); out.same = popNode === pop().firstChild; // beze změny se nepřekresluje
    S.op.dots = []; renderData(); out.empty = pop().textContent; out.noN = document.getElementById('opChipN').textContent;
    return out;
  })()`);
  assert.equal(r.visible, true);
  assert.equal(r.chips, 1, 'jediný čip místo čipu + odznaku');
  assert.match(r.text, /OP.*5/);
  assert.equal(r.sectors, 5);
  assert.match(r.popText, /Sektor 68 · Tokra/);
  assert.equal(r.hidden, 'none', 'sektory jsou skryté, dokud se nenajede');
  assert.equal(r.shown, 'block', 'po najetí/kliknutí se ukážou');
  assert.ok(r.header < 70, 'hlavička zůstala štíhlá');
  assert.equal(r.same, true, 'překreslení beze změny seznam nezahodí');
  assert.equal(r.empty, '');
  assert.equal(r.noN, '');
});

test('auto-dohoz: v hlavičce už není vypínač DOHOZ, ovládá se přepínačem AUTO v panelech; selhání dohozu ho podbarví červeně', { skip, timeout: 30_000 }, async () => {
  const r = await b.eval(`(() => { // vše v jednom kroku: server mezitím posílá nový stav a přepsal by testovací
    const out = { gone: document.getElementById('armyTgl') === null && document.getElementById('armyAuto') === null, panels: document.querySelectorAll('.autoh').length };
    const el = () => document.querySelector('.autoh');
    S.autoArmy = { pending: [], topping: [], sent: 1, skipped: 0, failed: 1, lastHour: 1, recent: [{ at: S.serverTime, type: 'fail', name: 'Nas1', text: 'nejsou vyplněné jednotky' }] };
    renderAutoArmy(); out.warn = el().classList.contains('warn'); out.warnTitle = el().title;
    S.autoArmy.recent = [{ at: S.serverTime, type: 'sent', name: 'Nas1', text: '' }];
    renderAutoArmy(); out.warnAfter = el().classList.contains('warn'); out.titleAfter = el().title;
    return out;
  })()`);
  assert.equal(r.gone, true, 'hlavičkový vypínač je pryč');
  assert.ok(r.panels >= 1, 'AUTO v panelu zůstalo');
  assert.equal(r.warn, true);
  assert.match(r.warnTitle, /selhal.*nejsou vyplněné jednotky/);
  assert.equal(r.warnAfter, false);
  assert.match(r.titleAfter, /^Auto-dohoz:/, 'původní popis se vrátil');
});

test('Nastavení → Přihlášení: vlastní záložka, přepínač zapnuto/vypnuto zešedne zbytek a vše se uloží na server', { skip, timeout: 30_000 }, async () => {
  await b.eval(`document.getElementById('openSettings').click(); document.querySelector('[data-tab=login]').click(); 1`); await sleep(300);
  assert.equal(await b.eval(`document.getElementById('sesEnabled').checked`), true);
  await b.eval(`const s = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; s('sesAttempts', '5'); s('sesMaintStart', '02:30'); s('sesMaintEnd', '03:15'); document.getElementById('sesNRetry').click(); document.getElementById('sesCloseTab').click(); document.getElementById('sesEnabled').click(); 1`);
  assert.equal(await b.eval(`document.getElementById('pane-login').classList.contains('off')`), true, 'vypnuto = ostatní nastavení zešedlé');
  await b.eval(`document.getElementById('save').click(); 1`); await sleep(800);
  const ses = (await app.api('/api/config')).session;
  assert.equal(ses.enabled, false); assert.equal(ses.maxAttempts, 5); assert.equal(ses.maintStart, '02:30'); assert.equal(ses.maintEnd, '03:15');
  assert.equal(ses.notify.retry, false); assert.equal(ses.closeTab, false);
  // vrátit zpět, ať to nerozhodí další zkoušky
  await b.eval(`document.getElementById('sesEnabled').click(); document.getElementById('save').click(); document.getElementById('closeSettings').click(); 1`); await sleep(500);
  assert.equal((await app.api('/api/config')).session.enabled, true);
});

test('Telegram: tlačítka Najít skupinu (hlavní i servisní) něco udělají – bez platného tokenu ukážou chybu, ne nic', { skip, timeout: 30_000 }, async () => {
  await b.eval(`document.getElementById('openSettings').click(); document.querySelector('[data-tab=channels]').click(); 1`); await sleep(300);
  for (const id of ['findChats', 'findServiceChats']) {
    await b.eval(`document.getElementById('chatList').textContent = ''; document.getElementById('tToken').value = ''; document.getElementById('${id}').click(); 1`); await sleep(500);
    assert.ok((await b.eval(`document.getElementById('chatList').textContent`)).length > 0, id + ' nic neukázalo');
  }
  await b.eval(`document.getElementById('closeSettings').click(); 1`);
});

test('Nastavení → Přihlášení: heslo se uloží, v rozhraní se ukáže jen „uloženo“ a smazat ho jde', { skip, timeout: 30_000 }, async () => {
  await b.eval(`document.getElementById('openSettings').click(); document.querySelector('[data-tab=login]').click(); 1`); await sleep(300);
  await b.eval(`(() => { const sv = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; sv('loginUser', 'tester'); sv('loginPass', 'heslo123'); })(); document.getElementById('loginUse').click(); document.getElementById('save').click(); 1`); await sleep(900);
  const cfgNow = await app.api('/api/config');
  assert.equal(cfgNow.login.hasPassword, true); assert.equal(cfgNow.login.user, 'tester'); assert.ok(!JSON.stringify(cfgNow).includes('heslo123'));
  await b.eval(`document.getElementById('openSettings').click(); document.querySelector('[data-tab=login]').click(); 1`); await sleep(300);
  assert.equal(await b.eval(`document.getElementById('loginPass').value`), '', 'heslo se do pole nevrací');
  assert.match(await b.eval(`document.getElementById('loginPassState').textContent`), /uloženo/);
  await b.eval(`window.confirm = () => true; document.getElementById('loginClear').click(); 1`); await sleep(700);
  assert.equal((await app.api('/api/config')).login.hasPassword, false);
  await b.eval(`document.getElementById('closeSettings').click(); 1`);
});

test('Nastavení → Data: přepočty hráčů se dají vypnout a ukázat statistika; uloží se na server', { skip, timeout: 30_000 }, async () => {
  await b.eval(`document.getElementById('openSettings').click(); document.querySelector('[data-tab=stats]').click(); 1`); await sleep(300);
  assert.match(await b.eval(`document.getElementById('rcStats').textContent`), /Zachyceno/);
  await b.eval(`document.getElementById('rcEco').click(); document.getElementById('rcShowMil').click(); document.getElementById('save').click(); 1`); await sleep(800);
  const r = (await app.api('/api/config')).recalc;
  assert.equal(r.economic, false); assert.equal(r.showMilitary, false); assert.equal(r.military, true);
  await b.eval(`document.getElementById('openSettings').click(); document.querySelector('[data-tab=stats]').click(); document.getElementById('rcEco').click(); document.getElementById('rcShowMil').click(); document.getElementById('save').click(); document.getElementById('closeSettings').click(); 1`); await sleep(700);
  assert.equal((await app.api('/api/config')).recalc.economic, true);
});

test('Profil nastavení: uložení do souboru bez tajných věcí, změna a načtení zpět; rozhraní v Data to ukáže', { skip, timeout: 40_000 }, async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  await app.api('/api/config', 'PUT', { dropPct: 11 });
  await app.api('/api/profile', 'PUT', { name: 'tester', autoSave: false, autoLoad: false });
  const sv = await app.api('/api/profile/save', 'POST', {});
  assert.equal(sv.ok, true);
  const file = join(app.dir, 'profiles', 'tester.json');
  assert.ok(existsSync(file));
  const txt = readFileSync(file, 'utf8');
  assert.ok(!txt.includes('"token"') && !txt.includes('botToken') && !txt.includes('webhookUrl') && !txt.includes('password'), 'v profilu nejsou tajné věci');
  assert.equal(JSON.parse(txt).config.dropPct, 11);
  await app.api('/api/config', 'PUT', { dropPct: 33 });
  assert.equal((await app.api('/api/config')).dropPct, 33);
  const ld = await app.api('/api/profile/load', 'POST', {});
  assert.equal(ld.ok, true); assert.equal(ld.config.dropPct, 11); assert.equal((await app.api('/api/config')).dropPct, 11);
  // po načtení profilu si prohlížeč převezme vzhled a obnoví stránku
  await sleep(2500);
  await b.eval(`document.getElementById('openSettings').click(); document.querySelector('[data-tab=sync]').click(); 1`); await sleep(600);
  assert.equal(await b.eval(`document.getElementById('profName').value`), 'tester');
  assert.match(await b.eval(`document.getElementById('profStatus').textContent`), /tester/);
  await b.eval(`document.getElementById('closeSettings').click(); 1`);
});

test('Statistiky dohozů: pohled v nabídce, přehled, tabulka s rozbalením kol, filtry a nastavení v Data', { skip, timeout: 60_000 }, async () => {
  const { TOKEN } = await import('./harness.mjs');
  const raw = (path, body = {}) => fetch(app.base + path, { method: 'POST', headers: { 'x-token': TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const mk = (low) => ours.map((p, i) => (i === 0 && low ? { ...p, power: 60_000_000 } : p));
  await app.ingest(20, 'Bedrosian', mk(true)); await sleep(500);
  await raw('/army/poll?short=1', { inst: 'u' });
  assert.equal((await app.api('/api/army', 'POST', { name: ours[0].name })).ok, true);
  const s = await raw('/army/poll?short=1', { inst: 'u' });
  await sleep(300); await raw('/army/report', { id: s.id, ok: true }); await sleep(300);
  await app.ingest(20, 'Bedrosian', mk(false)); await sleep(4200);
  await b.eval(`document.querySelector('[data-nav=stats]').click(); 1`); await sleep(900);
  assert.equal(await b.eval(`document.getElementById('statsBox').hidden`), false);
  assert.equal(await b.eval(`document.querySelectorAll('.st-row').length`) >= 1, true);
  assert.match(await b.eval(`document.querySelector('.st-row').textContent`), /Ručně/);
  assert.equal(await b.eval(`document.getElementById('stCards').children.length`), 7, 'přehledové karty');
  await b.eval(`document.querySelector('.st-row').click(); 1`); await sleep(200);
  assert.match(await b.eval(`document.querySelector('.st-detail').textContent`), /zabralo/, 'rozbalená kola');
  await b.eval(`document.querySelector('#stSource [data-v=auto]').click(); 1`); await sleep(700);
  assert.equal(await b.eval(`document.querySelectorAll('.st-row').length`), 0, 'filtr Auto: ruční dohoz se neukáže');
  await b.eval(`document.querySelector('#stSource [data-v=""]').click(); 1`); await sleep(700);
  assert.ok(await b.eval(`document.querySelectorAll('.st-row').length`) >= 1);
  // nastavení
  await b.eval(`document.getElementById('openSettings').click(); document.querySelector('[data-tab=stats]').click(); 1`); await sleep(300);
  assert.equal(await b.eval(`document.getElementById('stEnabled').checked`), true);
  await b.eval(`document.getElementById('closeSettings').click(); document.querySelector('[data-nav=watch]').click(); 1`);
});

test('hlavička: Menu sdružuje upozornění, poslední alerty, nastavení a zavření; zavření se ptá na potvrzení', { skip }, async () => {
  assert.equal(await b.eval(`[...document.querySelectorAll('#mainMenu [data-go]')].map((e) => e.dataset.go).join('>')`), 'notify>alerts>settings>close');
  assert.equal(await b.eval(`document.getElementById('mainMenu').hidden`), true, 'nabídka je zavřená');
  await b.eval(`document.getElementById('mainBtn').click(); 1`); await sleep(150);
  assert.equal(await b.eval(`document.getElementById('mainMenu').hidden`), false);
  // položka Upozornění otevře původní nabídku zvonku (pod tlačítkem Menu) a nabídka Menu se zavře
  await b.eval(`document.querySelector('#mainMenu [data-go=notify]').click(); 1`); await sleep(200);
  assert.equal(await b.eval(`document.getElementById('mainMenu').hidden`), true);
  assert.equal(await b.eval(`document.getElementById('ntMenu').hidden`), false, 'nabídka upozornění se otevřela');
  const near = await b.eval(`(() => { const m = document.getElementById('ntMenu').getBoundingClientRect(), t = document.getElementById('mainBtn').getBoundingClientRect(); return Math.abs(m.right - t.right) < 4 && m.top >= t.bottom; })()`);
  assert.equal(near, true, 'nabídka je zarovnaná pod tlačítkem Menu');
  await b.eval(`document.body.click(); 1`); await sleep(150);
  // zavření aplikace: bez potvrzení nic neudělá
  await b.eval(`window.__asked = 0; window.confirm = () => { window.__asked++; return false; }; document.getElementById('mainBtn').click(); document.querySelector('#mainMenu [data-go=close]').click(); 1`); await sleep(300);
  assert.equal(await b.eval(`window.__asked`), 1);
  assert.ok((await app.api('/api/state')).races !== undefined, 'aplikace dál běží');
});

test('hlavička a rozcestník se vejdou do úzkého okna (420 px) a na široké obrazovce drží vystředěný sloupec', { skip }, async () => {
  const geo = `(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { closeRight: Math.round(r('#mainBtn').right), vw: document.documentElement.clientWidth, navRight: Math.round(r('#viewBtn').right), barLeft: Math.round(r('header .bar').left), barRight: Math.round(r('header .bar').right), mainLeft: Math.round(r('main').left) }; })()`;
  await b.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(400);
  const n = await b.eval(geo);
  assert.ok(n.closeRight <= n.vw && n.navRight <= n.vw, `v úzkém okně nic nepřetéká: ${JSON.stringify(n)}`);
  await b.send('Emulation.setDeviceMetricsOverride', { width: 2600, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(400);
  const w = await b.eval(geo);
  assert.ok(w.barRight - w.barLeft <= 1700, `hlavička není natažená přes celou šířku: ${w.barRight - w.barLeft}`);
  assert.ok(Math.abs(w.barLeft - w.mainLeft) <= 2, 'hlavička i obsah mají stejný levý okraj');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(300);
});

test('Nastavení → Vzhled: živý náhled, téma, akcentní barva, největší velikost, tečka a efekty se použijí hned, uloží a jdou vrátit', { skip, timeout: 30_000 }, async () => {
  await b.eval(`document.getElementById('openSettings').click(); document.querySelector('[data-tab=look]').click(); 1`); await sleep(400);
  assert.ok(await b.eval(`document.querySelectorAll('#lookPrev tbody tr').length`) >= 3, 'náhled má vzorové řádky');
  const acc0 = await b.eval(`getComputedStyle(document.documentElement).getPropertyValue('--acc').trim()`);
  await b.eval(`document.querySelector('#lkTheme [data-v=oled]').click(); document.querySelector('#lkAccent [data-c="#74a8ff"]').click(); document.querySelector('#uiDens [data-v=xl]').click(); 1`); await sleep(300);
  assert.equal(await b.eval(`document.body.dataset.theme + '/' + document.body.dataset.dens`), 'oled/xl');
  assert.equal(await b.eval(`getComputedStyle(document.documentElement).getPropertyValue('--acc').trim()`), '#74a8ff');
  assert.equal(await b.eval(`getComputedStyle(document.body).backgroundColor`), 'rgb(0, 0, 0)', 'černé téma');
  assert.equal(await b.eval(`JSON.parse(localStorage.getItem('uicfg')).accent`), '#74a8ff', 'uloženo');
  await b.eval(`document.getElementById('uiDot').click(); document.getElementById('uiFx').click(); 1`); await sleep(200);
  assert.equal(await b.eval(`document.body.dataset.dot + '/' + document.body.dataset.fx`), 'off/off');
  assert.equal(await b.eval(`getComputedStyle(document.querySelector('td.pname .nl1 .on')).display`), 'none', 'tečka online je schovaná');
  await b.eval(`document.getElementById('lkResetAll').click(); 1`); await sleep(300);
  assert.equal(await b.eval(`document.body.dataset.theme + '/' + document.body.dataset.dens + '/' + document.body.dataset.dot + '/' + document.body.dataset.fx`), 'night/l/on/on');
  assert.equal(await b.eval(`getComputedStyle(document.documentElement).getPropertyValue('--acc').trim()`), acc0, 'výchozí barva zpět');
  await b.eval(`document.getElementById('closeSettings').click(); 1`);
});

test('hlavička: dva nezávislé přepínače 🎯 chytat a 📣 alerty (jen jeden, nebo oba), hlavička zůstane štíhlá', { skip, timeout: 30_000 }, async () => {
  const r = await b.eval(`(() => { // vše v jednom kroku: server mezitím posílá nový stav a přepsal by testovací
    const out = {};
    const base = { at: Date.now(), dots: [], vigilance: { count: 0, lastClickedAt: 0, pendingSince: 0 }, telescope: {} };
    const read = () => ({ hunt: $('opHuntMaster').checked, alert: $('opAlertMaster').checked, tag: !$('opHuntTag').hidden });
    const set = (enabled, hunt, dry, alerts) => { S.op = { ...base, enabled, hunt: { enabled: hunt, dryRun: dry } }; cfg.notifyTypes = alerts ? {} : { op: false }; renderOp(); return read(); };
    out.both = set(true, true, true, true);
    out.onlyHunt = set(true, true, false, false);
    out.onlyAlerts = set(true, false, false, true);
    out.off = set(false, true, false, true); // bot na mapě vypnutý: nic z toho neplatí, i když jsou v nastavení příznaky
    out.header = document.querySelector('header').getBoundingClientRect().height;
    out.order = [...document.querySelectorAll('.statpill > *')].map((e) => e.id || e.className).join('>');
    out.noMaster = document.getElementById('opMaster') === null && document.getElementById('opEnabled2') === null && document.getElementById('opHuntEnabled') === null;
    return out;
  })()`);
  assert.deepEqual(r.both, { hunt: true, alert: true, tag: true }, 've zkušebním režimu má chytání štítek test');
  assert.deepEqual(r.onlyHunt, { hunt: true, alert: false, tag: false }, 'jen chytání (bez zpráv do skupiny)');
  assert.deepEqual(r.onlyAlerts, { hunt: false, alert: true, tag: false }, 'jen alerty');
  assert.deepEqual(r.off, { hunt: false, alert: false, tag: false }, 'vypnutý bot nic nechytá ani nehlásí');
  assert.equal(r.noMaster, true, 'hlavní přepínač OP je pryč');
  assert.ok(r.header < 70, 'hlavička zůstala štíhlá');
  assert.match(r.order, /opHuntTgl.*opAlertTgl/);
});

test('Nastavení → Mapa a OP: přepínače Chytat a Alerty jsou propojené s hlavičkou, starý přepínač OP je pryč', { skip, timeout: 30_000 }, async () => {
  const r = await b.eval(`(() => { // vše v jednom kroku: server mezitím posílá nový stav a přepsal by testovací
    const base = { at: Date.now(), dots: [], vigilance: { count: 0, lastClickedAt: 0, pendingSince: 0 }, telescope: {} };
    S.op = { ...base, enabled: true, hunt: { enabled: true, dryRun: false } }; cfg.notifyTypes = { op: false }; renderOp();
    const a = { head: [$('opHuntMaster').checked, $('opAlertMaster').checked], set: [$('opHuntSet').checked, $('opAlertSet').checked] };
    S.op = { ...base, enabled: true, hunt: { enabled: false, dryRun: false } }; cfg.notifyTypes = {}; renderOp();
    const b2 = { head: [$('opHuntMaster').checked, $('opAlertMaster').checked], set: [$('opHuntSet').checked, $('opAlertSet').checked] };
    return { a, b2, panes: document.getElementById('pane-op').textContent.includes('Zapnout OP') };
  })()`);
  assert.deepEqual(r.a, { head: [true, false], set: [true, false] }, 'jen chytání');
  assert.deepEqual(r.b2, { head: [false, true], set: [false, true] }, 'jen alerty');
  assert.equal(r.panes, false, 'text o starém hlavním přepínači OP zmizel');
});

test('pohledy se jmenují jako ve hře (Vesmír, Stavby, Obchod) a Nezaměstnaní jsou v Obchodu, ne ve Stavbách', { skip }, async () => {
  assert.equal(await b.eval(`[...document.querySelectorAll('#viewMenu .vitem b')].map((e) => e.textContent).join(' | ')`), 'Vesmír | Stavby | Obchod | Nezaměstnaní | Hvězdné brány | Statistiky');
  assert.equal(await b.eval(`document.getElementById('viewLbl').textContent`), 'Vesmír');
  assert.equal(await b.eval(`!!document.querySelector('#shopBox #uStart') && !document.querySelector('#buildBox #uStart')`), true, 'Nezaměstnaní jsou v Obchodu');
  await b.eval(`document.querySelector('[data-nav=shop]').click(); 1`); await sleep(300);
  assert.equal(await b.eval(`document.getElementById('shopBox').hidden + '/' + document.getElementById('buildBox').hidden + '/' + document.getElementById('viewLbl').textContent`), 'false/true/Obchod');
  await b.eval(`document.querySelector('[data-nav=build]').click(); 1`); await sleep(200);
  assert.equal(await b.eval(`document.getElementById('viewLbl').textContent`), 'Stavby');
  await b.eval(`document.querySelector('[data-nav=watch]').click(); 1`);
});

test('Obchod: karta Přerozdělení nezaměstnaných má výchozí podmínky (100–300 mil., zbývá 0, zkušební běh) a uloží změny na server', { skip, timeout: 30_000 }, async () => {
  await b.eval(`document.querySelector('[data-nav=shop]').click(); 1`); await sleep(500);
  assert.equal(await b.eval(`[rdMin.value, rdMax.value, rdFree.value, rdMoves.value, rdDry.checked].join('/')`), '100.000.000/300.000.000/0/100/true');
  await b.eval(`rdMin.value = '150.000.000'; rdMin.dispatchEvent(new Event('change', { bubbles: true })); rdDry.click(); 1`); await sleep(900);
  const c = (await app.api('/api/config')).redist;
  assert.deepEqual([c.minM, c.dry], [150, false]);
  await b.eval(`rdMin.value = '100.000.000'; rdMin.dispatchEvent(new Event('change', { bubbles: true })); rdDry.click(); 1`); await sleep(900);
  assert.deepEqual([(await app.api('/api/config')).redist.minM, (await app.api('/api/config')).redist.dry], [100, true]);
  await b.eval(`document.querySelector('[data-nav=watch]').click(); 1`);
});

test('Obchod: karta Chování má tempo (turbo až velmi pomalé) a pauzu mezi planetami, uloží se na server', { skip, timeout: 30_000 }, async () => {
  await b.eval(`document.querySelector('[data-nav=shop]').click(); 1`); await sleep(500);
  assert.equal(await b.eval(`document.querySelectorAll('#rdPace button').length`), 5);
  assert.equal(await b.eval(`document.querySelector('#rdPace .on').dataset.v + '/' + rdPauseMin.value + '/' + rdPauseMax.value`), '1/4/10');
  await b.eval(`document.querySelector('#rdPace [data-v="1.6"]').click(); rdPauseMin.value = '6'; rdPauseMin.dispatchEvent(new Event('change', { bubbles: true })); 1`); await sleep(900);
  const c = (await app.api('/api/config')).redist;
  assert.deepEqual([c.pace, c.pauseMinSec], [1.6, 6]);
  await b.eval(`document.querySelector('#rdPace [data-v="1"]').click(); rdPauseMin.value = '4'; rdPauseMin.dispatchEvent(new Event('change', { bubbles: true })); 1`); await sleep(900);
  await b.eval(`document.querySelector('[data-nav=watch]').click(); 1`);
});

test('Obchod: omezení obřích planet (měst / lidí) se uloží na server', { skip, timeout: 30_000 }, async () => {
  await b.eval(`document.querySelector('[data-nav=shop]').click(); 1`); await sleep(500);
  assert.equal(await b.eval(`rdGiantCities.value + '/' + rdGiantPeople.value`), '0/0');
  await b.eval(`rdGiantCities.value = '500'; rdGiantCities.dispatchEvent(new Event('change', { bubbles: true })); 1`); await sleep(900);
  assert.equal((await app.api('/api/config')).redist.ignoreCities, 500);
  await b.eval(`rdGiantCities.value = '0'; rdGiantCities.dispatchEvent(new Event('change', { bubbles: true })); 1`); await sleep(900);
  await b.eval(`document.querySelector('[data-nav=watch]').click(); 1`);
});

test('Obchod: hranice „Nejdřív nejprázdnější planety“ (méně než N mil. lidí) se uloží na server', { skip, timeout: 30_000 }, async () => {
  await b.eval(`document.querySelector('[data-nav=shop]').click(); 1`); await sleep(500);
  assert.equal(await b.eval(`rdPrioBelow.value`), '0');
  await b.eval(`rdPrioBelow.value = '50.000.000'; rdPrioBelow.dispatchEvent(new Event('change', { bubbles: true })); 1`); await sleep(900);
  assert.equal((await app.api('/api/config')).redist.prioBelowM, 50);
  await b.eval(`rdPrioBelow.value = '0'; rdPrioBelow.dispatchEvent(new Event('change', { bubbles: true })); 1`); await sleep(900);
  await b.eval(`document.querySelector('[data-nav=watch]').click(); 1`);
});

test('pruh ras: na široké obrazovce celý seznam (naše první, bez přeškrtnutí), na úzké štíhlý řádek Rasy ▾ s rozbalením; klik přidá panel nebo na něj přejde', { skip, timeout: 40_000 }, async () => {
  await b.eval(`(() => { panels = panels.filter((x) => x !== '5'); saveUi(); renderBoard(); })()`); // Aschen (5) nemá panel
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(500);
  assert.equal(await b.eval(`getComputedStyle(document.querySelector('#raceBar .rb-all')).display + '/' + getComputedStyle(document.querySelector('#raceBar .rb-strip')).display`), 'flex/none');
  const names = await b.eval(`[...document.querySelectorAll('#rbAll .rchip:not(.watched) .rname')].map((e) => e.textContent).join('|')`);
  assert.match(names, /^Bedrosian\|/, 'naše rasa je první'); assert.ok(names.includes('Aschen'));
  assert.equal(await b.eval(`[...document.querySelectorAll('#rbAll .rname')].some((e) => getComputedStyle(e).textDecorationLine.includes('line-through'))`), false, 'nic není přeškrtnuté');
  assert.equal(await b.eval(`document.querySelector('#rbAll .rchip.mine').classList.contains('open')`), true);
  await b.eval(`document.querySelector('#rbAll .rchip[data-race="5"]').click(); 1`); await sleep(500);
  assert.equal(await b.eval(`!!document.querySelector('.rpanel[data-p="5"]')`), true, 'klik přidal panel');
  // úzké okno: štíhlý řádek, seznam je schovaný a rozbalí se
  await b.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(500);
  assert.equal(await b.eval(`getComputedStyle(document.querySelector('#raceBar .rb-strip')).display + '/' + getComputedStyle(document.querySelector('#raceBar .rb-all')).display`), 'flex/none');
  assert.equal(await b.eval(`document.getElementById('raceBar').parentElement.tagName`), 'DIV', 'na úzké sedí pruh ras v horní liště');
  assert.ok(Number(await b.eval(`document.getElementById('rbCount').textContent`)) >= 2);
  await b.eval(`document.getElementById('rbToggle').click(); 1`); await sleep(250);
  assert.equal(await b.eval(`getComputedStyle(document.getElementById('rbAll')).display + '/' + document.getElementById('rbToggle').getAttribute('aria-expanded')`), 'grid/true');
  await b.eval(`document.querySelector('#rbAll .rchip[data-race="5"]').click(); 1`); await sleep(300);
  assert.equal(await b.eval(`getComputedStyle(document.getElementById('rbAll')).display`), 'none', 'po kliku na rasu se seznam zavře');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(300);
  await b.eval(`(() => { panels = panels.filter((x) => x !== '5'); saveUi(); renderBoard(); })()`);
});

test('Obchod: funkce jsou rozbalovací panely; položka v nabídce otevře jen tu svou, hlavička panelu přepíná', { skip, timeout: 30_000 }, async () => {
  await b.eval(`document.querySelector('[data-nav=shop]:not([data-fn])').click(); 1`); await sleep(300);
  const r = await b.eval(`(() => {
    const st = () => ['unemp', 'gates'].map((id) => document.getElementById('fn_' + id).classList.contains('open') ? 1 : 0).join('');
    const out = { start: st() };
    document.querySelector('.vitem[data-fn=gates]').click();
    out.gatesOnly = st(); out.shown = document.getElementById('shopBox').hidden === false;
    out.marked = document.querySelector('.vitem[data-fn=gates]').classList.contains('on') && !document.querySelector('.vitem[data-fn=unemp]').classList.contains('on');
    document.querySelector('#fn_unemp .fnhead').click(); out.both = st();
    document.querySelector('#fn_gates .fnhead').click(); out.unempOnly = st();
    out.inert = document.querySelector('#fn_gates .fninner').inert;
    shopStat.gates = { on: true, text: 'zkušební' }; renderShopChips();
    out.chip = document.getElementById('fchip_gates').textContent;
    return out;
  })()`);
  assert.equal(r.gatesOnly, '01', 'z nabídky se otevře jen Hvězdné brány');
  assert.equal(r.shown, true);
  assert.equal(r.marked, true, 'otevřená funkce je v nabídce zvýrazněná');
  assert.equal(r.both, '11', 'hlavička panelu rozbalí další');
  assert.equal(r.unempOnly, '10', 'hlavička panelu sbalí');
  assert.equal(r.inert, true, 'sbalený panel není dostupný z klávesnice');
  assert.equal(r.chip, 'zkušební');
  await b.eval(`document.querySelector('[data-nav=watch]').click(); 1`);
});
