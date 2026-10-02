// ==UserScript==
// @name         Stargate dominator
// @namespace    sg-dominator
// @version      3.1.0
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
  function readPlayers() {
    const players = [];
    let nameIdx = 1;
    let powerIdx = 4;
    let planetsIdx = -1;
    for (const tr of document.querySelectorAll('tr')) {
      const td = tr.querySelectorAll(':scope > td, :scope > th');
      const texts = [...td].map((c) => c.textContent.trim());
      const iName = texts.findIndex((t) => /^Jméno/i.test(t));
      const iPower = texts.findIndex((t) => /^Síla/i.test(t));
      if (iName >= 0 && iPower >= 0) { nameIdx = iName; powerIdx = iPower; planetsIdx = texts.findIndex((t) => /^Planety/i.test(t)); continue; }
      if (td.length <= Math.max(nameIdx, powerIdx) || !/^\d+\.$/.test(texts[0])) continue;
      const name = (td[nameIdx].querySelector('a')?.textContent ?? td[nameIdx].textContent).trim();
      const power = cellNumber(td[powerIdx]);
      if (!name || !Number.isFinite(power)) continue;
      const p = { name, power };
      if (planetsIdx >= 0 && td[planetsIdx]) {
        // buňka typu "468 +19": počet planet a změna, kterou ukazuje hra (zelená +, červená −)
        const planets = cellNumber(td[planetsIdx]);
        if (Number.isFinite(planets)) p.planets = planets;
        const d = texts[planetsIdx].match(/([+\-−–])\s*(\d[\d\s ]*)$/);
        if (d) p.planetsDelta = (d[1] === '+' ? 1 : -1) * Number(d[2].replace(/\D/g, ''));
      }
      players.push(p);
    }
    return players;
  }

  let lastBody = '';
  let lastSendAt = 0;
  let inFlight = false;

  /** Pošle snapshot. Bez změny dat jen jako "heartbeat" max 1× za vteřinu. */
  function tick() {
    const players = readPlayers();
    if (!players.length) return;
    const body = JSON.stringify({ raceId, raceName: findRaceName(), page, src, players });
    const now = Date.now();
    const changed = body !== lastBody;
    if (inFlight || (!changed && now - lastSendAt < 800)) return; // 800 ms rezerva na jitter intervalu
    inFlight = true;
    lastBody = body;
    lastSendAt = now;
    GM_xmlhttpRequest({
      method: 'POST',
      url: `${SERVER}/ingest`,
      headers: { 'content-type': 'application/json', 'x-token': TOKEN },
      data: body,
      onload: () => { inFlight = false; },
      onerror: () => { inFlight = false; },
      ontimeout: () => { inFlight = false; },
      timeout: 5000,
    });
  }

  // změna DOM = okamžité odeslání; interval zajišťuje heartbeat, i když se tabulka nemění
  tick();
  new MutationObserver(tick).observe(document.body, { childList: true, subtree: true, characterData: true });
  setInterval(tick, 1000);
})();
