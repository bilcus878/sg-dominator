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
  { id: 'park', name: 'Chodba harmonie' },
  { id: 'bs', name: 'Bezpečnostní (BS)' },
  { id: 'sdi', name: 'RL štít' },
  { id: 'po', name: 'RL paprsek' },
  { id: 'kasarna', name: 'Kasárny' },
];
const IDS = new Set(BUILDINGS.map((b) => b.id));
export const isBuildingId = (id) => IDS.has(id);

const STALE_MS = 150_000; // skript přestal hlásit (zavřená karta, odhlášení…)
const MAX_PLANETS = 300; // pojistka proti nekonečnému kroužení

/**
 * Plán -> co vyplnit na aktuální planetě. Políčka ve hře jsou CÍLOVÝ celkový počet staveb,
 * `max` je strop, který stránka u políčka ukazuje. Snižovat počet (bourat) se nikdy nezkouší.
 * @param plan { [id]: { mode: 'skip'|'target'|'max', n } }
 * @param buildings { [id]: { cur, max } } z aktuální stránky
 * @returns { [id]: cílový počet } jen pro stavby, které se mají změnit
 */
export function planChanges(plan, buildings) {
  const out = {};
  for (const b of BUILDINGS) {
    const p = plan?.[b.id];
    const page = buildings?.[b.id];
    if (!p || p.mode === 'skip' || !page || !Number.isFinite(page.cur) || !Number.isFinite(page.max)) continue;
    let target = p.mode === 'max' ? page.max : Number(p.n);
    if (!Number.isFinite(target)) continue;
    target = Math.min(Math.floor(target), page.max);
    if (target > page.cur) out[b.id] = target;
  }
  return out;
}

export function createBuildRun({ notify = () => {}, rand = Math.random } = {}) {
  let run = fresh();

  function fresh() {
    return { status: 'idle', startedAt: 0, lastSeenAt: 0, startName: null, current: null, planets: [], pending: null, log: [], dry: false, staleNotified: false };
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

  function finish(now) {
    run.status = 'finished';
    run.pending = null;
    const count = (s) => run.planets.filter((p) => p.state === s).length;
    const msg = `hotovo, ${run.planets.length} planet (postaveno ${count('built')}, beze změny ${count('nothing')}, zkušebně ${count('dry')}, chyb ${count('failed')})`;
    addLog(msg, now);
    notify(`✅ Stavění ${msg}`);
  }

  function mark(name, state, note, now) {
    run.planets.push({ name, state, note: note ?? '' });
    addLog(`${name}: ${{ built: 'postaveno', nothing: 'není co stavět', dry: 'vyplněno (zkušebně)', failed: 'selhalo' }[state]}${note ? ` – ${note}` : ''}`, now);
  }

  const speed = (cfgBuild) => Math.round((Number(cfgBuild.pace) || 1) * (0.7 + rand() * 1.0) * 100) / 100;
  const next = (cfgBuild) => ({ action: 'next', speed: speed(cfgBuild) });

  /**
   * Hlášení ze stránky stavby.php.
   * rep: { phase: 'load'|'filled'|'ping', planet, buildings: {id:{cur,max}}, error? }
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

    if (rep.phase === 'filled') { // zkušební běh: pole jsou vyplněná, nic se neodesílá
      if (run.pending?.name === name) { mark(name, 'dry', Object.keys(run.pending.targets).join(', '), now); run.pending = null; }
      return next(cfgBuild);
    }

    // načtení stránky po odeslání formuláře: ověř, že se počty opravdu zvýšily
    if (run.pending?.name === name) {
      const { targets, before } = run.pending;
      run.pending = null;
      const ids = Object.keys(targets);
      const grown = ids.filter((id) => (rep.buildings[id]?.cur ?? 0) > before[id]);
      if (!grown.length) mark(name, 'failed', 'počty se nezměnily (málo surovin nebo hra akci odmítla)', now);
      else mark(name, 'built', grown.length === ids.length ? '' : `jen část: ${grown.join(', ')}`, now);
      return next(cfgBuild);
    }

    if (seen(name) || run.planets.length >= MAX_PLANETS) { finish(now); return { action: 'done' }; }

    const targets = planChanges(cfgBuild.plan, rep.buildings);
    if (!Object.keys(targets).length) { mark(name, 'nothing', '', now); return next(cfgBuild); }
    const before = Object.fromEntries(Object.keys(targets).map((id) => [id, rep.buildings[id].cur]));
    run.pending = { name, targets, before };
    addLog(`${name}: stavím ${Object.entries(targets).map(([id, n]) => `${id} → ${n}`).join(', ')}`, now);
    return { action: 'build', values: targets, speed: speed(cfgBuild), dry: run.dry };
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
      planets: run.planets,
      log: run.log.slice(-40),
    };
  }

  return { start, stop, report, staleCheck, snapshot, isActive: active };
}
