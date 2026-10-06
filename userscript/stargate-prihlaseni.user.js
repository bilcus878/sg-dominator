// ==UserScript==
// @name         Stargate dominator – přihlášení
// @namespace    sg-dominator
// @version      1.0.0
// @description  Když hru po ~3 hodinách odhlásí (Vypršela platnost přihlášení), jedna karta se sama přihlásí zpátky (údaje doplní Chrome, skript hesla nezná), ostatní karty se obnoví. V době denní údržby (3:00–3:31) počká.
// @match        https://stargate-game.cz/*
// @match        https://www.stargate-game.cz/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @noframes
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  const SERVER = '__SERVER__';
  const TOKEN = '__TOKEN__';
  const VERSION = '1.0.0'; // stejné jako @version

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const $ = (id) => document.getElementById(id);

  // ---------- sdílený stav mezi kartami (localStorage) a stav této karty (sessionStorage) ----------
  const jget = (st, k) => { try { return JSON.parse(st.getItem(k)); } catch { return null; } };
  const jset = (st, k, v) => { try { st.setItem(k, JSON.stringify(v)); } catch { /* plné/zakázané úložiště */ } };
  const jdel = (st, k) => { try { st.removeItem(k); } catch { /* nic */ } };
  const LOCK = 'sgd_relogin_lock', PROBE = 'sgd_probe_at', STATE = 'sgd_relogin_state', TABID = 'sgd_tab_id';
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
  /** Denní údržba serveru (3:00–3:31). Vrací, za kolik ms po ní bude možné se přihlásit (0 = mimo údržbu); začíná se brzy, ať se nenarazí těsně před ní. */
  function maintenanceWaitMs(now = new Date()) {
    const start = new Date(now); start.setHours(2, 57, 0, 0);
    const end = new Date(now); end.setHours(3, 31, 20, 0);
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

  // ---------- přihlášení ----------
  let heartbeat = null;
  const startHeartbeat = () => { if (!heartbeat) heartbeat = setInterval(renewLock, 20_000); };
  const stopHeartbeat = () => { clearInterval(heartbeat); heartbeat = null; };
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('sgd-relogin') : null;

  async function startRelogin(reason) {
    if (getState() || !acquireLock()) return; // už běží (tady nebo v jiné kartě)
    startHeartbeat();
    setState({ phase: 'wait', ret: location.href, attempts: 0, startedAt: Date.now() });
    let wait = maintenanceWaitMs();
    if (wait > 0) {
      wait += rnd(8_000, 70_000);
      report('maintenance', `Odhlášeno (${reason}), probíhá údržba serveru: přihlásím se asi za ${Math.round(wait / 60000)} min.`);
    } else {
      wait = rnd(4_000, 9_000);
      report('expired', `Odhlášeno ze hry (${reason}), přihlašuji se znovu.`);
    }
    const end = Date.now() + wait;
    while (Date.now() < end) await sleep(Math.min(5_000, end - Date.now()) + 1);
    // znovu: mezitím se mohlo přihlásit ručně
    if (!(await probeExpired()) && !pageExpired()) { finishQuiet('Přihlášení už platí (někdo se přihlásil sám).'); return; }
    setState({ ...getState(), phase: 'go' });
    location.assign(location.origin + '/');
  }

  function finishQuiet(text) { stopHeartbeat(); releaseLock(); sessionStorage.removeItem(STATE); if (text) report('ok', text); }

  async function doLogin(st) {
    startHeartbeat();
    const user = $('log-jmeno'), pw = $('log-heslo'), btn = $('loginButton'), form = $('prihlaseni');
    const filled = () => (user.value && pw.value) || (user.matches(':-webkit-autofill') && pw.matches(':-webkit-autofill'));
    // Chrome doplní uložené údaje sám; skript je nezná ani nevyplňuje
    let waited = 0;
    while (!filled() && waited < 15_000) { await sleep(300); waited += 300; }
    if (!filled()) {
      report('needs-user', 'Přihlašovací formulář není vyplněný (Chrome nedoplnil uložené údaje). Přihlas se ručně.');
      banner('Chrome nedoplnil přihlašovací údaje, přihlas se prosím ručně.');
      finishQuiet(null);
      return;
    }
    await sleep(rnd(1_500, 4_000));
    if (!document.querySelector('input[name="hra"]:checked')) ($('sg') ?? document.querySelector('input[name="hra"]'))?.click(); // výchozí je SG-1
    for (;;) {
      st = { ...(getState() ?? st), phase: 'submit' };
      st.attempts = (st.attempts ?? 0) + 1;
      setState(st);
      await clickEl(btn);
      await sleep(10_000); // při úspěchu stránka mezitím přejde jinam a skript tady končí
      if (st.attempts === 1 && form?.isConnected && isLoginPage()) { try { form.submit(); } catch { /* nic */ } await sleep(10_000); }
      if (st.attempts >= 3) break;
      const back = st.attempts === 1 ? rnd(110_000, 150_000) : rnd(280_000, 340_000);
      report('retry', `Přihlášení se nepovedlo (pokus ${st.attempts}/3), zkusím znovu za ${Math.round(back / 60000)} min.`);
      const end = Date.now() + back;
      while (Date.now() < end) await sleep(5_000);
      if (!isLoginPage()) return;
    }
    report('failed', 'Přihlášení se napotřetí nepovedlo. Přihlas se prosím ručně.');
    banner('Přihlášení se nepovedlo, přihlas se prosím ručně.');
    finishQuiet(null);
  }

  async function afterLogin(st) {
    if (pageExpired()) { // po přihlášení zase „vypršelo“ – nezacyklit se
      report('failed', 'Po přihlášení hra pořád hlásí vypršelé přihlášení. Přihlas se prosím ručně.');
      finishQuiet(null);
      return;
    }
    const mins = Math.max(1, Math.round((Date.now() - (st.startedAt ?? Date.now())) / 60000));
    finishQuiet(`Znovu přihlášeno (trvalo ${mins} min). Karty s daty se obnovují.`);
    channel?.postMessage({ type: 'done', at: Date.now() });
    // vrátit tuhle kartu na stránku, na které byla (hlavní strana a přihlašovací stránka se nechají)
    const ret = st.ret;
    if (ret && !/stargate-game\.cz\/?(index\.php)?(\?.*)?$/.test(ret) && ret !== location.href) {
      await sleep(rnd(2_500, 6_000));
      location.assign(ret);
    }
  }

  // ---------- ostatní karty: po přihlášení se obnoví (každá v jiný okamžik) ----------
  const loadedAt = Date.now();
  if (channel) {
    channel.onmessage = (m) => {
      if (m.data?.type !== 'done' || getState() || isLoginPage()) return;
      if (loadedAt > m.data.at - 4_000) return; // už je načtená po přihlášení
      setTimeout(() => location.reload(), rnd(2_000, 8_000));
    };
  }

  // ---------- hlídání: občas dotaz na hlavní stranu (jen jedna karta za minutu) ----------
  async function watchLoop() {
    await sleep(rnd(20_000, 40_000));
    for (;;) {
      if (!getState() && !isLoginPage() && !lockedByOther()) {
        const last = Number(localStorage.getItem(PROBE) || 0);
        if (Date.now() - last > 45_000) {
          localStorage.setItem(PROBE, String(Date.now()));
          if (pageExpired() || (await probeExpired())) { startRelogin('vypršelo přihlášení'); return; }
        }
      }
      await sleep(rnd(60_000, 120_000));
    }
  }

  // ---------- start ----------
  (async () => {
    const st = getState();
    if (st) {
      if (st.phase === 'wait') { finishQuiet(null); } // karta se obnovila uprostřed čekání: nic se nedělá, hlídání začne znovu
      else if (isLoginPage()) { await doLogin(st); return; }
      else if (st.phase === 'go' || st.phase === 'submit') { await afterLogin(st); return; }
    }
    if (isLoginPage()) return;
    if (pageExpired()) { await sleep(rnd(2_000, 6_000)); startRelogin('vypršelo přihlášení'); return; }
    watchLoop();
  })();
})();
