/**
 * Přerozdělení nezaměstnaných (Obchod → Nezaměstnaní): lidi z planet, které jsou plné (zbývá 0 míst) a mají 100–300 mil. nezaměstnaných,
 * se přesunou na planety s hodně volným místem a málo lidmi. Bot nikdy nevyplňuje počet: hra v poli předvyplní, kolik jde poslat
 * (nejvýš 300 mil.), a bot pošle všechno.
 *
 * Kolo: seznam (seřadit podle Nezaměstnaných) -> zdrojová planeta -> její detail -> v nabídce „Na vlastní planetu“ vybrat cíl -> Přesunout
 * -> zpět na seznam (čerstvá data) -> další zdroj … dokud je nějaký zdroj, který splňuje podmínky.
 *
 * Cíl: planeta, kam se vejde celý přesun a po něm ještě zůstane „lidí na planetě“ ≤ „zbývá míst“ (vyrovnání: přijme (zbývá − lidí) / 2).
 * Ze všech vhodných se bere ta s největší rezervou. Čistá logika bez sítě a DOM; skript v prohlížeči jen hlásí, co vidí, a dostane pokyn.
 */
const STALE_MS = 120_000; // skript se tak dlouho neozval = běh se zastaví
const MAX_RELOADS = 3; // tolikrát se znovu načte seznam, když ukazuje stará data (po návratu zpět z mezipaměti prohlížeče)

export const REDIST_DEFAULTS = { minM: 100, maxM: 300, freeMaxM: 0, dry: true, maxMoves: 100, pace: 1, pauseMinSec: 4, pauseMaxSec: 10, ignoreCities: 0, ignorePeopleM: 0, prioBelowM: 0, smallCities: 0 }; // prioBelowM: přednostně planety s méně lidmi než tolik mil. (0 = vypnuto) // pace = násobek tempa skriptu (menší = rychlejší), pauza = náhodná prodleva mezi planetami (s); platí pro přerozdělení i doplňování // v milionech lidí; dry = zkušební běh (nic se nepřesouvá)

const fmtM = (n) => `${(Number(n) / 1e6).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} mil.`;

/** Zdroje: nezaměstnaných v rozmezí a skoro žádné volné místo; pořadí podle nezaměstnaných sestupně. */
export function pickSources(rows, s, done = new Set()) {
  const lo = s.minM * 1e6, hi = s.maxM * 1e6, freeMax = s.freeMaxM * 1e6;
  return rows.filter((r) => !done.has(r.name) && r.unemployed >= lo && r.unemployed <= hi && r.free <= freeMax).sort((a, b) => b.unemployed - a.unemployed);
}

/** Kolik lidí ještě přijme cílová planeta, aby se po přesunu vyrovnaly „lidé na planetě“ a „zbývá míst“. */
export const acceptance = (r) => Math.floor((r.free - r.people) / 2);

/** Cíle, kam se vejde celý přesun `amount`: největší rezerva první. `allowed` = názvy planet, které jsou v nabídce na detailu zdroje. */
/** Obří planety (víc měst / víc lidí, než je nastaveno; 0 = bez omezení) se jako cíl ani k doplňování nepoužijí. */
/**
 * Priorita cílové planety (menší číslo = dřív): 0 = prázdná (0 lidí, vždy první), 1 = malá (měst nejvýš `smallCities`, nebo lidí méně než `prioBelowM`; 0 = vypnuto),
 * 2 = ostatní. Prázdné a malé se plní přednostně (nejprázdnější první) a berou celý přesun, který se vejde; zbytek (2) se mezi sebou vyrovnává.
 */
export const tier = (r, s = {}) => (r.people <= 0 ? 0 : (s.smallCities > 0 && r.cities <= s.smallCities) || (s.prioBelowM > 0 && r.people < s.prioBelowM * 1e6) ? 1 : 2);
export const isGiant = (r, s = {}) => (s.ignoreCities > 0 && r.cities > s.ignoreCities) || (s.ignorePeopleM > 0 && r.people > s.ignorePeopleM * 1e6);

export function pickTargets(rows, source, amount, allowed = null, s = {}) {
  return rows
    .filter((r) => r.name !== source && !isGiant(r, s) && (tier(r, s) < 2 ? r.free >= amount : acceptance(r) >= amount) && (!allowed || allowed.has(r.name))) // prázdné a malé berou vše, co se vejde; ostatní jen tolik, aby zůstaly vyrovnané
    .sort((a, b) => (tier(a, s) - tier(b, s)) || (tier(a, s) < 2 ? a.people - b.people || b.free - a.free : acceptance(b) - acceptance(a))); // prázdné → malé (nejprázdnější první) → ostatní (největší rezerva = rovnoměrné doplňování)
}

export function createRedist() {
  let run = idle();
  function idle() {
    return { status: 'idle', startedAt: 0, lastSeenAt: 0, settings: null, rows: [], done: new Set(), cur: null, moves: [], movedTotal: 0, reason: '', log: [], reloads: 0, lastMove: null, skipped: 0 };
  }
  const active = () => run.status === 'running';
  const addLog = (now, msg) => { run.log.push({ at: now, msg }); if (run.log.length > 80) run.log.shift(); };

  function start(settings, now = Date.now()) {
    if (active()) return false;
    run = { ...idle(), status: 'running', startedAt: now, lastSeenAt: now, settings: { ...REDIST_DEFAULTS, ...settings } };
    addLog(now, `Spuštěno${run.settings.dry ? ' (zkušební běh: nic se nepřesune)' : ''} – čekám na stránku Obchod → Nezaměstnaní`);
    return true;
  }
  function finish(now, status, reason) {
    if (!active()) return null;
    run.status = status; run.reason = reason; run.cur = null;
    addLog(now, reason);
    const n = run.moves.length;
    const sum = n ? ` ${run.settings.dry ? 'Přesunul bych' : 'Přesunuto'} ${n}× (${fmtM(run.movedTotal)}).` : ' Nic se nepřesunulo.';
    return `👥 Přerozdělení nezaměstnaných skončilo: ${reason}.${sum}`;
  }
  const stop = (now = Date.now()) => finish(now, 'stopped', 'zastaveno ručně');
  const skip = (now, name, why) => { run.done.add(name); run.skipped++; run.cur = null; addLog(now, `${name}: přeskočeno – ${why}`); };

  /**
   * Hlášení skriptu. rep.page:
   *  - 'list':   { sorted, rows?: [{name, cities, people, unemployed, free}] }  (rows jen na vyžádání: action 'send-rows')
   *  - 'planet': { name, count, options: [názvy planet v nabídce „Na vlastní planetu“] }
   *  - 'moved':  { name }      (stránka po Přesunout)
   *  - 'failed': { name, error } (cíl nenalezen v nabídce apod.)
   * @returns {{action:'idle'|'sort'|'send-rows'|'open'|'move'|'back'|'reload', name?:string, target?:string, dry?:boolean, summary?:string}}
   */
  function report(rep, now = Date.now()) {
    if (!active()) return { action: 'idle' };
    run.lastSeenAt = now;
    const S = run.settings;

    if (rep.page === 'moved') {
      const c = run.cur;
      if (c && rep.name === c.source.name) {
        run.moves.push({ source: c.source.name, target: c.target, amount: c.amount, at: now });
        run.movedTotal += c.amount;
        run.done.add(c.source.name);
        run.lastMove = { source: c.source.name, before: c.source.unemployed };
        addLog(now, `${c.source.name} → ${c.target}: přesunuto ${fmtM(c.amount)}`);
        run.cur = null;
        if (run.moves.length >= S.maxMoves) return { action: 'idle', summary: finish(now, 'finished', `pojistka: ${S.maxMoves} přesunů za jeden běh`) };
      }
      return { action: 'back' };
    }

    if (rep.page === 'failed') {
      if (run.cur && rep.name === run.cur.source.name) skip(now, run.cur.source.name, String(rep.error ?? 'nepodařilo se přesunout').slice(0, 100));
      return { action: 'back' };
    }

    if (rep.page === 'list') {
      if (!rep.sorted) return { action: 'sort' };
      if (!Array.isArray(rep.rows)) return { action: 'send-rows' };
      run.rows = rep.rows;
      // po přesunu seznam z mezipaměti prohlížeče ještě ukazuje starou hodnotu: znovu načíst
      if (run.lastMove) {
        const r = rep.rows.find((x) => x.name === run.lastMove.source);
        if (r && r.unemployed === run.lastMove.before && !S.dry) {
          if (run.reloads++ < MAX_RELOADS) return { action: 'reload' };
          return { action: 'idle', summary: finish(now, 'error', `${run.lastMove.source} má pořád stejný počet nezaměstnaných i po přesunu`) };
        }
        run.lastMove = null; run.reloads = 0;
      }
      const sources = pickSources(rep.rows, S, run.done);
      if (!sources.length) return { action: 'idle', summary: finish(now, 'finished', run.moves.length || run.skipped ? 'žádná další planeta nesplňuje podmínky' : 'žádná planeta nesplňuje podmínky (nezaměstnaní v rozmezí a plná planeta)') };
      const src = sources[0];
      run.cur = { source: src, target: null, amount: 0 };
      addLog(now, `${src.name}: ${fmtM(src.unemployed)} nezaměstnaných, zbývá ${fmtM(src.free)} míst – otevírám planetu`);
      return { action: 'open', name: src.name };
    }

    if (rep.page === 'planet') {
      const c = run.cur;
      if (!c || rep.name !== c.source.name) return { action: 'idle' }; // cizí planeta, nic nedělat
      const amount = Number(rep.count);
      if (!(amount >= S.minM * 1e6)) { skip(now, c.source.name, `k přesunu je jen ${Number.isFinite(amount) ? fmtM(amount) : '?'}`); return { action: 'back' }; }
      const allowed = Array.isArray(rep.options) ? new Set(rep.options) : null;
      const targets = pickTargets(run.rows, c.source.name, amount, allowed, S);
      if (!targets.length) { skip(now, c.source.name, `není planeta, kam by se vešlo ${fmtM(amount)} a zůstala vyrovnaná`); return { action: 'back' }; }
      const t = targets[0];
      c.target = t.name; c.amount = amount;
      addLog(now, `${c.source.name} → ${t.name}: ${fmtM(amount)} (cíl: lidí ${fmtM(t.people)}, zbývá ${fmtM(t.free)} míst)`);
      if (S.dry) { // zkušební běh: jen ukázat plán a jít dál
        run.moves.push({ source: c.source.name, target: t.name, amount, at: now, dry: true });
        run.movedTotal += amount;
        run.done.add(c.source.name);
        run.cur = null;
        if (run.moves.length >= S.maxMoves) return { action: 'idle', summary: finish(now, 'finished', `pojistka: ${S.maxMoves} přesunů za jeden běh`) };
        return { action: 'back' };
      }
      return { action: 'move', name: c.source.name, target: t.name };
    }
    return { action: 'idle' };
  }

  function staleCheck(now = Date.now()) {
    return active() && now - run.lastSeenAt > STALE_MS ? finish(now, 'error', 'skript přestal hlásit (zavřená karta nebo odhlášení?)') : null;
  }
  const snapshot = () => ({ status: run.status, active: active(), dry: !!run.settings?.dry, startedAt: run.startedAt, target: run.cur ? `${run.cur.source.name}${run.cur.target ? ' → ' + run.cur.target : ''}` : null, moves: run.moves.slice(-20), movedTotal: run.movedTotal, count: run.moves.length, skipped: run.skipped, reason: run.reason, log: run.log.slice(-25) });
  return { start, stop, report, staleCheck, snapshot, active };
}
