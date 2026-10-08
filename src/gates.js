/**
 * Nákup hvězdných bran (Obchod → Hvězdné brány): hra nabízí neutrální nabídku „X bran po Y kg naquadahu“, která se mění
 * každé 3 minuty. Bot si stránku jako člověk občas obnoví, těsně po změně nabídky (1–5 s) ji načte znovu a když je cena pod
 * nastaveným limitem, klikne na Koupit, dokud je co kupovat a stačí naquadah. Planetu nevybírá (na kterou planetu to padne, nevadí).
 *
 * Čistá logika bez sítě a DOM: skript na stránce jen hlásí, co vidí (cena, počet, odpočet, naquadah), a dostane pokyn
 * (koupit / počkat a obnovit za X ms / nic). Stav (rozjetý nákup, součty) drží server, protože se stránka při každém kliknutí přenačte.
 *
 * Pojistky: jedna karta nakupuje (druhá dostane „nic“), po každém kliknutí se ověří, že naquadah opravdu ubyl (2 neúspěchy = nákup
 * v téhle nabídce se zastaví), limit ceny, rezerva naquadahu, limit kusů za nabídku, zkušební režim (nikdy neklikne).
 */

export const GATES_DEFAULTS = {
  enabled: false,
  notify: true, // zpráva do servisního chatu: kolik bran se koupilo a za kolik
  dryRun: true, // první spuštění: vše kromě samotného kliknutí na Koupit, výsledek jen zpráva
  maxPrice: 5_000_000, // nejvyšší přijatelná cena jedné brány (kg naquadahu)
  reserveNaq: 0, // kolik naquadahu nechat nevyužito
  maxPerOffer: 0, // nejvíc bran z jedné nabídky (0 = všechny dostupné)
  afterMinSec: 1, afterMaxSec: 5, // po změně nabídky obnovit stránku za (s)
  midChance: 70, // šance (%), že se stránka uprostřed 3minutového cyklu občas obnoví, jako když se člověk dívá
  midMinSec: 25, midMaxSec: 80, // kdy (s od posledního načtení)
  firstMinSec: 0.4, firstMaxSec: 1.3, // před prvním kliknutím na Koupit po načtení dobré nabídky
  stepMinSec: 0.7, stepMaxSec: 2.2, // mezi dalšími kliknutími na Koupit
};

const MAX_FAILS = 2; // tolik kliknutí za sebou bez úbytku naquadahu = v téhle nabídce se přestane
const OWNER_TTL_MS = 30_000; // karta, která naposledy hlásila před méně než tolika ms, „vlastní“ nakupování
const LOW_NAQ_GAP_MS = 20 * 60_000; // zprávu o nedostatku naquadahu nejvýš jednou za tuto dobu

export function createGates({ rand = Math.random } = {}) {
  const range = (a, b) => a + rand() * (b - a);
  let owner = null; // { src, at }
  let last = null; // poslední hlášení stránky
  let awaiting = null; // kliknuto na Koupit, čeká se na výsledek na další stránce: { price, naq, at }
  let batch = null; // aktuální nabídka: { price, bought, spent, fails, startedAt, dryNotified, stopped }
  let lowNaqAt = 0;
  let wasOff = false; // před chvílí bylo vypnuto: první hlášení po zapnutí může být ze staré stránky, proto se (není-li čerstvě načtená) nejdřív znovu načte
  const log = []; // poslední události pro UI
  const totals = { bought: 0, spent: 0, batches: 0 };
  const note = (now, type, text) => { log.push({ at: now, type, text }); if (log.length > 30) log.shift(); };
  const fmt = (n) => Math.round(n).toLocaleString('cs-CZ');
  const h = (c) => ({ ...GATES_DEFAULTS, ...c });

  /** Skončila nabídka (jiná cena / odpočet naskočil / vypnuto): zpráva o tom, co se koupilo. */
  function closeBatch(now, naq) {
    const b = batch;
    batch = null;
    if (!b) return null;
    if (b.bought) totals.batches++;
    return summary(b, now, naq, null); // co zbylo neohlášeno
  }

  /**
   * Zpráva o nákupu: kolik bran, za kolik za kus a celkem. Posílá se hned, jak nákup v nabídce skončí (vyprodáno, limit, došel naquadah…),
   * ne až při další změně nabídky. Hlásí se jen to, co ještě nebylo ohlášeno.
   */
  function summary(b, now, naq, left) {
    const n = b.bought - (b.reportedBought ?? 0), spent = b.spent - (b.reportedSpent ?? 0);
    if (n <= 0) return null;
    b.reportedBought = b.bought; b.reportedSpent = b.spent;
    const first = b.firstCount != null ? ` Nabídka měla ${b.firstCount} bran${left != null ? `, zbývá jich ${left}` : ''}.` : '';
    const text = `🌌 Hvězdné brány: koupeno ${n}× po ${fmt(spent / n)} kg za kus, celkem ${fmt(spent)} kg.${first}${naq != null ? ` Zbývá ${fmt(naq)} kg naquadahu.` : ''}`;
    note(now, 'bought', text);
    return text;
  }

  /** Kdy obnovit stránku: těsně po změně nabídky; občas uprostřed cyklu (jako člověk). */
  function reloadIn(rep, c) {
    const rem = Number.isFinite(rep.remainingSec) && rep.remainingSec >= 0 ? rep.remainingSec * 1000 : null;
    if (rem === null) return { ms: Math.round(range(20_000, 60_000)), kind: 'unknown' };
    if (rem > 30_000 && rand() * 100 < c.midChance) {
      const m = range(c.midMinSec, c.midMaxSec) * 1000;
      if (m < rem - 12_000) return { ms: Math.round(m), kind: 'mid' };
    }
    return { ms: Math.round(rem + range(c.afterMinSec, c.afterMaxSec) * 1000), kind: 'change' };
  }

  /**
   * @param {{src:string, price:number|null, count:number|null, remainingSec:number|null, naq:number|null, planets:number, canBuy:boolean, clicked?:boolean, fresh?:boolean}} rep (fresh = stránka se právě načetla; clicked = od minulého hlášení se kliklo na Koupit)
   * @returns {{action:'buy'|'wait'|'idle', delayMs?:number, reloadInMs?:number, kind?:string, why?:string, notify?:string, spec?:object}}
   */
  function report(rep, cfg, now) {
    const c = h(cfg);
    const out = (o, notify) => (notify ? { ...o, notify } : o);
    if (!c.enabled) { const n = closeBatch(now, rep.naq); awaiting = null; wasOff = true; return out({ action: 'idle', why: 'off' }, n); }
    // jedna karta nakupuje; druhá otevřená karta jen čeká
    if (owner && owner.src !== rep.src && now - owner.at < OWNER_TTL_MS) return { action: 'idle', why: 'other-tab' };
    owner = { src: rep.src, at: now };
    if (wasOff) { // právě zapnuto: data na stránce můžou být stará, hned se načte čerstvá nabídka a podle ní se jedná a plánuje
      wasOff = false;
      if (!rep.fresh) return { action: 'wait', why: 'enabled', reloadInMs: Math.round(range(500, 1800)), kind: 'enable' };
    }
    let notify = null;

    // výsledek předchozího kliknutí
    if (awaiting) {
      const a = awaiting;
      awaiting = null;
      if (!rep.clicked) { /* na Koupit se nakonec nekliklo (stránka se změnila): není co vyhodnocovat */ }
      else if (Number.isFinite(rep.naq) && a.naq - rep.naq >= a.price * 0.9) {
        batch.bought++; batch.spent += a.naq - rep.naq; batch.fails = 0;
        totals.bought++; totals.spent += a.naq - rep.naq;
        note(now, 'click', `koupena 1 brána za ${fmt(a.naq - rep.naq)} kg`);
      } else {
        batch.fails++;
        note(now, 'fail', `naquadah po kliknutí neubyl (${batch.fails}×)`);
        if (batch.fails >= MAX_FAILS) {
          batch.stopped = true;
          notify = `⚠️ Hvězdné brány: dvakrát po sobě jsem klikl na Koupit a naquadah neubyl. V téhle nabídce (${fmt(rep.price ?? 0)} kg) už nekupuji, zkontroluj stránku.`;
        }
      }
    }

    // nová nabídka? (jiná cena, nebo odpočet znovu naskočil nahoru)
    const newOffer = !batch || (rep.price != null && batch.price !== rep.price) || (last && Number.isFinite(rep.remainingSec) && Number.isFinite(last.remainingSec) && rep.remainingSec > last.remainingSec + 30);
    if (newOffer) {
      const n = closeBatch(now, rep.naq);
      if (n) notify = notify ? `${notify}\n${n}` : n;
      batch = { price: rep.price, bought: 0, spent: 0, fails: 0, startedAt: now, dryNotified: false, stopped: false, firstCount: rep.count ?? null, reportedBought: 0, reportedSpent: 0 };
    }
    last = { ...rep, at: now };

    const wait = (why, extra = {}) => {
      const sum = batch ? summary(batch, now, rep.naq, rep.count ?? null) : null; // nákup v téhle nabídce skončil: hned ohlásit
      if (sum) notify = notify ? `${notify}\n${sum}` : sum;
      const r = reloadIn(rep, c);
      return out({ action: 'wait', why, reloadInMs: r.ms, kind: r.kind, ...extra }, notify);
    };

    if (!rep.canBuy || !(rep.planets > 0)) return wait('no-form');
    if (!(rep.count > 0)) return wait('sold-out');
    if (!(rep.price > 0)) return wait('no-price');
    if (!(c.maxPrice > 0) || rep.price > c.maxPrice) return wait('expensive');
    if (batch.stopped) return wait('stopped');
    if (c.maxPerOffer > 0 && batch.bought >= c.maxPerOffer) return wait('limit');
    if (Number.isFinite(rep.naq) && rep.naq - rep.price < c.reserveNaq) {
      if (now - lowNaqAt > LOW_NAQ_GAP_MS) {
        lowNaqAt = now;
        const t = `⚠️ Hvězdné brány: nabídka ${rep.count}× po ${fmt(rep.price)} kg je pod limitem, ale nestačí naquadah (máš ${fmt(rep.naq)} kg${c.reserveNaq ? `, rezerva ${fmt(c.reserveNaq)} kg` : ''}).`;
        notify = notify ? `${notify}\n${t}` : t;
      }
      return wait('no-naq');
    }

    // dobrá nabídka: koupit
    if (c.dryRun) {
      if (!batch.dryNotified) {
        batch.dryNotified = true;
        const n = Math.min(rep.count, rep.planets, c.maxPerOffer > 0 ? c.maxPerOffer : Infinity, Number.isFinite(rep.naq) ? Math.floor((rep.naq - c.reserveNaq) / rep.price) : Infinity);
        const t = `🧪 Hvězdné brány (zkušební režim): nabídka ${rep.count}× po ${fmt(rep.price)} kg je pod limitem ${fmt(c.maxPrice)} kg, koupil bych ${n}× (${fmt(n * rep.price)} kg). Neklikám, je zapnutý zkušební režim.`;
        note(now, 'dry', t);
        notify = notify ? `${notify}\n${t}` : t;
      }
      return wait('dry');
    }
    awaiting = { price: rep.price, naq: rep.naq ?? 0, at: now };
    const first = batch.bought === 0 && batch.fails === 0 && !batch.clicked;
    batch.clicked = true;
    const delayMs = Math.round(first ? range(c.firstMinSec, c.firstMaxSec) * 1000 : range(c.stepMinSec, c.stepMaxSec) * 1000);
    return out({ action: 'buy', delayMs, maxPrice: c.maxPrice, price: rep.price }, notify);
  }

  /** Stránka se po kliknutí nenačetla (karta zavřena apod.): nákup nečeká na výsledek. */
  function reset() { awaiting = null; owner = null; }

  function snapshot(now = Date.now()) {
    return {
      last: last ? { price: last.price, count: last.count, remainingSec: last.remainingSec, naq: last.naq, planets: last.planets, ageSec: Math.round((now - last.at) / 1000) } : null,
      batch: batch ? { price: batch.price, bought: batch.bought, spent: batch.spent, fails: batch.fails, stopped: batch.stopped } : null,
      awaiting: !!awaiting,
      totals: { ...totals },
      active: !!owner && now - owner.at < OWNER_TTL_MS,
      log: log.slice(-12),
    };
  }

  return { report, reset, snapshot };
}
