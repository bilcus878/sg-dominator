// ==UserScript==
// @name         Stargate dominator – útok (D)
// @namespace    sg-dominator
// @version      1.0.0
// @description  Na stránce dobývacího útoku vyplní jednotky podle nastavení a vybere náhodnou planetu cíle (jen když se otevře tlačítkem D v aplikaci)
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
  const JOB_KEY = 'sgd-attack-job'; // rozdělaná práce přes přenačtení stránky (výběr planety může stránku obnovit)
  const JOB_MS = 30_000;

  // <logic> čistá logika bez DOM (testuje se v test/utok-script.test.js)
  const strip = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  /** "18 822 832" -> 18822832, "7,3" -> 7.3; bez čísla null. */
  function toNum(text) {
    const m = String(text ?? '').replace(/[\s\u00a0]/g, '').match(/\d+(?:[.,]\d+)?/);
    return m ? parseFloat(m[0].replace(',', '.')) : null;
  }

  /** Z možností výběru planety vybere náhodnou použitelnou (bez prázdné a zakázané). */
  function pickPlanet(options, rnd = Math.random) {
    const ok = options.filter((o) => o.value !== '' && !o.disabled);
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
  // </logic>

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const human = (a = 250, b = 700) => sleep(rand(a, b));

  function api(method, path, body) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method, url: `${SERVER}${path}`,
        headers: { 'content-type': 'application/json', 'x-token': TOKEN },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 5000,
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

  function findPlanetSelect() {
    const sels = [...document.querySelectorAll('select')].filter((s) => s.options.length > 0);
    return sels.find((s) => /planet/i.test(s.closest('form')?.textContent.slice(0, 600) ?? s.parentElement?.textContent ?? '')) ?? sels[0] ?? null;
  }

  function findSubmit() {
    return [...document.querySelectorAll('input[type=submit],input[type=button],button')].find((b) => /za[uú]to[cč]it/i.test(b.value || b.textContent)) ?? null;
  }

  /** Nastaví hodnotu tak, aby si toho všimly i skripty stránky (nativní setter + události). */
  function setValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    if (setter) setter.call(el, String(value)); else el.value = String(value);
    for (const t of ['input', 'change', 'keyup']) el.dispatchEvent(new Event(t, { bubbles: true }));
  }

  const readJob = () => { try { const j = JSON.parse(sessionStorage.getItem(JOB_KEY)); return j && Date.now() - j.ts < JOB_MS ? j : null; } catch { return null; } };
  const writeJob = (j) => { try { sessionStorage.setItem(JOB_KEY, JSON.stringify(j)); } catch { /* bez úložiště to jede dál */ } };
  const clearJob = () => { try { sessionStorage.removeItem(JOB_KEY); } catch { /* nic */ } };

  async function main() {
    const table = await waitFor(findUnitsTable);
    if (!table) return;
    const rows = readRows(table);

    // vždy: jména jednotek jdou do nastavení v aplikaci (s počtem 0), ať je stačí jen přepsat
    api('POST', '/attack/seen', { units: rows.map((r) => ({ name: r.name, available: r.available, attack: r.attack })) });

    // dál jen když stránku otevřelo tlačítko D v aplikaci (#dominator), nebo pokračuje rozdělaná práce
    const job = readJob();
    if (location.hash !== '#dominator' && !job) return;

    const problems = [];
    const cfg = await api('GET', '/attack/config');
    if (!cfg || !Array.isArray(cfg.units)) {
      api('POST', '/attack/report', { ok: false, problems: ['nepodařilo se načíst nastavení útoku z aplikace (běží? je skript aktuální?)'] });
      return;
    }
    const target = (document.body.textContent.match(/C[ií]l:\s*([^|\n]{1,60})/) ?? [])[1]?.trim() ?? '';

    // 1) náhodná planeta cíle; výběr může stránku obnovit, proto se rozdělaná práce pamatuje
    let planetText = '';
    const sel = findPlanetSelect();
    if (cfg.randomPlanet && sel) {
      if (!job?.planet) {
        const opt = pickPlanet([...sel.options].map((o) => ({ value: o.value, text: o.text, disabled: o.disabled })));
        if (opt && opt.value !== sel.value) {
          writeJob({ ts: Date.now(), planet: opt.value });
          await human(400, 900);
          setValue(sel, opt.value);
          await sleep(1800); // když se stránka obnoví, skript pokračuje po načtení
        }
      }
      planetText = sel.options[sel.selectedIndex]?.text.trim() ?? '';
    } else if (cfg.randomPlanet && !sel) problems.push('výběr planety nenalezen');
    clearJob();

    // 2) jednotky
    const filled = [];
    const fresh = readRows(findUnitsTable() ?? table);
    const plan = planFill(fresh, cfg.units);
    if (!plan.length) problems.push('v nastavení není žádná jednotka k poslání (počet 0 a bez Max)');
    for (const a of plan) {
      await human(150, 450);
      const row = fresh[a.i];
      if (a.mode === 'max') {
        if (row.maxBtn) { row.maxBtn.click(); filled.push({ name: a.name, value: 'max' }); }
        else problems.push(`u jednotky ${a.name} chybí tlačítko Max`);
      } else {
        setValue(row.input, a.value);
        filled.push({ name: a.name, value: a.value });
      }
    }

    // 3) odeslání jen na výslovné přání v nastavení; jinak se útok připraví a čeká na tebe
    const submit = findSubmit();
    let submitted = false;
    if (cfg.autoSubmit && submit && filled.length && !problems.length) {
      await human(700, 1600);
      submit.click();
      submitted = true;
    } else if (submit) {
      submit.focus({ preventScroll: true });
    } else problems.push('tlačítko Zaútočit nenalezeno');

    if (!submitted) history.replaceState(null, '', location.pathname + location.search); // F5 už znovu nevyplňuje
    api('POST', '/attack/report', { ok: filled.length > 0 && !problems.length, submitted, planet: planetText, target, filled, problems });
  }

  main().catch((e) => api('POST', '/attack/report', { ok: false, problems: [`chyba skriptu: ${String(e?.message ?? e).slice(0, 120)}`] }));
})();
