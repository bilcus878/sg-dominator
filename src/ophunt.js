/**
 * Automat na OP (opuštěné planety): když na velké mapě svítí OP, bot sám otevře jeho sektor, na sektorové mapě najde tečku
 * na stejné poloze jako na velké mapě (ostatní tečky jsou falešné), otevře ji a klikne na „Získat souřadnice“.
 *
 * Tohle je čistá logika bez sítě a DOM. Stav drží server (stránka se při každém kroku přenačte), skript na mapě jen hlásí,
 * co vidí, a dostává zakázku:
 *   zakázka = jeden sektor s OP: { id, sector, label, u, v }  (u, v = poloha tečky v sektoru 0–1, počítaná z velké mapy)
 *   životní cyklus: nabídnuta → spuštěna (event start) → sektorová mapa → planeta (zkusí se víc teček) → výsledek.
 *
 * Pojistky: jedna zakázka najednou, vypršení zakázky, cooldown sektoru po neúspěchu (ať se nezacyklí na falešném OP),
 * limit zakázek za hodinu, nedostatek naquadahu automat vypne a hlásí se, zkušební režim (dryRun) nikdy nekliká na „Získat souřadnice“.
 * Zprávy (notify) jdou jen do servisního chatu.
 */

export const HUNT_DEFAULTS = {
  enabled: false,
  dryRun: true, // první spuštění: všechno kromě závěrečného kliknutí; do ostrého režimu si to uživatel přepne sám
  reactMinSec: 1.5, reactMaxSec: 4, // po objevení OP do prvního pohybu
  stepMinSec: 0.8, stepMaxSec: 2.5, // pauzy mezi kroky (otevření sektoru, tečky, hledání tlačítka)
  claimMinSec: 1.5, claimMaxSec: 4, // pauza těsně před kliknutím na „Získat souřadnice“
  tolerancePx: 30, // jak daleko od očekávané polohy se na sektorové mapě tečka ještě bere
  maxTries: 3, // kolik teček se v sektoru vyzkouší
  retrySectorSec: 180, // po neúspěchu v sektoru ho tolik sekund nezkoušet znovu
  maxPerHour: 12,
};

const JOB_MAX_MS = 4 * 60_000; // celá zakázka (včetně případného zaseknutí skriptu)

export function createHunt({ rand = Math.random } = {}) {
  let job = null;
  let seq = 0;
  let last = null; // poslední výsledek (pro UI)
  const cool = new Map(); // sektor -> do kdy se nezkouší
  let starts = []; // časy spuštěných zakázek (limit za hodinu)
  let limitNotified = false;

  const cfgH = (h) => ({ ...HUNT_DEFAULTS, ...h });
  const range = (a, b) => a + rand() * (b - a);
  const sectorName = (j) => (/^\d+$/.test(j.label) || !j.label ? `sektor ${j.sector}` : `sektor ${j.sector} (${j.label})`);

  const spec = (j, h) => ({
    id: j.id, sector: j.sector, label: j.label, u: j.u, v: j.v, dryRun: !!h.dryRun, tried: j.tried.length,
    stepMinSec: h.stepMinSec, stepMaxSec: h.stepMaxSec, claimMinSec: h.claimMinSec, claimMaxSec: h.claimMaxSec,
    tolerancePx: h.tolerancePx, maxTries: h.maxTries,
  });

  function finish(result, text, now, { cooldown = true, notify = true } = {}, h = HUNT_DEFAULTS) {
    const j = job;
    job = null;
    if (!j) return null;
    last = { at: now, sector: j.sector, label: j.label, result, text };
    if (cooldown) cool.set(j.sector, now + (cfgH(h).retrySectorSec ?? 180) * 1000);
    return notify ? text : null;
  }

  /**
   * Volá se při každém snímku mapy s právě svítícími sektory.
   * @param {{id:string,label:string,u?:number,v?:number}[]} sectors
   * @returns {{spec?:object, notify?:string}} spec = zakázka, kterou má skript teď provést (jen když je její čas a ještě nezačala)
   */
  function offer(sectors, hCfg, now, { opEnabled = true } = {}) {
    const h = cfgH(hCfg);
    const out = {};
    if (!h.enabled || !opEnabled) { job = null; return out; }
    if (job && now - job.createdAt > JOB_MAX_MS) {
      const t = finish('timeout', `⚠️ Automat OP: zakázka na ${sectorName(job)} vypršela (skript se zasekl nebo se zavřelo okno mapy).`, now, {}, h);
      if (t) out.notify = t;
    }
    if (!job) {
      starts = starts.filter((t) => now - t < 3_600_000);
      const cand = sectors.find((s) => Number.isFinite(s.u) && Number.isFinite(s.v) && s.u >= 0 && s.u <= 1 && s.v >= 0 && s.v <= 1 && !(cool.get(s.id) > now));
      if (!cand) return out;
      if (starts.length >= h.maxPerHour) {
        if (!limitNotified) { limitNotified = true; out.notify = `⚠️ Automat OP: za poslední hodinu už proběhlo ${starts.length} zakázek (limit ${h.maxPerHour}), další OP se nehoní.`; }
        return out;
      }
      limitNotified = false;
      job = { id: ++seq, sector: cand.id, label: cand.label ?? '', u: cand.u, v: cand.v, createdAt: now, startAt: now + range(h.reactMinSec, h.reactMaxSec) * 1000, started: false, tried: [], tries: 0, stage: 'offered' };
    }
    if (!job.started && now >= job.startAt) {
      out.spec = { ...spec(job, h), startInMs: 0 };
    } else if (!job.started) out.wait = job.startAt - now;
    return out;
  }

  /** Je zakázka rozjetá? (teleskop se pak nezastavuje, OP tečky se nepovažují za zmizelé) */
  const active = (now = Date.now()) => !!job && now - job.createdAt <= JOB_MAX_MS;

  /**
   * Události ze skriptu.
   * @returns {{ok:boolean, spec?:object, notify?:string, disable?:boolean}}
   */
  function event(ev, hCfg, now) {
    const h = cfgH(hCfg);
    if (!job || ev.id !== job.id) return { ok: false, gone: true };
    switch (ev.event) {
      case 'start':
        if (job.started) return { ok: false, taken: true }; // už ji spustila jiná karta
        job.started = true; job.stage = 'sector'; job.startedAt = now; starts.push(now);
        return { ok: true, spec: spec(job, h) };
      case 'state':
        return { ok: true, spec: spec(job, h) };
      case 'sector':
        job.stage = 'sector';
        return { ok: true };
      case 'try':
        job.tries++; job.stage = 'planet';
        job.tried.push({ x: Number(ev.x) || 0, y: Number(ev.y) || 0 });
        return { ok: true };
      case 'no-button':
        job.stage = 'sector';
        return { ok: true };
      case 'no-dot': {
        const t = finish('no-dot', `🟠 Automat OP: v ${sectorName(job)} se nepodařilo najít pravou tečku OP${ev.text ? ` (${String(ev.text).slice(0, 200)})` : ''}. Hledám dál na velké mapě.`, now, {}, h);
        return { ok: true, notify: t };
      }
      case 'dry': {
        const t = finish('dry', `🧪 Automat OP (zkušební režim): v ${sectorName(job)} jsem našel tlačítko „Získat souřadnice“${ev.text ? ` (${String(ev.text).slice(0, 200)})` : ''}. Neklikl jsem, protože je zapnutý zkušební režim.`, now, {}, h);
        return { ok: true, notify: t };
      }
      case 'success': {
        const t = finish('success', `✅ Automat OP: OP v ${sectorName(job)} je osídlena!${ev.text ? ` ${String(ev.text).slice(0, 200)}` : ''}`, now, {}, h);
        return { ok: true, notify: t };
      }
      case 'no-naquadah': {
        const t = finish('no-naquadah', `⛔ Automat OP: na osídlení (${sectorName(job)}) nestačí naquadah${ev.text ? `: „${String(ev.text).slice(0, 200)}“` : ''}. Automat jsem VYPNUL, zapni ho znovu po doplnění naquadahu.`, now, {}, h);
        return { ok: true, notify: t, disable: true };
      }
      case 'fail': {
        const t = finish('fail', `⚠️ Automat OP: ${sectorName(job)} se nepodařilo osídlit${ev.text ? `: ${String(ev.text).slice(0, 300)}` : ''}.`, now, {}, h);
        return { ok: true, notify: t };
      }
      case 'abort': {
        const t = finish('abort', `⚠️ Automat OP: zakázku na ${sectorName(job)} jsem ukončil${ev.text ? `: ${String(ev.text).slice(0, 200)}` : ''}.`, now, {}, h);
        return { ok: true, notify: t };
      }
      default:
        return { ok: false, error: 'unknown event' };
    }
  }

  function snapshot(now = Date.now()) {
    return {
      active: active(now),
      job: job ? { sector: job.sector, label: job.label, stage: job.stage, tries: job.tries, started: job.started, ageSec: Math.round((now - job.createdAt) / 1000) } : null,
      last,
      cooling: [...cool].filter(([, t]) => t > now).map(([sector, t]) => ({ sector, inSec: Math.ceil((t - now) / 1000) })),
      startsLastHour: starts.filter((t) => now - t < 3_600_000).length,
    };
  }

  return { offer, event, active, snapshot };
}
