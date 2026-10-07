/**
 * Statistika dohozů: každé „dohazování“ jednoho hráče = jedna epizoda (od pádu pod práh po návrat nad něj / selhání), v ní jednotlivá kola
 * (každé odeslání jednotek). U každého kola se pamatuje, kdo ho spustil (auto-dohoz, nebo tlačítko Dohodit), kdy se zadalo, kdy skript
 * skutečně odeslal a za jak dlouho se síla zvedla. Čistá logika bez I/O (ukládání dělá volající přes onChange); drží jen posledních `keep`
 * hotových epizod, takže paměť i soubor zůstávají malé.
 *
 * Časy (ms): belowMs = pád pod práh -> první čtení nad prahem; firstSendMs = pád -> první odeslání; round.sendMs = zadání -> odeslání skriptem;
 * round.effectMs = odeslání -> první čtení se zvýšenou silou (jak rychle dohoz „zabral“ v datech).
 */
const IDLE_END_MS = 60_000; // epizoda bez dalšího dění po tuto dobu se ukončí (ruční dohoz nemá jiný signál konce)
const DONE_GRACE_MS = 3_000; // po návratu nad práh se ještě chvíli počká, jestli nepřijde další kolo (dohazování k horní hranici)
const GAIN_FRACTION = 0.001; // „síla vzrostla“ = o víc než 0,1 % prahu (stejně jako v auto-dohozu)

export const OUTCOMES = ['done', 'stall', 'fail', 'max', 'cancelled', 'unknown'];

export function createDohozStats({ keep = 200, saved = [], onChange = () => {} } = {}) {
  let limit = keep;
  let episodes = (Array.isArray(saved) ? saved : []).filter((e) => e && e.id && e.name).slice(0, limit); // hotové, nejnovější první
  let seq = episodes.reduce((m, e) => Math.max(m, e.id), 0);
  const open = new Map(); // jméno -> epizoda (rozdělaná)
  const byReq = new Map(); // id požadavku v army.js -> { ep, round }
  let rev = 0; // změní se při každé změně (rozhraní podle něj ví, že má stáhnout nová data)

  const touch = () => { rev++; };
  const persist = () => { onChange(episodes); };

  /** Nové kolo (požadavek na dohoz byl zadán). Pokud pro hráče běží epizoda, kolo se přidá do ní, jinak vznikne nová. */
  function requestStarted({ name, source, at, id = null, powerBefore = null, fallAt = null, threshold = null, target = null }) {
    let ep = open.get(name);
    if (!ep) {
      ep = { id: ++seq, name, source, fallAt, fallPower: powerBefore, threshold, target, startedAt: at, lastAt: at, rounds: [], recoveredAt: null, belowMs: null, firstSendMs: null, totalMs: null, endAt: null, outcome: null, mixed: false };
      open.set(name, ep);
    }
    if (ep.source !== source) ep.mixed = true;
    if (threshold != null) ep.threshold = threshold;
    if (target != null) ep.target = Math.max(ep.target ?? 0, target);
    const round = { n: ep.rounds.length + 1, source, reqAt: at, sentAt: null, sendMs: null, powerBefore, powerAfter: null, gain: null, effectAt: null, effectMs: null, status: 'pending', reloaded: false, error: '' };
    ep.rounds.push(round);
    ep.lastAt = at;
    if (id != null) byReq.set(id, { ep, round });
    touch();
    return ep.id;
  }

  /** Skript na stránce Rasová armáda odeslal formulář. */
  function sent(id, at) {
    const x = byReq.get(id); if (!x) return;
    const { ep, round } = x;
    round.sentAt = at; round.sendMs = at - round.reqAt; round.status = 'sent';
    if (ep.firstSendMs == null) ep.firstSendMs = ep.fallAt != null ? at - ep.fallAt : at - ep.startedAt;
    ep.lastAt = at;
    touch();
  }

  /** Skript dohoz neodeslal (chyba) – kolo skončilo neúspěchem. */
  function failed(id, at, error = '') {
    const x = byReq.get(id); if (!x) return;
    x.round.status = 'failed'; x.round.error = String(error).slice(0, 160); x.ep.lastAt = at;
    byReq.delete(id);
    touch();
  }

  /** Skript vrátil požadavek k novému vyzvednutí (stránka byla zastaralá a obnovuje se). */
  function retried(id, at) {
    const x = byReq.get(id); if (!x) return;
    x.round.reloaded = true; x.ep.lastAt = at;
    touch();
  }

  /** Auto-dohoz po nezabraném dohozu nechal stránku obnovit a dohazuje znovu: poslední kolo se označí. */
  function reloaded(name, at) {
    const ep = open.get(name); const r = ep?.rounds[ep.rounds.length - 1];
    if (!r) return;
    r.reloaded = true; r.status = r.status === 'sent' ? 'noeffect' : r.status; ep.lastAt = at;
    touch();
  }

  /** Nová data o síle hráče: zaznamená účinek odeslaného kola a návrat nad práh. */
  function power(name, value, at) {
    const ep = open.get(name);
    if (!ep || !Number.isFinite(value)) return;
    const r = [...ep.rounds].reverse().find((x) => x.sentAt != null && x.effectAt == null && (x.status === 'sent' || x.status === 'noeffect'));
    if (r) {
      const eps = Math.max(1, Math.round((ep.threshold ?? 0) * GAIN_FRACTION));
      if (r.powerBefore != null && value > r.powerBefore + eps) {
        r.powerAfter = value; r.gain = value - r.powerBefore; r.effectAt = at; r.effectMs = at - r.sentAt; r.status = 'ok';
        ep.lastAt = at; touch();
      }
    }
    if (ep.recoveredAt == null && ep.threshold != null && value >= ep.threshold) {
      ep.recoveredAt = at; ep.belowMs = ep.fallAt != null ? at - ep.fallAt : null;
      ep.lastAt = at; touch();
    }
  }

  /** Dohazování hráče skončilo. */
  function end(name, at, outcome, note = '') {
    const ep = open.get(name); if (!ep) return;
    open.delete(name);
    for (const [k, v] of byReq) if (v.ep === ep) byReq.delete(k);
    const last = [...ep.rounds].reverse().find((r) => r.sentAt != null);
    ep.endAt = at;
    ep.outcome = OUTCOMES.includes(outcome) ? outcome : 'unknown';
    ep.note = String(note).slice(0, 160);
    ep.totalMs = ep.recoveredAt != null ? ep.recoveredAt - (ep.fallAt ?? ep.startedAt) : (last ? last.sentAt - (ep.fallAt ?? ep.startedAt) : null);
    for (const r of ep.rounds) if (r.status === 'pending' || r.status === 'sent') r.status = r.sentAt != null && r.effectAt == null ? 'noeffect' : r.status;
    episodes = [ep, ...episodes].slice(0, limit);
    touch(); persist();
  }

  /** Úklid rozdělaných epizod: po návratu nad práh (chvíli po něm) a po delším tichu se ukončí. */
  function sweep(now) {
    for (const [name, ep] of [...open]) {
      if (ep.recoveredAt != null && now - ep.lastAt > DONE_GRACE_MS) end(name, now, 'done');
      else if (now - ep.lastAt > IDLE_END_MS) end(name, now, ep.recoveredAt != null ? 'done' : (ep.rounds.some((r) => r.sentAt != null) ? 'stall' : 'fail'), 'bez dalšího dění');
    }
  }

  const setKeep = (n) => { limit = Math.max(20, Math.min(1000, Math.floor(n) || 200)); if (episodes.length > limit) { episodes = episodes.slice(0, limit); persist(); touch(); } };
  const clear = () => { episodes = []; touch(); persist(); };
  /** Hotové epizody (nejnovější první) + rozdělané (nahoře, označené open: true). */
  const snapshot = () => ({ rev, keep: limit, open: [...open.values()].map((e) => ({ ...e, open: true })), episodes });

  return { requestStarted, sent, failed, retried, reloaded, power, end, sweep, setKeep, clear, snapshot, hasOpen: (name) => open.has(name), get rev() { return rev; } };
}

const median = (a) => { const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

/** Filtr epizod: source = auto | manual | mixed (kdo dohazoval), name = část jména, outcome = ok | bad | konkrétní výsledek, sinceMs = od kdy (čas pádu/zadání), slowMs = jen s prvním dohozem pomalejším. */
export function filterEpisodes(list, q = {}) {
  const name = String(q.name ?? '').trim().toLowerCase();
  return list.filter((e) => {
    if (q.source === 'auto' && !(e.source === 'auto' && !e.mixed)) return false;
    if (q.source === 'manual' && !(e.source === 'manual' && !e.mixed)) return false;
    if (q.source === 'mixed' && !e.mixed) return false;
    if (name && !e.name.toLowerCase().includes(name)) return false;
    if (q.outcome === 'ok' && e.outcome !== 'done') return false;
    if (q.outcome === 'bad' && !['stall', 'fail', 'max'].includes(e.outcome)) return false;
    if (q.outcome && !['ok', 'bad'].includes(q.outcome) && e.outcome !== q.outcome) return false;
    if (Number(q.sinceMs) > 0 && (e.fallAt ?? e.startedAt) < Number(q.sinceMs)) return false;
    if (Number(q.slowMs) > 0 && !((e.firstSendMs ?? 0) >= Number(q.slowMs))) return false;
    return true;
  });
}

/** Souhrn pro přehled: počty, podíl automatu, mediány a nejhorší hodnoty z (už vyfiltrovaných) epizod. */
export function summarize(list) {
  const rounds = list.flatMap((e) => e.rounds ?? []);
  const sentRounds = rounds.filter((r) => r.sentAt != null);
  return {
    episodes: list.length,
    rounds: rounds.length,
    auto: rounds.filter((r) => r.source === 'auto').length,
    manual: rounds.filter((r) => r.source === 'manual').length,
    ok: list.filter((e) => e.outcome === 'done').length,
    bad: list.filter((e) => ['stall', 'fail', 'max'].includes(e.outcome)).length,
    belowMedian: median(list.map((e) => e.belowMs)),
    belowMax: Math.max(0, ...list.map((e) => e.belowMs ?? 0)) || null,
    firstSendMedian: median(list.map((e) => e.firstSendMs)),
    firstSendMax: Math.max(0, ...list.map((e) => e.firstSendMs ?? 0)) || null,
    sendMedian: median(sentRounds.map((r) => r.sendMs)),
    effectMedian: median(rounds.map((r) => r.effectMs)),
    reloads: rounds.filter((r) => r.reloaded).length,
  };
}
