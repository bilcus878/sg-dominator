// ==UserScript==
// @name         Stargate dominator – útok (D)
// @namespace    sg-dominator
// @version      2.0.0
// @description  Na stránce dobývacího útoku vyplní jednotky a vybere náhodnou planetu cíle; průběh a tlačítko Zaútočit jsou v aplikaci (jen když se otevře tlačítkem D v aplikaci)
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
  const JOB_KEY = 'sgd-attack-job'; // rozdělaná práce přes přenačtení stránky (odeslání formuláře stránku načte znovu)
  const JOB_MS = 15 * 60_000;

  // <logic> čistá logika bez DOM (testuje se v test/utok-script.test.js)
  const strip = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  /** "18 822 832" -> 18822832, "7,3" -> 7.3; bez čísla null. */
  function toNum(text) {
    const m = String(text ?? '').replace(/[\s\u00a0]/g, '').match(/\d+(?:[.,]\d+)?/);
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

  /** Id práce z adresy: #dominator (bez práce, jen vyplnit) nebo #dominator=<id> (průběh a odeslání řídí aplikace). */
  function parseHash(hash) {
    const m = /^#dominator(?:=([A-Za-z0-9]{4,24}))?$/.exec(hash ?? '');
    return m ? { fill: true, jobId: m[1] ?? null } : { fill: false, jobId: null };
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

  const readJob = () => { try { const j = JSON.parse(sessionStorage.getItem(JOB_KEY)); return j && Date.now() - j.ts < JOB_MS ? j : null; } catch { return null; } };
  const writeJob = (j) => { try { sessionStorage.setItem(JOB_KEY, JSON.stringify({ ...j, ts: Date.now() })); } catch { /* bez úložiště to jede dál */ } };
  const clearJob = () => { try { sessionStorage.removeItem(JOB_KEY); } catch { /* nic */ } };

  const targetText = () => (document.body.textContent.match(/C[ií]l:\s*([^|\n]{1,60}?)\s*(?:\||S[ií]la|\n)/) ?? [])[1]?.trim() ?? '';
  const planetLabel = (sel) => sel?.options[sel.selectedIndex]?.text.trim() ?? '';

  /** Vyplní jednotky podle plánu; vrací co se vyplnilo a případné problémy. */
  async function fillUnits(cfgUnits) {
    const filled = [], problems = [];
    const rows = readRows(findUnitsTable());
    const plan = planFill(rows, cfgUnits);
    if (!plan.length) problems.push('v nastavení není žádná jednotka k poslání (počet 0 a bez Max)');
    for (const a of plan) {
      await human(150, 450);
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

  /** Co hra napsala po odeslání: texty hlášek, jinak začátek obsahu stránky (bez menu). */
  function readResult() {
    const msg = [...document.querySelectorAll('.hlaska,.chyba,.error,.success,.ok,.info,.warning,[class*=hlas],[class*=chyb],[class*=err]')]
      .map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const main = (document.querySelector('#obsah,#content,main') ?? document.body).innerText.split('\n').map((l) => l.trim()).filter(Boolean);
    const text = (msg.length ? msg.join(' | ') : main.filter((l) => !/^(Útok|Výpis útoků|Aktivity armády|Statistiky útoků)$/.test(l)).slice(0, 6).join(' | ')).slice(0, 300);
    const stillForm = !!findUnitsTable() && !!findSubmit();
    return { text, stillForm };
  }

  /** Průběh řízený aplikací: hlásí kroky, čeká na příkaz (odeslat / jiná planeta / zrušit). */
  async function runJob(jobId, cfg) {
    const report = (phase, data = {}) => api('POST', '/attack/job/report', { id: jobId, phase, ...data });
    const sel = findPlanetSelect();
    const planetsTotal = sel ? [...sel.options].filter((o) => o.value !== '').length : 0;
    await report('loaded', { target: targetText(), planetsTotal });

    const choosePlanet = async (not = null) => {
      if (!(cfg.randomPlanet && sel)) return;
      const opt = pickPlanet([...sel.options].map((o) => ({ value: o.value, text: o.text, disabled: o.disabled })), Math.random, not);
      if (opt && opt.value !== sel.value) { await human(300, 800); setValue(sel, opt.value); }
    };
    await choosePlanet();
    await report('planet', { planet: planetLabel(sel), planetsTotal });

    const { filled, problems } = await fillUnits(cfg.units);
    await report('units', { filled });
    if (!filled.length) { await report('failed', { error: problems[0] ?? 'nic se nevyplnilo', problems }); return; }
    if (!findSubmit()) problems.push('tlačítko Zaútočit nenalezeno');
    await report('ready', { target: targetText(), planet: planetLabel(sel), planetsTotal, filled, problems });

    // čekání na příkaz z aplikace: dlouhé dotazování (server odpoví hned, jak příkaz přijde), takže ho nezpomalí
    // ani zpomalené časovače karty na pozadí
    const end = Date.now() + JOB_MS;
    while (Date.now() < end) {
      const r = await api('POST', '/attack/job/poll', { id: jobId }, 30_000);
      if (!r) { await sleep(1500); continue; }
      if (!r.ok) return; // práce na serveru skončila (zrušena, vypršela, jiná je novější)
      if (!r.cmd) continue;
      if (r.cmd === 'reroll') {
        await choosePlanet(sel?.value ?? null);
        await report('planet', { planet: planetLabel(sel), planetsTotal });
        await report('ready', { target: targetText(), planet: planetLabel(sel), planetsTotal, filled, problems });
      } else if (r.cmd === 'cancel') {
        clearJob();
        if (cfg.closeTab) window.close();
        return;
      } else if (r.cmd === 'submit') {
        const btn = findSubmit();
        if (!btn) { await report('failed', { error: 'tlačítko Zaútočit nenalezeno' }); return; }
        writeJob({ id: jobId, phase: 'submitting' }); // odeslání stránku načte znovu; výsledek přečte další běh skriptu
        await report('submitting');
        await human(500, 1300);
        btn.click();
        await sleep(6000); // když se stránka nepřenačte, hra útok zřejmě nepřijala
        const res = readResult();
        clearJob();
        await report('failed', { error: 'po kliknutí na Zaútočit se stránka nezměnila (hra útok nepřijala?)', result: res.text });
        return;
      }
    }
    await report('failed', { error: 'vypršel čas čekání na odeslání' });
  }

  async function main() {
    const h = parseHash(location.hash);
    const job = readJob();

    // po odeslání formuláře: stránka je načtená znovu, přečteme výsledek a nahlásíme ho
    if (job?.phase === 'submitting') {
      const res = readResult();
      clearJob();
      let cfgAfter = null;
      try { cfgAfter = await api('GET', '/attack/config'); } catch { /* nic */ }
      await api('POST', '/attack/job/report', { id: job.id, phase: 'sent', result: res.text, stillForm: res.stillForm });
      if (cfgAfter?.closeTab && !res.stillForm) setTimeout(() => window.close(), 2500);
      return;
    }

    const table = await waitFor(findUnitsTable);
    if (!table) return;
    const rows = readRows(table);

    // vždy: jména jednotek jdou do nastavení v aplikaci (s počtem 0), ať je stačí jen přepsat
    api('POST', '/attack/seen', { units: rows.map((r) => ({ name: r.name, available: r.available, attack: r.attack })) });

    if (!h.fill) return; // stránka otevřená normálně, ne tlačítkem D v aplikaci

    const cfg = await api('GET', '/attack/config');
    if (!cfg || !Array.isArray(cfg.units)) {
      const err = 'nepodařilo se načíst nastavení útoku z aplikace (běží? je skript aktuální?)';
      if (h.jobId) api('POST', '/attack/job/report', { id: h.jobId, phase: 'failed', error: err });
      else api('POST', '/attack/report', { ok: false, problems: [err] });
      return;
    }
    history.replaceState(null, '', location.pathname + location.search); // F5 už znovu nevyplňuje

    if (h.jobId) return runJob(h.jobId, cfg);

    // starší režim bez aplikace v cestě: jen vyplnit a nechat na uživateli
    const problems = [];
    const sel = findPlanetSelect();
    if (cfg.randomPlanet && sel) {
      const opt = pickPlanet([...sel.options].map((o) => ({ value: o.value, text: o.text, disabled: o.disabled })));
      if (opt && opt.value !== sel.value) { await human(400, 900); setValue(sel, opt.value); }
    } else if (cfg.randomPlanet) problems.push('výběr planety nenalezen');
    const { filled, problems: p2 } = await fillUnits(cfg.units);
    problems.push(...p2);
    const submit = findSubmit();
    let submitted = false;
    if (cfg.autoSubmit && submit && filled.length && !problems.length) { await human(700, 1600); submit.click(); submitted = true; }
    else if (submit) submit.focus({ preventScroll: true });
    else problems.push('tlačítko Zaútočit nenalezeno');
    api('POST', '/attack/report', { ok: filled.length > 0 && !problems.length, submitted, planet: planetLabel(sel), target: targetText(), filled, problems });
  }

  main().catch((e) => {
    const err = `chyba skriptu: ${String(e?.message ?? e).slice(0, 120)}`;
    const j = parseHash(location.hash).jobId ?? readJob()?.id;
    if (j) api('POST', '/attack/job/report', { id: j, phase: 'failed', error: err });
    else api('POST', '/attack/report', { ok: false, problems: [err] });
  });
})();
