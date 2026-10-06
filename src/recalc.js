/**
 * Přepočet hráče: ve sloupci „Dobyt“ hráčů rasy se v hodinu přepočtu číslo vynuluje (z „11×“ na „0×“).
 * Přepočet je vždy v celou hodinu, takže se ukládá hodina (0–23). Vynulování musí potvrdit 2 čtení po sobě
 * (filtr chyb čtení). Čistá logika; ukládání do souboru dělá volající (onChange).
 */
const HOUR_MS = 3_600_000;

/** Čas zjištění -> celá hodina přepočtu: do 10 min po celé zpět na ni, od 50 min dál na další (posun hodin PC a hry); jinak zpět. */
export function recalcHour(at) {
  const d = new Date(at);
  if (d.getMinutes() >= 50) d.setTime(d.getTime() + HOUR_MS);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

/**
 * @param {{ [key: string]: { at: number, hour: number, history?: number[] } }} saved uložené přepočty (klíč „raceId|jméno“)
 */
export function createRecalc(saved = {}, { onChange = () => {} } = {}) {
  const rec = saved; // klíč -> { at: čas přepočtu (celá hodina), hour: 0–23, history: poslední časy }
  const last = new Map(); // klíč -> { dobyt, zeroReads }

  /** Data z jednoho čtení stránky rasy. Vrací seznam nově zjištěných přepočtů [{ name, at, hour }]. */
  function ingest(raceId, players, now = Date.now()) {
    const found = [];
    for (const p of players) {
      if (!Number.isInteger(p.dobyt) || p.dobyt < 0) continue; // starý skript nebo nečitelná buňka
      const key = `${raceId}|${p.name}`;
      const s = last.get(key);
      if (!s) { last.set(key, { dobyt: p.dobyt, zeroReads: 0, before: p.dobyt }); continue; }
      if (p.dobyt === 0 && s.before > 0) {
        s.zeroReads++;
        if (s.zeroReads >= 2) { // potvrzeno: z >0× na 0×
          const at = recalcHour(now);
          const hour = new Date(at).getHours();
          const prev = rec[key];
          if (!prev || prev.at !== at) {
            rec[key] = { at, hour, history: [at, ...(prev?.history ?? [])].slice(0, 7) };
            found.push({ name: p.name, at, hour });
          }
          s.before = 0;
          s.zeroReads = 0;
        }
      } else {
        s.zeroReads = 0;
        if (p.dobyt > 0) s.before = p.dobyt;
      }
      s.dobyt = p.dobyt;
    }
    if (found.length) onChange(rec);
    return found;
  }

  /** Pro UI: hodina posledního přepočtu hráče, nebo null. */
  const of = (raceId, name) => {
    const r = rec[`${raceId}|${name}`];
    return r ? { recalcAt: r.at, recalcHour: r.hour } : { recalcAt: null, recalcHour: null };
  };
  const clear = () => { for (const k of Object.keys(rec)) delete rec[k]; last.clear(); onChange(rec); };
  const count = () => Object.keys(rec).length;
  return { ingest, of, clear, count };
}
