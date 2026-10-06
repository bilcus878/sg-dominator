/**
 * Poslední známý stav ras v paměti. Zdrojem jsou okna prohlížeče (userscript);
 * stránku (raceId + page) může posílat i víc oken najednou. Když se jejich data liší (jedno okno je staré, neobnovené),
 * platí okno, ve kterém se data naposledy změnila (živá obnova); okno, které posílá pořád totéž, se ignoruje.
 * Jinak by síla skákala tam a zpět podle toho, které okno poslalo jako poslední.
 */
const PAGE_TTL_MS = 10 * 60_000;
const SOURCE_ACTIVE_MS = 5_000;
export const PLANET_CHANGE_MS = 30_000; // změna planet se sčítá, dokud nepřijde 30 s bez další změny

export function createStore() {
  const pages = new Map(); // "raceId:page" -> { raceId, page, at, players, sources: Map(src -> ts) }
  const changes = new Map(); // "raceId|jméno" -> { power, delta, at } poslední změna síly (pro barvu v UI)
  const plChanges = new Map(); // "raceId|jméno" -> { planets, delta, at } získané/ztracené planety (součet v okně 30 s)

  function ingest({ raceId, page = 1, src = 'unknown', players }, now = Date.now()) {
    const key = `${raceId}:${page}`;
    let e = pages.get(key);
    if (!e) pages.set(key, (e = { raceId, page, at: now, players: [], sources: new Map(), srcInfo: new Map(), leader: null }));
    e.sources.set(src, now);
    // které okno platí: to s nejčerstvější změnou dat (nové okno = čerstvě načtená stránka = změna teď)
    const sig = players.map((p) => `${p.name}:${p.power}:${p.planets ?? ''}`).join('|');
    const info = e.srcInfo.get(src);
    if (!info || info.sig !== sig) e.srcInfo.set(src, { sig, changedAt: now });
    for (const [s, ts] of e.sources) if (now - ts > SOURCE_ACTIVE_MS) { e.sources.delete(s); e.srcInfo.delete(s); }
    let leader = e.sources.has(e.leader) ? e.leader : src;
    for (const [s, inf] of e.srcInfo) if (inf.changedAt > (e.srcInfo.get(leader)?.changedAt ?? -Infinity)) leader = s;
    e.leader = leader;
    if (src !== leader) return false; // jiné okno má čerstvější (měnící se) data: tohle se ignoruje
    e.at = now;
    e.players = players;
    for (const p of players) {
      const ck = `${raceId}|${p.name}`;
      const c = changes.get(ck);
      if (!c) changes.set(ck, { power: p.power, delta: 0, at: 0 }); // první údaj není změna
      else if (c.power !== p.power) changes.set(ck, { power: p.power, delta: p.power - c.power, at: now });
      if (!Number.isFinite(p.planets)) continue; // starší skript počet planet neposílá
      const pc = plChanges.get(ck);
      if (!pc) plChanges.set(ck, { planets: p.planets, delta: 0, at: 0 });
      else if (pc.planets !== p.planets) {
        // další změna do 30 s od poslední se přičte (−1, −1 -> −2) a odpočet začne znovu
        const base = pc.at && now - pc.at < PLANET_CHANGE_MS ? pc.delta : 0;
        plChanges.set(ck, { planets: p.planets, delta: base + (p.planets - pc.planets), at: now });
      }
    }
    for (const [k, v] of pages) if (now - v.at > PAGE_TTL_MS) pages.delete(k);
    return true;
  }

  /** Souhrn za rasu: sloučené hráči ze všech stránek, čas posledních dat a počet aktivních oken. */
  function snapshot(raceId, now = Date.now()) {
    const entries = [...pages.values()].filter((e) => e.raceId === raceId).sort((a, b) => a.page - b.page);
    const seen = new Map(); // jméno -> index v players
    const players = [];
    const srcs = new Set();
    let at = 0;
    for (const e of entries) {
      at = Math.max(at, e.at);
      for (const [s, ts] of e.sources) if (now - ts < SOURCE_ACTIVE_MS) srcs.add(s);
      for (const p of e.players) {
        const at = seen.get(p.name);
        if (at !== undefined && players[at].seenAt >= e.at) continue; // hráč je na víc stránkách: vyhrávají nejčerstvější data
        const c = changes.get(`${raceId}|${p.name}`);
        const pc = plChanges.get(`${raceId}|${p.name}`);
        const obj = { ...p, seenAt: e.at, powerDelta: c?.delta ?? 0, powerAt: c?.at ?? 0, planetsChange: pc?.delta ?? 0, planetsAt: pc?.at ?? 0 };
        if (at === undefined) { seen.set(p.name, players.length); players.push(obj); } else players[at] = obj;
      }
    }
    return { at, sources: srcs.size, players };
  }

  return { ingest, snapshot, clear: () => { pages.clear(); changes.clear(); plChanges.clear(); }, raceIds: () => [...new Set([...pages.values()].map((e) => e.raceId))] };
}
