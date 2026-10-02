/**
 * Automatické stavění: plán (co a kolik stavět), fronta planet z tabulky pod stavěním a stavový automat
 * jedné planety. Čistá logika bez sítě a DOM; userscript (stargate-stavby.user.js) jen hlásí, co vidí na stránce,
 * a dostane instrukci, co udělat dál (vyplnit a postavit / přejít na planetu / poslat tabulku / nic).
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
const MAX_FAILED_IN_ROW = 5; // tolik planet po sobě bez úspěchu = nejspíš došly suroviny, běh se zastaví
/** Planety s těmito značkami za názvem v tabulce ((CP), (DP), (PP)) se nestaví – hra to nedovolí. */
const NO_BUILD_TAGS = new Set(['CP', 'DP', 'PP']);
const MAX_GOTO_TRIES = 3; // tolikrát se zkusí přejít na planetu, než se přeskočí

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

/** Jen u města a dolu je „max“ u políčka skutečný strop; u ostatních staveb si hra místo uvolní z dolů. */
const CAPPED = new Set(['mesto', 'vyrobna']);
const TARGET_IDS = ['laborator', 'bs', 'sdi', 'po', 'kasarna']; // stavby bez stropu (parky zvlášť)
const COUNT_IDS = BUILDINGS.map((b) => b.id); // sloupce tabulky planet, které známe

/** Minimum parků pro spokojenost `sat`: od něj výš se park bere jako hotový. Bez minima = cíl; minimum nad cílem se ořízne na cíl. */
const parkMin = (cfgBuild, sat, target) => {
  const mn = cfgBuild.parksMin?.[String(sat)];
  return mn === undefined || mn === null || !Number.isFinite(Number(mn)) ? target : Math.min(Number(mn), target);
};

/**
 * Plán -> co vyplnit ve fázi. Políčka ve hře jsou CÍLOVÝ celkový počet staveb. Cíl se ořezává stropem `max`
 * jen u města a dolu; ostatní stavby (parky, BS, RL štít…) se píšou přesně, i když je u nich „max“ nižší,
 * protože hra při postavení uvolní místo zmenšením dolů (ve 3. fázi se důl doplní zpátky).
 * Snižovat počet (bourat) se nikdy nezkouší.
 * Parky se neřídí `plan`, ale tabulkou `parks` podle spokojenosti planety (sat = -50|-25|0|5|10|null).
 * @returns { [id]: cílový počet } jen pro stavby, které se mají změnit
 */
export function planChanges(cfgBuild, buildings, sat, phaseIdx) {
  const out = {};
  for (const id of PHASES[phaseIdx].ids) {
    const page = buildings?.[id];
    if (!page || !Number.isFinite(page.cur)) continue;
    const capped = CAPPED.has(id);
    let target;
    if (id === 'park') {
      const n = sat === null || sat === undefined ? undefined : cfgBuild.parks?.[String(sat)];
      if (n === undefined || n === null) continue;
      target = Number(n);
      if (page.cur >= parkMin(cfgBuild, sat, target)) continue; // splněno minimum
    } else {
      const p = cfgBuild.plan?.[id];
      if (!p || p.mode === 'skip') continue;
      target = p.mode === 'max' ? page.max : Number(p.n);
    }
    if (!Number.isFinite(target)) continue;
    if (capped) {
      if (!Number.isFinite(page.max)) continue;
      target = Math.min(target, page.max);
    }
    target = Math.floor(target);
    if (target > page.cur) out[id] = target;
  }
  return out;
}

// ---------- fronta planet z tabulky ----------

/** Klíč plánu pro města a důl: když se změní, je potřeba je na planetách znovu ověřit. */
const capsKey = (plan) => JSON.stringify([plan?.mesto ?? null, plan?.vyrobna ?? null]);

/**
 * Musí se planeta navštívit? Rozhoduje se bez návštěvy z dat, která uživatel vidí v tabulce pod stavěním a v seznamu planet:
 *   row.c      aktuální počty staveb (tabulka pod stavěním)
 *   row.free   volné místo (sloupec „Místo“) = kolik dolů se ještě vejde
 *   row.sat    spokojenost planety ze seznamu planet (-50|-25|0|5|10, null = žádná); undefined = nezjištěno
 *   row.townsMax  strop měst ze seznamu planet; undefined = nezjištěno
 * Co se z nich zjistit nedá (nebo chybí), doplňuje historie planety (entry). Planeta, u které se od poslední návštěvy
 * města a doly nezměnily, se kvůli nim znovu nenavštěvuje (jinak by se hlídaly suroviny, které nejdou).
 * `forceAll` = projít všechny planety s nějakou prací (třeba po přidání surovin).
 * @returns {string[]} důvody návštěvy; prázdné pole = přeskočit
 */
export function visitReasons(row, cfgBuild, entry, forceAll = false) {
  const plan = cfgBuild.plan ?? {};
  const parks = cfgBuild.parks ?? {};
  const why = [];
  const stuck = (id, target) => entry?.tried?.[id] === target && entry.final?.[id] === row.c[id]; // hra víc nedala
  const sameSince = (id) => entry?.final && entry.capsKey === capsKey(plan) && entry.final[id] === row.c[id]; // beze změny od naší návštěvy

  if (forceAll) {
    const any = Object.values(plan).some((p) => p && p.mode !== 'skip') || Object.keys(parks).length;
    return any ? ['vynuceno'] : [];
  }

  for (const id of TARGET_IDS) {
    const p = plan[id];
    if (!p || p.mode === 'skip') continue;
    if (p.mode === 'max') { // strop z tabulky neznáme, rozhoduje historie
      if (!entry?.final || entry.final[id] !== row.c[id]) why.push(id);
      continue;
    }
    if (row.c[id] >= p.n || stuck(id, p.n)) continue;
    why.push(id);
  }

  if (Object.keys(parks).length) {
    const sat = row.sat !== undefined ? row.sat : entry?.satKnown ? entry.sat : undefined;
    if (sat === undefined) why.push('park (spokojenost neznámá)');
    else if (sat !== null) {
      const t = parks[String(sat)];
      if (t !== undefined && t !== null && row.c.park < parkMin(cfgBuild, sat, Number(t)) && !stuck('park', t)) why.push('park');
    }
  }

  const pm = plan.mesto;
  if (pm && pm.mode !== 'skip') {
    if (row.townsMax !== undefined) {
      const want = pm.mode === 'max' ? row.townsMax : Math.min(Number(pm.n), row.townsMax);
      if (row.c.mesto < want && !sameSince('mesto')) why.push('mesto');
    } else if (!(pm.mode === 'target' && row.c.mesto >= pm.n) && !sameSince('mesto')) why.push('mesto');
  }

  const pv = plan.vyrobna;
  if (pv && pv.mode !== 'skip') {
    if (row.free !== undefined && row.free >= 0) { // volné místo = je kam postavit další doly
      if (row.free > 0 && (pv.mode === 'max' || row.c.vyrobna < pv.n) && !sameSince('vyrobna')) why.push('vyrobna');
    } else if (!(pv.mode === 'target' && row.c.vyrobna >= pv.n) && !sameSince('vyrobna')) why.push('vyrobna');
  }
  return why;
}

/** Tabulka -> fronta planet k návštěvě (v pořadí tabulky) + počet přeskočených. */
export function buildQueue(table, cfgBuild, ledgerPlanets = {}, forceAll = false) {
  const queue = [];
  let skipped = 0;
  for (const row of table) {
    const why = visitReasons(row, cfgBuild, ledgerPlanets[row.id], forceAll);
    if (why.length) queue.push({ id: row.id, name: row.name, why });
    else skipped++;
  }
  return { queue, skipped };
}

export function createBuildRun({ notify = () => {}, rand = Math.random, ledger = { planets: {} }, onLedger = () => {} } = {}) {
  let run = fresh();

  function fresh() {
    return {
      status: 'idle', startedAt: 0, lastSeenAt: 0, current: null, dry: false, staleNotified: false,
      queue: null, queueTotal: 0, skipped: 0, excluded: 0, tableSize: 0, gotoTries: {},
      planets: [], cur: null, pending: null, failedInRow: 0, log: [],
    };
  }
  const active = () => run.status === 'running';
  const addLog = (msg, now) => {
    run.log.push({ at: now, msg });
    if (run.log.length > 80) run.log.shift();
  };

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
    const msg = run.planets.length
      ? `hotovo, ${run.planets.length} planet (postaveno ${c.built}, beze změny ${c.nothing}, zkušebně ${c.dry}, chyb ${c.failed}), ${run.skipped} přeskočeno jako hotové`
      : `hotovo, nic k stavění: všech ${run.skipped} planet je podle tabulky a historie hotových`;
    addLog(msg, now);
    notify(`✅ Stavění ${msg}`);
  }

  const speed = (cfgBuild) => Math.round((Number(cfgBuild.pace) || 1) * (0.7 + rand() * 1.0) * 100) / 100;

  /** Další krok po dokončení planety: přejít na další planetu z fronty, nebo skončit. */
  function routeNext(cfgBuild, now) {
    for (;;) {
      const head = run.queue[0];
      if (!head) { finish(now); return { action: 'done' }; }
      const tries = (run.gotoTries[head.id] = (run.gotoTries[head.id] ?? 0) + 1);
      if (tries > MAX_GOTO_TRIES) { // na planetu se nedá přejít (zmizela z tabulky?) -> přeskočit
        run.queue.shift();
        run.planets.push({ name: head.name, state: 'failed', note: 'nepodařilo se na ni přejít' });
        addLog(`${head.name}: nepodařilo se na ni přejít, přeskočeno`, now);
        continue;
      }
      return { action: 'goto', plId: head.id, name: head.name, speed: speed(cfgBuild) };
    }
  }

  /** Planeta je hotová: zapíše výsledek i historii, a když to nejde, zastaví běh. */
  function completePlanet(cfgBuild, now, rep) {
    const cur = run.cur;
    run.cur = null;
    run.pending = null;
    run.queue = run.queue.filter((q) => q.id !== cur.id);
    const did = [...cur.grew, ...cur.dry];
    const state = cur.failed ? 'failed' : did.length ? (run.dry ? 'dry' : 'built') : 'nothing';
    const note = [did.length ? did.map((i) => PHASES[i].name).join(', ') : '', cur.failed ?? '', cur.note ?? ''].filter(Boolean).join('; ');
    run.planets.push({ name: cur.name, state, note });
    const label = { built: 'postaveno', nothing: 'není co stavět', dry: 'vyplněno (zkušebně)', failed: 'selhalo' }[state];
    addLog(`${cur.name}: ${label}${note ? ` – ${note}` : ''}`, now);

    if (!run.dry) { // zkušební běh nic nestaví, takže historii nesmí měnit
      const old = ledger.planets[cur.id] ?? {};
      const entry = { ...old, name: cur.name, at: now, sat: cur.sat, satKnown: true, tried: { ...(old.tried ?? {}), ...cur.tried } };
      if (state === 'failed') { // neúspěch (třeba došly suroviny) se nepamatuje jako „hotovo“, příště se zkusí znovu
        delete entry.final;
        delete entry.capsKey;
      } else {
        entry.final = Object.fromEntries(COUNT_IDS.filter((id) => Number.isFinite(rep.buildings[id]?.cur)).map((id) => [id, rep.buildings[id].cur]));
        entry.capsKey = capsKey(cfgBuild.plan);
      }
      ledger.planets[cur.id] = entry;
      onLedger();
    }

    run.failedInRow = state === 'failed' ? run.failedInRow + 1 : state === 'nothing' ? run.failedInRow : 0;
    if (run.failedInRow >= MAX_FAILED_IN_ROW) {
      fail(`${MAX_FAILED_IN_ROW} planet po sobě se nepodařilo postavit (došly suroviny?)`, now);
      return { action: 'idle' };
    }
    return routeNext(cfgBuild, now);
  }

  /** Najde první fázi s prací, od aktuální; když žádná nezbyla, planeta je hotová. */
  function advance(rep, cfgBuild, now) {
    const cur = run.cur;
    const sat = cur.sat;
    if (cur.phase <= 1 && sat === null && !cur.noted && Object.keys(cfgBuild.parks ?? {}).length) {
      cur.noted = true;
      cur.note = 'spokojenost nerozpoznána, parky přeskočeny';
    }
    for (let p = cur.phase; p < PHASES.length; p++) {
      const targets = planChanges(cfgBuild, rep.buildings, sat, p);
      if (!Object.keys(targets).length) continue;
      cur.phase = p;
      const before = Object.fromEntries(Object.keys(targets).map((id) => [id, rep.buildings[id].cur]));
      run.pending = { id: cur.id, phase: p, targets, before };
      const satTxt = sat === null ? '' : ` [spokojenost ${sat > 0 ? '+' : ''}${sat} %]`;
      const what = Object.entries(targets).map(([id, n]) => `${id} → ${n}`).join(', ');
      addLog(`${cur.name}: ${p + 1}/3 ${PHASES[p].name}${satTxt}: ${what}`, now);
      return { action: 'build', phase: p, values: targets, speed: speed(cfgBuild), dry: run.dry };
    }
    return completePlanet(cfgBuild, now, rep);
  }

  /**
   * Hlášení ze stránky stavby.php.
   * rep: { phase: 'load'|'table'|'filled'|'ping'|'goto-failed', plId, planet, satisfaction, buildings: {id:{cur,max}},
   *        table?: [{id, name, c:{id:počet}}], error?, scriptError? }
   * Vrací instrukci: idle | ok | done | goto | send-table | build.
   */
  function report(rep, cfgBuild, now = Date.now(), { forceAll = false } = {}) {
    if (!active()) return { action: 'idle' };
    run.lastSeenAt = now;
    run.staleNotified = false;
    if (rep.phase === 'ping') return { action: 'ok' };
    if (rep.scriptError) { fail(`chyba skriptu v prohlížeči: ${String(rep.scriptError).slice(0, 160)}`, now); return { action: 'idle' }; }
    if (rep.error) { fail(`stránka stavění vypadá jinak, než čekám (${String(rep.error).slice(0, 80)})`, now); return { action: 'idle' }; }

    if (rep.phase === 'goto-failed') {
      const head = run.queue?.[0];
      if (head && head.id === String(rep.plId)) run.gotoTries[head.id] = MAX_GOTO_TRIES; // routeNext ji přeskočí
      return run.queue ? routeNext(cfgBuild, now) : { action: 'send-table' };
    }

    const plId = String(rep.plId ?? '');
    const name = String(rep.planet ?? '').trim();
    if (!plId || !name || !rep.buildings || typeof rep.buildings !== 'object') { fail('nepodařilo se přečíst planetu nebo formulář', now); return { action: 'idle' }; }
    run.current = name;

    if (rep.phase === 'table') {
      if (!Array.isArray(rep.table) || !rep.table.length) { fail('nepodařilo se přečíst tabulku planet', now); return { action: 'idle' }; }
      // nečitelný počet = -1, takže planeta se raději navštíví, než aby se omylem přeskočila
      const valid = rep.table.filter((r) => r && r.id && r.name);
      const allowed = valid.filter((r) => !NO_BUILD_TAGS.has(String(r.tag ?? '').toUpperCase()));
      run.excluded = valid.length - allowed.length;
      const opt = (v) => (v === undefined || v === null || !Number.isFinite(Number(v)) ? undefined : Number(v));
      const table = allowed.map((r) => ({
        id: String(r.id), name: String(r.name),
        free: opt(r.free), townsMax: opt(r.townsMax),
        sat: r.sat === undefined ? undefined : r.sat === null ? null : opt(r.sat) ?? undefined,
        c: Object.fromEntries(COUNT_IDS.map((id) => [id, Number.isFinite(Number(r.c?.[id])) && r.c?.[id] !== null ? Number(r.c[id]) : -1])),
      }));
      const { queue, skipped } = buildQueue(table, cfgBuild, ledger.planets, forceAll);
      run.queue = queue;
      run.queueTotal = queue.length;
      run.skipped = skipped;
      run.tableSize = valid.length;
      addLog(`Tabulka: ${valid.length} planet (${run.excluded} s (CP)/(DP)/(PP) se nestaví), k návštěvě ${queue.length}, přeskočeno ${skipped} (hotové podle tabulky a historie)`, now);
    }
    if (!run.queue) return { action: 'send-table' };

    if (run.cur && run.cur.id !== plId) { // někdo (ručně) přepnul planetu uprostřed práce
      addLog(`${run.cur.name}: přerušeno (stránka se přepnula na ${name})`, now);
      run.cur = null;
      run.pending = null;
    }
    if (!run.cur) {
      const head = run.queue[0];
      if (!head) { finish(now); return { action: 'done' }; }
      if (head.id !== plId) return routeNext(cfgBuild, now);
      const sat = rep.satisfaction === undefined || rep.satisfaction === null ? null : Number(rep.satisfaction);
      run.cur = { id: plId, name, sat, phase: 0, grew: [], dry: [], failed: null, note: '', noted: false, tried: {} };
    }
    const cur = run.cur;

    if (rep.phase === 'filled' && run.pending?.id === plId) { // zkušební běh: vyplněno, nic se neodeslalo
      cur.dry.push(run.pending.phase);
      cur.phase = run.pending.phase + 1;
      run.pending = null;
    } else if (run.pending?.id === plId) { // načtení po odeslání formuláře: ověř, že se počty zvýšily
      const { phase, targets, before } = run.pending;
      run.pending = null;
      const ids = Object.keys(targets);
      const grown = ids.filter((id) => (rep.buildings[id]?.cur ?? 0) > before[id]);
      if (!grown.length) {
        cur.failed = `${PHASES[phase].name}: počty se nezměnily (málo surovin nebo hra akci odmítla)`;
        return completePlanet(cfgBuild, now, rep);
      }
      // hra něco přijala, ale ne vše: dál už nedá, příště se tahle planeta kvůli tomu nenavštěvuje
      for (const id of ids) if ((rep.buildings[id]?.cur ?? 0) < targets[id]) cur.tried[id] = targets[id];
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
      queue: run.queue ? { total: run.queueTotal, left: run.queue.length, skipped: run.skipped, excluded: run.excluded, tableSize: run.tableSize } : null,
      counts: counts(),
      planets: run.planets.slice(-40), // běžně stovky planet; do UI jen posledních 40
      log: run.log.slice(-40),
    };
  }

  return { start, stop, report, staleCheck, snapshot, isActive: active };
}
