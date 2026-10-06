/**
 * Ekonomický přepočet hráče (odhad). Proběhne, až se hráč po své hodině přihlásí, takže čas není přesný a jistý.
 * Hlavní znak: populace hráči vzroste, aniž by se změnil počet planet (změna planet = dobývání, ne přepočet).
 * Podpůrné znaky zvyšují jistotu: hráč je v tu chvíli online (přepočet spouští přihlášení) a do 15 minut mu přibudou
 * planety (vybírá mateřské lodě s kolonizačními misemi: 1–22 planet, po ~30 s). Růst populace musí potvrdit 2 čtení
 * po sobě. Čistá logika; ukládání dělá volající (onChange).
 */
const COLON_WINDOW_MS = 15 * 60_000; // přibývání planet do 15 min po růstu populace = vybrané mateřské lodě (kolonizace)
const MIN_REL = 0.001; // růst populace aspoň o 0,1 % (drobné kolísání se nepočítá)
const SAME_EVENT_MS = 15 * 60_000; // další růst do 15 min = pořád stejný přepočet
const HISTORY = 12;

/** Obvyklá hodina z historie: nejčastější hodina (nejvíc událostí), při shodě ta s novějšími událostmi. */
export function usualHour(events) {
  const count = new Map();
  for (const e of events ?? []) { const h = new Date(e.at).getHours(); count.set(h, (count.get(h) ?? 0) + 1); }
  let best = null;
  for (const [h, n] of count) if (!best || n > best.n) best = { hour: h, n };
  return best;
}

export function createEcon(saved = {}, { onChange = () => {} } = {}) {
  const rec = saved; // „raceId|jméno“ -> { events: [{ at, popGain, online, colon, planetsBefore }] } (nejnovější první)
  const last = new Map(); // klíč -> { pop, planets, pending: { pop, at } | null }

  function ingest(raceId, players, now = Date.now(), { minRel = MIN_REL } = {}) {
    const found = [];
    let changed = false;
    for (const p of players) {
      const key = `${raceId}|${p.name}`;
      let s = last.get(key);
      if (!Number.isFinite(p.population) || p.population < 0) continue; // starý skript nebo nečitelná buňka
      if (!s) { last.set(key, { pop: p.population, planets: p.planets, pending: null }); continue; }
      // u čerstvé události dodatečně poznačit přibyté planety (kolonizace z mateřských lodí)
      const ev = rec[key]?.events?.[0];
      if (ev && now - ev.at <= COLON_WINDOW_MS && Number.isFinite(p.planets) && Number.isFinite(ev.planetsBefore)) {
        const colon = p.planets - ev.planetsBefore;
        if (colon > (ev.colon ?? 0)) { ev.colon = colon; changed = true; }
      }

      const planetsSame = !Number.isFinite(p.planets) || !Number.isFinite(s.planets) || p.planets === s.planets;
      const gain = p.population - s.pop;
      if (!planetsSame) { s.pop = p.population; s.planets = p.planets; s.pending = null; continue; } // dobývání: nový základ
      if (gain > 0 && gain >= s.pop * minRel) {
        if (s.pending && s.pending.pop === p.population) { // potvrzeno druhým čtením
          const prev = rec[key]?.events?.[0];
          if (prev && s.pending.at - prev.at < SAME_EVENT_MS) { prev.popGain += gain; } // pokračování stejného přepočtu
          else {
            const e = { at: s.pending.at, popGain: gain, online: p.online === true, colon: 0, planetsBefore: Number.isFinite(p.planets) ? p.planets : null };
            rec[key] = { events: [e, ...(rec[key]?.events ?? [])].slice(0, HISTORY) };
            found.push({ name: p.name, ...e });
          }
          changed = true;
          s.pop = p.population; s.pending = null;
        } else s.pending = { pop: p.population, at: now };
      } else {
        s.pending = null;
        if (gain < 0) s.pop = p.population; // pokles (útok, hlad…) = nový základ
      }
      s.planets = p.planets;
    }
    if (changed) onChange(rec);
    return found;
  }

  /** Pro UI: poslední zachycený ekonomický přepočet a obvyklá hodina. */
  const of = (raceId, name) => {
    const evs = rec[`${raceId}|${name}`]?.events ?? [];
    if (!evs.length) return { econAt: null, econUsual: null, econEvents: null };
    const u = usualHour(evs);
    return { econAt: evs[0].at, econUsual: u, econEvents: evs.slice(0, 5).map((e) => ({ at: e.at, online: e.online, colon: e.colon ?? 0 })) };
  };
  const clear = () => { for (const k of Object.keys(rec)) delete rec[k]; last.clear(); onChange(rec); };
  const count = () => Object.keys(rec).length;
  return { ingest, of, clear, count };
}
