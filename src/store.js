/**
 * Poslední známý stav ras v paměti. Zdrojem jsou okna prohlížeče (userscript);
 * stránku (raceId + page) může posílat i víc oken najednou, poslední data vyhrávají.
 */
const PAGE_TTL_MS = 10 * 60_000;
const SOURCE_ACTIVE_MS = 5_000;

export function createStore() {
  const pages = new Map(); // "raceId:page" -> { raceId, page, at, players, sources: Map(src -> ts) }

  function ingest({ raceId, page = 1, src = 'unknown', players }, now = Date.now()) {
    const key = `${raceId}:${page}`;
    let e = pages.get(key);
    if (!e) pages.set(key, (e = { raceId, page, at: now, players: [], sources: new Map() }));
    e.at = now;
    e.players = players;
    e.sources.set(src, now);
    for (const [k, v] of pages) if (now - v.at > PAGE_TTL_MS) pages.delete(k);
  }

  /** Souhrn za rasu: sloučené hráči ze všech stránek, čas posledních dat a počet aktivních oken. */
  function snapshot(raceId, now = Date.now()) {
    const entries = [...pages.values()].filter((e) => e.raceId === raceId).sort((a, b) => a.page - b.page);
    const seen = new Set();
    const players = [];
    const srcs = new Set();
    let at = 0;
    for (const e of entries) {
      at = Math.max(at, e.at);
      for (const [s, ts] of e.sources) if (now - ts < SOURCE_ACTIVE_MS) srcs.add(s);
      for (const p of e.players) if (!seen.has(p.name)) { seen.add(p.name); players.push(p); }
    }
    return { at, sources: srcs.size, players };
  }

  return { ingest, snapshot, clear: () => pages.clear(), raceIds: () => [...new Set([...pages.values()].map((e) => e.raceId))] };
}
