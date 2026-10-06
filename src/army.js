/**
 * Dohození rasové armády: tlačítko Dohodit v aplikaci -> skript na stránce Jednotky → Rasová armáda
 * vepíše jméno hráče do „Odeslat hráči“ a klikne na Odeslat. Vždy jen jeden požadavek najednou;
 * skript si ho vyzvedne jen jednou (nikdy se neodešle dvakrát). Čistá logika bez I/O.
 */
const PAGE_LIVE_MS = 5_000; // stránka Rasová armáda se ozvala nedávno = je otevřená
const REQUEST_TTL_MS = 15_000; // nevyzvednutý požadavek po této době propadne
const RELOAD_TTL_MS = 12_000; // obnovení stránky se čeká nejvýš tak dlouho (pak se bere, že stránka zmizela)
const MAX_RETRIES = 2; // kolikrát může skript požadavek vrátit k novému vyzvednutí (např. po obnovení zastaralé stránky)

export function createArmy() {
  let seq = 0;
  let pageSeenAt = -Infinity; // stránka se zatím neozvala
  let req = null; // { id, name, at, status: 'pending'|'sending'|'sent'|'error'|'expired', error }
  let reload = null; // { at, inst }: žádost o obnovení stránky Rasová armáda (po odhlášení/přihlášení bývá zastaralá); inst = která kopie stránky má obnovení provést
  let waiting = 0; // kolik skriptů právě čeká na pokyn (dlouhé dotazování): stránka je pak otevřená, i když neposlala běžný dotaz

  /** Kliknutí na Dohodit v aplikaci. */
  function request(name, now = Date.now()) {
    if (typeof name !== 'string' || !name.trim() || name.length > 64) return { ok: false, error: 'chybí jméno hráče' };
    if (!waiting && now - pageSeenAt > PAGE_LIVE_MS) return { ok: false, error: 'Otevři ve hře stránku Jednotky → Rasová armáda (se skriptem) a vyplň počty jednotek.' };
    if (reload && now - reload.at <= RELOAD_TTL_MS) return { ok: false, error: 'Ještě se dohazuje: stránka Rasová armáda se obnovuje.' };
    if (req && (req.status === 'pending' || req.status === 'sending') && now - req.at < REQUEST_TTL_MS) {
      return { ok: false, error: `Ještě se dohazuje ${req.name}, chvíli počkej.` };
    }
    req = { id: ++seq, name: name.trim(), at: now, status: 'pending', error: '' };
    return { ok: true, id: req.id };
  }

  /** Skript na stránce se ptá, jestli má něco odeslat. Požadavek vydá jen jednou. */
  function poll(now = Date.now(), inst = '') {
    pageSeenAt = now;
    if (reload) {
      if (now - reload.at > RELOAD_TTL_MS) reload = null; // stránka se nevrátila: žádost propadla
      else if (!reload.inst) { reload.inst = inst || '?'; return { action: 'reload' }; } // první kopie stránky, která se ozvala: ta se má obnovit
      else if (inst && inst !== reload.inst) reload = null; // ozvala se NOVÁ kopie (stránka je obnovená): dohazovat se může
      else return { action: 'reload' }; // stará kopie ještě nestihla přejít
    }
    if (!req || req.status !== 'pending') return { action: 'none' };
    if (now - req.at > REQUEST_TTL_MS) { req.status = 'expired'; return { action: 'none' }; }
    req.status = 'sending';
    return { action: 'send', id: req.id, name: req.name };
  }

  /** Skript hlásí výsledek (ok = klikl na Odeslat, jinak důvod, proč neodeslal). */
  function report({ id, ok, error, retry }) {
    if (!req || req.id !== id) return;
    if (retry && !ok && (req.retries ?? 0) < MAX_RETRIES) { req.retries = (req.retries ?? 0) + 1; req.status = 'pending'; req.error = ''; return; } // skript stránku obnovuje: požadavek si vyzvedne po obnovení znovu
    req.status = ok ? 'sent' : 'error';
    req.error = ok ? '' : String(error ?? 'neznámá chyba').slice(0, 160);
  }

  /** Žádost o obnovení stránky (nezabral dohoz, např. po odhlášení/přihlášení zbyl starý formulář): do obnovení se nový dohoz nezadává. */
  const requestReload = (now = Date.now()) => { reload = { at: now, inst: '' }; };

  /** Skript začal / skončil čekat na pokyn (dlouhé dotazování). */
  const waitStart = (now = Date.now()) => { waiting += 1; pageSeenAt = now; };
  const waitEnd = (now = Date.now()) => { waiting = Math.max(0, waiting - 1); pageSeenAt = now; };

  const status = (now = Date.now()) => ({
    pageLive: waiting > 0 || now - pageSeenAt <= PAGE_LIVE_MS,
    req: req && { id: req.id, name: req.name, status: req.status === 'pending' && now - req.at > REQUEST_TTL_MS ? 'expired' : req.status, error: req.error },
  });

  return { request, poll, report, status, waitStart, waitEnd, requestReload };
}
