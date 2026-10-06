// ==UserScript==
// @name         Stargate dominator – stavění
// @namespace    sg-dominator
// @version      1.5.0
// @description  Na pokyn z aplikace vyplní počty staveb, klikne na Postavit a přejde na další planetu klikem v tabulce planet (pomalu a nepravidelně, jako člověk)
// @match        https://stargate-game.cz/stavby.php*
// @match        https://www.stargate-game.cz/stavby.php*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  const SERVER = '__SERVER__';
  const TOKEN = '__TOKEN__';
  const IDS = ['mesto', 'vyrobna', 'laborator', 'park', 'bs', 'sdi', 'po', 'kasarna']; // pořadí na stránce

  // ---------- pomocné: čas a náhoda ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  /** Pauza kolem `ms` s lidským rozptylem; občas delší „zamyšlení“. */
  let tempo = 1; // násobek tempa z aktuální instrukce (menší = rychlejší); zkracuje i náhodná „zamyšlení“ a kroky myši
  const pause = (ms) => sleep(Math.max(40, ms * (1 + gauss() * 0.3)) + (Math.random() < 0.06 ? rnd(1500, 4500) * Math.min(1, tempo) : 0));

  // ---------- komunikace se serverem ----------
  const VERSION = '1.5.0'; // stejné jako @version; server podle ní pozná zastaralý skript

  /** Hláška přímo na stránce (např. zastaralý skript). Stejný text se neopakuje; křížek ji zavře. */
  let bannerText = '';
  function showBanner(text) {
    if (!text || text === bannerText) return;
    bannerText = text;
    document.getElementById('sgd-banner')?.remove();
    const d = document.createElement('div');
    d.id = 'sgd-banner';
    d.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;max-width:720px;background:#3a0d0d;color:#fff;border:2px solid #ff4d4d;border-radius:8px;padding:12px 40px 12px 16px;font:15px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.6)';
    d.textContent = '⚠️ Dominator – stavění: ' + text;
    const x = document.createElement('button');
    x.textContent = '✕';
    x.style.cssText = 'position:absolute;top:6px;right:8px;background:none;border:0;color:#fff;font-size:18px;cursor:pointer';
    x.onclick = () => d.remove();
    d.appendChild(x);
    document.body.appendChild(d);
  }

  function post(path, data) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: `${SERVER}${path}`,
        headers: { 'content-type': 'application/json', 'x-token': TOKEN },
        data: JSON.stringify({ ver: VERSION, ...data }),
        timeout: 8000,
        onload: (r) => { try { const j = JSON.parse(r.responseText); if (j?.message) showBanner(j.message); resolve(j); } catch { resolve(null); } },
        onerror: () => resolve(null),
        ontimeout: () => resolve(null),
      });
    });
  }

  // ---------- čtení stránky ----------
  const num = (s) => {
    const d = String(s ?? '').replace(/\D/g, '');
    return d ? Number(d) : NaN;
  };
  const submitBtn = () => document.querySelector('input[name="postavit"]');

  /** Kolik naquadahu je k dispozici („Máš k dispozici 47 649 299 kg naquadahu“); nenalezeno -> null. */
  function naquadah() {
    const m = (document.body.innerText || '').match(/Máš k dispozici\s*([\d\s ]+)\s*kg naquadahu/i);
    return m ? num(m[1]) : null;
  }
  /** Cena vyplněných staveb: (vyplněno − postaveno) × cena za kus z `.cena`. Neznámá cena -> null (pojistka se neuplatní). */
  function buildCost() {
    let sum = 0;
    for (const id of IDS) {
      const inp = document.getElementById(id);
      if (!inp) continue;
      const add = num(inp.value) - num(inp.defaultValue);
      if (!(add > 0)) continue; // nic nového (bourat se nezkouší)
      const price = num(inp.closest('.stavba')?.querySelector('.cena')?.textContent);
      if (!Number.isFinite(price)) return null;
      sum += add * price;
    }
    return sum;
  }

  /** Spokojenost pod názvem planety: '+ 10%' -> 10, '- 50%' -> -50, '~' -> 0; nerozpoznané -> null. */
  function readSatisfaction() {
    const t = (document.querySelector('.typ-planety .vhodnost-planety')?.textContent ?? '').replace(/\s+/g, '');
    if (!t) return null;
    if (t.includes('~')) return 0;
    const m = t.match(/^([+\-−–]?)(\d+)%/);
    if (!m) return null;
    return m[1] && m[1] !== '+' ? -Number(m[2]) : Number(m[2]);
  }

  function readPage() {
    const btn = submitBtn();
    const planet = document.querySelector('.vyber-planety .nazev')?.textContent.trim();
    const plId = btn?.form?.elements?.pl_id?.value;
    if (!btn || !btn.form || !planet || !plId) return null;
    const satisfaction = readSatisfaction();
    const buildings = {};
    for (const id of IDS) {
      const inp = document.getElementById(id);
      if (!inp) continue;
      // defaultValue = počet z HTML (aktuálně postaveno), ne to, co jsme zrovna napsali
      buildings[id] = { cur: num(inp.defaultValue), max: num(inp.closest('.stavba')?.querySelector('.max')?.textContent) };
    }
    return { plId, planet, satisfaction, buildings, uninhabitable: isUninhabitable() };
  }

  /** Neobyvatelná planeta: hra píše „neobyvatelná“ u spokojenosti nebo hlášku „Planeta je neobyvatelná“. Na takové se NIKDY nestaví. */
  function isUninhabitable() {
    const typ = document.querySelector('.typ-planety')?.textContent ?? '';
    return /neobyvateln/i.test(typ) || /Planeta je neobyvateln/i.test(document.body.textContent ?? '');
  }

  /**
   * Seznam planet (planety.php) jedním načtením: spokojenost (z popisku obrázku) a strop měst každé planety.
   * Díky tomu se nemusí kvůli těmhle údajům navštěvovat každá planeta. Při chybě vrací null (použije se historie).
   */
  async function readPlanetList() {
    try {
      const html = await (await fetch('/planety.php', { credentials: 'include' })).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const out = {};
      for (const b of doc.querySelectorAll('.seznam-planet .planeta')) {
        const id = (b.querySelector('a.nazev-planety')?.getAttribute('href') ?? '').match(/id_pl=(\d+)/)?.[1];
        if (!id) continue;
        const plain = (b.querySelector('img.obr')?.getAttribute('title') ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
        const m = plain.match(/\(\s*([+\-\u2212\u2013]?)\s*(\d+)\s*%\s*\)/);
        const sat = m ? (m[1] && m[1] !== '+' ? -Number(m[2]) : Number(m[2])) : /\(\s*~\s*\)/.test(plain) ? 0 : null;
        const towns = b.textContent.match(/Města:\s*([\d\s]+?)\s*\/\s*([\d\s]+)/);
        out[id] = { sat, townsMax: towns ? num(towns[2]) : undefined };
      }
      return Object.keys(out).length ? out : null;
    } catch {
      return null;
    }
  }

  // sloupce tabulky planet (#seznam-planet): Planeta, Místo, Města, Výrobny, BS, SDI, PO, KAS, LAB, PAR, HB, Iris
  const TABLE_COLS = { mesto: 2, vyrobna: 3, bs: 4, sdi: 5, po: 6, kasarna: 7, laborator: 8, park: 9 };
  /** Tabulka pod stavěním -> [{id, name, c:{stavba: počet}}]. U „430 / 430“ se bere první číslo (postaveno). */
  function readTable() {
    return [...document.querySelectorAll('#seznam-planet tr[id^="pl-"]')].map((tr) => {
      const c = {};
      for (const [k, i] of Object.entries(TABLE_COLS)) {
        const cell = tr.cells[i];
        c[k] = num(cell?.querySelector('span')?.textContent ?? cell?.textContent);
      }
      // značka za názvem: (DP), (CP), (PP) – takové planety se nestaví
      const tag = tr.querySelector('.nazev-planety')?.textContent.match(/\(([A-Za-z]{1,3})\)/)?.[1] ?? '';
      const uninhabitable = tr.classList.contains('neobyvatelna'); // celý řádek sytě červený: neobyvatelná planeta, nestaví se
      // Města „52 / 103“: zelené číslo (odkaz .stavby-max) postaví maximum měst jedním klikem
      const mCell = tr.cells[TABLE_COLS.mesto];
      const mestaLink = !!mCell?.querySelector('a.stavby-max');
      const mestaMax = mestaLink ? num(mCell.querySelector('a.stavby-max').textContent) : undefined;
      return { id: tr.id.slice(3), name: tr.querySelector('.nazev-planety a')?.textContent.trim(), tag, uninhabitable, free: num(tr.cells[1]?.textContent), c, mestaLink, mestaMax };
    }).filter((r) => r.id && r.name);
  }

  // ---------- „lidská“ myš a klávesnice ----------
  let mouse = { x: rnd(300, 700), y: rnd(250, 500) };
  const fire = (el, type, init = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));

  /** Plynulé rolování k prvku (i o tisíce px, třeba řádek v dlouhé tabulce): kroky se zpomalují, občas krátká pauza. */
  async function ensureVisible(el) {
    for (let i = 0; i < 120; i++) {
      const r = el.getBoundingClientRect();
      if (r.top > 90 && r.bottom < innerHeight - 90) return;
      const want = r.top + r.height / 2 - innerHeight * rnd(0.35, 0.6);
      const dist = Math.abs(want);
      const step = Math.min(dist, Math.max(60, Math.min(900, dist * rnd(0.12, 0.3))) * rnd(0.7, 1.2));
      window.scrollBy(0, Math.sign(want) * step);
      await sleep(rnd(18, 70) + (Math.random() < 0.05 ? rnd(150, 400) : 0));
    }
  }

  /** Posun kurzoru po zakřivené dráze se zrychlením a zpomalením; krátce „přestřelí“ a vrátí se. */
  async function moveTo(el) {
    await ensureVisible(el);
    const r = el.getBoundingClientRect();
    const t = { x: r.left + r.width * rnd(0.22, 0.78), y: r.top + r.height * rnd(0.3, 0.7) };
    const c = { x: mouse.x + (t.x - mouse.x) * rnd(0.2, 0.6) + rnd(-90, 90), y: mouse.y + (t.y - mouse.y) * rnd(0.2, 0.6) + rnd(-90, 90) };
    const from = { ...mouse };
    const steps = Math.round(rnd(16, 34) * Math.min(1, Math.max(0.5, tempo)));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease in-out
      const x = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * c.x + e * e * t.x + rnd(-1.2, 1.2);
      const y = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * c.y + e * e * t.y + rnd(-1.2, 1.2);
      const under = document.elementFromPoint(x, y) || document.body;
      fire(under, 'mousemove', { clientX: x, clientY: y });
      await sleep(rnd(5, 22));
    }
    mouse = t;
    fire(el, 'mouseover', { clientX: t.x, clientY: t.y });
    fire(el, 'mouseenter', { clientX: t.x, clientY: t.y, bubbles: false });
  }

  async function clickEl(el, speed) {
    await moveTo(el);
    await pause(rnd(90, 260) * speed);
    const pt = { clientX: mouse.x, clientY: mouse.y, button: 0 };
    fire(el, 'mousedown', pt);
    if (el.focus) el.focus();
    await sleep(rnd(45, 130));
    fire(el, 'mouseup', pt);
    // klik se souřadnicemi jako od skutečné myši (el.click() má 0,0 a hra takové kliky může ignorovat);
    // pro odkaz = přechod, pro submit = odeslání formuláře, pro input = fokus
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, ...pt }));
  }

  const keyInit = (key) => ({ key, code: /^\d$/.test(key) ? `Digit${key}` : key, bubbles: true, cancelable: true });
  const key = (el, type, k) => el.dispatchEvent(new KeyboardEvent(type, keyInit(k)));

  async function typeChar(el, ch, speed) {
    key(el, 'keydown', ch);
    key(el, 'keypress', ch);
    el.value += ch;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    key(el, 'keyup', ch);
    await sleep(rnd(70, 220) * speed + (Math.random() < 0.12 ? rnd(180, 520) : 0));
  }
  async function backspace(el, speed) {
    key(el, 'keydown', 'Backspace');
    el.value = el.value.slice(0, -1);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    key(el, 'keyup', 'Backspace');
    await sleep(rnd(90, 200) * speed);
  }

  /** Klik do pole, smazání, napsání čísla po znacích (občas překlep a oprava), potvrzení změny. */
  async function fillField(inp, value, speed) {
    await clickEl(inp, speed);
    await pause(rnd(150, 420) * speed);
    inp.select();
    await pause(rnd(120, 300) * speed);
    // označený text se smaže jedním Backspace
    key(inp, 'keydown', 'Backspace');
    inp.value = '';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    key(inp, 'keyup', 'Backspace');
    await pause(rnd(200, 500) * speed);
    const digits = String(value);
    const typoAt = Math.random() < 0.07 && digits.length > 1 ? Math.floor(rnd(1, digits.length)) : -1;
    for (let i = 0; i < digits.length; i++) {
      if (i === typoAt) {
        await typeChar(inp, String((Number(digits[i]) + Math.ceil(rnd(1, 8))) % 10), speed);
        await pause(rnd(260, 700) * speed); // „všimne si“ překlepu
        await backspace(inp, speed);
        await pause(rnd(120, 300) * speed);
      }
      await typeChar(inp, digits[i], speed);
    }
    await pause(rnd(180, 450) * speed);
    inp.dispatchEvent(new Event('change', { bubbles: true })); // programový zápis ho sám nevyvolá
    inp.blur();
  }

  /** Pořadí vyplňování: většinou shora dolů, někdy dva sousedi prohozeni. */
  function fillOrder(ids) {
    const out = [...ids];
    for (let i = 0; i < out.length - 1; i++) {
      if (Math.random() < 0.2) [out[i], out[i + 1]] = [out[i + 1], out[i]];
    }
    return out;
  }

  // ---------- průběh jedné stránky ----------
  let busy = false;
  let holdUntil = 0; // po kliknutí na odeslání / šipku čekáme na přenačtení stránky, ať se nehlásí stará

  async function stillActive() {
    const r = await post('/build/report', { phase: 'ping' });
    return r?.action === 'ok';
  }

  /** Provede instrukci. Vrací další instrukci jen ve zkušebním běhu (stránka se nepřenačítá). */
  async function act(ins, first) {
    const speed = Math.min(2.5, Math.max(0.25, Number(ins.speed) || 1));
    tempo = speed;
    await pause(rnd(first ? 1800 : 900, first ? 4800 : 2200) * speed); // „čte“ stránku
    if (Math.random() < 0.03) await sleep(rnd(15000, 45000) * speed); // občas se na chvíli „zdrží“

    if (ins.action === 'build') {
      if (isUninhabitable()) { // pojistka nezávislá na serveru: na neobyvatelné planetě nic nevyplnit ani neodeslat
        return await post('/build/report', { phase: 'load', ...readPage() });
      }
      for (const id of fillOrder(IDS.filter((i) => i in ins.values))) {
        const inp = document.getElementById(id);
        if (!inp || !(await stillActive())) return null;
        await fillField(inp, ins.values[id], speed);
        await pause(rnd(500, 1600) * speed);
      }
      await pause(rnd(1200, 3500) * speed); // zkontroluje, co napsal
      if (!(await stillActive()) || isUninhabitable()) return null;
      if (ins.dry) return await post('/build/report', { phase: 'filled', ...readPage() });
      // pojistka: na vyplněné stavby musí být dost naquadahu, jinak nic neodeslat a stavění zastavit
      const nq = naquadah(), cost = buildCost();
      if (nq !== null && cost !== null && cost > nq) {
        return await post('/build/report', { phase: 'nofunds', cost, naquadah: nq, ...readPage() });
      }
      holdUntil = Date.now() + 25000;
      await clickEl(submitBtn(), speed); // stránka se přenačte, další fázi řeší nové načtení
      return null;
    }
    if (ins.action === 'goto') return await goPlanet(ins);
    return null;
  }

  /** Přechod na jinou planetu klikem na její název v tabulce pod stavěním. */
  async function goPlanet(ins) {
    const speed = Math.min(2.5, Math.max(0.25, Number(ins.speed) || 1));
    // města přes zelené číslo v tabulce: jedním klikem postaví maximum měst a zároveň otevře planetu
    const cityLink = ins.viaCities ? document.querySelector(`#pl-${CSS.escape(String(ins.plId))} a.stavby-max`) : null;
    if (cityLink && cityLink.closest('td') === document.querySelector(`#pl-${CSS.escape(String(ins.plId))}`)?.cells[TABLE_COLS.mesto]) {
      const add = Math.max(0, Number(ins.cityAdd) || 0);
      const price = num(document.getElementById('mesto')?.closest('.stavba')?.querySelector('.cena')?.textContent);
      const nq = naquadah();
      if (nq !== null && Number.isFinite(price) && add * price > nq) {
        return await post('/build/report', { phase: 'nofunds', cost: add * price, naquadah: nq, planet: ins.name, plId: ins.plId, buildings: {}, uninhabitable: false });
      }
      if (!(await stillActive())) return null;
      await pause(rnd(900, 2600) * speed);
      holdUntil = Date.now() + 25000;
      await clickEl(cityLink, speed);
      return null;
    }
    const a = document.querySelector(`#pl-${CSS.escape(String(ins.plId))} .nazev-planety a`);
    if (!a) return await post('/build/report', { phase: 'goto-failed', plId: ins.plId }); // server planetu přeskočí
    if (!(await stillActive())) return null;
    await pause(rnd(900, 2600) * speed);
    holdUntil = Date.now() + 25000;
    await clickEl(a, speed);
    return null;
  }

  async function tick() {
    if (busy || Date.now() < holdUntil) return;
    busy = true;
    try {
      const page = readPage();
      if (!page) {
        await post('/build/report', { phase: 'load', error: 'chybí formulář nebo název planety' });
        return;
      }
      let ins = await post('/build/report', { phase: 'load', ...page });
      if (ins?.action === 'send-table') {
        await sleep(rnd(300, 900));
        const list = await readPlanetList();
        const table = readTable().map((r) => ({ ...r, sat: list?.[r.id]?.sat, townsMax: list?.[r.id]?.townsMax }));
        const scan = !!ins.scan; // náhled fronty bez spuštění běhu
        ins = await post('/build/report', { phase: 'table', ...page, table, ...(scan ? { scan: true } : {}) });
      }
      for (let first = true; ins && (ins.action === 'build' || ins.action === 'goto'); first = false) ins = await act(ins, first);
    } catch (e) {
      console.error('[dominator stavění]', e);
      await post('/build/report', { phase: 'load', scriptError: `${e?.name}: ${e?.message}`.slice(0, 160) }); // ať je chyba vidět v aplikaci
    } finally {
      busy = false;
    }
  }

  // v klidu se jednou za pár vteřin zeptá, jestli se mezitím nespustil běh
  setTimeout(tick, 800);
  setInterval(tick, 5000);
})();
