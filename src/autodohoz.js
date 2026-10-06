/**
 * Automatický dohoz: když hráč naší rasy spadne pod práh, bot za náhodnou dobu (minSec–maxSec) sám zadá požadavek
 * Dohodit (stejný jako tlačítko v aplikaci; stránku Rasová armáda vyplní a odešle skript). Náhodná prodleva a rozestup
 * mezi víc hráči mají zajistit, že to nevypadá jako stroj. Čistá logika bez I/O; skutečný požadavek dělá `io.request`.
 *
 * Dohazuje se vždy, dokud hráč není NAD CÍLEM: v režimu „nad práh“ je cílem práh hráče (jeden dohoz často nestačí, např. jednotky přidají
 * 30 mil. a práh je 100 mil.), v režimu topUp horní hranice. Stejný mechanismus (záchrana → případně k horní hranici) platí v obou režimech.
 *
 * Dohazování až po horní hranici (topUp): jeden dohoz často nestačí (jednotky dají třeba 150 mil. a hráč potřebuje
 * dostat nad 700 mil.), proto bot po každém dohození sleduje sílu hráče v datech a když je pořád pod horní
 * hranicí a síla vzrostla, po náhodné prodlevě dohodí znovu. Sílu sleduje živě: další kolo naplánuje hned, jakmile se po
 * dohozu v datech zvedne (žádná pevná čekací doba), a dohazování ukončí jen když do STALL_MS nevzroste vůbec.
 *
 * Pojistka při víc hráčích: nejdřív se každý hráč pod prahem dostane NAD PRÁH (záchrana, jeden po druhém), a teprve když
 * už nikdo pod prahem není, dohazují se hráči střídavě dál k horní hranici. Jeden hráč tak nespotřebuje všechny jednotky,
 * zatímco druhý zůstává pod prahem.
 *
 * Bezpečnostní zásady (jednotky jsou drahé, chyba se nesmí zacyklit):
 *  - každý odeslaný dohoz se OVĚŘUJE (i bez horní hranice): chyba skriptu nebo nevzrůst síly = zpráva, ne ticho;
 *  - sílu bere jen z čerstvých dat (io.power / io.stillBelow vrací null bez čerstvých dat → nic se neposílá naslepo);
 *  - vypnutí auto-dohozu okamžitě zruší všechno naplánované i rozjeté dohazování;
 *  - pojistka: víc než `maxPerHour` dohozů za hodinu = auto-dohoz se vypne a pošle se zpráva;
 *  - nezabírá-li dohoz (síla nevzroste), dohazování se ukončí; počet dohozů na hráče se neomezuje (jen interní tvrdý strop).
 */

export const AUTO_ARMY_DEFAULTS = {
  enabled: false, minSec: 2, maxSec: 4, gapMinSec: 0.9, gapMaxSec: 2.5,
  roundMinSec: 2, roundMaxSec: 4, // pauza mezi dohozy téhož hráče (kola k horní hranici): náhodně v rozmezí
  cooldownMinSec: 60, cooldownMaxSec: 120, // dřív než za tuhle (náhodnou) dobu se stejný hráč po dohození znovu nezačíná dohazovat
  quietMinSec: 5, quietMaxSec: 15, // první pád po klidu (QUIET_MS nikdo z rasy nespadl): k prodlevě 1 se přičte ještě tohle (hráč „nebyl připravený“)
  topUp: false, topUpTarget: 0, // false = jeden dohoz za pád pod práh; true = dohazovat, dokud síla nepřekročí topUpTarget (bez omezení počtu dohozů)
  maxPerHour: 200, // pojistka: víc dohozů za hodinu = auto-dohoz se sám vypne
  // přednostní dohoz pro uživatele samotného: kdo si zadá svoje jméno v rase, tomu se dohazuje rychleji a jako prvnímu (člověk má sebe vždycky připraveného)
  selfName: '', selfMinSec: 0.3, selfMaxSec: 1, selfRoundMinSec: 0.4, selfRoundMaxSec: 1.2,
};

const GIVE_UP_MS = 30_000; // tak dlouho se po termínu zkouší, když je dohoz zaneprázdněný / stránka armády se načítá / chybí čerstvá data
const PAGE_ALERT_GAP_MS = 10 * 60_000; // „stránka není otevřená“ se hlásí nejvýš jednou za 10 minut
const BELOW_REASONS = new Set(['threshold', 'critical']); // pád pod práh (propad nad prahem a návrat se nedohazují)
const NOGAIN_MS = 4_000; // dohoz odeslán, ale síla nevzrostla: stránka armády je nejspíš zastaralá (po odhlášení/přihlášení) – obnovit ji a dohodit znovu
const STALL_MS = 15_000; // pojistka: síla po dohození do téhle doby nevzrostla = dohoz nezabírá, přestat (běžně síla naskočí hned)
const GAIN_FRACTION = 0.001; // „síla vzrostla“ = o víc než 0,1 % cíle (filtr drobného přirozeného kolísání)
const HOUR_MS = 3_600_000;
const QUIET_MS = 60 * 60_000; // „klid“: tak dlouho nikdo z naší rasy nespadl pod práh -> další pád je začátek nového útoku
const EARLY_DEDUPE_MS = 20_000; // po rychlé větvi (viz onAlert, alert.early) se potvrzený alert téhož hráče z pravidel nebere jako nový pád
const PIPELINE_MS = 300; // požadavek se skutečně „klikne“ až ~0,2–0,45 s po zadání (skript ho vyzvedne, vyplní a klikne): u rychlé větve se odečte, ať prodleva platí do kliknutí
const MIN_BELOW_READINGS = 2; // před prvním dohozem musí být hráč pod prahem aspoň ve dvou čteních dat (ochrana před jednorázovým výkyvem)
const MAX_ROUNDS = 500; // jen tvrdý strop proti chybě v kódu; v nastavení se počet dohozů na hráče neomezuje

/** Starší nastavení (pevná pauza cooldownSec, kola s prodlevou jako první dohoz) -> nová rozmezí. */
export function migrateAutoArmy(a) {
  if (!a || typeof a !== 'object') return a;
  const o = { ...a };
  delete o.repeat; // „dohazovat znovu při připomínce“ zrušeno: buď jednou za pád, nebo až po horní hranici
  delete o.topUpMaxRounds; // limit kol zrušen
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
  if ('maxPerHour' in body) next.maxPerHour = Math.floor(num(body.maxPerHour, 1, 1000, next.maxPerHour));
  if ('selfName' in body && typeof body.selfName === 'string') next.selfName = body.selfName.trim().slice(0, 64);
  for (const k of ['selfMinSec', 'selfMaxSec', 'selfRoundMinSec', 'selfRoundMaxSec']) if (k in body) next[k] = num(body[k], 0, 60, next[k]);
  for (const k of ['quietMinSec', 'quietMaxSec']) if (k in body) next[k] = num(body[k], 0, 600, next[k]);
  if (next.quietMaxSec < next.quietMinSec) next.quietMaxSec = next.quietMinSec;
  if (next.maxSec < next.minSec) next.maxSec = next.minSec;
  if (next.gapMaxSec < next.gapMinSec) next.gapMaxSec = next.gapMinSec;
  if (next.cooldownMaxSec < next.cooldownMinSec) next.cooldownMaxSec = next.cooldownMinSec;
  if (next.roundMaxSec < next.roundMinSec) next.roundMaxSec = next.roundMinSec;
  if (next.selfMaxSec < next.selfMinSec) next.selfMaxSec = next.selfMinSec;
  if (next.selfRoundMaxSec < next.selfRoundMinSec) next.selfRoundMaxSec = next.selfRoundMinSec;
  return next;
}

export function createAutoArmy({ rand = Math.random, maxRounds = MAX_ROUNDS, startedAt = Date.now() } = {}) {
  let queue = []; // [{ name, dueAt, firstDueAt, episode, cool, limit }]
  let lastDueAt = 0; // kdy byl naplánovaný poslední dohoz (kvůli rozestupu mezi hráči)
  const blockedUntil = new Map(); // jméno -> do kdy se po dohození znovu nezačíná dohazovat (náhodná doba z rozmezí cooldownMin–Max)
  const episodes = new Map(); // jméno -> { phase: 'rescue'|'topup', target, quiet, maxRounds, rounds, minSec, maxSec, gapMinSec, gapMaxSec, cool, limit, startedAt } (jen při dohazování po horní hranici)
  const reloadTried = new Set(); // hráči, u kterých se po nezabraném dohozu už obnovovala stránka armády (jednou na dohazování)
  const watch = new Map(); // jméno -> { sentAt, powerAtSend, reqId }: čeká se na výsledek a účinek posledního dohozu (i bez horní hranice)
  const sentTimes = []; // kdy se dohazovalo (pro hodinovou pojistku)
  const recent = []; // poslední události pro UI
  const total = { sent: 0, skipped: 0, failed: 0 };
  let pageAlertAt = -Infinity;
  const earlyAt = new Map(); // jméno -> kdy rychlá větev naplánovala dohoz (potvrzený alert z pravidel o chvíli později se pak ignoruje)
  let lastFallAt = startedAt; // poslední pád hráče naší rasy pod práh; před prvním pádem čas spuštění (historii před ním neznáme)

  const randRange = (a, b) => a + rand() * (b - a);
  const note = (now, type, name, text = '') => {
    recent.push({ at: now, type, name, text });
    if (recent.length > 12) recent.shift();
  };
  /** Termín dalšího dohozu: náhodná prodleva + odstup od předchozího naplánovaného (dva hráči naráz nikdo neklikne ve stejné vteřině). */
  const dueFor = (now, a) => {
    const due = now + Math.round(randRange(a.minSec, a.maxSec) * 1000);
    if (a.priority) return due; // přednostní dohoz (uživatel sám): bez odstupu od ostatních a ostatním neposouvá termíny
    const at = Math.max(due, lastDueAt + Math.round(randRange(a.gapMinSec ?? 0.9, a.gapMaxSec ?? 2.5) * 1000));
    lastDueAt = at;
    return at;
  };
  const fmt = (n) => Math.round(n).toLocaleString('cs-CZ');
  const doneText = (name, p, ep) => (ep.quiet
    ? `✅ Auto-dohoz: ${name} je zpět nad prahem (síla ${fmt(p)}) po ${ep.rounds}. dohozu.`
    : `✅ Auto-dohoz: ${name} je na ${fmt(p)} (nad hranicí ${fmt(ep.target)}) po ${ep.rounds}. dohozu.`);
  const hasRescue = () => [...episodes.values()].some((e) => e.phase === 'rescue'); // někdo je ještě pod prahem a čeká na záchranu
  const isTop = (q) => !!q.episode && q.episode.phase === 'topup';
  const norm = (s) => String(s ?? '').trim().toLowerCase();
  const isSelf = (auto, name) => !!norm(auto.selfName) && norm(auto.selfName) === norm(name); // jméno uživatele v rase (bez ohledu na velikost písmen)
  /** Síla hráče z čerstvých dat; null = žádná použitelná data (chybí, nečitelná nebo stará) – podle takových se nikdy nedohazuje. Síla 0 je platná (hráče dobyvací útok srazí až na 0 a právě tehdy se dohazuje). */
  const readPower = (name, io) => {
    const p = io.power?.(name);
    return p == null || !Number.isFinite(p) || p < 0 ? null : p;
  };

  /**
   * Alert z hlídání. Naplánuje dohoz jen pro pád pod práh (připomínky „stále pod prahem“ se ignorují),
   * nejvýš jeden čekající na hráče; po předchozím dohození se nový dohoz odloží o náhodnou pauzu (cooldownMinSec–MaxSec).
   * @returns {{scheduled: boolean, dueAt?: number, deferred?: boolean, why?: string}}
   */
  function onAlert(alert, auto, now = Date.now()) {
    if (!auto?.enabled) return { scheduled: false, why: 'off' };
    if (!BELOW_REASONS.has(alert.reason)) return { scheduled: false, why: 'reason' };
    if (alert.repeat) return { scheduled: false, why: 'repeat' }; // připomínka „stále pod prahem“ není nový pád
    if (!alert.early && now - (earlyAt.get(alert.name) ?? -Infinity) < EARLY_DEDUPE_MS) return { scheduled: false, why: 'early' }; // pád už zachytila rychlá větev
    if (queue.some((q) => q.name === alert.name) || episodes.has(alert.name)) return { scheduled: false, why: 'queued' };
    const self = isSelf(auto, alert.name); // přednostní dohoz: rychlejší a jako první, bez odstupu a bez pauzy před opětovným dohozem
    // první pád po klidu (60 min nikdo nespadl) = začátek nového útoku: bot „nebyl připravený“ a dohodí s trochou zpoždění navíc
    const afterQuiet = now - lastFallAt >= QUIET_MS;
    lastFallAt = now;
    if (alert.early) earlyAt.set(alert.name, now);
    let dueAt = self ? now + Math.round(randRange(auto.selfMinSec ?? 0.3, auto.selfMaxSec ?? 1) * 1000) : dueFor(now, auto);
    if (alert.early) dueAt = Math.max(now, dueAt - PIPELINE_MS); // rychlá větev: prodleva se počítá od prvního čtení pod prahem až po kliknutí
    const extra = afterQuiet && !self ? Math.round(randRange(auto.quietMinSec ?? 5, auto.quietMaxSec ?? 15) * 1000) : 0;
    if (extra) { dueAt += extra; lastDueAt = Math.max(lastDueAt, dueAt); }
    // pauza po předchozím dohození: nový pád se NEZAHODÍ, jen se dohoz odloží na konec pauzy (až bude potřeba, ověří se, že je hráč pořád pod prahem)
    const until = self ? undefined : blockedUntil.get(alert.name);
    const deferred = until !== undefined && until > dueAt;
    if (deferred) { dueAt = until + Math.round(randRange(0, 1000)); lastDueAt = Math.max(lastDueAt, dueAt); }
    const cool = self ? [0, 0] : [auto.cooldownMinSec, auto.cooldownMaxSec];
    const limit = auto.maxPerHour ?? 60;
    // cíl dohazování: v režimu „až do horní hranice“ horní hranice, jinak práh hráče (dohazuje se, dokud hráč není nad prahem – jeden dohoz
    // často nestačí). Cíl nikdy nebývá pod prahem hráče, jinak by se skončilo, ještě než je hráč nad prahem.
    const topUp = !!auto.topUp && auto.topUpTarget > 0;
    const thr = Number(alert.threshold);
    const target = Math.max(topUp ? auto.topUpTarget : 0, Number.isFinite(thr) && thr > 0 ? thr : 0);
    const episode = target > 0
      ? { phase: 'rescue', target, quiet: !topUp, maxRounds, rounds: 0, minSec: self ? auto.selfRoundMinSec ?? 0.4 : auto.roundMinSec, maxSec: self ? auto.selfRoundMaxSec ?? 1.2 : auto.roundMaxSec, gapMinSec: auto.gapMinSec, gapMaxSec: auto.gapMaxSec, priority: self, cool, limit, startedAt: now }
      : null;
    if (episode) episodes.set(alert.name, episode);
    queue.push({ name: alert.name, dueAt, firstDueAt: dueAt, episode, cool, limit, priority: self });
    note(now, 'plan', alert.name, `${self ? '⚡ ' : ''}za ${Math.round((dueAt - now) / 100) / 10} s${extra ? ' (první pád po klidu)' : ''}${deferred ? ' (po pauze)' : ''}${episode ? (topUp ? `, pak do ${fmt(episode.target)}` : ` (dohazuje se, dokud není nad ${fmt(episode.target)})`) : ''}`);
    return { scheduled: true, dueAt, deferred };
  }

  /** Dohazování hráče skončilo (cíl, nezabírá, max kol, selhání): úklid a událost. */
  function endEpisode(name, now, type, text, events, notify = false, message = '') {
    episodes.delete(name);
    reloadTried.delete(name);
    watch.delete(name);
    note(now, type, name, text);
    events.push({ type, name, notify, text: message });
  }

  /** Zruší všechno naplánované i rozjeté (vypnutí auto-dohozu, pojistka). */
  function cancelAll(now, why) {
    if (!queue.length && !episodes.size && !watch.size) return;
    for (const n of new Set([...queue.map((q) => q.name), ...episodes.keys(), ...watch.keys()])) note(now, 'cancel', n, why);
    queue = [];
    episodes.clear();
    watch.clear();
  }

  /**
   * Sleduje výsledek a účinek odeslaných dohozů:
   *  - skript hlásí chybu / požadavek nikdo nevyzvedl -> konec se zprávou (ne ticho),
   *  - dokud skript neodeslal, na účinek se nečeká (jinak by drobné kolísání síly vypadalo jako úspěch),
   *  - překonal hranici -> hotovo; vzrostla síla -> další kolo (nebo konec bez horní hranice); nevzrostla -> nezabírá.
   */
  function followUp(now, io, events) {
    for (const [name, w] of [...watch]) {
      const ep = episodes.get(name) ?? null;
      const age = now - w.sentAt;
      const res = w.reqId != null ? io.result?.(w.reqId) : null; // null = neznámý výsledek (třeba už přepsal jiný požadavek) -> rozhoduje jen síla
      if (res?.status === 'error' || res?.status === 'expired') {
        const why = res.status === 'expired' ? 'stránka Rasová armáda požadavek nevyzvedla (je otevřená a viditelná?)' : (res.error || 'skript dohoz neodeslal');
        total.failed++;
        endEpisode(name, now, 'fail', why, events, true, `⚠️ Auto-dohoz: ${name} – dohoz se nepovedl: ${why}.`);
        events[events.length - 1].error = why;
        continue;
      }
      if (res && (res.status === 'pending' || res.status === 'sending')) {
        if (age > STALL_MS + 15_000) endEpisode(name, now, 'stall', 'skript neodpověděl', events, true, `⚠️ Auto-dohoz: ${name} – skript na stránce Rasová armáda neodpověděl, dohazování končí.`);
        continue;
      }
      const p = readPower(name, io);
      if (p == null) {
        if (age > STALL_MS) endEpisode(name, now, 'stall', 'nejsou čerstvá data o síle', events, true, `⚠️ Auto-dohoz: ${name} – nejsou čerstvá data o síle, dohazování končí${ep ? ` po ${ep.rounds}. dohozu` : ''}.`);
        continue;
      }
      const ref = ep ? ep.target : io.threshold?.(name) ?? 0;
      const gain = Math.max(1, Math.round(ref * GAIN_FRACTION));
      if (ep && p >= ep.target) {
        endEpisode(name, now, 'done', `${fmt(p)} po ${ep.rounds}× dohozu`, events, !(ep.quiet && ep.rounds <= 1), doneText(name, p, ep)); // jeden dohoz nad práh je běžná věc, zpráva až když bylo potřeba víc dohozů nebo šlo o horní hranici
      } else if (p > w.powerAtSend + gain) { // dohoz zabral
        reloadTried.delete(name);
        if (!ep) { watch.delete(name); note(now, 'verified', name, `síla ${fmt(p)}`); continue; }
        if (ep.rounds >= ep.maxRounds) {
          endEpisode(name, now, 'max', `bezpečnostní strop ${ep.maxRounds} dohozů, síla ${fmt(p)}`, events, true, `⚠️ Auto-dohoz: ${name} je po ${ep.rounds} dohozech jen na ${fmt(p)} (cíl ${fmt(ep.target)}), dohazování se z bezpečnostních důvodů zastavilo.`);
          continue;
        }
        watch.delete(name);
        const thr = io.threshold?.(name);
        if (ep.phase === 'rescue' && (thr == null || p >= thr)) { // je nad prahem: záchrana hotová, dál už jen k horní hranici
          ep.phase = 'topup';
          note(now, 'rescued', name, `nad prahem (${fmt(p)})`);
        }
        const dueAt = dueFor(now, ep);
        queue.push({ name, dueAt, firstDueAt: dueAt, episode: ep, cool: ep.cool, limit: ep.limit, priority: ep.priority });
        note(now, 'plan', name, `${ep.phase === 'rescue' ? 'nad práh' : 'k hranici'}: kolo ${ep.rounds + 1} za ${Math.round((dueAt - now) / 100) / 10} s (síla ${fmt(p)})`);
      } else if (age > NOGAIN_MS && !reloadTried.has(name) && io.reloadPage) {
        // nezabralo: nejdřív se stránka Rasová armáda obnoví a až potom se znovu vyplní jednotky a hráč a odešle (jednou)
        reloadTried.add(name);
        io.reloadPage();
        watch.delete(name);
        if (ep) ep.rounds = Math.max(0, ep.rounds - 1);
        const dueAt = now + Math.round(randRange(600, 1200));
        queue.push({ name, dueAt, firstDueAt: dueAt, episode: ep, cool: [0, 0], limit: ep?.limit, priority: true });
        note(now, 'reload', name, `síla nevzrostla za ${Math.round(age / 100) / 10} s: obnovuji stránku armády a dohazuji znovu`);
      } else if (age > STALL_MS) {
        endEpisode(name, now, 'stall', `síla ${fmt(p)} nevzrostla`, events, true, `⚠️ Auto-dohoz: ${name} – po dohození síla nevzrostla (${fmt(p)}), dohazování končí. Zkontroluj armádu a stránku Rasová armáda.`);
      }
    }
  }

  /** Hráč, který se při dohazování k horní hranici znovu propadl pod práh, má opět přednost (záchrana). */
  function refreshPhases(now, io) {
    for (const [name, ep] of episodes) {
      if (ep.phase !== 'topup') continue;
      const p = readPower(name, io);
      const thr = io.threshold?.(name);
      if (p != null && thr != null && p < thr) { ep.phase = 'rescue'; note(now, 'rescue', name, `znovu pod prahem (${fmt(p)})`); }
    }
  }

  /**
   * Zpracuje splatné dohazy. io: { stillBelow(name) -> true|false|null, power(name) -> číslo|null, threshold(name) -> číslo|null,
   * result(id) -> {status, error?}|null, request(name) -> {ok, id?, error?} }. null = bez čerstvých dat.
   * `enabled` = je auto-dohoz zapnutý (vypnutí okamžitě zruší naplánované i rozjeté dohazování).
   * @returns události k zalogování: [{type: 'sent'|'skip'|'fail'|'done'|'stall'|'max'|'breaker', name?, error?, page?, notify?, text?}]
   */
  function tick(now, io, enabled = true) {
    const events = [];
    if (!enabled) { cancelAll(now, 'auto-dohoz vypnut'); return events; }
    refreshPhases(now, io);
    followUp(now, io, events);
    // nejdřív záchrana (hráči pod prahem), dohazování k horní hranici až potom; uvnitř skupiny podle termínu
    const due = queue.filter((q) => q.dueAt <= now).sort((a, b) => Number(!!b.priority) - Number(!!a.priority) || Number(isTop(a)) - Number(isTop(b)) || a.dueAt - b.dueAt); // přednostní hráč vždy první
    for (const item of due) {
      const drop = () => { queue = queue.filter((q) => q !== item); };
      const ep = item.episode;
      /** Nejsou použitelná data: nic se naslepo neposílá, chvíli se čeká, pak se hráč vzdá. */
      const noData = () => {
        if (now - item.firstDueAt > GIVE_UP_MS) {
          drop(); total.failed++; episodes.delete(item.name);
          note(now, 'fail', item.name, 'nejsou čerstvá data o síle');
          events.push({ type: 'fail', name: item.name, error: 'nejsou čerstvá data o síle hráče', notify: true, text: `⚠️ Auto-dohoz: ${item.name} – nejsou čerstvá data o síle hráče, dohazování se nepovedlo.` });
        } else item.dueAt = now + Math.round(randRange(500, 1200));
      };
      if (isTop(item) && hasRescue() && !item.priority) { // někdo je ještě pod prahem: ten má přednost, tenhle počká (přednostní hráč nečeká)
        item.dueAt = now + Math.round(randRange(500, 1200));
        continue;
      }
      if (ep && ep.rounds > 0) { // další kolo dohazování: jde jen o to, jestli je pořád pod horní hranicí
        const p = readPower(item.name, io);
        if (p == null) { noData(); continue; }
        if (p >= ep.target) {
          drop();
          endEpisode(item.name, now, 'done', `${fmt(p)} po ${ep.rounds}× dohozu`, events, !(ep.quiet && ep.rounds <= 1), doneText(item.name, p, ep));
          continue;
        }
      } else { // první dohoz: mezitím ho někdo dohodil / vyskočil nad práh / zmizela data
        const below = io.stillBelow(item.name);
        if (below === null) { noData(); continue; }
        if (!below) {
          drop(); total.skipped++; episodes.delete(item.name); note(now, 'skip', item.name, 'už je nad prahem');
          events.push({ type: 'skip', name: item.name });
          continue;
        }
        const streak = io.belowStreak?.(item.name); // kolik čtení dat po sobě je hráč pod prahem (null = neznámo)
        if (streak != null && streak < MIN_BELOW_READINGS) { // jedno čtení nestačí: počká se na druhé (jednorázový výkyv dat dohoz nespustí)
          if (now - item.firstDueAt > GIVE_UP_MS) noData(); else item.dueAt = now + 120;
          continue;
        }
      }
      while (sentTimes.length && sentTimes[0] < now - HOUR_MS) sentTimes.shift();
      if (sentTimes.length >= (item.limit ?? 60)) { // pojistka proti zacyklení: příliš mnoho dohozů za hodinu
        const n = sentTimes.length;
        cancelAll(now, 'pojistka');
        note(now, 'breaker', '', `${n} dohozů za hodinu`);
        events.push({ type: 'breaker', notify: true, text: `⛔ Auto-dohoz vypnut pojistkou: ${n} dohozů za poslední hodinu (limit ${item.limit ?? 60}). Zkontroluj, jestli se něco nezacyklilo, a pak ho znovu zapni.` });
        return events;
      }
      const powerBefore = readPower(item.name, io) ?? 0; // síla těsně před dohozem: podle ní se pozná, že dohoz zabral
      const r = io.request(item.name);
      if (r.ok) {
        drop(); total.sent++; sentTimes.push(now);
        const cool = item.cool ?? ep?.cool ?? [0, 0];
        blockedUntil.set(item.name, now + Math.round(randRange(cool[0], cool[1]) * 1000)); // další samostatné dohazování téhož hráče až po náhodné pauze
        if (ep) ep.rounds += 1;
        watch.set(item.name, { sentAt: now, powerAtSend: powerBefore, reqId: r.id ?? null });
        note(now, 'sent', item.name, ep ? `${ep.rounds}. dohoz` : '');
        events.push({ type: 'sent', name: item.name });
        break; // další až v dalším průchodu: najednou se zadává nejvýš jeden požadavek
      }
      // dohoz nejde zadat hned: předchozí požadavek ještě běží, nebo se stránka armády právě načítá (po odeslání se vrací zpět)
      const busy = /^Ještě se dohazuje/.test(r.error ?? '');
      const page = /^Otevři ve hře/.test(r.error ?? '');
      if ((busy || page) && now - item.firstDueAt <= GIVE_UP_MS) { item.dueAt = now + Math.round(item.priority ? randRange(150, 350) : randRange(500, 1200)); break; }
      drop(); total.failed++; episodes.delete(item.name); watch.delete(item.name);
      note(now, 'fail', item.name, r.error ?? 'neznámá chyba');
      const notify = page ? now - pageAlertAt > PAGE_ALERT_GAP_MS : !busy;
      if (page && notify) pageAlertAt = now;
      events.push({ type: 'fail', name: item.name, error: r.error, page, notify, text: `⚠️ Auto-dohoz: ${r.error}` });
      break;
    }
    return events;
  }

  const snapshot = (now = Date.now()) => ({
    pending: queue.map((q) => ({ name: q.name, inMs: Math.max(0, q.dueAt - now) })),
    topping: [...episodes].map(([name, e]) => ({ name, phase: e.phase, rounds: e.rounds, maxRounds: e.maxRounds, target: e.target, self: !!e.priority })),
    lastHour: sentTimes.filter((t) => t >= now - HOUR_MS).length,
    ...total,
    recent: recent.slice(-6),
  });

  return { onAlert, tick, snapshot };
}
