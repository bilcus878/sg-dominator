/**
 * Chování teleskopu na mapě „jako člověk“: automatická aktivace zastaveného teleskopu a občasné záměrné
 * vynechání tlačítka bdělosti (po něm hra teleskop zastaví a bot ho nechá nějakou dobu vypnutý).
 * Stav drží server (ne stránka), protože hra po nepotvrzení stránku sama přenačte.
 * Čistá logika bez sítě a DOM; skript v prohlížeči jen hlásí, co vidí, a dostane instrukci.
 */

export const VIGILANCE_DEFAULTS = { enabled: true, minSec: 5, maxSec: 10, skipEnabled: true, skipMin: 5, skipMax: 10, downMin: 3, downMax: 15 };
export const TELESCOPE_DEFAULTS = { auto: true, reactMinSec: 10, reactMaxSec: 40 };

const MAX_ATTEMPTS = 3; // tolik kliknutí na Aktivovat za sebou bez úspěchu = problém, přestane se zkoušet
const BLOCK_MS = 30 * 60_000;

export function createTelescope({ rand = Math.random } = {}) {
  const st = {
    untilSkip: null, // kolik potvrzení ještě proběhne, než se příští tlačítko bdělosti vynechá
    skipPending: false, // vynechali jsme tlačítko, čekáme, až hra teleskop zastaví
    downUntil: 0, // do kdy nechat zastavený teleskop vypnutý
    attempts: 0,
    blockedUntil: 0,
    skipped: 0,
    state: 'unknown',
    zeroAlerted: false,
  };
  const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const randRange = (a, b) => a + rand() * (b - a);
  const cfgV = (v) => ({ ...VIGILANCE_DEFAULTS, ...v });
  const cfgT = (t) => ({ ...TELESCOPE_DEFAULTS, ...t });

  /** Objevilo se tlačítko bdělosti: potvrdit, nebo (jednou za skipMin–skipMax potvrzení) záměrně vynechat? */
  function vigilanceSeen(vCfg) {
    const v = cfgV(vCfg);
    if (!v.skipEnabled) return { action: 'click' };
    if (st.untilSkip === null) st.untilSkip = randInt(v.skipMin, v.skipMax);
    if (st.untilSkip <= 0) {
      st.skipPending = true;
      st.skipped++;
      st.untilSkip = randInt(v.skipMin, v.skipMax);
      return { action: 'skip' };
    }
    st.untilSkip--;
    return { action: 'click' };
  }

  /** Potvrzení proběhlo: případné čekání na zastavení po vynechání už neplatí. */
  function vigilanceClicked() {
    st.skipPending = false;
  }

  /**
   * Skript hlásí stav teleskopu.
   * rep: { state: 'active'|'stopped', remainingSec: číslo|null }
   * @returns {{action: 'none'|'wait'|'activate', delayMs?: number, waitMs?: number, alert?: string}}
   */
  function telescopeState(rep, opCfg, now = Date.now()) {
    const v = cfgV(opCfg?.vigilance);
    const t = cfgT(opCfg?.telescope);
    st.state = rep.state;
    if (rep.state === 'active') {
      st.attempts = 0;
      st.zeroAlerted = false;
      return { action: 'none' };
    }
    if (!t.auto) return { action: 'none' };
    if (rep.remainingSec === 0) { // došel čas teleskopu, aktivace nemá smysl
      const first = !st.zeroAlerted;
      st.zeroAlerted = true;
      return first ? { action: 'none', alert: 'zero' } : { action: 'none' };
    }
    if (now < st.blockedUntil) return { action: 'none' };
    if (st.skipPending) { // hra teleskop po vynechané bdělosti zastavila: teď začíná „pauza“
      st.skipPending = false;
      st.downUntil = now + Math.round(randRange(v.downMin, v.downMax) * 60_000);
    }
    if (now < st.downUntil) return { action: 'wait', waitMs: st.downUntil - now };
    return { action: 'activate', delayMs: Math.round(randRange(t.reactMinSec, t.reactMaxSec) * 1000) };
  }

  /** Skript se chystá kliknout na Aktivovat. Po třech neúspěšných pokusech za sebou se na 30 minut přestane. */
  function attempt(now = Date.now()) {
    st.attempts++;
    if (st.attempts >= MAX_ATTEMPTS) {
      st.attempts = 0;
      st.blockedUntil = now + BLOCK_MS;
      return { alert: 'failed' };
    }
    return {};
  }

  const snapshot = () => ({ state: st.state, untilSkip: st.untilSkip, skipped: st.skipped, downUntil: st.downUntil, blockedUntil: st.blockedUntil });

  return { vigilanceSeen, vigilanceClicked, telescopeState, attempt, snapshot };
}
