/**
 * Dobývací útok přes tlačítko D: nastavení, které jednotky a kolik jich poslat.
 * Stránku utok.php vyplňuje userscript (userscript/stargate-utok.user.js); tady je jen čistá logika
 * kolem nastavení a seznamu jednotek, aby šla testovat.
 *
 * units: [{ name, count, max }]  count = kolik poslat, max = kliknout na „Max“ (pošle všechny)
 */
export const ATTACK_DEFAULTS = { units: [], autoSubmit: false, randomPlanet: true, closeTab: true, retry: true, retryMaxSec: 60 };

const MAX_UNITS = 30;

/** Jméno jednotky bez diakritiky, malými písmeny a s jednou mezerou: pro porovnání mezi UI a stránkou. */
export const normUnit = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Ověří a sjednotí nastavení útoku přicházející z UI (nebo z konfigurace). */
export function sanitizeAttack(cur, body) {
  const next = { ...ATTACK_DEFAULTS, ...cur, units: [...(cur?.units ?? [])] };
  if (!body || typeof body !== 'object') return next;
  if ('autoSubmit' in body) next.autoSubmit = !!body.autoSubmit;
  if ('randomPlanet' in body) next.randomPlanet = !!body.randomPlanet;
  if ('closeTab' in body) next.closeTab = !!body.closeTab;
  if ('retry' in body) next.retry = !!body.retry;
  if ('retryMaxSec' in body) { const n = Math.floor(Number(body.retryMaxSec)); if (Number.isFinite(n)) next.retryMaxSec = Math.min(300, Math.max(5, n)); }
  if (Array.isArray(body.units)) {
    const seen = new Set();
    next.units = [];
    for (const u of body.units.slice(0, MAX_UNITS)) {
      const name = typeof u?.name === 'string' ? u.name.trim().slice(0, 64) : '';
      const key = normUnit(name);
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const n = Number(u.count);
      next.units.push({ name, count: Number.isFinite(n) && n > 0 ? Math.min(1e12, Math.floor(n)) : 0, max: !!u.max });
    }
  }
  return next;
}

/**
 * Jednotky viděné na stránce útoku se doplní do nastavení (s počtem 0), ať je v UI stačí jen přepsat.
 * Vrací nové nastavení, nebo null, když se nic nezměnilo.
 */
export function mergeSeenUnits(attack, seen) {
  const have = new Set(attack.units.map((u) => normUnit(u.name)));
  const add = [];
  for (const s of seen ?? []) {
    const name = typeof s?.name === 'string' ? s.name.trim().slice(0, 64) : '';
    const key = normUnit(name);
    if (!name || have.has(key) || attack.units.length + add.length >= MAX_UNITS) continue;
    have.add(key);
    add.push({ name, count: 0, max: false });
  }
  return add.length ? { ...attack, units: [...attack.units, ...add] } : null;
}

/** Zkontroluje a zkrátí hlášení ze stránky útoku, než se uloží (přijde z prohlížeče). */
export function sanitizeReport(body) {
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  return {
    ok: !!body?.ok,
    submitted: !!body?.submitted,
    planet: str(body?.planet, 80),
    target: str(body?.target, 80),
    filled: Array.isArray(body?.filled)
      ? body.filled.slice(0, MAX_UNITS).map((f) => ({ name: str(f?.name, 64), value: str(String(f?.value ?? ''), 24) }))
      : [],
    problems: Array.isArray(body?.problems) ? body.problems.slice(0, 10).map((p) => str(p, 160)) : [],
  };
}

/** Jednotky ze stránky útoku (name/available/attack) – jen rozumné hodnoty. */
export function sanitizeSeenUnits(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_UNITS).flatMap((u) => {
    const name = typeof u?.name === 'string' ? u.name.trim().slice(0, 64) : '';
    if (!name) return [];
    const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
    return [{ name, available: num(u.available), attack: num(u.attack) }];
  });
}
