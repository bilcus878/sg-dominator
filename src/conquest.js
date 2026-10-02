/**
 * „K dobytí“ u cizích ras (role 'attack'): hráč je cíl, když mu síla spadne pod `below`,
 * a cílem zůstává, dokud nevyleze nad `above` (hystereze, ať notifikace neskáče kolem hranice).
 *
 *  - target:   hráč se stal cílem a jde na něj zaútočit -> jedna zpráva
 *  - released: hráč vylezl nad `above` -> jedna zpráva „už není k dobytí“ (jen když se předtím hlásil)
 * Vstup i výstup musí potvrdit 2 po sobě jdoucí čtení (filtr výkyvů při obnově stránky).
 * Cíl, kterého nelze dobýt (attackable === false: ve hře chybí ikona D), se ukazuje, ale nehlásí; ohlásí se,
 * jakmile D bude a je pořád cílem. Čistá logika bez I/O.
 */
export const CONQUEST_DEFAULTS = { below: 10_000_000, above: 20_000_000 };

export function createConquest() {
  const st = new Map(); // "raceId|jméno" -> { target, since, notified, pendIn, pendOut }

  /**
   * @param {string} raceId
   * @param {{name:string, power:number, attackable?:boolean|null, watched:boolean}[]} players
   * @param {{below:number, above:number}} limits
   * @returns {{type:'target'|'released', name:string, power:number, since:number}[]}
   */
  function evaluate(raceId, players, { below, above }, now = Date.now()) {
    const events = [];
    for (const { name, power, attackable, watched } of players) {
      const key = `${raceId}|${name}`;
      let s = st.get(key);
      if (!s) st.set(key, (s = { target: false, since: 0, notified: false, pendIn: false, pendOut: false }));
      if (!s.target) {
        if (power < below) {
          if (s.pendIn) { s.target = true; s.since = now; s.pendOut = false; }
          else s.pendIn = true;
        } else s.pendIn = false;
      } else if (power > above) {
        if (s.pendOut) {
          if (s.notified && watched) events.push({ type: 'released', name, power, since: s.since });
          Object.assign(s, { target: false, since: 0, notified: false, pendIn: false, pendOut: false });
          continue;
        }
        s.pendOut = true;
      } else s.pendOut = false;

      if (!watched) { s.notified = false; continue; } // nehlídaný hráč: po zapnutí se ohlásí znovu
      if (s.target && !s.notified && attackable !== false) {
        s.notified = true;
        events.push({ type: 'target', name, power, since: s.since });
      }
    }
    return events;
  }

  /** Stav pro UI. */
  const status = (raceId, name) => {
    const s = st.get(`${raceId}|${name}`);
    return s?.target ? { target: true, since: s.since } : { target: false, since: 0 };
  };

  return { evaluate, status, clear: () => st.clear() };
}
