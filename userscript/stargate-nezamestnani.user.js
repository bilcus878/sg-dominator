// ==UserScript==
// @name         Stargate dominator – nezaměstnaní
// @namespace    sg-dominator
// @version      1.0.0
// @description  Na pokyn z aplikace doplní nezaměstnané na planety, kterým chybí lidé: Obchod → Nezaměstnaní, seřadit, poslední červená planeta, Přesunout, zpět.
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
  const RETURN_KEY = 'sgd-unemp-return'; // vracíme se zpět v prohlížeči na seznam (počet kroků)

  const rnd = (a, b) => a + Math.random() * (b - a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (s) => { const d = String(s ?? '').replace(/\D/g, ''); return d ? Number(d) : NaN; };
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* nic */ } }, del: (k) => { try { sessionStorage.removeItem(k); } catch { /* nic */ } } };

  function post(path, data) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'POST', url: `${SERVER}${path}`, headers: { 'content-type': 'application/json', 'x-token': TOKEN },
        data: JSON.stringify(data), timeout: 5000,
        onload: (r) => { try { resolve(JSON.parse(r.responseText)); } catch { resolve(null); } },
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
    return { sorted, sortLink, last, lastLink: lastRow?.cells[0].querySelector('a') };
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
    return { name, need: num(form.querySelector('input[name="pocet"]')?.value), avail, btn };
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
    if (pl) {
      const ins = await post('/unemp/report', { page: 'planet', name: pl.name, need: pl.need, avail: pl.avail });
      if (ins?.action === 'move') {
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
      const ins = await post('/unemp/report', { page: 'list', sorted: L.sorted, last: L.last });
      if (ins?.action === 'sort' && L.sortLink) { await sleep(rnd(800, 2000)); await clickEl(L.sortLink); return; }
      if (ins?.action === 'open' && L.lastLink) { await sleep(rnd(800, 2000)); await clickEl(L.lastLink); return; }
      if (ins?.action === 'reload') { await sleep(rnd(500, 1200)); location.reload(); return; }
      await sleep(1500); // běh neběží: zeptat se znovu
    }
  }
  main();
})();
