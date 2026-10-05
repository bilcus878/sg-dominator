// ==UserScript==
// @name         Stargate dominator
// @namespace    sg-dominator
// @version      3.11.0
// @description  Čte tabulku hráčů a posílá sílu na lokální notifikační server (bez zásahu do stránky)
// @match        https://stargate-game.cz/vesmir.php*
// @match        https://www.stargate-game.cz/vesmir.php*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  const SERVER = '__SERVER__';
  const TOKEN = '__TOKEN__';

  const params = new URLSearchParams(location.search);
  const raceId = params.get('id_rasa');
  if (!raceId || !/^\d{1,6}$/.test(raceId)) return; // není stránka s hráči rasy
  const page = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1);
  const src = Math.random().toString(36).slice(2, 10); // identifikuje toto okno (víc oken = víc zdrojů)

  /** První souvislé číslo v buňce ("62 817 006"); ignoruje případné přípisky typu "(-5 000)". */
  function cellNumber(td) {
    const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const m = n.nodeValue.match(/\d[\d\s ]*/);
      if (m) return Number(m[0].replace(/\D/g, ''));
    }
    return NaN;
  }

  let raceName = '';
  /** Název rasy z nadpisu typu: Hráči rasy „Bedrosian“. Jednou nalezený se pamatuje. */
  function findRaceName() {
    if (raceName) return raceName;
    const m = (document.body.textContent || '').match(/Hráči rasy\s*[„"“]\s*([^“”"]{1,60}?)\s*[“”"]/);
    if (m) raceName = m[1];
    return raceName;
  }

  /**
   * Čte řádky tabulky hráčů. Sloupce Jméno a Síla se hledají podle hlavičky,
   * takže funguje i na stránkách s jiným rozložením (např. Vyvrhelé).
   */
  function readPlayers(root = document) {
    const players = [];
    let nameIdx = 1;
    let powerIdx = 4;
    let planetsIdx = -1;
    let attackIdx = -1;
    dDebug = '';
    for (const tr of root.querySelectorAll('tr')) {
      const td = tr.querySelectorAll(':scope > td, :scope > th');
      const texts = [...td].map((c) => c.textContent.trim());
      const iName = texts.findIndex((t) => /^Jméno/i.test(t));
      const iPower = texts.findIndex((t) => /^Síla/i.test(t));
      if (iName >= 0 && iPower >= 0) { nameIdx = iName; powerIdx = iPower; planetsIdx = texts.findIndex((t) => /^Planety/i.test(t)); attackIdx = texts.findIndex((t) => /^Útok/i.test(t)); continue; }
      if (td.length <= Math.max(nameIdx, powerIdx) || !/^\d+\.$/.test(texts[0])) continue;
      const name = (td[nameIdx].querySelector('a')?.textContent ?? td[nameIdx].textContent).trim();
      const power = cellNumber(td[powerIdx]);
      if (!name || !Number.isFinite(power)) continue;
      const p = { name, power, online: !!td[nameIdx].querySelector('img[src*="online"]') }; // zelená tečka před jménem = online
      if (planetsIdx >= 0 && td[planetsIdx]) {
        // buňka typu "468 +19": počet planet a změna, kterou ukazuje hra (zelená +, červená −)
        const planets = cellNumber(td[planetsIdx]);
        if (Number.isFinite(planets)) p.planets = planets;
        const d = texts[planetsIdx].match(/([+\-−–])\s*(\d[\d\s ]*)$/);
        if (d) p.planetsDelta = (d[1] === '+' ? 1 : -1) * Number(d[2].replace(/\D/g, ''));
      }
      if (attackIdx >= 0 && td[attackIdx]) {
        // Útok: dobýt jde jen se svítící ikonou D (dobytí); chybí, je průhledná (.pruhledny) nebo „nelze“ = nejde
        const d = [...td[attackIdx].querySelectorAll('img')].find((i) => i.alt === 'D');
        p.attackable = !!d && !d.classList.contains('pruhledny') && !/nelze/i.test(texts[attackIdx]);
        // D vede na utok.php?page=0&hrac_id=…&utok_id=1: id hráče hledáme v celém řádku (odkaz, onclick, data-atributy),
        // protože nevíme, jak přesně hra D zapisuje
        const html = tr.innerHTML;
        const hid = parseInt((html.match(/utok\.php\?[^"'\s>]*?hrac_id=(\d+)/) ?? html.match(/hrac_id=(\d+)/) ?? [])[1], 10);
        if (hid > 0) {
          p.hracId = hid;
          const uid = parseInt((html.match(/hrac_id=\d+[^"'\s>]*?utok_id=(\d+)/) ?? html.match(/utok_id=(\d+)/) ?? [])[1], 10);
          if (uid > 0) p.utokId = uid;
        } else if (p.attackable && !dDebug) {
          dDebug = td[attackIdx].innerHTML.replace(/\s+/g, ' ').replace(/(token|[?&]t)=[^&"'\s>]*/g, '$1=X').slice(0, 400); // pro ladění: jak D vypadá
        }
      }
      // všechny druhy útoku jako ve hře (D P Z U N L S T): písmeno z ikony, id útoku z odkazu, svítí = ikona bez třídy .pruhledny
      if (attackIdx >= 0 && td[attackIdx]) {
        const attacks = [];
        for (const a of td[attackIdx].querySelectorAll('a[href*="utok_id"]')) {
          const img = a.querySelector('img');
          const t = (img?.alt ?? '').trim();
          let id = NaN;
          try { id = parseInt(new URL(a.getAttribute('href'), location.href).searchParams.get('utok_id'), 10); } catch { /* neplatný odkaz */ }
          if (/^[A-Z]$/.test(t) && id > 0) attacks.push({ t, id, ok: !img.classList.contains('pruhledny') });
        }
        if (attacks.length) p.attacks = attacks;
      }
      // hodnost podle barvy jména ve hře: vůdce (žlutá), zástupce (bílá), ministr (zelená), občan
      const rank = ['vudce', 'zastupce', 'ministr', 'obcan'].find((r) => td[nameIdx].querySelector('a')?.classList.contains(r));
      if (rank) p.rank = rank;
      players.push(p);
    }
    return players;
  }

  // Denní změna planet („537 +25“) hra vypisuje jen na obyčejné stránce; živá obnova ji z buněk maže. Proto ji jednou za minutu
  // stáhneme ze stejné stránky (stejný původ, jako když ji obnovíš ručně) a posíláme dál.
  let deltaMap = new Map();
  let deltaBusy = false;
  async function refreshDeltas() {
    if (deltaBusy) return;
    deltaBusy = true;
    try {
      const u = new URL(location.href);
      u.searchParams.delete('auto');
      const html = await (await fetch(u.pathname + u.search, { credentials: 'same-origin' })).text();
      const m = new Map();
      for (const p of readPlayers(new DOMParser().parseFromString(html, 'text/html'))) if (Number.isFinite(p.planetsDelta)) m.set(p.name, p.planetsDelta);
      if (m.size) deltaMap = m;
    } catch { /* bez změn se prostě pošle to, co je na stránce */ } finally { deltaBusy = false; }
  }

  let dDebug = ''; // jak vypadá buňka D, když v ní nenajdeme hrac_id (jen pro ladění)
  let lastBody = '';
  let lastSendAt = 0;
  let inFlight = false;
  let dirty = false; // změna přišla, zatímco předchozí odeslání ještě běželo: pošle se hned po jeho dokončení (dřív by čekala až na další změnu / 1 s)
  const done = () => { inFlight = false; if (dirty) { dirty = false; tick(); } };

  /** Pošle snapshot. Bez změny dat jen jako "heartbeat" max 1× za vteřinu. */
  function tick() {
    const players = readPlayers();
    if (!players.length) return;
    for (const p of players) if (!Number.isFinite(p.planetsDelta) && deltaMap.has(p.name)) p.planetsDelta = deltaMap.get(p.name);
    const body = JSON.stringify({ raceId, raceName: findRaceName(), page, src, ver: '3.11.0', dDebug, players });
    const now = Date.now();
    const changed = body !== lastBody;
    if (inFlight) { if (changed) dirty = true; return; }
    if (!changed && now - lastSendAt < 800) return; // 800 ms rezerva na jitter intervalu
    inFlight = true;
    lastBody = body;
    lastSendAt = now;
    GM_xmlhttpRequest({
      method: 'POST',
      url: `${SERVER}/ingest`,
      headers: { 'content-type': 'application/json', 'x-token': TOKEN },
      data: body,
      onload: done,
      onerror: done,
      ontimeout: done,
      timeout: 5000,
    });
  }

  // změna DOM = okamžité odeslání; interval zajišťuje heartbeat, i když se tabulka nemění
  refreshDeltas();
  setInterval(refreshDeltas, 60_000);
  tick();
  new MutationObserver(tick).observe(document.body, { childList: true, subtree: true, characterData: true });
  setInterval(tick, 1000);
})();
