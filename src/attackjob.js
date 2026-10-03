/**
 * Útok řízený z aplikace: aplikace založí „práci“, skript v otevřené kartě hry ji plní (vybere planetu,
 * vyplní jednotky) a hlásí kroky; odeslání potvrzuje uživatel v aplikaci (nebo samo, je-li zapnuté
 * automatické odeslání). Čistá logika bez I/O, čas se předává zvenku.
 *
 * stavy: opening (čeká na kartu) -> filling -> ready -> submitting -> sent | failed
 *        mimo to cancelled, expired (karta se neozvala), lost (karta zmizela)
 */
const OPEN_TTL_MS = 25_000; // za jak dlouho se musí karta po otevření ozvat
const LOST_MS = 90_000; // jak dlouho smí být karta potichu, než ji prohlásíme za ztracenou (dlouhé dotazování se obnovuje po ~20 s)
const FINAL = new Set(['sent', 'failed', 'cancelled', 'expired', 'lost']);
const STEPS = [
  ['opened', 'Karta s útokem otevřena'],
  ['loaded', 'Stránka útoku načtena'],
  ['planet', 'Planeta cíle vybrána'],
  ['units', 'Jednotky vyplněny'],
  ['ready', 'Připraveno k odeslání'],
];
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const int = (v) => (Number.isInteger(v) && v >= 0 && v < 1e12 ? v : null);

export function createAttackJobs() {
  let job = null;
  let seq = 0;

  const genId = (t) => (t.toString(36) + (++seq).toString(36) + Math.random().toString(36).slice(2, 6)).slice(-12).padStart(8, 'a');

  /** Založí novou práci (předchozí nedokončená se ruší). */
  function start(info, t) {
    if (job && !FINAL.has(job.status)) job.status = 'cancelled';
    job = {
      id: genId(t),
      createdAt: t,
      lastSeen: 0,
      status: 'opening',
      hracId: info.hracId,
      utokId: info.utokId,
      name: str(info.name, 64),
      type: str(info.type, 24),
      power: int(info.power),
      lit: info.lit !== false,
      done: { opened: true },
      summary: null,
      error: '',
      result: null,
      cmd: null,
    };
    return job.id;
  }

  /** Kontrola času: karta se neozvala / zmizela. */
  function tick(t) {
    if (!job || FINAL.has(job.status)) return;
    if (job.status === 'opening' && t - job.createdAt > OPEN_TTL_MS) {
      job.status = 'expired';
      job.error = 'Karta s útokem se neozvala. Je v Tampermonkey zapnutý skript „Útok (D)“ a povolené otevírání oken?';
    } else if (job.lastSeen && ['filling', 'ready'].includes(job.status) && t - job.lastSeen > LOST_MS) {
      job.status = 'lost';
      job.error = 'Karta s útokem přestala odpovídat (zavřená?).';
    }
  }

  const isMine = (id) => job && job.id === id;
  const alive = (id) => isMine(id) && !FINAL.has(job.status);

  /** Hlášení ze skriptu v kartě hry. Vrací false, když práce neexistuje nebo už skončila. */
  function report(id, body, t) {
    if (!isMine(id)) return false;
    job.lastSeen = t;
    const phase = body.phase;
    if (FINAL.has(job.status) && !(job.status === 'failed' && phase === 'sent')) return false;
    switch (phase) {
      case 'loaded':
        job.done.loaded = true;
        job.status = 'filling';
        job.summary = { ...(job.summary ?? {}), target: str(body.target, 80), planetsTotal: int(body.planetsTotal) };
        break;
      case 'planet':
        job.done.planet = true;
        job.summary = { ...(job.summary ?? {}), planet: str(body.planet, 40), planetsTotal: int(body.planetsTotal) ?? job.summary?.planetsTotal ?? null };
        break;
      case 'units':
        job.done.units = true;
        job.summary = { ...(job.summary ?? {}), filled: cleanFilled(body.filled) };
        break;
      case 'ready':
        job.done.ready = true;
        job.status = 'ready';
        job.summary = {
          target: str(body.target, 80) || job.summary?.target || '',
          planet: str(body.planet, 40),
          planetsTotal: int(body.planetsTotal) ?? job.summary?.planetsTotal ?? null,
          filled: cleanFilled(body.filled),
          problems: cleanList(body.problems),
        };
        break;
      case 'submitting':
        job.status = 'submitting';
        break;
      case 'sent':
        job.status = 'sent';
        job.result = { text: str(body.result, 300), stillForm: !!body.stillForm };
        break;
      case 'failed':
        job.status = 'failed';
        job.error = str(body.error, 200) || 'Útok se nepodařilo připravit.';
        if (typeof body.result === 'string') job.result = { text: str(body.result, 300), stillForm: true };
        if (Array.isArray(body.problems)) job.summary = { ...(job.summary ?? {}), problems: cleanList(body.problems) };
        break;
      default:
        return false;
    }
    return true;
  }

  const cleanList = (l) => (Array.isArray(l) ? l.slice(0, 10).map((x) => str(String(x ?? ''), 160)) : []);
  const cleanFilled = (l) =>
    Array.isArray(l)
      ? l.slice(0, 20).map((f) => ({
          name: str(f?.name, 64),
          value: f?.value === 'max' ? 'max' : int(Number(f?.value)),
          sent: Number.isFinite(Number(f?.sent)) ? Number(f.sent) : null,
          available: Number.isFinite(Number(f?.available)) ? Number(f.available) : null,
        }))
      : [];

  /** Příkaz z aplikace: submit | reroll | cancel. */
  function command(cmd, t) {
    if (!job || FINAL.has(job.status)) return { ok: false, error: 'Žádný útok se nepřipravuje.' };
    if (cmd === 'cancel') {
      job.status = 'cancelled';
      job.cmd = 'cancel'; // skript si ho vyzvedne a zavře kartu
      return { ok: true };
    }
    if (job.status !== 'ready') return { ok: false, error: 'Útok ještě není připravený.' };
    if (cmd === 'submit') { job.status = 'submitting'; job.cmd = 'submit'; return { ok: true }; }
    if (cmd === 'reroll') { job.status = 'filling'; job.cmd = 'reroll'; job.done.ready = false; return { ok: true }; }
    return { ok: false, error: 'Neznámý příkaz.' };
  }

  /** Skript se ptá na příkaz. cmd se vydá jen jednou. ok:false = práce už neexistuje / skončila. */
  function poll(id, t) {
    if (!isMine(id)) return { ok: false, cmd: null };
    job.lastSeen = t;
    const cmd = job.cmd;
    job.cmd = null;
    if (FINAL.has(job.status) && cmd !== 'cancel') return { ok: false, cmd: null };
    return { ok: true, cmd };
  }

  /** Pohled pro aplikaci. */
  function snapshot(t) {
    tick(t);
    if (!job) return null;
    return {
      id: job.id,
      status: job.status,
      final: FINAL.has(job.status),
      name: job.name,
      type: job.type,
      power: job.power,
      lit: job.lit,
      hracId: job.hracId,
      utokId: job.utokId,
      steps: STEPS.map(([key, label]) => ({ key, label, done: !!job.done[key] })),
      summary: job.summary,
      error: job.error,
      result: job.result,
      ageMs: t - job.createdAt,
    };
  }

  return { start, report, command, poll, snapshot, isAlive: alive, tick };
}
