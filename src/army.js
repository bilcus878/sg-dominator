/**
 * Dohození rasové armády: tlačítko Dohodit v aplikaci -> skript na stránce Jednotky → Rasová armáda
 * vepíše jméno hráče do „Odeslat hráči“ a klikne na Odeslat. Vždy jen jeden požadavek najednou;
 * skript si ho vyzvedne jen jednou (nikdy se neodešle dvakrát). Čistá logika bez I/O.
 */
const PAGE_LIVE_MS = 5_000; // stránka Rasová armáda se ozvala nedávno = je otevřená
const REQUEST_TTL_MS = 15_000; // nevyzvednutý požadavek po této době propadne

export function createArmy() {
  let seq = 0;
  let pageSeenAt = -Infinity; // stránka se zatím neozvala
  let req = null; // { id, name, at, status: 'pending'|'sending'|'sent'|'error'|'expired', error }
  let waiting = 0; // kolik skriptů právě čeká na pokyn (dlouhé dotazování): stránka je pak otevřená, i když neposlala běžný dotaz

  /** Kliknutí na Dohodit v aplikaci. */
  function request(name, now = Date.now()) {
    if (typeof name !== 'string' || !name.trim() || name.length > 64) return { ok: false, error: 'chybí jméno hráče' };
    if (!waiting && now - pageSeenAt > PAGE_LIVE_MS) return { ok: false, error: 'Otevři ve hře stránku Jednotky → Rasová armáda (se skriptem) a vyplň počty jednotek.' };
    if (req && (req.status === 'pending' || req.status === 'sending') && now - req.at < REQUEST_TTL_MS) {
      return { ok: false, error: `Ještě se dohazuje ${req.name}, chvíli počkej.` };
    }
    req = { id: ++seq, name: name.trim(), at: now, status: 'pending', error: '' };
    return { ok: true, id: req.id };
  }

  /** Skript na stránce se ptá, jestli má něco odeslat. Požadavek vydá jen jednou. */
  function poll(now = Date.now()) {
    pageSeenAt = now;
    if (!req || req.status !== 'pending') return { action: 'none' };
    if (now - req.at > REQUEST_TTL_MS) { req.status = 'expired'; return { action: 'none' }; }
    req.status = 'sending';
    return { action: 'send', id: req.id, name: req.name };
  }

  /** Skript hlásí výsledek (ok = klikl na Odeslat, jinak důvod, proč neodeslal). */
  function report({ id, ok, error }) {
    if (!req || req.id !== id) return;
    req.status = ok ? 'sent' : 'error';
    req.error = ok ? '' : String(error ?? 'neznámá chyba').slice(0, 160);
  }

  /** Skript začal / skončil čekat na pokyn (dlouhé dotazování). */
  const waitStart = (now = Date.now()) => { waiting += 1; pageSeenAt = now; };
  const waitEnd = (now = Date.now()) => { waiting = Math.max(0, waiting - 1); pageSeenAt = now; };

  const status = (now = Date.now()) => ({
    pageLive: waiting > 0 || now - pageSeenAt <= PAGE_LIVE_MS,
    req: req && { id: req.id, name: req.name, status: req.status === 'pending' && now - req.at > REQUEST_TTL_MS ? 'expired' : req.status, error: req.error },
  });

  return { request, poll, report, status, waitStart, waitEnd };
}
