// ==UserScript==
// @name         Stargate dominator – přihlášení
// @namespace    sg-dominator
// @version      1.8.0
// @description  Když hru po ~3 hodinách odhlásí, otevře se nový panel s přihlašovací stránkou, klikne na Přihlaš (údaje doplní Chrome, skript hesla nezná), panel se zavře a karty s daty se obnoví. V době denní údržby (výchozí 3:00–3:31) počká. Vše se nastavuje v aplikaci (Nastavení → Přihlášení).
// @match        https://stargate-game.cz/*
// @match        https://www.stargate-game.cz/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      127.0.0.1
// @noframes
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  const SERVER = '__SERVER__';
  const TOKEN = '__TOKEN__';
  const VERSION = '1.8.0'; // stejné jako @version

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const $ = (id) => document.getElementById(id);

  // ---------- sdílený stav mezi kartami (localStorage) a stav této karty (sessionStorage) ----------
  const jget = (st, k) => { try { return JSON.parse(st.getItem(k)); } catch { return null; } };
  const jset = (st, k, v) => { try { st.setItem(k, JSON.stringify(v)); } catch { /* plné/zakázané úložiště */ } };
  const jdel = (st, k) => { try { st.removeItem(k); } catch { /* nic */ } };
  const LOCK = 'sgd_relogin_lock', PROBE = 'sgd_probe_at', STATE = 'sgd_relogin_state', JOB = 'sgd_relogin_job', TABID = 'sgd_tab_id';
  const tabId = (() => { let id = sessionStorage.getItem(TABID); if (!id) { id = Math.random().toString(36).slice(2); sessionStorage.setItem(TABID, id); } return id; })();
  const getState = () => jget(sessionStorage, STATE);
  const setState = (s) => jset(sessionStorage, STATE, s);
  const LOCK_TTL = 3 * 60_000; // zámek se obnovuje každých ~20 s; delší ticho = karta zmizela

  const lockedByOther = () => { const l = jget(localStorage, LOCK); return !!l && l.id !== tabId && Date.now() - l.at < LOCK_TTL; };
  const renewLock = () => jset(localStorage, LOCK, { id: tabId, at: Date.now() });
  function acquireLock() {
    if (lockedByOther()) return false;
    renewLock();
    return jget(localStorage, LOCK)?.id === tabId;
  }
  function releaseLock() { if (jget(localStorage, LOCK)?.id === tabId) jdel(localStorage, LOCK); }

  // <maint>
  /** Denní údržba serveru (z nastavení, výchozí 3:00–3:31). Vrací, za kolik ms po ní bude možné se přihlásit (0 = mimo údržbu). Skript se sám nikdy neodhlašuje, jen počká, až hra odhlásí. */
  function maintenanceWaitMs(now = new Date(), cfg = {}) {
    const hm = (t, d) => { const m = /^(\d{2}):(\d{2})$/.exec(t ?? ''); return m ? [Number(m[1]), Number(m[2])] : d; };
    const [sh, sm] = hm(cfg.maintStart, [3, 0]), [eh, em] = hm(cfg.maintEnd, [3, 31]);
    const start = new Date(now); start.setHours(sh, sm, 0, 0);
    const end = new Date(now); end.setHours(eh, em, 20, 0); // 20 s rezerva po oficiálním konci
    return now >= start && now < end ? end - now : 0;
  }
  // </maint>

  // ---------- zprávy serveru (log + servisní chat) ----------
  function report(event, text) {
    GM_xmlhttpRequest({
      method: 'POST',
      url: `${SERVER}/session`,
      headers: { 'content-type': 'application/json', 'x-token': TOKEN },
      data: JSON.stringify({ ver: VERSION, event, text }),
      timeout: 8000,
      onload: () => {}, onerror: () => {}, ontimeout: () => {},
    });
  }

  // výchozí hodnoty = stejné jako SESSION_DEFAULTS v aplikaci (použijí se, když server neodpoví)
  const DEFAULTS = { enabled: true, reactMinSec: 1.5, reactMaxSec: 3, maintStart: '03:00', maintEnd: '03:31', maintMinSec: 8, maintMaxSec: 70, formMinSec: 1.5, formMaxSec: 4, maxAttempts: 3, retryFirstMinSec: 110, retryFirstMaxSec: 150, retryNextMinSec: 280, retryNextMaxSec: 340, tabWaitMin: 8, closeTab: true, reloadOthers: true, reloadMinSec: 2, reloadMaxSec: 8, probeMinSec: 60, probeMaxSec: 120 };
  /** Nastavení z Nastavení → Přihlášení; bez serveru platí výchozí. */
  function loadCfg() {
    return new Promise((resolve) => {
      const d = { ...DEFAULTS };
      GM_xmlhttpRequest({
        method: 'GET', url: `${SERVER}/session/config`, headers: { 'x-token': TOKEN }, timeout: 4000,
        onload: (r) => { try { const j = JSON.parse(r.responseText); for (const k of Object.keys(d)) if (j[k] !== undefined && typeof j[k] === typeof d[k]) d[k] = j[k]; } catch { /* výchozí */ } resolve(d); },
        onerror: () => resolve(d), ontimeout: () => resolve(d),
      });
    });
  }
  /** Uložené přihlašovací údaje z aplikace (jen když jsou v Nastavení → Přihlášení zapnuté); jinak {} a spoléhá se na Chrome. */
  function loadCreds() {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'GET', url: `${SERVER}/session/credentials`, headers: { 'x-token': TOKEN }, timeout: 4000,
        onload: (r) => { try { const j = JSON.parse(r.responseText); resolve(j.user && j.password ? j : null); } catch { resolve(null); } },
        onerror: () => resolve(null), ontimeout: () => resolve(null),
      });
    });
  }
  /** Vyplní pole stejně jako při psaní (hra i prohlížeč vidí změnu hodnoty). */
  function setField(el, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const rndSec = (c, a, b) => rnd(c[a] * 1000, c[b] * 1000);

  function banner(text) {
    $('sgd-login-banner')?.remove();
    const d = document.createElement('div');
    d.id = 'sgd-login-banner';
    d.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;max-width:720px;background:#3a0d0d;color:#fff;border:2px solid #ff4d4d;border-radius:8px;padding:10px 34px 10px 14px;font:14px system-ui,sans-serif';
    d.textContent = '⚠️ Dominator – přihlášení: ' + text;
    const x = document.createElement('button');
    x.textContent = '✕';
    x.style.cssText = 'position:absolute;top:6px;right:8px;background:none;border:0;color:#fff;font-size:18px;cursor:pointer';
    x.onclick = () => d.remove();
    d.appendChild(x);
    document.body.appendChild(d);
  }

  // ---------- klik jako od myši (el.click() má souřadnice 0,0 a hra ho může ignorovat) ----------
  async function clickEl(el) {
    const r = el.getBoundingClientRect();
    const pt = { clientX: Math.round(r.left + r.width * rnd(0.25, 0.75)), clientY: Math.round(r.top + r.height * rnd(0.25, 0.75)), button: 0, bubbles: true, cancelable: true };
    el.dispatchEvent(new MouseEvent('mouseover', pt));
    await sleep(rnd(150, 400));
    el.dispatchEvent(new MouseEvent('mousedown', pt));
    if (el.focus) el.focus();
    await sleep(rnd(50, 140));
    el.dispatchEvent(new MouseEvent('mouseup', pt));
    el.dispatchEvent(new MouseEvent('click', { ...pt, detail: 1 }));
  }

  // ---------- rozpoznání stavu ----------
  const EXPIRED_RE = /Vypr\S{1,3}ela\s+platnost\s+p\S+hl\S+en/i; // „Vypršela platnost přihlášení“ (bez ohledu na kódování)
  const isLoginPage = () => !!($('loginButton') && $('log-heslo') && $('log-jmeno'));
  const pageExpired = () => EXPIRED_RE.test(document.body?.innerText ?? '');

  /** Ověří dotazem na hlavní stranu, jestli přihlášení opravdu vypršelo (jen výslovná hláška hry, ruční odhlášení se tak nepřihlašuje zpátky). */
  async function probeExpired() {
    try {
      const r = await fetch('/hlavni.php', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return false; // výpadek / údržba není vypršení
      const t = new TextDecoder('windows-1250').decode(await r.arrayBuffer());
      return EXPIRED_RE.test(t);
    } catch { return false; }
  }

  // Stránka s hráči rasy (vesmir.php?id_rasa=…) je nejrychlejší ukazatel: po odhlášení z ní zbyde jen prázdná stránka s počítadlem návštěv.
  const onRacePage = /\/vesmir\.php$/.test(location.pathname) && /^\d+$/.test(new URLSearchParams(location.search).get('id_rasa') ?? '');
  const hasPlayerRows = (root) => [...root.querySelectorAll('tr')].some((tr) => /^\d+\.$/.test((tr.cells[0]?.textContent ?? '').trim())); // řádek „1.“, „2.“…
  async function fetchedHasPlayers() {
    try {
      const r = await fetch(location.href, { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return true; // výpadek / údržba není odhlášení
      const html = new TextDecoder('windows-1250').decode(await r.arrayBuffer());
      return hasPlayerRows(new DOMParser().parseFromString(html, 'text/html'));
    } catch { return true; }
  }
  /** Je hra opravdu odhlášená? (hláška o vypršení, nebo na stránce hráčů rasy chybí tabulka) */
  async function stillLoggedOut() {
    if (pageExpired() || (await probeExpired())) return true;
    return onRacePage && !(await fetchedHasPlayers());
  }

  // ---------- přihlášení ----------
  let heartbeat = null;
  const startHeartbeat = () => { if (!heartbeat) heartbeat = setInterval(renewLock, 20_000); };
  const stopHeartbeat = () => { clearInterval(heartbeat); heartbeat = null; };
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('sgd-relogin') : null;

  /** @returns {Promise<boolean>} true = přihlašování běží (tady nebo v jiné kartě), false = vypnuté v nastavení */
  async function startRelogin(reason) {
    if (getState() || lockedByOther()) return true; // už běží (tady nebo v jiné kartě)
    const dl = await loadCfg();
    if (!dl.enabled) return false; // automatické přihlášení je v aplikaci vypnuté: jen hlídáme
    if (getState() || !acquireLock()) return true;
    startHeartbeat();
    setState({ phase: 'wait', ret: location.href, attempts: 0, startedAt: Date.now() });
    let wait = maintenanceWaitMs(new Date(), dl);
    if (wait > 0) {
      wait += rndSec(dl, 'maintMinSec', 'maintMaxSec');
      report('maintenance', `Odhlášeno (${reason}), probíhá údržba serveru: přihlásím se asi za ${Math.round(wait / 60000)} min.`);
    } else {
      wait = rndSec(dl, 'reactMinSec', 'reactMaxSec'); // celé odhlášení → začátek přihlašování má trvat do ~10 s
      report('expired', `Odhlášeno ze hry (${reason}), přihlašuji se znovu.`);
    }
    const end = Date.now() + wait;
    while (Date.now() < end) await sleep(Math.min(5_000, end - Date.now()) + 1);
    // znovu: mezitím se mohlo přihlásit ručně
    if (!(await stillLoggedOut())) { finishQuiet('Přihlášení už platí (někdo se přihlásil sám).'); return true; }
    // jako člověk: nový panel s přihlašovací stránkou, tam klik na „Přihlaš“; tahle karta zatím čeká (data se po přihlášení obnoví)
    setState({ ...getState(), phase: 'tab' });
    jset(localStorage, JOB, { by: tabId, at: Date.now(), taken: null });
    GM_openInTab(location.origin + '/', { active: true, insert: true, setParent: true });
    const until = Date.now() + dl.tabWaitMin * 60_000;
    while (getState()?.phase === 'tab' && Date.now() < until) await sleep(1_000);
    if (getState()?.phase === 'tab') { // panel se nepřihlásil (nikdo nepřevzal úkol / zavřen)
      report('failed', `Nový panel se do ${dl.tabWaitMin} minut nepřihlásil. Přihlas se prosím ručně.`);
      jdel(localStorage, JOB);
      finishQuiet(null);
    }
    return true;
  }

  /** Přihlašovací panel se vzdal: smaže úkol a dá vědět čekající kartě. */
  function giveUp(st) { finishQuiet(null); if (st?.worker) { jdel(localStorage, JOB); channel?.postMessage({ type: 'failed' }); } }
  function finishQuiet(text) { stopHeartbeat(); releaseLock(); sessionStorage.removeItem(STATE); if (text) report('ok', text); }

  async function doLogin(st) {
    startHeartbeat();
    const cfg = await loadCfg();
    const user = $('log-jmeno'), pw = $('log-heslo'), btn = $('loginButton'), form = $('prihlaseni');
    const creds = await loadCreds();
    if (creds) { setField(user, creds.user); setField(pw, creds.password); } // údaje uložené v aplikaci; jinak je doplní Chrome
    const filled = () => (user.value && pw.value) || (user.matches(':-webkit-autofill') && pw.matches(':-webkit-autofill'));
    // Chrome doplní uložené údaje sám; skript je nezná ani nevyplňuje
    let waited = 0;
    while (!filled() && waited < 15_000) { await sleep(300); waited += 300; }
    if (!filled()) {
      report('needs-user', 'Přihlašovací formulář není vyplněný (Chrome nedoplnil uložené údaje). Přihlas se ručně.');
      banner('Chrome nedoplnil přihlašovací údaje, přihlas se prosím ručně.');
      giveUp(st);
      return;
    }
    // Chrome vykreslí uložené heslo hned, ale stránce (i tomuto skriptu) ho vydá až po skutečném kliknutí nebo stisku klávesy uživatele.
    // Dokud je pole z pohledu stránky prázdné, klik na Přihlaš by odeslal prázdné heslo (přihlášení by tiše selhalo a formulář zůstal).
    if (!pw.value) {
      const nudge = 'Chrome drží uložené heslo, dokud na přihlašovací stránku neklikneš. Klikni kamkoli do panelu, přihlášení pak dokončím samo.';
      report('needs-user', nudge);
      banner(nudge);
      const limit = Date.now() + cfg.tabWaitMin * 60_000 - 60_000;
      while (!pw.value && Date.now() < limit) await sleep(300);
      $('sgd-login-banner')?.remove();
      if (!pw.value) { report('failed', 'Do panelu se nekliklo, heslo zůstalo skryté. Přihlas se prosím ručně.'); giveUp(st); return; }
    }
    await sleep(rndSec(cfg, 'formMinSec', 'formMaxSec'));
    if (!document.querySelector('input[name="hra"]:checked')) ($('sg') ?? document.querySelector('input[name="hra"]'))?.click(); // výchozí je SG-1
    for (;;) {
      st = { ...(getState() ?? st), phase: 'submit' };
      st.attempts = (st.attempts ?? 0) + 1;
      setState(st);
      await clickEl(btn);
      await sleep(10_000); // při úspěchu stránka mezitím přejde jinam a skript tady končí
      if (st.attempts === 1 && form?.isConnected && isLoginPage()) { try { form.submit(); } catch { /* nic */ } await sleep(10_000); }
      if (st.attempts >= cfg.maxAttempts) break;
      const back = st.attempts === 1 ? rndSec(cfg, 'retryFirstMinSec', 'retryFirstMaxSec') : rndSec(cfg, 'retryNextMinSec', 'retryNextMaxSec');
      report('retry', `Přihlášení se nepovedlo (pokus ${st.attempts}/${cfg.maxAttempts}, heslo ${pw.value ? 'vyplněné' : 'prázdné'}), zkusím znovu za ${Math.round(back / 60000)} min.`);
      const end = Date.now() + back;
      while (Date.now() < end) await sleep(5_000);
      if (!isLoginPage()) return;
    }
    report('failed', `Přihlášení se ${cfg.maxAttempts}× nepovedlo. Přihlas se prosím ručně.`);
    banner('Přihlášení se nepovedlo, přihlas se prosím ručně.');
    giveUp(st);
  }

  async function afterLogin(st) {
    if (pageExpired()) { // po přihlášení zase „vypršelo“ – nezacyklit se
      report('failed', 'Po přihlášení hra pořád hlásí vypršelé přihlášení. Přihlas se prosím ručně.');
      giveUp(st);
      return;
    }
    const cfg = await loadCfg();
    const mins = Math.max(1, Math.round((Date.now() - (st.startedAt ?? Date.now())) / 60000));
    finishQuiet(`Znovu přihlášeno (trvalo ${mins} min).${cfg.reloadOthers ? ' Karty s daty se obnovují.' : ''}`);
    channel?.postMessage({ type: 'done', at: Date.now(), reload: cfg.reloadOthers ? [cfg.reloadMinSec, cfg.reloadMaxSec] : null });
    jdel(localStorage, JOB);
    if (cfg.closeTab) { await sleep(rnd(1_500, 3_000)); window.close(); } // panel otevřený skriptem se zavře sám (jinak zůstane na hlavní straně)
  }

  // ---------- ostatní karty: po přihlášení se obnoví (každá v jiný okamžik) ----------
  const loadedAt = Date.now();
  if (channel) {
    channel.onmessage = (m) => {
      const t = m.data?.type, own = getState();
      if (own?.phase === 'tab') { // tahle karta čekala na přihlašovací panel
        if (t === 'done' || t === 'failed') { finishQuiet(null); if (t === 'done' && m.data.reload) setTimeout(() => location.reload(), rnd(m.data.reload[0] * 1000, m.data.reload[1] * 1000)); }
        return;
      }
      if (t !== 'done' || own || isLoginPage()) return;
      if (loadedAt > m.data.at - 4_000) return; // už je načtená po přihlášení
      if (m.data.reload) setTimeout(() => location.reload(), rnd(m.data.reload[0] * 1000, m.data.reload[1] * 1000));
    };
  }

  // ---------- stránka hráčů rasy: tabulka zmizela (po odhlášení zbyde jen prázdná stránka) ----------
  async function racePageLoop() {
    await sleep(rnd(1_000, 2_500));
    let missing = 0;
    for (;;) {
      if (!getState() && !isLoginPage() && !lockedByOther()) {
        missing = hasPlayerRows(document) ? 0 : missing + 1;
        if (missing >= 2) { // tabulka chybí 2× po sobě (~3 s); dotaz na stránku pak potvrdí, že to není jen okamžik obnovy
          if (!(await fetchedHasPlayers())) { if (await startRelogin('na stránce hráčů rasy chybí tabulka (odhlášeno)')) return; }
          missing = 0;
        }
      }
      await sleep(rnd(1_200, 1_800));
    }
  }

  // ---------- hlídání: občas dotaz na hlavní stranu (jen jedna karta za minutu) ----------
  async function watchLoop() {
    await sleep(rnd(20_000, 40_000));
    for (;;) {
      if (!getState() && !isLoginPage() && !lockedByOther()) {
        const last = Number(localStorage.getItem(PROBE) || 0);
        if (Date.now() - last > 45_000) {
          localStorage.setItem(PROBE, String(Date.now()));
          if ((pageExpired() || (await probeExpired())) && (await startRelogin('vypršelo přihlášení'))) return;
        }
      }
      const c = await loadCfg();
      await sleep(rndSec(c, 'probeMinSec', 'probeMaxSec'));
    }
  }

  // ---------- start ----------
  (async () => {
    const st = getState();
    if (st) {
      if (st.phase === 'wait' || st.phase === 'tab') { finishQuiet(null); } // karta se obnovila uprostřed čekání: nic se nedělá, hlídání začne znovu
      else if (isLoginPage()) { await doLogin(st); return; }
      else if (st.phase === 'submit') { await afterLogin(st); return; }
    }
    if (isLoginPage() && !st) { // přihlašovací panel otevřený kartou, která zjistila odhlášení: převezme úkol
      const job = jget(localStorage, JOB);
      if (job && !job.taken && Date.now() - job.at < 3 * 60_000) {
        jset(localStorage, JOB, { ...job, taken: tabId });
        const w = { phase: 'submit', worker: true, attempts: 0, startedAt: job.at };
        setState(w);
        await doLogin(w);
      }
      return;
    }
    if (isLoginPage()) return;
    if (pageExpired()) { await sleep(rnd(500, 1_500)); if (await startRelogin('vypršelo přihlášení')) return; }
    watchLoop();
    if (onRacePage) racePageLoop();
  })();
})();
