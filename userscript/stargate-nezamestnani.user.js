// ==UserScript==
// @name         Stargate dominator – nezaměstnaní
// @namespace    sg-dominator
// @version      1.4.0
// @description  Na pokyn z aplikace doplní nezaměstnané na planety, kterým chybí lidé, nebo je přerozdělí z plných planet na planety s volným místem: Obchod → Nezaměstnaní, seřadit, otevřít planetu, vybrat cíl, Přesunout, zpět.
// @match        https://stargate-game.cz/obchod.php*
// @match        https://www.stargate-game.cz/obchod.php*
// @match        https://stargate-game.cz/planety.php*
// @match        https://www.stargate-game.cz/planety.php*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  const SERVER = '__SERVER__';
  const TOKEN = '__TOKEN__';
  const MOVED_KEY = 'sgd-unemp-moved'; // kliknuto na Přesunout: na další stránce nahlásit, že je přesunuto
  const OPEN_KEY = 'sgd-unemp-open'; // otevíráme planetu (název): když na ní není formulář Přesunout, vrátíme se zpět a zkusíme další
  const RETURN_KEY = 'sgd-unemp-return'; // vracíme se zpět v prohlížeči na seznam (počet kroků)

  const rnd = (a, b) => a + Math.random() * (b - a);
  // tempo z aplikace (Obchod → Chování): násobek všech lidských pauz (menší = rychlejší) a náhodná pauza mezi planetami
  let speed = 1, pauseRange = [0, 0];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms * speed));
  const rawSleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (s) => { const d = String(s ?? '').replace(/\D/g, ''); return d ? Number(d) : NaN; };
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* nic */ } }, del: (k) => { try { sessionStorage.removeItem(k); } catch { /* nic */ } } };

  function post(path, data) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'POST', url: `${SERVER}${path}`, headers: { 'content-type': 'application/json', 'x-token': TOKEN },
        data: JSON.stringify(data), timeout: 5000,
        onload: (r) => { try { const j = JSON.parse(r.responseText); if (Number.isFinite(j?.speed) && j.speed > 0) speed = Math.min(3, Math.max(0.25, j.speed)); if (Array.isArray(j?.pause)) pauseRange = [Number(j.pause[0]) || 0, Number(j.pause[1]) || 0]; resolve(j); } catch { resolve(null); } },
        onerror: () => resolve(null), ontimeout: () => resolve(null),
      });
    });
  }

  /** Klik myší se souřadnicemi; k prvku se nejdřív doscrolluje (seznam je dlouhý). */
  async function clickEl(el) {
    for (let i = 0; i < 80; i++) {
      const r = el.getBoundingClientRect();
      if (r.top > 80 && r.bottom < innerHeight - 80) break;
      window.scrollBy(0, Math.sign(r.top - innerHeight / 2) * Math.min(Math.abs(r.top - innerHeight / 2), rnd(250, 700)));
      await sleep(rnd(30, 90));
    }
    await sleep(rnd(250, 700));
    const r = el.getBoundingClientRect();
    const pt = { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: Math.round(r.left + r.width * rnd(0.3, 0.7)), clientY: Math.round(r.top + r.height * rnd(0.3, 0.7)) };
    el.dispatchEvent(new MouseEvent('mousedown', pt));
    await sleep(rnd(50, 130));
    el.dispatchEvent(new MouseEvent('mouseup', pt));
    el.dispatchEvent(new MouseEvent('click', pt));
  }

  // ---------- stránky ----------
  /** Seznam planet v Obchod → Nezaměstnaní (tabulka s „Počet měst“ a „Zbývá míst“). */
  function listTable() {
    return [...document.querySelectorAll('table')].find((t) => /Počet měst/.test(t.textContent) && /Zbývá míst/.test(t.textContent)) ?? null;
  }
  function readList(tbl) {
    const hdr = [...tbl.querySelectorAll('tr')].find((r) => /Počet měst/.test(r.textContent));
    const sortLink = [...hdr.querySelectorAll('a')].find((a) => /Nezaměstnaných/.test(a.textContent));
    const sorted = new URL(location.href).searchParams.get('filtr') === '3' || !sortLink; // seřazeno = sloupec už není odkaz
    const rows = [...tbl.querySelectorAll('tr')].filter((r) => r !== hdr && r.cells.length >= 5 && r.cells[0].querySelector('a'));
    const lastRow = rows[rows.length - 1];
    const red = lastRow?.cells[3].querySelector('span.asistent'); // červené číslo = lidé na planetě chybí
    const last = lastRow ? { name: lastRow.cells[0].textContent.trim(), missing: red ? num(red.textContent) : 0 } : null;
    return { sorted, sortLink, last, lastLink: lastRow?.cells[0].querySelector('a'), rows };
  }
  const firstNum = (t) => { const m = String(t ?? '').match(/\d[\d\s\u00a0]*/); return m ? Number(m[0].replace(/\D/g, '')) : NaN; };
  /** Celý seznam planet pro přerozdělení: název, města, lidé na planetě, nezaměstnaní (první číslo v buňce), zbývá míst. */
  function rowsData(rows) {
    return rows.map((r) => ({ name: r.cells[0].textContent.trim(), cities: num(r.cells[1].textContent), people: num(r.cells[2].textContent), unemployed: firstNum(r.cells[3].textContent), free: num(r.cells[4].textContent), missing: (() => { const red = r.cells[3].querySelector('span.asistent'); return red ? num(red.textContent) : 0; })() }))
      .filter((r) => r.name && Number.isFinite(r.people) && Number.isFinite(r.unemployed) && Number.isFinite(r.free));
  }
  /** Detail planety s formulářem „Přesunutí nezaměstnaných“. */
  function readPlanet() {
    const btn = document.querySelector('input[name="presunout_nez"]');
    const form = btn?.form;
    if (!form) return null;
    const name = (document.body.innerText.match(/Detaily planety\s*[„"“]\s*([^“”"]+?)\s*[“”"]/) ?? [])[1] ?? '';
    const zb = form.textContent.match(/zbývá:\s*([\d\s ]+)\s*(miliard|milión|milion|tisíc)?/i);
    let avail = null;
    if (zb) { const u = (zb[2] ?? '').toLowerCase(); avail = num(zb[1]) * (u.startsWith('miliard') ? 1e9 : u.startsWith('mili') ? 1e6 : u.startsWith('tis') ? 1e3 : 1); }
    const sel = form.querySelector('select[name="id_pl_cil"]');
    const options = sel ? [...sel.options].map((o) => o.textContent.trim().replace(/\s*\(.*$/, '')) : [];
    const count = num(form.querySelector('input[name="pocet"]')?.value); // kolik hra předvyplnila (kolik jde poslat): bot ho nikdy nepřepisuje
    return { name, need: count, count, avail, options, sel, btn };
  }

  async function main() {
    // 1) po kliknutí na Přesunout: nahlásit a vrátit se zpět
    const moved = ss.get(MOVED_KEY);
    if (moved) {
      ss.del(MOVED_KEY);
      const ins = await post('/unemp/report', { page: 'moved', name: moved });
      if (ins?.action === 'back') { ss.set(RETURN_KEY, '1'); await sleep(rnd(500, 1100)); history.back(); }
      return;
    }
    const tbl = listTable();
    // 2) cestou zpět: dokud nejsme na seznamu, ještě o krok zpět (nejvýš 3×)
    const ret = Number(ss.get(RETURN_KEY) || 0);
    if (ret && !tbl) {
      if (ret >= 3) { ss.del(RETURN_KEY); return; }
      ss.set(RETURN_KEY, String(ret + 1));
      await sleep(rnd(300, 700));
      history.back();
      return;
    }
    ss.del(RETURN_KEY);

    // 3) detail planety
    const pl = readPlanet();
    const opened = ss.get(OPEN_KEY);
    if (opened) ss.del(OPEN_KEY);
    if (!pl && !tbl && opened) { // planetu jsme otevřeli, ale není na ní tlačítko Přesunout (třeba nově osídlená planeta, ze které se přesouvat nedá): zpět a další
      await post('/unemp/report', { page: 'failed', name: opened, error: 'na planetě není tlačítko Přesunout (nově osídlená?)' });
      ss.set(RETURN_KEY, '1');
      await sleep(rnd(700, 1500));
      history.back();
      return;
    }
    if (pl) {
      const ins = await post('/unemp/report', { page: 'planet', name: pl.name, need: pl.need, count: pl.count, avail: pl.avail, options: pl.options });
      if (ins?.action === 'move') {
        if (ins.target) { // přerozdělení: vybrat cílovou planetu v nabídce „Na vlastní planetu“ (počet se nemění)
          const opt = pl.sel && [...pl.sel.options].find((o) => o.textContent.trim().startsWith(ins.target + ' ('));
          if (!opt) { await post('/unemp/report', { page: 'failed', name: pl.name, error: `cíl ${ins.target} není v nabídce` }); ss.set(RETURN_KEY, '1'); history.back(); return; }
          await sleep(rnd(700, 1600));
          pl.sel.value = opt.value;
          pl.sel.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(rnd(500, 1200));
          if (pl.sel.value !== opt.value || num(document.querySelector('input[name="pocet"]')?.value) !== pl.count) { await post('/unemp/report', { page: 'failed', name: pl.name, error: 'formulář se změnil, přesun se neodeslal' }); ss.set(RETURN_KEY, '1'); history.back(); return; }
        }
        await sleep(rnd(900, 2200));
        ss.set(MOVED_KEY, pl.name);
        await clickEl(pl.btn);
      } else if (ins?.action === 'back') {
        ss.set(RETURN_KEY, '1');
        history.back();
      }
      return;
    }

    // 4) seznam: ptát se, dokud běh neběží / nepřijde pokyn
    if (!tbl) return;
    for (;;) {
      const L = readList(tbl);
      let ins = await post('/unemp/report', { page: 'list', sorted: L.sorted, last: L.last });
      if (ins?.action === 'send-rows') ins = await post('/unemp/report', { page: 'list', sorted: L.sorted, last: L.last, rows: rowsData(L.rows) }); // přerozdělení potřebuje celou tabulku
      if (ins?.action === 'sort' && L.sortLink) { await sleep(rnd(800, 2000)); await clickEl(L.sortLink); return; }
      if (ins?.action === 'open') {
        await rawSleep(rnd(pauseRange[0], Math.max(pauseRange[0], pauseRange[1])) * 1000); // pauza mezi planetami (Obchod → Chování)
        const link = (ins.name && L.rows.find((r) => r.cells[0].textContent.trim() === ins.name)?.cells[0].querySelector('a')) || L.lastLink;
        if (link) { await sleep(rnd(800, 2000)); ss.set(OPEN_KEY, link.textContent.trim()); await clickEl(link); return; }
      }
      if (ins?.action === 'reload') { await sleep(rnd(500, 1200)); location.reload(); return; }
      await sleep(1500); // běh neběží: zeptat se znovu
    }
  }
  main();
})();
