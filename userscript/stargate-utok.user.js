// ==UserScript==
// @name         Stargate dominator – útok (D)
// @namespace    sg-dominator
// @version      3.0.0
// @description  Na stránce útoku vyplní jednotky a vybere náhodnou planetu cíle. Odeslání a F5 děláš ty sám (jen když se otevře kliknutím na útok v aplikaci)
// @match        https://stargate-game.cz/utok.php*
// @match        https://www.stargate-game.cz/utok.php*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  const SERVER = '__SERVER__';
  const TOKEN = '__TOKEN__';

  // <logic> čistá logika bez DOM (testuje se v test/utok-script.test.js)
  const strip = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  /** "18 822 832" -> 18822832, "7,3" -> 7.3; bez čísla null. */
  function toNum(text) {
    let t = String(text ?? '').replace(/[\s\u00a0]/g, '');
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(t)) t = t.replace(/\./g, ''); // "2.000.000" = te\u010dky po tis\u00edc\u00edch (hra tak form\u00e1tuje vypln\u011bn\u00e9 pole)
    const m = t.match(/\d+(?:[.,]\d+)?/);
    return m ? parseFloat(m[0].replace(',', '.')) : null;
  }

  /** Z možností výběru planety vybere náhodnou použitelnou (bez prázdné a zakázané); `not` = hodnota, kterou nechceme. */
  function pickPlanet(options, rnd = Math.random, not = null) {
    let ok = options.filter((o) => o.value !== '' && !o.disabled);
    if (not !== null && ok.length > 1) ok = ok.filter((o) => o.value !== not);
    return ok.length ? ok[Math.floor(rnd() * ok.length)] : null;
  }

  /**
   * Co do kterých řádků vyplnit. rows = [{name, available}], units = nastavení [{name, count, max}].
   * Pošle se nejvýš tolik, kolik je k dispozici; jednotka s počtem 0 a bez „Max“ se přeskočí.
   */
  function planFill(rows, units) {
    const byName = new Map(units.map((u) => [strip(u.name), u]));
    const out = [];
    rows.forEach((r, i) => {
      const u = byName.get(strip(r.name));
      if (!u) return;
      if (u.max) { out.push({ i, name: r.name, mode: 'max' }); return; }
      if (!(u.count > 0)) return;
      const value = r.available != null ? Math.min(u.count, r.available) : u.count;
      if (value > 0) out.push({ i, name: r.name, mode: 'value', value });
    });
    return out;
  }

  /** Adresa z aplikace: #dominator=P (P = druh útoku, písmeno jako ve hře: D P Z U N L S T); #dominator bez druhu = dobývací. */
  function parseHash(hash) {
    const m = /^#dominator(?:=([A-Z]))?$/.exec(hash ?? '');
    return m ? { fill: true, type: m[1] ?? 'D' } : { fill: false, type: null };
  }
  // </logic>

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const human = (a = 250, b = 700) => sleep(rand(a, b));

  function api(method, path, body, timeout = 5000) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method, url: `${SERVER}${path}`,
        headers: { 'content-type': 'application/json', 'x-token': TOKEN },
        data: body ? JSON.stringify(body) : undefined,
        timeout,
        onload: (r) => { try { resolve(JSON.parse(r.responseText)); } catch { resolve(null); } },
        onerror: () => resolve(null), ontimeout: () => resolve(null),
      });
    });
  }

  async function waitFor(fn, ms = 8000) {
    const end = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(250);
    }
  }

  /** Tabulka jednotek: hlavička s „Název“ a „Poslat“ (nejvnitřnější taková tabulka). */
  function findUnitsTable() {
    return [...document.querySelectorAll('table')].find((t) => !t.querySelector('table') && /poslat/i.test(t.textContent) && /n[aá]zev/i.test(t.textContent)) ?? null;
  }

  function readRows(table) {
    const trs = [...table.querySelectorAll('tr')];
    const head = trs.find((tr) => /n[aá]zev/i.test(tr.textContent) && /poslat/i.test(tr.textContent));
    const cols = [...head.children].map((c) => strip(c.textContent));
    const idx = (re) => cols.findIndex((c) => re.test(c));
    const iName = Math.max(0, idx(/^nazev/)), iAvail = idx(/^pocet/), iAtk = idx(/^utok/), iSend = idx(/^poslat/);
    const rows = [];
    for (const tr of trs.slice(trs.indexOf(head) + 1)) {
      const cells = [...tr.children];
      if (cells.length <= Math.max(iName, iSend)) continue;
      const sendCell = cells[iSend] ?? tr;
      const input = sendCell.querySelector('input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio])');
      if (!input) continue;
      const maxBtn = [...sendCell.querySelectorAll('input[type=button],input[type=submit],button,a,span')].find((e) => /^max$/i.test((e.value || e.textContent || '').trim())) ?? null;
      rows.push({
        name: cells[iName].textContent.trim(),
        available: iAvail >= 0 ? toNum(cells[iAvail].textContent) : null,
        attack: iAtk >= 0 ? toNum(cells[iAtk].textContent) : null,
        input, maxBtn,
      });
    }
    return rows;
  }

  /** Výběr planet cíle (ve hře select name=pl_id); jinak první select s možnostmi. */
  function findPlanetSelect() {
    const byName = document.querySelector('select[name=pl_id]');
    if (byName && byName.options.length) return byName;
    const sels = [...document.querySelectorAll('select')].filter((s) => s.options.length > 0);
    return sels.find((s) => /planet/i.test(s.closest('form')?.textContent.slice(0, 600) ?? s.parentElement?.textContent ?? '')) ?? sels[0] ?? null;
  }

  /** Tlačítko Zaútočit: ve hře <button id="zautocit"><img alt="Zaútočit"></button> (bez textu), proto podle id, jména a alt. */
  function findSubmit() {
    return document.querySelector('#zautocit, button[name=zautocit], input[name=zautocit]')
      ?? [...document.querySelectorAll('input[type=submit],input[type=button],button')].find((b) => /za[uú]to[cč]it/i.test(b.value || b.textContent || b.querySelector('img')?.alt || '')) ?? null;
  }

  /** Nastaví hodnotu tak, aby si toho všimly i skripty stránky (nativní setter + události). */
  function setValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    if (setter) setter.call(el, String(value)); else el.value = String(value);
    for (const t of ['input', 'change', 'keyup']) el.dispatchEvent(new Event(t, { bubbles: true }));
  }

  const targetText = () => (document.body.textContent.match(/C[ií]l:\s*([^|\n]{1,60}?)\s*(?:\||S[ií]la|\n)/) ?? [])[1]?.trim() ?? '';
  const planetLabel = (sel) => sel?.options[sel.selectedIndex]?.text.trim() ?? '';

  /** Vyplní jednotky podle plánu; vrací co se vyplnilo a případné problémy. */
  async function fillUnits(cfgUnits, fast = false) {
    const filled = [], problems = [];
    const rows = readRows(findUnitsTable());
    const plan = planFill(rows, cfgUnits);
    if (!plan.length) problems.push('v nastavení není žádná jednotka k poslání (počet 0 a bez Max)');
    for (const a of plan) {
      if (!fast) await human(150, 450); // při opakování po srážce se nezdržujeme
      const row = rows[a.i];
      if (a.mode === 'max') {
        if (!row.maxBtn) { problems.push(`u jednotky ${a.name} chybí tlačítko Max`); continue; }
        row.maxBtn.click();
        await sleep(200);
        const got = toNum(row.input.value); // Max doplní hra podle toho, co teď smí poslat; může vyjít 0
        if (got > 0) filled.push({ name: a.name, value: 'max', sent: got, available: row.available });
        else problems.push(`${a.name}: Max nic nevyplnilo (hra teď nedovoluje poslat žádnou)`);
      } else {
        setValue(row.input, a.value);
        const got = toNum(row.input.value);
        if (got > 0) filled.push({ name: a.name, value: a.value, sent: got, available: row.available });
        else problems.push(`${a.name}: hodnota se nevyplnila`);
      }
    }
    return { filled, problems };
  }

  async function main() {
    const h = parseHash(location.hash);
    const table = await waitFor(findUnitsTable);
    if (!table) return;
    const rows = readRows(table);
    if (!h.fill) return; // stránka otevřená normálně, ne kliknutím na útok v aplikaci

    // jména jednotek jdou do nastavení v aplikaci (s počtem 0), ať je stačí jen přepsat
    api('POST', '/attack/seen', { type: h.type, units: rows.map((r) => ({ name: r.name, available: r.available, attack: r.attack })) });

    const cfg = await api('GET', `/attack/config?t=${h.type}`);
    if (!cfg || !Array.isArray(cfg.units)) {
      api('POST', '/attack/report', { ok: false, problems: ['nepodařilo se načíst nastavení útoku z aplikace (běží? je skript aktuální?)'] });
      return;
    }
    history.replaceState(null, '', location.pathname + location.search); // F5 už znovu nevyplňuje

    const problems = [];
    const sel = findPlanetSelect();
    if (cfg.randomPlanet && sel) {
      const opt = pickPlanet([...sel.options].map((o) => ({ value: o.value, text: o.text, disabled: o.disabled })));
      if (opt && opt.value !== sel.value) { await human(400, 900); setValue(sel, opt.value); }
    }
    const { filled, problems: p2 } = await fillUnits(cfg.units);
    problems.push(...p2);
    const submit = findSubmit();
    if (submit) submit.focus({ preventScroll: true }); // jen zaměřit; klikneš si sám
    else problems.push('tlačítko Zaútočit nenalezeno');
    api('POST', '/attack/report', { ok: filled.length > 0 && !problems.length, submitted: false, planet: planetLabel(sel), target: targetText(), filled, problems });
  }

  main().catch((e) => api('POST', '/attack/report', { ok: false, problems: [`chyba skriptu: ${String(e?.message ?? e).slice(0, 120)}`] }));

})();
