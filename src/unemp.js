/**
 * Doplnění nezaměstnaných na planety, kterým chybí lidé (Obchod → Nezaměstnaní, červená čísla).
 * Skript na stránkách hry hlásí, co vidí, a dostane pokyn. Postup kola:
 *   seznam (seřadit podle Nezaměstnaných) -> poslední červená planeta -> detail planety -> Přesunout -> zpět na seznam -> ...
 * Konec: dole už není červená planeta, „zbývá“ chybí / je 0, nebo „zbývá“ nestačilo na celou planetu (hra doplní maximum).
 * Čistá logika bez sítě a DOM.
 */
const STALE_MS = 120_000; // skript se tak dlouho neozval = běh se zastaví (zavřená karta, odhlášení…)
const MAX_PLANETS = 200; // pojistka proti zacyklení
const isGiant = (r, s) => (s.ignoreCities > 0 && r.cities > s.ignoreCities) || (s.ignorePeopleM > 0 && r.people > s.ignorePeopleM * 1e6); // obří planety se nedoplňují (nastavení Obchod → Chování)

export function createUnemp() {
  let run = idle();
  function idle() {
    return { status: 'idle', startedAt: 0, lastSeenAt: 0, target: null, done: new Set(), filled: [], moved: 0, reason: '', log: [], last: false, reloads: 0, settings: {} };
  }
  const active = () => run.status === 'running';
  const addLog = (now, msg) => { run.log.push({ at: now, msg }); if (run.log.length > 60) run.log.shift(); };

  function start(now = Date.now(), settings = {}) {
    if (active()) return false;
    run = { ...idle(), status: 'running', startedAt: now, lastSeenAt: now, settings: { ignoreCities: Number(settings.ignoreCities) || 0, ignorePeopleM: Number(settings.ignorePeopleM) || 0 } };
    addLog(now, 'Spuštěno – čekám na stránku Obchod → Nezaměstnaní');
    return true;
  }
  /** Konec běhu; vrací text shrnutí (pro servisní chat), nebo null, když neběžel. */
  function finish(now, status, reason) {
    if (!active()) return null;
    run.status = status;
    run.reason = reason;
    run.target = null;
    addLog(now, reason);
    const sum = run.filled.length ? ` Doplněno ${run.filled.length} planet (${run.filled.map((f) => f.name).join(', ')}).` : ' Nic se nedoplnilo.';
    return `👥 Doplnění nezaměstnaných skončilo: ${reason}.${sum}`;
  }
  const stop = (now = Date.now()) => finish(now, 'stopped', 'zastaveno ručně');

  /**
   * Hlášení skriptu. rep.page:
   *  - 'list':   { sorted: bool, last: {name, missing} | null } (poslední řádek tabulky; missing > 0 = červený)
   *  - 'planet': { name, need, avail }  (detail planety; avail = „zbývá“, null = nenalezeno)
   *  - 'moved':  { name }               (stránka po kliknutí na Přesunout)
   * @returns {{action: 'idle'|'sort'|'open'|'move'|'back'|'reload', name?: string}, summary?: string}
   */
  function report(rep, now = Date.now()) {
    if (!active()) return { action: 'idle' };
    run.lastSeenAt = now;
    if (rep.page === 'moved') {
      if (run.target && rep.name === run.target.name) {
        run.done.add(run.target.name);
        run.filled.push({ name: run.target.name, count: run.target.count });
        run.moved += run.target.count;
        addLog(now, `${run.target.name}: přesunuto (${run.target.count.toLocaleString('cs-CZ')} lidí)`);
        run.target = null;
        if (run.last) return { action: 'idle', summary: finish(now, 'finished', 'nezaměstnaní došli (poslední planeta doplněna jen zčásti)') };
        if (run.filled.length >= MAX_PLANETS) return { action: 'idle', summary: finish(now, 'error', `pojistka: ${MAX_PLANETS} planet za jeden běh`) };
      }
      return { action: 'back' };
    }
    if (rep.page === 'list') {
      if (!rep.sorted) return { action: 'sort' };
      const filtering = run.settings.ignoreCities > 0 || run.settings.ignorePeopleM > 0;
      let last = rep.last;
      if (filtering) { // omezení obřích planet: potřebuje celou tabulku, dole se vezme poslední planeta, která obří není
        if (!Array.isArray(rep.rows)) return { action: 'send-rows' };
        const cand = rep.rows.filter((r) => r.missing > 0 && !isGiant(r, run.settings));
        const skippedGiants = rep.rows.filter((r) => r.missing > 0 && isGiant(r, run.settings)).length;
        if (skippedGiants && !run.giantNoted) { run.giantNoted = true; addLog(now, `Obří planety se přeskakují (${skippedGiants} s chybějícími lidmi)`); }
        last = cand.length ? { name: cand[cand.length - 1].name, missing: cand[cand.length - 1].missing } : null;
      }
      if (!last || !(last.missing > 0)) return { action: 'idle', summary: finish(now, 'finished', 'všechny planety mají dost lidí') };
      if (run.done.has(last.name)) { // seznam z mezipaměti prohlížeče ještě ukazuje doplněnou planetu
        if (run.reloads++ < 3) return { action: 'reload' };
        return { action: 'idle', summary: finish(now, 'error', `${last.name} je pořád na konci seznamu i po doplnění`) };
      }
      run.reloads = 0;
      run.target = { name: last.name, count: 0 };
      addLog(now, `${last.name}: chybí ${Number(last.missing).toLocaleString('cs-CZ')} lidí, otevírám planetu`);
      return { action: 'open', name: last.name };
    }
    if (rep.page === 'planet') {
      if (!run.target || rep.name !== run.target.name) return { action: 'idle' }; // cizí planeta, nic nedělat
      const avail = Number(rep.avail), need = Number(rep.need);
      if (!(avail > 0)) return { action: 'idle', summary: finish(now, 'finished', 'nezbývají žádní nezaměstnaní („zbývá“ je 0)') };
      if (!(need > 0)) { run.done.add(run.target.name); run.target = null; return { action: 'back' }; } // planeta už nic nepotřebuje
      run.last = avail < need; // nestačí na celou planetu: hra doplní, co je, a pak konec
      run.target.count = Math.min(avail, need);
      return { action: 'move', name: rep.name };
    }
    return { action: 'idle' };
  }

  /** Skript se dlouho neozval -> zastavit. Vrací shrnutí, nebo null. */
  function staleCheck(now = Date.now()) {
    return active() && now - run.lastSeenAt > STALE_MS ? finish(now, 'error', 'skript přestal hlásit (zavřená karta nebo odhlášení?)') : null;
  }

  const snapshot = () => ({ status: run.status, startedAt: run.startedAt, target: run.target?.name ?? null, filled: run.filled, moved: run.moved, reason: run.reason, log: run.log.slice(-15) });
  return { start, stop, report, staleCheck, snapshot };
}

/** „zbývá: 17 892 miliónů“ -> 17 892 000 000; nerozpoznané -> null. */
export function parseAvail(text) {
  const m = String(text ?? '').match(/zbývá:\s*([\d\s ]+)\s*(miliard|milión|milion|tisíc)?/i);
  if (!m) return null;
  const n = Number(m[1].replace(/\D/g, ''));
  if (!Number.isFinite(n)) return null;
  const u = (m[2] ?? '').toLowerCase();
  return n * (u.startsWith('miliard') ? 1e9 : u.startsWith('mili') ? 1e6 : u.startsWith('tis') ? 1e3 : 1);
}
