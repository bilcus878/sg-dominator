/**
 * Automatický dohoz: když hráč naší rasy spadne pod práh, bot za náhodnou dobu (minSec–maxSec) sám zadá požadavek
 * Dohodit (stejný jako tlačítko v aplikaci; stránku Rasová armáda vyplní a odešle skript). Náhodná prodleva a rozestup
 * mezi víc hráči mají zajistit, že to nevypadá jako stroj. Čistá logika bez I/O; skutečný požadavek dělá `io.request`.
 */

export const AUTO_ARMY_DEFAULTS = { enabled: false, minSec: 2, maxSec: 4, repeat: false, cooldownSec: 60 };

const GIVE_UP_MS = 30_000; // tak dlouho se po termínu zkouší, když je dohoz zaneprázdněný, pak se hráč vzdá
const PAGE_ALERT_GAP_MS = 10 * 60_000; // „stránka není otevřená“ se hlásí nejvýš jednou za 10 minut
const BELOW_REASONS = new Set(['threshold', 'critical']); // pád pod práh (propad nad prahem a návrat se nedohazují)

/** Ověří a sjednotí nastavení auto-dohozu z UI. Čísla mimo meze se ořežou, max nikdy pod min. */
export function sanitizeAutoArmy(cur, body) {
  const next = { ...AUTO_ARMY_DEFAULTS, ...cur };
  if (!body || typeof body !== 'object') return next;
  const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.min(hi, Math.max(lo, Number(v))) : d);
  if ('enabled' in body) next.enabled = !!body.enabled;
  if ('repeat' in body) next.repeat = !!body.repeat;
  if ('minSec' in body) next.minSec = num(body.minSec, 0, 120, next.minSec);
  if ('maxSec' in body) next.maxSec = num(body.maxSec, 0, 120, next.maxSec);
  if ('cooldownSec' in body) next.cooldownSec = num(body.cooldownSec, 0, 3600, next.cooldownSec);
  if (next.maxSec < next.minSec) next.maxSec = next.minSec;
  return next;
}

export function createAutoArmy({ rand = Math.random } = {}) {
  let queue = []; // [{ name, dueAt, firstDueAt }]
  let lastDueAt = 0; // kdy byl naplánovaný poslední dohoz (kvůli rozestupu mezi hráči)
  const lastSent = new Map(); // jméno -> kdy se naposled dohodilo
  const recent = []; // poslední události pro UI
  const total = { sent: 0, skipped: 0, failed: 0 };
  let pageAlertAt = -Infinity;

  const randRange = (a, b) => a + rand() * (b - a);
  const note = (now, type, name, text = '') => {
    recent.push({ at: now, type, name, text });
    if (recent.length > 12) recent.shift();
  };

  /**
   * Alert z hlídání. Naplánuje dohoz jen pro pád pod práh (a při zapnutém opakování i pro připomínky),
   * nejvýš jeden čekající na hráče a s odstupem cooldownSec od posledního dohození.
   * @returns {{scheduled: boolean, dueAt?: number, why?: string}}
   */
  function onAlert(alert, auto, now = Date.now()) {
    if (!auto?.enabled) return { scheduled: false, why: 'off' };
    if (!BELOW_REASONS.has(alert.reason)) return { scheduled: false, why: 'reason' };
    if (alert.repeat && !auto.repeat) return { scheduled: false, why: 'repeat' };
    if (queue.some((q) => q.name === alert.name)) return { scheduled: false, why: 'queued' };
    const last = lastSent.get(alert.name);
    if (last !== undefined && now - last < auto.cooldownSec * 1000) return { scheduled: false, why: 'cooldown' };
    let dueAt = now + Math.round(randRange(auto.minSec, auto.maxSec) * 1000);
    dueAt = Math.max(dueAt, lastDueAt + Math.round(randRange(900, 2500))); // dva hráči naráz nikdo neklikne ve stejné vteřině
    lastDueAt = dueAt;
    queue.push({ name: alert.name, dueAt, firstDueAt: dueAt });
    note(now, 'plan', alert.name, `za ${Math.round((dueAt - now) / 100) / 10} s`);
    return { scheduled: true, dueAt };
  }

  /**
   * Zpracuje splatné dohazy. io: { stillBelow(name) -> bool, request(name) -> {ok, error?} }.
   * @returns události k zalogování: [{type: 'sent'|'skip'|'fail', name, error?, page?}]
   */
  function tick(now, io) {
    const events = [];
    const due = queue.filter((q) => q.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
    for (const item of due) {
      const drop = () => { queue = queue.filter((q) => q !== item); };
      if (!io.stillBelow(item.name)) { // mezitím ho někdo dohodil / vyskočil nad práh
        drop(); total.skipped++; note(now, 'skip', item.name, 'už je nad prahem');
        events.push({ type: 'skip', name: item.name });
        continue;
      }
      const r = io.request(item.name);
      if (r.ok) {
        drop(); lastSent.set(item.name, now); total.sent++; note(now, 'sent', item.name);
        events.push({ type: 'sent', name: item.name });
        break; // další až v dalším průchodu: najednou se zadává nejvýš jeden požadavek
      }
      if (/^Ještě se dohazuje/.test(r.error ?? '')) { // předchozí požadavek ještě běží: chvíli počkat
        if (now - item.firstDueAt > GIVE_UP_MS) { drop(); total.failed++; note(now, 'fail', item.name, 'dohoz byl zaneprázdněný'); events.push({ type: 'fail', name: item.name, error: r.error }); } else item.dueAt = now + Math.round(randRange(500, 1200));
        break;
      }
      drop(); total.failed++; note(now, 'fail', item.name, r.error ?? 'neznámá chyba');
      const page = /^Otevři ve hře/.test(r.error ?? '');
      const notify = page && now - pageAlertAt > PAGE_ALERT_GAP_MS;
      if (notify) pageAlertAt = now;
      events.push({ type: 'fail', name: item.name, error: r.error, page, notify });
    }
    return events;
  }

  const snapshot = (now = Date.now()) => ({
    pending: queue.map((q) => ({ name: q.name, inMs: Math.max(0, q.dueAt - now) })),
    ...total,
    recent: recent.slice(-6),
  });

  return { onAlert, tick, snapshot };
}
