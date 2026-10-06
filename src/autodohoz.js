/**
 * Automatický dohoz: když hráč naší rasy spadne pod práh, bot za náhodnou dobu (minSec–maxSec) sám zadá požadavek
 * Dohodit (stejný jako tlačítko v aplikaci; stránku Rasová armáda vyplní a odešle skript). Náhodná prodleva a rozestup
 * mezi víc hráči mají zajistit, že to nevypadá jako stroj. Čistá logika bez I/O; skutečný požadavek dělá `io.request`.
 *
 * Dohazování až po horní hranici (topUp): jeden dohoz často nestačí (jednotky dají třeba 150 mil. a hráč potřebuje
 * dostat nad 700 mil.), proto bot po každém dohození počká, až se síla hráče ukáže v datech, a když je pořád pod horní
 * hranicí a síla vzrostla, po náhodné prodlevě dohodí znovu. Sílu sleduje živě: další kolo naplánuje hned, jakmile se po
 * dohozu v datech zvedne (žádná pevná čekací doba), a dohazování ukončí jen když do STALL_MS nevzroste vůbec. Zastaví se, jakmile hráč hranici překoná, nebo když
 * dohoz nezabírá (síla nevzrostla) či dojde nejvyšší počet kol, ať se jednotky neposílají donekonečna.
 *
 * Pojistka při víc hráčích: nejdřív se každý hráč pod prahem dostane NAD PRÁH (záchrana, jeden po druhém), a teprve když
 * už nikdo pod prahem není, dohazují se hráči střídavě dál k horní hranici. Jeden hráč tak nespotřebuje všechny jednotky,
 * zatímco druhý zůstává pod prahem.
 */

export const AUTO_ARMY_DEFAULTS = {
  enabled: false, minSec: 2, maxSec: 4, gapMinSec: 0.9, gapMaxSec: 2.5, repeat: false,
  roundMinSec: 2, roundMaxSec: 4, // pauza mezi dohozy téhož hráče (kola k horní hranici): náhodně v rozmezí
  cooldownMinSec: 60, cooldownMaxSec: 120, // dřív než za tuhle (náhodnou) dobu se stejný hráč po dohození znovu nezačíná dohazovat
  topUp: false, topUpTarget: 0, topUpMaxRounds: 10, // dohazovat, dokud síla nepřekročí topUpTarget (nejvýš topUpMaxRounds dohozů)
};

const GIVE_UP_MS = 30_000; // tak dlouho se po termínu zkouší, když je dohoz zaneprázdněný, pak se hráč vzdá
const PAGE_ALERT_GAP_MS = 10 * 60_000; // „stránka není otevřená“ se hlásí nejvýš jednou za 10 minut
const BELOW_REASONS = new Set(['threshold', 'critical']); // pád pod práh (propad nad prahem a návrat se nedohazují)
const STALL_MS = 15_000; // pojistka: síla po dohození do téhle doby nevzrostla = dohoz nezabírá, přestat (běžně síla naskočí hned)

/** Starší nastavení (pevná pauza cooldownSec, kola s prodlevou jako první dohoz) -> nová rozmezí. */
export function migrateAutoArmy(a) {
  if (!a || typeof a !== 'object') return a;
  const o = { ...a };
  if ('cooldownSec' in o && !('cooldownMinSec' in o)) o.cooldownMinSec = o.cooldownMaxSec = o.cooldownSec;
  delete o.cooldownSec;
  if (!('roundMinSec' in o) && ('minSec' in o || 'maxSec' in o)) { o.roundMinSec = o.minSec ?? AUTO_ARMY_DEFAULTS.minSec; o.roundMaxSec = o.maxSec ?? AUTO_ARMY_DEFAULTS.maxSec; }
  return o;
}

/** Ověří a sjednotí nastavení auto-dohozu z UI. Čísla mimo meze se ořežou, max nikdy pod min. */
export function sanitizeAutoArmy(cur, body) {
  const next = { ...AUTO_ARMY_DEFAULTS, ...migrateAutoArmy(cur) };
  body = migrateAutoArmy(body);
  if (!body || typeof body !== 'object') return next;
  const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.min(hi, Math.max(lo, Number(v))) : d);
  if ('enabled' in body) next.enabled = !!body.enabled;
  if ('repeat' in body) next.repeat = !!body.repeat;
  if ('topUp' in body) next.topUp = !!body.topUp;
  if ('minSec' in body) next.minSec = num(body.minSec, 0, 120, next.minSec);
  if ('maxSec' in body) next.maxSec = num(body.maxSec, 0, 120, next.maxSec);
  if ('gapMinSec' in body) next.gapMinSec = num(body.gapMinSec, 0, 60, next.gapMinSec);
  if ('gapMaxSec' in body) next.gapMaxSec = num(body.gapMaxSec, 0, 60, next.gapMaxSec);
  if ('cooldownMinSec' in body) next.cooldownMinSec = num(body.cooldownMinSec, 0, 3600, next.cooldownMinSec);
  if ('cooldownMaxSec' in body) next.cooldownMaxSec = num(body.cooldownMaxSec, 0, 3600, next.cooldownMaxSec);
  if ('roundMinSec' in body) next.roundMinSec = num(body.roundMinSec, 0, 120, next.roundMinSec);
  if ('roundMaxSec' in body) next.roundMaxSec = num(body.roundMaxSec, 0, 120, next.roundMaxSec);
  if ('topUpTarget' in body) next.topUpTarget = Math.floor(num(body.topUpTarget, 0, 1e13, next.topUpTarget));
  if ('topUpMaxRounds' in body) next.topUpMaxRounds = Math.floor(num(body.topUpMaxRounds, 1, 50, next.topUpMaxRounds));
  if (next.maxSec < next.minSec) next.maxSec = next.minSec;
  if (next.gapMaxSec < next.gapMinSec) next.gapMaxSec = next.gapMinSec;
  if (next.cooldownMaxSec < next.cooldownMinSec) next.cooldownMaxSec = next.cooldownMinSec;
  if (next.roundMaxSec < next.roundMinSec) next.roundMaxSec = next.roundMinSec;
  return next;
}

export function createAutoArmy({ rand = Math.random } = {}) {
  let queue = []; // [{ name, dueAt, firstDueAt, episode }]
  let lastDueAt = 0; // kdy byl naplánovaný poslední dohoz (kvůli rozestupu mezi hráči)
  const blockedUntil = new Map(); // jméno -> do kdy se po dohození znovu nezačíná dohazovat (náhodná doba z rozmezí cooldownMin–Max)
  const episodes = new Map(); // jméno -> { phase: 'rescue'|'topup', target, maxRounds, rounds, minSec, maxSec, gapMinSec, gapMaxSec, startedAt } (jen při dohazování po horní hranici)
  const watch = new Map(); // jméno -> { sentAt, powerAtSend }: čeká se, až se ukáže účinek posledního dohozu
  const recent = []; // poslední události pro UI
  const total = { sent: 0, skipped: 0, failed: 0 };
  let pageAlertAt = -Infinity;

  const randRange = (a, b) => a + rand() * (b - a);
  const note = (now, type, name, text = '') => {
    recent.push({ at: now, type, name, text });
    if (recent.length > 12) recent.shift();
  };
  /** Termín dalšího dohozu: náhodná prodleva + odstup od předchozího naplánovaného (dva hráči naráz nikdo neklikne ve stejné vteřině). */
  const dueFor = (now, a) => {
    const due = now + Math.round(randRange(a.minSec, a.maxSec) * 1000);
    const at = Math.max(due, lastDueAt + Math.round(randRange(a.gapMinSec ?? 0.9, a.gapMaxSec ?? 2.5) * 1000));
    lastDueAt = at;
    return at;
  };
  const fmt = (n) => Math.round(n).toLocaleString('cs-CZ');
  const hasRescue = () => [...episodes.values()].some((e) => e.phase === 'rescue'); // někdo je ještě pod prahem a čeká na záchranu
  const isTop = (q) => !!q.episode && q.episode.phase === 'topup';

  /**
   * Alert z hlídání. Naplánuje dohoz jen pro pád pod práh (a při zapnutém opakování i pro připomínky),
   * nejvýš jeden čekající na hráče a s náhodným odstupem (cooldownMinSec–MaxSec) od posledního dohození.
   * @returns {{scheduled: boolean, dueAt?: number, why?: string}}
   */
  function onAlert(alert, auto, now = Date.now()) {
    if (!auto?.enabled) return { scheduled: false, why: 'off' };
    if (!BELOW_REASONS.has(alert.reason)) return { scheduled: false, why: 'reason' };
    if (alert.repeat && !auto.repeat) return { scheduled: false, why: 'repeat' };
    if (queue.some((q) => q.name === alert.name) || episodes.has(alert.name)) return { scheduled: false, why: 'queued' };
    const until = blockedUntil.get(alert.name);
    if (until !== undefined && now < until) return { scheduled: false, why: 'cooldown' };
    const dueAt = dueFor(now, auto);
    const topUp = auto.topUp && auto.topUpTarget > 0;
    const episode = topUp
      ? { phase: 'rescue', target: auto.topUpTarget, maxRounds: Math.max(1, auto.topUpMaxRounds), rounds: 0, minSec: auto.roundMinSec, maxSec: auto.roundMaxSec, gapMinSec: auto.gapMinSec, gapMaxSec: auto.gapMaxSec, cool: [auto.cooldownMinSec, auto.cooldownMaxSec], startedAt: now }
      : null;
    if (episode) episodes.set(alert.name, episode);
    queue.push({ name: alert.name, dueAt, firstDueAt: dueAt, episode, cool: [auto.cooldownMinSec, auto.cooldownMaxSec] });
    note(now, 'plan', alert.name, `za ${Math.round((dueAt - now) / 100) / 10} s${episode ? `, pak do ${fmt(episode.target)}` : ''}`);
    return { scheduled: true, dueAt };
  }

  /** Dohazování hráče skončilo (cíl, nezabírá, max kol, selhání): úklid a událost. */
  function endEpisode(name, now, type, text, events, notify = false, message = '') {
    episodes.delete(name);
    watch.delete(name);
    note(now, type, name, text);
    events.push({ type, name, notify, text: message });
  }

  /** Sleduje účinek odeslaných dohozů: překonal hranici -> hotovo; vzrostla síla -> další kolo; nevzrostla -> nezabírá. */
  function followUp(now, io, events) {
    for (const [name, w] of [...watch]) {
      const ep = episodes.get(name);
      if (!ep) { watch.delete(name); continue; }
      const age = now - w.sentAt;
      const p = io.power?.(name);
      if (p == null) {
        if (age > STALL_MS) endEpisode(name, now, 'stall', 'nejsou data o síle', events, true, `⚠️ Auto-dohoz: ${name} – nejsou čerstvá data o síle, dohazování končí po ${ep.rounds}. dohozu.`);
        continue;
      }
      if (p >= ep.target) {
        endEpisode(name, now, 'done', `${fmt(p)} po ${ep.rounds}× dohozu`, events, true, `✅ Auto-dohoz: ${name} je na ${fmt(p)} (nad hranicí ${fmt(ep.target)}) po ${ep.rounds}. dohozu.`);
      } else if (p > w.powerAtSend) {
        if (ep.rounds >= ep.maxRounds) {
          endEpisode(name, now, 'max', `max ${ep.maxRounds} dohozů, síla ${fmt(p)}`, events, true, `⚠️ Auto-dohoz: ${name} je po ${ep.rounds} dohozech jen na ${fmt(p)} (cíl ${fmt(ep.target)}), dohazování končí.`);
        } else {
          watch.delete(name);
          const thr = io.threshold?.(name);
          if (ep.phase === 'rescue' && (thr == null || p >= thr)) { // je nad prahem: záchrana hotová, dál už jen k horní hranici
            ep.phase = 'topup';
            note(now, 'rescued', name, `nad prahem (${fmt(p)})`);
          }
          const dueAt = dueFor(now, ep);
          queue.push({ name, dueAt, firstDueAt: dueAt, episode: ep });
          note(now, 'plan', name, `${ep.phase === 'rescue' ? 'nad práh' : 'k hranici'}: kolo ${ep.rounds + 1}/${ep.maxRounds} za ${Math.round((dueAt - now) / 100) / 10} s (síla ${fmt(p)})`);
        }
      } else if (age > STALL_MS) {
        endEpisode(name, now, 'stall', `síla ${fmt(p)} nevzrostla`, events, true, `⚠️ Auto-dohoz: ${name} – po dohození síla nevzrostla (${fmt(p)}), dohazování končí. Zkontroluj armádu a stránku Rasová armáda.`);
      }
    }
  }

  /**
   * Zpracuje splatné dohazy. io: { stillBelow(name) -> bool, power(name) -> číslo|null, threshold(name) -> číslo|null, request(name) -> {ok, error?} }.
   * @returns události k zalogování: [{type: 'sent'|'skip'|'fail'|'done'|'stall'|'max', name, error?, page?, notify?, text?}]
   */
  function tick(now, io) {
    const events = [];
    followUp(now, io, events);
    // nejdřív záchrana (hráči pod prahem), dohazování k horní hranici až potom; uvnitř skupiny podle termínu
    const due = queue.filter((q) => q.dueAt <= now).sort((a, b) => Number(isTop(a)) - Number(isTop(b)) || a.dueAt - b.dueAt);
    for (const item of due) {
      const drop = () => { queue = queue.filter((q) => q !== item); };
      const ep = item.episode;
      if (isTop(item) && hasRescue()) { // někdo je ještě pod prahem: ten má přednost, tenhle počká
        item.dueAt = now + Math.round(randRange(500, 1200));
        continue;
      }
      if (ep && ep.rounds > 0) { // další kolo dohazování: jde jen o to, jestli je pořád pod horní hranicí
        const p = io.power?.(item.name);
        if (p != null && p >= ep.target) {
          drop();
          endEpisode(item.name, now, 'done', `${fmt(p)} po ${ep.rounds}× dohozu`, events, true, `✅ Auto-dohoz: ${item.name} je na ${fmt(p)} (nad hranicí ${fmt(ep.target)}) po ${ep.rounds}. dohozu.`);
          continue;
        }
      } else if (!io.stillBelow(item.name)) { // první dohoz: mezitím ho někdo dohodil / vyskočil nad práh
        drop(); total.skipped++; episodes.delete(item.name); note(now, 'skip', item.name, 'už je nad prahem');
        events.push({ type: 'skip', name: item.name });
        continue;
      }
      const powerBefore = io.power?.(item.name) ?? 0; // síla těsně před dohozem: podle ní se pozná, že dohoz zabral
      const r = io.request(item.name);
      if (r.ok) {
        drop(); total.sent++;
        const cool = item.cool ?? ep?.cool ?? [0, 0];
        blockedUntil.set(item.name, now + Math.round(randRange(cool[0], cool[1]) * 1000)); // další samostatné dohazování téhož hráče až po náhodné pauze
        if (ep) {
          ep.rounds += 1;
          watch.set(item.name, { sentAt: now, powerAtSend: powerBefore });
          note(now, 'sent', item.name, `${ep.rounds}. dohoz`);
        } else note(now, 'sent', item.name);
        events.push({ type: 'sent', name: item.name });
        break; // další až v dalším průchodu: najednou se zadává nejvýš jeden požadavek
      }
      if (/^Ještě se dohazuje/.test(r.error ?? '')) { // předchozí požadavek ještě běží: chvíli počkat
        if (now - item.firstDueAt > GIVE_UP_MS) {
          drop(); total.failed++; episodes.delete(item.name); note(now, 'fail', item.name, 'dohoz byl zaneprázdněný');
          events.push({ type: 'fail', name: item.name, error: r.error });
        } else item.dueAt = now + Math.round(randRange(500, 1200));
        break;
      }
      drop(); total.failed++; episodes.delete(item.name); watch.delete(item.name); note(now, 'fail', item.name, r.error ?? 'neznámá chyba');
      const page = /^Otevři ve hře/.test(r.error ?? '');
      const notify = page && now - pageAlertAt > PAGE_ALERT_GAP_MS;
      if (notify) pageAlertAt = now;
      events.push({ type: 'fail', name: item.name, error: r.error, page, notify });
    }
    return events;
  }

  const snapshot = (now = Date.now()) => ({
    pending: queue.map((q) => ({ name: q.name, inMs: Math.max(0, q.dueAt - now) })),
    topping: [...episodes].map(([name, e]) => ({ name, phase: e.phase, rounds: e.rounds, maxRounds: e.maxRounds, target: e.target })),
    ...total,
    recent: recent.slice(-6),
  });

  return { onAlert, tick, snapshot };
}
