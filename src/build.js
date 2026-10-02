/**
 * Automatické stavění: plán (co a kolik stavět) + stavový automat průchodu planetami.
 * Čistá logika bez sítě a DOM; userscript (stargate-stavby.user.js) jen hlásí, co vidí na stránce,
 * a dostane instrukci, co udělat dál (vyplnit a postavit / přepnout na další planetu / nic).
 */

// pořadí = pořadí na stránce stavby.php; id odpovídá id políčka ve formuláři
export const BUILDINGS = [
  { id: 'mesto', name: 'Město' },
  { id: 'vyrobna', name: 'Naquadahový důl' },
  { id: 'laborator', name: 'Laboratoř' },
  { id: 'park', name: 'Chodba harmonie (parky)' },
  { id: 'bs', name: 'Bezpečnostní (BS)' },
  { id: 'sdi', name: 'RL štít' },
  { id: 'po', name: 'RL paprsek' },
  { id: 'kasarna', name: 'Kasárny' },
];
const IDS = new Set(BUILDINGS.map((b) => b.id));
export const isBuildingId = (id) => IDS.has(id);

const STALE_MS = 150_000; // skript přestal hlásit (zavřená karta, odhlášení…)
const MAX_PLANETS = 5000; // pojistka proti nekonečnému kroužení
const MAX_FAILED_IN_ROW = 5; // tolik planet po sobě bez úspěchu = nejspíš došly suroviny, běh se zastaví

/** Spokojenost z typu planety -> klíč v plánu parků ('~' ve hře = 0). */
export const SATISFACTIONS = [-50, -25, 0, 5, 10];
export const isSatKey = (k) => SATISFACTIONS.includes(Number(k)) && String(Number(k)) === String(k);

/**
 * Pořadí stavění na každé planetě (každá fáze = vyplnit a kliknout na Postavit, pak se stránka přenačte):
 * 1) města, 2) vše ostatní kromě dolu (parky podle spokojenosti), 3) naquadahový důl.
 * Fáze jdou odděleně, protože města a další stavby mění stropy (max) u dalších.
 */
export const PHASES = [
  { name: 'města', ids: ['mesto'] },
  { name: 'ostatní stavby', ids: ['laborator', 'bs', 'sdi', 'po', 'kasarna', 'park'] },
  { name: 'naquadahový důl', ids: ['vyrobna'] },
];

/**
 * Plán -> co vyplnit ve fázi. Políčka ve hře jsou CÍLOVÝ celkový počet staveb, `max` je strop,
 * který stránka u políčka ukazuje. Snižovat počet (bourat) se nikdy nezkouší.
 * Parky se neřídí `plan`, ale tabulkou `parks` podle spokojenosti planety (sat = -50|-25|0|5|10|null).
 * @returns { [id]: cílový počet } jen pro stavby, které se mají změnit
 */
export function planChanges(cfgBuild, buildings, sat, phaseIdx) {
  const out = {};
  for (const id of PHASES[phaseIdx].ids) {
    const page = buildings?.[id];
    if (!page || !Number.isFinite(page.cur) || !Number.isFinite(page.max)) continue;
    let target;
    if (id === 'park') {
      const n = sat === null || sat === undefined ? undefined : cfgBuild.parks?.[String(sat)];
      if (n === undefined || n === null) continue;
      target = Number(n);
    } else {
      const p = cfgBuild.plan?.[id];
      if (!p || p.mode === 'skip') continue;
      target = p.mode === 'max' ? page.max : Number(p.n);
    }
    if (!Number.isFinite(target)) continue;
    target = Math.min(Math.floor(target), page.max);
    if (target > page.cur) out[id] = target;
  }
  return out;
}

export function createBuildRun({ notify = () => {}, rand = Math.random } = {}) {
  let run = fresh();

  function fresh() {
    return { status: 'idle', startedAt: 0, lastSeenAt: 0, startName: null, current: null, planets: [], cur: null, pending: null, failedInRow: 0, log: [], dry: false, staleNotified: false };
  }
  const active = () => run.status === 'running';
  const addLog = (msg, now) => {
    run.log.push({ at: now, msg });
    if (run.log.length > 80) run.log.shift();
  };
  const seen = (name) => run.planets.some((p) => p.name === name);

  function start(cfgBuild, now = Date.now()) {
    run = fresh();
    run.status = 'running';
    run.startedAt = run.lastSeenAt = now;
    run.dry = !!cfgBuild.dryRun;
    addLog(run.dry ? 'Spuštěno (zkušební běh – nebude se klikat na Postavit)' : 'Spuštěno', now);
  }

  function stop(now = Date.now(), reason = 'Zastaveno uživatelem') {
    if (!active()) return;
    run.status = 'stopped';
    run.pending = null;
    addLog(reason, now);
  }

  function fail(reason, now) {
    run.status = 'error';
    run.pending = null;
    addLog(reason, now);
    notify(`⚠️ Stavění zastaveno: ${reason}`);
  }

  const counts = () => {
    const c = { built: 0, nothing: 0, dry: 0, failed: 0 };
    for (const p of run.planets) c[p.state]++;
    return c;
  };

  function finish(now) {
    run.status = 'finished';
    run.pending = null;
    const c = counts();
    const msg = `hotovo, ${run.planets.length} planet (postaveno ${c.built}, beze změny ${c.nothing}, zkušebně ${c.dry}, chyb ${c.failed})`;
    addLog(msg, now);
    notify(`✅ Stavění ${msg}`);
  }

  const speed = (cfgBuild) => Math.round((Number(cfgBuild.pace) || 1) * (0.7 + rand() * 1.0) * 100) / 100;
  const next = (cfgBuild) => ({ action: 'next', speed: speed(cfgBuild) });

  /** Planeta je hotová: zapíše výsledek, a když to nejde, zastaví běh. */
  function completePlanet(cfgBuild, now) {
    const cur = run.cur;
    run.cur = null;
    run.pending = null;
    const did = [...cur.grew, ...cur.dry];
    const state = cur.failed ? 'failed' : did.length ? (run.dry ? 'dry' : 'built') : 'nothing';
    const note = [did.length ? did.map((i) => PHASES[i].name).join(', ') : '', cur.failed ?? '', cur.note ?? ''].filter(Boolean).join('; ');
    run.planets.push({ name: cur.name, state, note });
    const label = { built: 'postaveno', nothing: 'není co stavět', dry: 'vyplněno (zkušebně)', failed: 'selhalo' }[state];
    addLog(`${cur.name}: ${label}${note ? ` – ${note}` : ''}`, now);
    run.failedInRow = state === 'failed' ? run.failedInRow + 1 : state === 'nothing' ? run.failedInRow : 0;
    if (run.failedInRow >= MAX_FAILED_IN_ROW) {
      fail(`${MAX_FAILED_IN_ROW} planet po sobě se nepodařilo postavit (došly suroviny?)`, now);
      return { action: 'idle' };
    }
    return next(cfgBuild);
  }

  /** Najde první fázi s prací, od aktuální; když žádná nezbyla, planeta je hotová. */
  function advance(rep, cfgBuild, now) {
    const cur = run.cur;
    const sat = rep.satisfaction === undefined || rep.satisfaction === null ? null : Number(rep.satisfaction);
    if (cur.phase <= 1 && sat === null && !cur.noted && Object.keys(cfgBuild.parks ?? {}).length) {
      cur.noted = true;
      cur.note = 'spokojenost nerozpoznána, parky přeskočeny';
    }
    for (let p = cur.phase; p < PHASES.length; p++) {
      const targets = planChanges(cfgBuild, rep.buildings, sat, p);
      if (!Object.keys(targets).length) continue;
      cur.phase = p;
      const before = Object.fromEntries(Object.keys(targets).map((id) => [id, rep.buildings[id].cur]));
      run.pending = { name: cur.name, phase: p, targets, before };
      const satTxt = sat === null ? '' : ` [spokojenost ${sat > 0 ? '+' : ''}${sat} %]`;
      const what = Object.entries(targets).map(([id, n]) => `${id} → ${n}`).join(', ');
      addLog(`${cur.name}: ${p + 1}/3 ${PHASES[p].name}${satTxt}: ${what}`, now);
      return { action: 'build', phase: p, values: targets, speed: speed(cfgBuild), dry: run.dry };
    }
    return completePlanet(cfgBuild, now);
  }

  /**
   * Hlášení ze stránky stavby.php.
   * rep: { phase: 'load'|'filled'|'ping', planet, satisfaction, buildings: {id:{cur,max}}, error? }
   * Vrací instrukci: idle | ok | done | next | build.
   */
  function report(rep, cfgBuild, now = Date.now()) {
    if (!active()) return { action: 'idle' };
    run.lastSeenAt = now;
    run.staleNotified = false;
    if (rep.phase === 'ping') return { action: 'ok' };
    if (rep.error) { fail(`stránka stavění vypadá jinak, než čekám (${String(rep.error).slice(0, 80)})`, now); return { action: 'idle' }; }

    const name = String(rep.planet ?? '').trim();
    if (!name || !rep.buildings || typeof rep.buildings !== 'object') { fail('nepodařilo se přečíst planetu nebo formulář', now); return { action: 'idle' }; }
    run.current = name;
    if (!run.startName) run.startName = name;

    if (run.cur && run.cur.name !== name) { // někdo (ručně) přepnul planetu uprostřed práce
      addLog(`${run.cur.name}: přerušeno (stránka se přepnula na ${name})`, now);
      run.cur = null;
      run.pending = null;
    }
    if (!run.cur) {
      if (seen(name) || run.planets.length >= MAX_PLANETS) { finish(now); return { action: 'done' }; }
      run.cur = { name, phase: 0, grew: [], dry: [], failed: null, note: '', noted: false };
    }
    const cur = run.cur;

    if (rep.phase === 'filled' && run.pending?.name === name) { // zkušební běh: vyplněno, nic se neodeslalo
      cur.dry.push(run.pending.phase);
      cur.phase = run.pending.phase + 1;
      run.pending = null;
    } else if (run.pending?.name === name) { // načtení po odeslání formuláře: ověř, že se počty zvýšily
      const { phase, targets, before } = run.pending;
      run.pending = null;
      const ids = Object.keys(targets);
      const grown = ids.filter((id) => (rep.buildings[id]?.cur ?? 0) > before[id]);
      if (!grown.length) {
        cur.failed = `${PHASES[phase].name}: počty se nezměnily (málo surovin nebo hra akci odmítla)`;
        return completePlanet(cfgBuild, now);
      }
      cur.grew.push(phase);
      if (grown.length < ids.length) cur.note = `${PHASES[phase].name}: jen část (${grown.join(', ')})`;
      cur.phase = phase + 1;
    }
    return advance(rep, cfgBuild, now);
  }

  /** true právě jednou, když skript přestal hlásit během běhu */
  function staleCheck(now = Date.now()) {
    if (!active() || run.staleNotified || now - run.lastSeenAt < STALE_MS) return false;
    run.staleNotified = true;
    addLog('Skript přestal hlásit (zavřená karta nebo odhlášení?)', now);
    return true;
  }

  function snapshot() {
    return {
      status: run.status,
      dry: run.dry,
      startedAt: run.startedAt,
      lastSeenAt: run.lastSeenAt,
      current: run.current,
      total: run.planets.length,
      counts: counts(),
      planets: run.planets.slice(-40), // běžně stovky planet; do UI jen posledních 40
      log: run.log.slice(-40),
    };
  }

  return { start, stop, report, staleCheck, snapshot, isActive: active };
}
