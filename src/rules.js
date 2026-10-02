/**
 * Rule engine – čistá logika bez I/O, aby šla snadno testovat.
 *
 * Alert se vyšle, když:
 *  1) síla je pod prahem a zároveň je nižší než při posledním alertu
 *     (tj. první pád pod práh + každý další útok, který sílu ještě sníží),
 *  2) (volitelně) síla klesla o >= dropPct % oproti maximu v posledním okně.
 * Pád musí potvrdit 2 po sobě jdoucí čtení (filtr jednorázových výkyvů při obnově stránky).
 * Volitelně (repeatWhileBelow) se zpráva opakuje po každé pauze, dokud je hráč pod prahem.
 * Kritické pásmo (power < critical, 2 čtení po sobě): při vstupu do něj se zpráva pošle ihned
 * (bez cooldownu), pak se opakuje po criticalCooldownSec, dokud hráč z pásma nevyleze.
 * V kritickém pásmu se neposílají běžné zprávy "pod prahem".
 * Na hráče platí cooldown. Alert potlačený cooldownem se nezahazuje – při
 * dalším snapshotu je podmínka stále splněná, takže se vyšle později.
 */

export function createState() {
  return new Map(); // jméno -> { lastPower, lastAlertedPower, lastAlertAt, history: [{t, p}] }
}

/**
 * Po změně konfigurace (např. zvýšení prahu) nechceme alert za každého, kdo je
 * teď pod novým prahem. Jejich aktuální síla se bere jako výchozí stav.
 */
export function rebaseline(state, thresholdOf, criticalOf = () => 0) {
  for (const [name, s] of state) {
    if (s.lastPower < thresholdOf(name)) s.lastAlertedPower = Math.min(s.lastAlertedPower ?? Infinity, s.lastPower);
    else s.lastAlertedPower = null;
    const c = criticalOf(name);
    s.critEscalated = c > 0 && s.lastPower < c; // kdo je teď v kritickém pásmu, vstup už "ohlášen" není třeba
  }
}

/**
 * @param {Map} state
 * @param {{name:string, power:number, threshold?:number, critical?:number, watched?:boolean}[]} players
 *   threshold/critical/watched určuje volající (viz watch.js); výchozí je globální práh, bez kritické hranice, hlídáno
 * @param {object} cfg
 * @param {number} now ms
 * @returns {{name:string, power:number, prev:number|null, threshold:number, reason:'threshold'|'drop'|'recovered'|'critical', dropPct:number}[]}
 */
export function evaluate(state, players, cfg, now = Date.now()) {
  const alerts = [];

  for (const { name, power, threshold: own, critical = 0, watched = true } of players) {
    let s = state.get(name);
    const first = !s;
    if (!s) {
      s = { lastPower: power, lastAlertedPower: null, lastAlertAt: -Infinity, lastTriggered: false, lastOk: true, lastCrit: false, critEscalated: false, lastCritAlertAt: -Infinity, history: [] };
      state.set(name, s);
    }

    const prev = first ? null : s.lastPower;
    const threshold = own ?? cfg.threshold;

    // okno historie pro procentuální propad
    s.history.push({ t: now, p: power });
    const cutoff = now - cfg.dropWindowSec * 1000;
    while (s.history.length && s.history[0].t < cutoff) s.history.shift();

    // návrat nad práh = znovu "ozbrojeno"; s hlášením návratu čekáme na 2. potvrzující čtení
    const prevOk = s.lastOk;
    s.lastOk = power >= threshold;
    let recovered = false;
    if (power >= threshold && s.lastAlertedPower !== null) {
      if (!cfg.notifyRecovery) s.lastAlertedPower = null;
      else if (prevOk && !first) {
        s.lastAlertedPower = null;
        recovered = true;
      }
    }

    let dropPct = 0;
    if (cfg.dropPct > 0) {
      const max = Math.max(...s.history.map((h) => h.p));
      dropPct = max > 0 ? ((max - power) / max) * 100 : 0;
    }
    const below = power < threshold;
    const dropped = cfg.dropPct > 0 && dropPct >= cfg.dropPct;
    const triggered = below || dropped;
    const confirmed = triggered && s.lastTriggered; // musí platit ve 2 po sobě jdoucích čteních
    s.lastTriggered = triggered;

    const crit = critical > 0 && power < critical;
    const confirmedCrit = crit && s.lastCrit;
    s.lastCrit = crit;
    if (!crit) s.critEscalated = false; // z kritického pásma venku = znovu "ozbrojeno"

    if (first) {
      // baseline: hráč, který je při startu už pod prahem, nespamuje
      if (below) s.lastAlertedPower = power;
      if (crit) s.critEscalated = true;
      continue;
    }
    // jednorázový výkyv (pád pod práh i do kritického pásma); lastPower zůstává na hodnotě před pádem
    if ((triggered && !confirmed) || (crit && !confirmedCrit)) continue;

    s.lastPower = power;
    if (!watched) continue;
    if (recovered) alerts.push({ name, power, prev, threshold, reason: 'recovered', dropPct: 0 });

    if (confirmedCrit) {
      const entering = !s.critEscalated;
      if (entering || now - s.lastCritAlertAt >= cfg.criticalCooldownSec * 1000) {
        s.critEscalated = true;
        s.lastCritAlertAt = now;
        s.lastAlertAt = now; // navazující běžné zprávy po opuštění pásma nemají hned duplikovat
        s.lastAlertedPower = Math.min(power, s.lastAlertedPower ?? Infinity);
        alerts.push({ name, power, prev, threshold, critical, reason: 'critical', dropPct, repeat: !entering });
      }
      continue; // v kritickém pásmu žádné běžné zprávy
    }
    if (!confirmed) continue;

    // pod prahem hlásíme jen další pokles o aspoň minDrop (min. 1)
    const lower = s.lastAlertedPower === null || s.lastAlertedPower - power >= Math.max(1, cfg.minDrop);
    // připomínka: dokud je hráč pod hranicí, opakuj zprávu po každé pauze i bez dalšího poklesu
    const repeat = !lower && below && cfg.repeatWhileBelow;
    if (!lower && !repeat) continue;
    const reason = below ? 'threshold' : 'drop';
    if (now - s.lastAlertAt < cfg.cooldownSec * 1000) continue;

    s.lastAlertAt = now;
    s.lastAlertedPower = Math.min(power, s.lastAlertedPower ?? Infinity);
    alerts.push({ name, power, prev, threshold, reason, dropPct, repeat });
  }
  return alerts;
}
