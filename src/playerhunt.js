/**
 * Lov hráče (🎯, zapíná se u jednotlivého hráče v jeho nastavení, např. Tartarus u Vyvrhelů): hlídá se nezávisle
 * na režimu rasy, když je její stránka otevřená.
 *   - 'd-on':  objevilo se D (hráče jde dobýt)                -> zpráva do hlavní skupiny
 *   - 'crit':  D svítí a síla je pod hranicí k dobytí (10 mil.) -> kritická zpráva
 *   - 'd-off': D zmizelo (po předchozí zprávě)                  -> krátká zpráva, že už nejde dobýt
 * Každá změna musí platit 2 čtení po sobě (filtr výkyvů při obnově stránky). Čistá logika bez I/O.
 */
export function createPlayerHunt() {
  const st = new Map(); // "raceId|jméno" -> { d, pendD, crit, pendCrit, notified }

  /**
   * @param {{name:string, power:number, attackable?:boolean|null}[]} players jen lovení hráči
   * @param {number} below hranice k dobytí (pod ní + D = kritické)
   * @returns {{type:'d-on'|'crit'|'d-off', name:string, power:number}[]}
   */
  function evaluate(raceId, players, below, now = Date.now()) {
    const events = [];
    for (const { name, power, attackable } of players) {
      if (typeof attackable !== 'boolean') continue; // starý skript: o D nic nevíme
      const key = `${raceId}|${name}`;
      let s = st.get(key);
      if (!s) st.set(key, (s = { d: false, pendD: false, crit: false, pendCrit: false, notified: false }));
      // D: změna stavu potvrzená 2 čteními
      if (attackable !== s.d) {
        if (s.pendD) {
          s.d = attackable; s.pendD = false;
          if (!s.d) { if (s.notified) events.push({ type: 'd-off', name, power }); s.notified = false; s.crit = false; s.pendCrit = false; continue; }
          s.notified = true;
          if (power < below) { s.crit = true; s.pendCrit = false; events.push({ type: 'crit', name, power }); continue; } // D rovnou pod hranicí: jen kritická zpráva
          events.push({ type: 'd-on', name, power });
        } else s.pendD = true;
      } else s.pendD = false;
      // kritické: D svítí a síla pod hranicí (2 čtení po sobě)
      const critNow = s.d && power < below;
      if (critNow && !s.crit) {
        if (s.pendCrit) { s.crit = true; s.pendCrit = false; s.notified = true; events.push({ type: 'crit', name, power }); }
        else s.pendCrit = true;
      } else if (!critNow) { s.crit = false; s.pendCrit = false; }
    }
    return events;
  }

  const status = (raceId, name) => { const s = st.get(`${raceId}|${name}`); return { huntD: !!s?.d, huntCrit: !!s?.crit }; };
  return { evaluate, status, clear: () => st.clear() };
}
