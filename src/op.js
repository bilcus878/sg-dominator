/**
 * Sleduje tečky OP na mapě.
 *  - fresh:   sektor, který se právě objevil (první snímek po startu je jen výchozí stav)
 *  - repeats: sektor, který pořád svítí a od posledního hlášení uplynulo repeatMs (0 = nikdy)
 * Sektor se považuje za "pryč", až když ho nikdo neviděl GONE_AFTER_MS; kratší výpadek
 * (okno nestihlo obrázek, překreslení) není nová tečka a nehlásí se podruhé.
 */
const GONE_AFTER_MS = 10_000;
const CURRENT_MS = 3_000;

export function createOpTracker() {
  const active = new Map(); // id -> { label, firstSeen, lastSeen, notifiedAt }
  let initialized = false;

  /**
   * @param {{id:string,label:string}[]} sectors tečky ve snímku
   * @param {number} now
   * @param {{repeatMs?:number, silent?:boolean}} opts silent = alerty jsou vypnuté: jen sledujeme
   *   a bereme vše jako už ohlášené (po zapnutí se tak nehlásí staré tečky)
   */
  function update(sectors, now = Date.now(), { repeatMs = 0, silent = false } = {}) {
    const fresh = [];
    const repeats = [];
    for (const [id, e] of active) if (now - e.lastSeen > GONE_AFTER_MS) active.delete(id);
    for (const { id, label } of sectors) {
      const e = active.get(id);
      if (!e) {
        active.set(id, { label, firstSeen: now, lastSeen: now, notifiedAt: now });
        if (initialized && !silent) fresh.push({ id, label });
        continue;
      }
      e.lastSeen = now;
      e.label = label;
      if (silent) e.notifiedAt = now;
      else if (repeatMs > 0 && now - e.notifiedAt >= repeatMs) {
        e.notifiedAt = now;
        repeats.push({ id, label });
      }
    }
    initialized = true;
    return { fresh, repeats };
  }

  /** Tečky viditelné právě teď (pro UI). */
  const current = (now = Date.now()) =>
    [...active].filter(([, e]) => now - e.lastSeen < CURRENT_MS).map(([id, e]) => ({ id, label: e.label, since: e.firstSeen }));

  return { update, current };
}
