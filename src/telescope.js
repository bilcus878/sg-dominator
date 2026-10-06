/**
 * Chování teleskopu na mapě „jako člověk“: automatická aktivace zastaveného teleskopu a občasné záměrné
 * vynechání tlačítka bdělosti (po něm hra teleskop zastaví a bot ho nechá nějakou dobu vypnutý).
 * Šetření po OP: další OP se objeví nejdřív 5 minut po předchozím, takže po objevení OP se teleskop (občas ne,
 * ať to nemá vzorec) po lidské prodlevě zastaví a v náhodném čase se zapne zpět, vždy tak, aby jel dřív než za 5 minut.
 * Stav drží server (ne stránka), protože hra po nepotvrzení stránku sama přenačte.
 * Čistá logika bez sítě a DOM; skript v prohlížeči jen hlásí, co vidí, a dostane instrukci.
 */

export const VIGILANCE_DEFAULTS = { enabled: true, minSec: 5, maxSec: 10, skipEnabled: true, skipMin: 5, skipMax: 10, downMin: 3, downMax: 15 };
export const TELESCOPE_DEFAULTS = {
  auto: true, reactMinSec: 10, reactMaxSec: 40,
  // šetření po OP: šance (%), zastavit za restStopMin–Max s, zapnout zpět restResumeMin–Max s od objevení OP
  restEnabled: true, restChance: 80, restStopMin: 20, restStopMax: 90, restResumeMin: 165, restResumeMax: 230,
};
export const OP_GAP_MS = 5 * 60_000; // další OP se objeví nejdřív po 5 minutách
const READY_MARGIN_MS = 20_000; // teleskop musí jet aspoň tolik před koncem jistého okna

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
    stopAt: 0, // šetření po OP: kdy teleskop zastavit (0 = nic naplánováno)
    restUntil: 0, // do kdy nechat teleskop po OP vypnutý
    restDeadline: 0, // nejpozději kdy musí znovu jet (OP + 5 min − rezerva)
    rested: 0,
    opSeen: false, // od zapnutí hlídání OP se už objevila první vlna OP (dřív se teleskop nešetří ani se záměrně nevynechává bdělost)
  };
  const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const randRange = (a, b) => a + rand() * (b - a);
  const cfgV = (v) => ({ ...VIGILANCE_DEFAULTS, ...v });
  const cfgT = (t) => ({ ...TELESCOPE_DEFAULTS, ...t });

  /** Objevilo se tlačítko bdělosti: potvrdit, nebo (jednou za skipMin–skipMax potvrzení) záměrně vynechat? */
  function vigilanceSeen(vCfg) {
    const v = cfgV(vCfg);
    if (!st.opSeen || !v.skipEnabled) return { action: 'click' };
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

  /**
   * Objevil se nový OP: naplánuje šetření teleskopu (zastavit po lidské prodlevě, zapnout zpět před koncem 5min okna).
   * @returns {{rest:boolean, stopAt?:number, restUntil?:number}}
   */
  function opAppeared(opCfg, now = Date.now()) {
    st.opSeen = true;
    const t = cfgT(opCfg?.telescope);
    if (!t.auto || !t.restEnabled) return { rest: false };
    if (st.restUntil > now) return { rest: false }; // už se šetří
    if (rand() * 100 >= t.restChance) return { rest: false }; // tentokrát nechat běžet, ať to nemá vzorec
    st.stopAt = now + Math.round(randRange(t.restStopMin, t.restStopMax) * 1000);
    st.restUntil = now + Math.round(randRange(t.restResumeMin, t.restResumeMax) * 1000);
    st.restDeadline = now + OP_GAP_MS - READY_MARGIN_MS;
    return { rest: true, stopAt: st.stopAt, restUntil: st.restUntil };
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
      if (st.stopAt && now >= st.stopAt) { // šetření po OP: teď zastavit
        st.stopAt = 0;
        if (t.auto && now < st.restUntil - 30_000) { st.rested++; return { action: 'stop', delayMs: Math.round(randRange(400, 1800)) }; }
      }
      return { action: 'none' };
    }
    st.stopAt = 0; // teleskop už stojí (ručně, bdělostí…): zastavovat není co
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
    if (now < st.restUntil) return { action: 'wait', waitMs: st.restUntil - now };
    let delayMs = Math.round(randRange(t.reactMinSec, t.reactMaxSec) * 1000);
    // po šetření musí teleskop jet dřív, než může přijít další OP
    if (st.restDeadline > now) delayMs = Math.max(500, Math.min(delayMs, st.restDeadline - now - 5000));
    return { action: 'activate', delayMs };
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

  /** Hlídání OP je vypnuté: po dalším zapnutí se zase čeká na první vlnu OP. */
  function resetOp() { st.opSeen = false; }

  /** Když je OP vypnuté, bot nic nedělá, ale stav teleskopu se pro UI zapamatuje. */
  function noteState(state) {
    st.state = state;
  }

  const snapshot = () => ({ state: st.state, untilSkip: st.untilSkip, skipped: st.skipped, downUntil: st.downUntil, blockedUntil: st.blockedUntil, stopAt: st.stopAt, restUntil: st.restUntil, rested: st.rested, opSeen: st.opSeen });

  return { vigilanceSeen, vigilanceClicked, opAppeared, telescopeState, attempt, noteState, snapshot, resetOp };
}
