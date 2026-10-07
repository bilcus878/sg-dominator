import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { loadConfig, saveConfig as saveConfigRaw, normalizeConfig, sanitizeUpdate, publicConfig, DATA_DIR, LEGACY_DATA_DIR, USING_DEFAULT_DIR } from './config.js';
import { migrateLegacyData } from './migrate.js';
import { createState, evaluate, rebaseline } from './rules.js';
import { formatAlert, sendText, sendService, findTelegramChats, notifyOn, sendStatus } from './notifiers.js';
import { openDb } from './db.js';
import { createStore } from './store.js';
import { createOpTracker } from './op.js';
import { resolveWatch } from './watch.js';
import { createWatchdog, watchItems } from './watchdog.js';
import { BUILDINGS, createBuildRun } from './build.js';
import { createTelescope } from './telescope.js';
import { createHunt } from './ophunt.js';
import { createConquest, CONQUEST_DEFAULTS } from './conquest.js';
import { createArmy } from './army.js';
import { createUnemp } from './unemp.js';
import { createRecalc } from './recalc.js';
import { createEcon } from './econ.js';
import { createAutoArmy } from './autodohoz.js';
import { pushShared, ensureDataRepo, pullData, migrateLegacyFiles, DATA_BRANCH } from './gitshare.js';
import { createDohozStats, summarize, filterEpisodes } from './dohoz-stats.js';
import { mergeRecalc, mergeEcon, sharedFileName, buildShared, sameShared, readAllShared, writeShared } from './shared-data.js';
import { DEFAULT_PROFILES, validName, buildProfile, mergeProfileConfig, sameContent, readProfile, writeProfile, listProfiles, cleanUi } from './profiles.js';
import { mergeSeenUnits, sanitizeReport, sanitizeSeenUnits, unitsFor, ATTACK_TYPES } from './attack.js';

// data bydlela dřív ve složce projektu (Dropbox); při prvním spuštění se přesunou mimo ni
if (USING_DEFAULT_DIR) migrateLegacyData(LEGACY_DATA_DIR, DATA_DIR);
let cfg = loadConfig();
/** Uložení nastavení; po každé změně se (když je zapnuto) aktualizuje i profil v repozitáři. */
function saveConfig(c) { saveConfigRaw(c); scheduleProfileSave(); }
if (process.env.SG_PORT) cfg.port = Number(process.env.SG_PORT);
const state = createState();
const conquest = createConquest(); // cizí rasy: kdo je k dobytí
const army = createArmy(); // tlačítko Dohodit -> skript na stránce Rasová armáda
let armyWaiters = [];
const wakeArmy = () => { for (const f of armyWaiters.splice(0)) f(); };
const autoArmy = createAutoArmy(); // pád vlastního hráče pod práh -> po náhodné prodlevě sám požadavek Dohodit
const DATA_FRESH_MS = 10_000; // data rasy starší než tohle (okno se zavřelo / zpomalilo) se pro dohazování nepoužijí
/** Hráč z čerstvých dat; null = žádná použitelná data (neznámý hráč, stará nebo nečitelná data). Síla 0 je platná: dobyvací útok hráče srazí až na 0 a právě tehdy se dohazuje. */
function freshPlayer(name) {
  const raceId = playerRace.get(name);
  if (!raceId) return null;
  const now = Date.now();
  const snap = store.snapshot(raceId, now);
  const p = snap.players.find((x) => x.name === name);
  if (!p || now - (p.seenAt ?? snap.at ?? 0) > DATA_FRESH_MS) return null; // čerstvost se měří za konkrétního hráče (jeho stránku může posílat jiné okno než zbytek rasy)
  return Number.isFinite(p.power) && p.power >= 0 ? { raceId, p } : null;
}
/**
 * Sleduje, kolik čtení dat po sobě je hráč naší rasy pod prahem, a zachytí PÁD (nad -> pod) hned při prvním čtení: auto-dohoz se naplánuje
 * hned (prodleva se počítá od prvního čtení, ne až od potvrzeného alertu o 1–2 s později). Před odesláním se stejně vyžadují dvě čtení pod prahem
 * (belowStreak) a čerstvé ověření stillBelow, takže jednorázový výkyv dat dohoz nespustí.
 */
const belowState = new Map(); // jméno -> { below, streak, countedAt }
function trackBelow(list, raceId, now) {
  for (const p of list) {
    if (!p.watched || !(p.threshold > 0) || !Number.isFinite(p.power)) { belowState.delete(p.name); continue; }
    const below = p.power < p.threshold;
    const st = belowState.get(p.name);
    if (!st) { belowState.set(p.name, { below, streak: below ? 1 : 0, countedAt: now, since: below ? now : null }); continue; } // první čtení: nevíme, jestli jde o pád
    if (!below) { st.below = false; st.streak = 0; st.countedAt = now; continue; }
    if (!st.below) { // přechod nad -> pod prahem = pád
      st.below = true; st.streak = 1; st.countedAt = now; st.since = now;
      const auto = cfg.army.auto;
      if (auto.enabled) {
        const own = cfg.players[p.name]?.topTarget;
        autoArmy.onAlert({ name: p.name, power: p.power, prev: null, reason: 'threshold', threshold: p.threshold, critical: p.critical, repeat: false, early: true, race: cfg.races[raceId]?.name }, own != null ? { ...auto, topUpTarget: own } : auto, now);
      }
    } else if (now - st.countedAt >= 400) { st.streak += 1; st.countedAt = now; } // další čtení (dvě okna v téže vteřině se nepočítají dvakrát)
  }
}
// statistika dohozů (posledních N dohazování; ukládá se mimo repozitář)
const STATS_PATH = join(DATA_DIR, 'dohoz-stats.json');
let statsSaveTimer = null;
const dohozStats = createDohozStats({
  keep: cfg.dohozStats.keep,
  saved: (() => { try { return JSON.parse(readFileSync(STATS_PATH, 'utf8')); } catch { return []; } })(),
  onChange: (episodes) => {
    clearTimeout(statsSaveTimer);
    statsSaveTimer = setTimeout(() => {
      try { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(`${STATS_PATH}.tmp`, JSON.stringify(episodes)); renameSync(`${STATS_PATH}.tmp`, STATS_PATH); }
      catch (e) { console.error('statistika dohozů se neuložila:', e.message); }
    }, 3000);
  },
});
const statsOn = () => !!cfg.dohozStats.enabled;
/** Zaznamená zadání dohozu (auto-dohoz i tlačítko) do statistiky: síla před dohozem, kdy hráč spadl pod práh, práh. */
function statsRequest(name, source, reqId) {
  if (!statsOn()) return;
  const f = freshPlayer(name);
  const raceId = f?.raceId ?? playerRace.get(name);
  const threshold = raceId ? resolveWatch(cfg, raceId, name).threshold : null;
  const b = belowState.get(name);
  dohozStats.requestStarted({ name, source, at: Date.now(), id: reqId ?? null, powerBefore: f?.p.power ?? null, fallAt: b?.below ? b.since ?? null : null, threshold: threshold > 0 ? threshold : null });
}
const autoArmyIo = {
  belowStreak(name) { return belowState.get(name)?.streak ?? null; },
  /** Je hráč pořád pod prahem? true/false, null = bez čerstvých dat (podle starých dat se nedohazuje). */
  stillBelow(name) {
    const f = freshPlayer(name);
    return f ? f.p.power < resolveWatch(cfg, f.raceId, name).threshold : null;
  },
  /** Práh hráče (od něj je „pod prahem“): hráč nejdřív musí nad něj, teprve pak se dohazuje k horní hranici. */
  threshold(name) {
    const raceId = playerRace.get(name);
    return raceId ? resolveWatch(cfg, raceId, name).threshold : null;
  },
  /** Aktuální síla hráče z čerstvých dat (pro dohazování až po horní hranici); null = bez čerstvých dat. */
  power(name) {
    return freshPlayer(name)?.p.power ?? null;
  },
  /** Výsledek požadavku podle jeho id (pending/sending/sent/error/expired); null = už ho přepsal jiný požadavek. */
  result(id) {
    const r = army.status().req;
    return r && r.id === id ? { status: r.status, error: r.error } : null;
  },
  /** Dohoz nezabral: stránka Rasová armáda se nechá obnovit (po odhlášení/přihlášení bývá zastaralá). */
  reloadPage(name) { if (statsOn() && name) dohozStats.reloaded(name, Date.now()); army.requestReload(); console.log('[dohodit] nezabralo: obnovuji stránku Rasová armáda'); wakeArmy(); },
  request(name) {
    const r = army.request(name);
    if (r.ok) { console.log(`[dohodit] auto: ${name}`); statsRequest(name, 'auto', r.id); wakeArmy(); }
    return r;
  },
};
/**
 * Zprávy auto-dohozu (selhání, pojistka, dohoz po několika kolech…) jdou JEN do servisního chatu (soukromě pro uživatele).
 * Do hlavní skupiny se o automatu nikdy nic neposílá, ať to v chatu vypadá, že dohazuje člověk. Bez nastaveného servisního chatu
 * se neposílá nic (stav je vidět v aplikaci a v logu).
 */
function sendDohoz(text) {
  sendService(cfg, text);
}
/**
 * Občan nemůže dohazovat: když je moje jméno (Dohoz → Moje jméno v rase) ve hře vedené jako občan (modré jméno), auto-dohoz se pozastaví
 * a rozběhne se sám, až bude hodnost zase ministr/zástupce/vůdce. Neznámá hodnost (žádná data) nepozastavuje.
 */
let rankPaused = false;
function ownRankIsCitizen() {
  const me = cfg.army.auto.selfName;
  const raceId = me && playerRace.get(me);
  if (!raceId) return false;
  return store.snapshot(raceId, Date.now()).players.find((x) => x.name === me)?.rank === 'obcan';
}
/**
 * Výstraha ve chvíli, kdy přijdu o hodnost: velká zpráva do servisního chatu hned, opakuje se každých 10 min, dokud hodnost není zpět,
 * a když odeslání selže (Telegram nedostupný), zkouší se dál po 30 s. Posílá se i když je auto-dohoz vypnutý (bez hodnosti nejde dohazovat ani ručně).
 */
const RANK_REMIND_MS = 10 * 60_000, RANK_RETRY_MS = 30_000;
let rankLostAt = 0, rankNextWarn = 0, rankWarnBusy = false;
function rankWarning(now) {
  const mins = Math.round((now - rankLostAt) / 60_000);
  const first = rankNextWarn === rankLostAt;
  return `🚨🚨🚨 POZOR! ${first ? 'ZTRATIL JSI HODNOST' : `STÁLE BEZ HODNOSTI (už ${mins} min)`}: jsi OBČAN (modré jméno), a občan NEMŮŽE POSÍLAT ARMÁDU!\n`
    + (cfg.army.auto.enabled ? '⛔ AUTO-DOHOZ JE ZASTAVENÝ pro všechny hráče, nikdo se nedohodí, dokud si hodnost nevrátíš (ministr/zástupce/vůdce).' : 'Dohazovat nejde ani ručně, dokud si hodnost nevrátíš.')
    + '\nAuto-dohoz se po návratu hodnosti rozběhne sám.';
}
function rankTick(now) {
  const citizen = ownRankIsCitizen();
  if (citizen !== rankPaused) {
    rankPaused = citizen;
    console.log(`[dohodit] ${citizen ? 'POZOR: ztráta hodnosti (občan), auto-dohoz pozastaven' : 'hodnost je zpět, auto-dohoz znovu běží'}`);
    if (citizen) { rankLostAt = now; rankNextWarn = now; } // varování se odešle níže
    else {
      rankNextWarn = 0;
      sendService(cfg, `✅ Hodnost je zpět${cfg.army.auto.enabled ? ', auto-dohoz znovu běží' : ''}.`, console, { critical: true });
    }
    pushState();
  }
  if (rankPaused && now >= rankNextWarn && !rankWarnBusy) {
    rankWarnBusy = true;
    const text = rankWarning(now);
    sendService(cfg, text, console, { critical: true }).then((r) => {
      rankNextWarn = r.sent > 0 || r.total === 0 ? now + RANK_REMIND_MS : now + RANK_RETRY_MS; // nic se neposílá (není chat/ztlumeno) = nezkoušet dokola; selhání = zkusit brzy znovu
    }).catch(() => { rankNextWarn = now + RANK_RETRY_MS; }).finally(() => { rankWarnBusy = false; });
  }
}
setInterval(() => {
  rankTick(Date.now());
  if (statsOn()) dohozStats.sweep(Date.now());
  for (const ev of autoArmy.tick(Date.now(), autoArmyIo, !!cfg.army.auto.enabled && !rankPaused)) {
    if (statsOn() && ev.name && ['done', 'stall', 'max', 'fail'].includes(ev.type)) dohozStats.end(ev.name, Date.now(), ev.type, ev.type === 'done' ? '' : String(ev.error ?? ev.text ?? '').slice(0, 160));
    if (ev.type === 'fail') console.log(`[dohodit] auto selhal (${ev.name}): ${ev.error}`);
    else if (['done', 'stall', 'max', 'breaker'].includes(ev.type)) console.log(`[dohodit] auto ${ev.type}: ${ev.name ?? ''} ${ev.text ?? ''}`);
    if (ev.type === 'breaker') { // pojistka: auto-dohoz se vypne i v nastavení, ať je to vidět a nezapne se samo
      cfg.army = { ...cfg.army, auto: { ...cfg.army.auto, enabled: false } };
      saveConfig(cfg);
      pushState();
    }
    if ((ev.notify || ev.type === 'done') && ev.text) sendDohoz(ev.text); // hotový dohoz se hlásí vždy (i po jediném); vypíná se spolu se systémovými zprávami
  }
}, 100);
const armyWait = (ms) => new Promise((ok) => { const t = setTimeout(ok, Math.max(0, ms)); armyWaiters.push(() => { clearTimeout(t); ok(); }); });
const store = createStore();
const op = createOpTracker();
let opLastAt = 0;
const lastWritten = new Map();
const watchdog = createWatchdog();
/** Přepočty, které se mají u hráče ukázat (podle Nastavení → Data: zapnuté druhy a nejvyšší stáří). */
function recalcShown(raceId, name, now) {
  const rc = cfg.recalc;
  const cutoff = rc.hideOlderDays > 0 ? now - rc.hideOlderDays * 86_400_000 : 0;
  let m = rc.showMilitary ? recalc.of(raceId, name) : { recalcAt: null, recalcHour: null };
  if (m.recalcAt && m.recalcAt < cutoff) m = { recalcAt: null, recalcHour: null };
  let o = rc.showEconomic ? econ.of(raceId, name) : { econAt: null, econUsual: null, econEvents: null };
  if (o.econAt && o.econAt < cutoff) o = { econAt: null, econUsual: null, econEvents: null };
  return { ...m, ...o };
}
const raceLastAt = new Map(); // raceId -> čas posledních dat (nezávisle na pročišťování store)
const playerRace = new Map(); // jméno -> raceId (pro přepočet prahů po změně konfigurace)
// historie planet pro stavění (spokojenost, co už bylo postaveno) – mimo konfiguraci, může být velká
// přepočty hráčů (vynulování „Dobyt“): hodina přepočtu se pamatuje i po restartu
const RECALC_PATH = join(DATA_DIR, 'recalc.json');
function saveRecalcFile(rec) {
  try { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(`${RECALC_PATH}.tmp`, JSON.stringify(rec)); renameSync(`${RECALC_PATH}.tmp`, RECALC_PATH); }
  catch (e) { console.error('přepočty se neuložily:', e.message); }
}
const recalcRec = (() => { try { return JSON.parse(readFileSync(RECALC_PATH, 'utf8')); } catch { return {}; } })(); // živý objekt (sdílí se s createRecalc; sloučení z cizích souborů ho mění na místě)
const recalc = createRecalc(recalcRec, { onChange: (rec) => { saveRecalcFile(rec); sharedDirty = true; } });
// ekonomický přepočet hráčů (odhad z růstu populace, online a přibytých planet z mateřských lodí), pamatuje se i po restartu
const ECON_PATH = join(DATA_DIR, 'econ.json');
function saveEconFile(rec) {
  try { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(`${ECON_PATH}.tmp`, JSON.stringify(rec)); renameSync(`${ECON_PATH}.tmp`, ECON_PATH); }
  catch (e) { console.error('ekonomické přepočty se neuložily:', e.message); }
}
const econRec = (() => { try { return JSON.parse(readFileSync(ECON_PATH, 'utf8')); } catch { return {}; } })();
const econ = createEcon(econRec, { onChange: (rec) => { saveEconFile(rec); sharedDirty = true; } });
let sharedDirty = false; // vlastní data se změnila od posledního zápisu do sdíleného souboru
const LEDGER_PATH = join(DATA_DIR, 'build-planets.json');
const ledger = (() => {
  try { return { planets: JSON.parse(readFileSync(LEDGER_PATH, 'utf8')).planets ?? {} }; } catch { return { planets: {} }; }
})();
let ledgerTimer;
function saveLedger() {
  clearTimeout(ledgerTimer);
  ledgerTimer = setTimeout(() => {
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(`${LEDGER_PATH}.tmp`, JSON.stringify({ planets: ledger.planets }));
      renameSync(`${LEDGER_PATH}.tmp`, LEDGER_PATH);
    } catch (e) { console.error('historie planet se neuložila:', e.message); }
  }, 500);
}
// stavění (dostavěno, zastaveno…) je systémová věc: jen do servisního chatu, do hlavní skupiny nikdy
const build = createBuildRun({ notify: (t) => { console.log(`[stavění] ${t}`); sendService(cfg, t); }, ledger, onLedger: saveLedger });
const db = openDb();
const ingestTimes = []; // časy posledních příjmů pro výpočet frekvence
const raceIngest = new Map(); // raceId -> časy posledních příjmů (pro frekvenci za jednotlivou rasu)

const pub = (f) => new URL(`../${f}`, import.meta.url);

function authOk(req) {
  const got = Buffer.from(String(req.headers['x-token'] ?? ''));
  const want = Buffer.from(cfg.token);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function readJson(req, limit = 256 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('payload too large'), { status: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('invalid json'), { status: 400 });
  }
}

function parsePlayers(body) {
  if (!Array.isArray(body.players) || body.players.length > 500) return null;
  const out = [];
  for (const p of body.players) {
    const power = Number(p?.power);
    if (typeof p?.name !== 'string' || !p.name || p.name.length > 64 || !Number.isFinite(power) || power < 0) return null;
    const q = { name: p.name.trim(), power: Math.round(power) };
    // počet planet a jeho změna ze hry jsou nepovinné (starší userscript je neposílá)
    if (Number.isInteger(p.planets) && p.planets >= 0 && p.planets < 1e6) q.planets = p.planets;
    if (Number.isInteger(p.dobyt) && p.dobyt >= 0 && p.dobyt < 1e5) q.dobyt = p.dobyt; // sloupec Dobyt (vynulování = přepočet)
    if (Number.isFinite(p.population) && p.population >= 0 && p.population < 1e15) q.population = Math.round(p.population); // sloupec Populace (růst = ekonomický přepočet)
    if (Number.isInteger(p.planetsDelta) && Math.abs(p.planetsDelta) < 1e6) q.planetsDelta = p.planetsDelta;
    if (['vudce', 'zastupce', 'ministr', 'obcan'].includes(p.rank)) q.rank = p.rank; // hodnost (barva jména ve hře)
    if (typeof p.online === 'boolean') q.online = p.online; // zelená tečka ve hře
    if (typeof p.attackable === 'boolean') q.attackable = p.attackable; // sloupec Útok ve hře (false = „nelze“)
    if (Number.isInteger(p.hracId) && p.hracId > 0 && p.hracId < 1e12) q.hracId = p.hracId; // id hráče z odkazu D (utok.php?hrac_id=…)
    if (Number.isInteger(p.utokId) && p.utokId > 0 && p.utokId < 100) q.utokId = p.utokId;
    if (Array.isArray(p.attacks)) { // všechny druhy útoku jako ve hře (D P Z U N L S T): písmeno, id útoku, svítí = jde zahájit
      const at = p.attacks.slice(0, 12).filter((a) => /^[A-Z]$/.test(a?.t) && Number.isInteger(a.id) && a.id > 0 && a.id < 100).map((a) => ({ t: a.t, id: a.id, ok: !!a.ok }));
      if (at.length) q.attacks = at;
    }
    out.push(q);
  }
  return out;
}

const raceRole = (id) => cfg.races[id]?.role ?? 'defend';
/** Hranice „k dobytí“ pro rasu: její vlastní, jinak společné z Nastavení; konec nikdy pod začátkem. */
function conquestFor(id) {
  const c = { ...CONQUEST_DEFAULTS, ...cfg.conquest, ...(cfg.races[id]?.conquest ?? {}) };
  if (c.above < c.below) c.above = c.below;
  return c;
}

/** Co o sobě hlásí skript Síla hráčů: verze a ukázka buňky D, když v ní nenašel hrac_id. Do logu jen při změně. */
const scriptInfo = new Map(); // raceId -> { ver, dDebug }
function noteScript(raceId, body) {
  const ver = typeof body.ver === 'string' ? body.ver.slice(0, 16) : '(stará, bez čísla)';
  const dDebug = typeof body.dDebug === 'string' ? body.dDebug.slice(0, 500) : '';
  const prev = scriptInfo.get(raceId);
  if (prev?.ver === ver && prev?.dDebug === dDebug) return;
  scriptInfo.set(raceId, { ver, dDebug });
  console.log(`[skript] rasa ${raceId}: Síla hráčů ${ver}${dDebug ? ` | D bez hrac_id, buňka: ${dDebug}` : ''}`);
}

/** Rasu při prvním výskytu zaregistruje jako vypnutou (hlídání zapneš v jejím panelu). */
function registerRace(raceId, name) {
  const rec = cfg.races[raceId];
  if (!rec) {
    cfg.races[raceId] = {
      name: name || `Rasa #${raceId}`,
      mode: 'off', // nová rasa se nehlídá, dokud ji nezapneš
      role: cfg.myRace && raceId === cfg.myRace ? 'defend' : 'attack', // nová rasa je cizí (k dobytí), kromě naší vybrané rasy
      threshold: null,
      criticalPct: null,
    };
    saveConfig(cfg);
  } else if (name && rec.name !== name) {
    rec.name = name;
    saveConfig(cfg);
  }
}

/** Skript „Přihlášení“ hlásí, že hru odhlásilo a jak se znovu přihlašuje. Zprávy jdou jen do servisního chatu (soukromě), nikdy do hlavní skupiny. */
const SESSION_TEXT = { expired: '🔑', maintenance: '🛠', ok: '✅', retry: '🔁', failed: '⚠️', 'needs-user': '⚠️' };
const sessionLog = [];
async function handleSession(req) {
  if (!authOk(req)) return [401, { error: 'bad token' }];
  const body = await readJson(req, 4096);
  const event = typeof body.event === 'string' && body.event in SESSION_TEXT ? body.event : null;
  const text = typeof body.text === 'string' ? body.text.slice(0, 300) : '';
  if (!event) return [400, { error: 'invalid event' }];
  console.log(`[přihlášení] ${event}: ${text}`);
  sessionLog.unshift({ at: Date.now(), event, text }); sessionLog.length = Math.min(sessionLog.length, 30); // posledních 30 událostí pro záložku Přihlášení
  if (text && cfg.session.notify?.[event] !== false) sendService(cfg, `${SESSION_TEXT[event]} ${text}`);
  pushState();
  return [200, { ok: true }];
}

async function handleIngest(req) {
  if (!authOk(req)) return [401, { error: 'bad token' }];
  const body = await readJson(req);
  const players = parsePlayers(body);
  const raceId = String(body.raceId ?? '');
  if (!body.raceId) return [400, { error: 'zastaralý userscript – nainstaluj novou verzi z /userscript.user.js' }];
  if (!players || !/^\d{1,6}$/.test(raceId)) return [400, { error: 'invalid payload' }];
  const raceName = typeof body.raceName === 'string' ? body.raceName.trim().slice(0, 64) : '';
  const page = Number.isInteger(body.page) && body.page > 0 && body.page < 1000 ? body.page : 1;
  const src = typeof body.src === 'string' ? body.src.slice(0, 32) : 'unknown';
  noteScript(raceId, body); // verze skriptu a (když D nemá hrac_id) ukázka buňky D

  const now = Date.now();
  registerRace(raceId, raceName);
  // víc oken stejné stránky s různými daty: platí to, kde se data mění; data ze starého okna se ignorují (nic se z nich nehlásí)
  if (!store.ingest({ raceId, page, src, players }, now)) return [200, { ok: true, ignored: true }];
  if (cfg.recalc.military) for (const f of recalc.ingest(raceId, players, now)) console.log(`[přepočet] ${f.name}: ${String(f.hour).padStart(2, '0')}:00`);
  if (cfg.recalc.economic) for (const f of econ.ingest(raceId, players, now, { minRel: cfg.recalc.econMinGrowthPct / 100 })) console.log(`[ekonomický přepočet?] ${f.name}: ${new Date(f.at).toLocaleTimeString('cs-CZ')}${f.online ? ' online' : ''}`);
  raceLastAt.set(raceId, now);
  ingestTimes.push(now);
  { const a = raceIngest.get(raceId) ?? []; a.push(now); while (a.length && a[0] < now - 10_000) a.shift(); raceIngest.set(raceId, a); }
  while (ingestTimes.length && ingestTimes[0] < now - 10_000) ingestTimes.shift();
  db.recordChanges(now, players, lastWritten);

  const raceLabel = cfg.races[raceId].name;
  const attack = raceRole(raceId) === 'attack';
  const resolved = players.map((p) => {
    playerRace.set(p.name, raceId);
    const { watched, threshold, critical } = resolveWatch(cfg, raceId, p.name);
    return { ...p, watched, threshold, critical };
  });
  // cizí rasa: hlídá se „k dobytí“, ne pokles pod práh (stav pravidel se ale vede dál, ať přepnutí nespamuje)
  if (!attack) trackBelow(resolved, raceId, now);
  if (statsOn()) for (const p of resolved) if (dohozStats.hasOpen(p.name)) dohozStats.power(p.name, p.power, now); // účinek dohozu a návrat nad práh // rychlá větev auto-dohozu: pád se zachytí hned při prvním čtení
  const alerts = evaluate(state, attack ? resolved.map((p) => ({ ...p, watched: false })) : resolved, cfg, now);
  if (attack) {
    for (const ev of conquest.evaluate(raceId, resolved, conquestFor(raceId), now)) {
      const p = players.find((x) => x.name === ev.name);
      alerts.push({ name: ev.name, power: ev.power, prev: null, reason: ev.type, planets: p?.planets ?? null, since: ev.since });
    }
  }
  for (const a of alerts) {
    a.race = raceLabel;
    db.recordAlert(now, a);
    console.log(`[alert] [${a.race}] ${a.name} ${a.prev} -> ${a.power} (${a.reason})`);
    if (notifyOn(cfg, a.reason)) sendText(cfg, formatAlert(a)); // fire-and-forget, chyby se logují v notifieru; vypnutý druh se jen zapíše do historie
    if (!attack) { // vlastní hráč pod prahem: horní hranici může mít nastavenou zvlášť u hráče
      const own = cfg.players[a.name]?.topTarget;
      autoArmy.onAlert(a, own != null ? { ...cfg.army.auto, topUpTarget: own } : cfg.army.auto, now);
    } // vlastní hráč pod prahem: sám dohodit po náhodné prodlevě (jen když je auto-dohoz zapnutý)
  }
  pushState();
  return [200, { ok: true, alerts: alerts.length }];
}

/** Tečky OP z mapy: alert na nově objevený sektor (jen když je OP alert zapnutý). */
async function handleIngestOp(req) {
  if (!authOk(req)) return [401, { error: 'bad token' }];
  const body = await readJson(req);
  if (!Array.isArray(body.sectors) || body.sectors.length > 50) return [400, { error: 'invalid payload' }];
  const sectors = [];
  for (const s of body.sectors) {
    if (!/^\d{1,4}$/.test(String(s?.id)) || typeof s.label !== 'string') return [400, { error: 'invalid payload' }];
    const e = { id: String(s.id), label: s.label.slice(0, 40) };
    if (Number.isFinite(s.u) && Number.isFinite(s.v)) { e.u = Math.min(1, Math.max(0, s.u)); e.v = Math.min(1, Math.max(0, s.v)); } // poloha tečky v sektoru 0–1 (pro automat na OP)
    sectors.push(e);
  }
  const now = Date.now();
  opLastAt = now;
  // tracker běží i při vypnutém alertu (silent), ať se po zapnutí nehlásí staré tečky
  if (!cfg.op.enabled) tele.resetOp();
  const { fresh, repeats } = op.update(sectors, now, { repeatMs: cfg.op.repeatSec * 1000, silent: !cfg.op.enabled });
  // jedna souhrnná zpráva za celou mapu (počet OP + sektory), ne zpráva za každý sektor
  if (fresh.length && cfg.op.enabled) { // šetření teleskopu až po prvním OP, které se po zapnutí hlídání objeví (do té doby teleskop jede a čeká)
    const r = tele.opAppeared(cfg.op, now, { keepOn: keepOn() });
    if (r.rest) console.log("[teleskop] šetření po OP: zastavím za "+Math.round((r.stopAt - now) / 1000)+" s, zapnu zpět za "+Math.round((r.restUntil - now) / 1000)+" s");
    else console.log('[teleskop] šetření po OP tentokrát ne, teleskop jede dál');
  }
  const notify = fresh.length > 0 || repeats.length > 0;
  if (notify) {
    op.markAllNotified(now); // připomínka pak přijde zase až po repeatSec pro všechny tečky naráz
    const list = sectors.map((s) => (/^\d+$/.test(s.label) || !s.label ? `Sektor ${s.id}` : `Sektor ${s.id} (${s.label})`)).join(', ');
    const a = { name: `${sectors.length}× OP – ${list}`, power: sectors.length, prev: null, reason: 'op', race: null, repeat: !fresh.length, count: sectors.length, sectors: list };
    db.recordAlert(now, a);
    console.log(`[alert] OP ${a.repeat ? 'stále ' : ''}na mapě: ${a.name}`);
    if (notifyOn(cfg, 'op')) sendText(cfg, formatAlert(a));
  }
  const offer = hunt.offer(sectors, cfg.op.hunt, now, { opEnabled: cfg.op.enabled });
  if (hunt.active(now)) op.hold(now + 20_000);
  if (offer.notify) sendService(cfg, offer.notify);
  pushState();
  return [200, { ok: true, alerts: notify ? 1 : 0, vigilance: cfg.op.vigilance, telescope: cfg.op.telescope, hunt: offer.spec ?? null }];
}

/** Události automatu na OP ze skriptu na mapě (start, sektor, tečka, výsledek). Zprávy jdou jen do servisního chatu. */
async function handleOpHunt(req) {
  if (!authOk(req)) return [401, { error: 'bad token' }];
  const body = await readJson(req, 8192);
  const now = Date.now();
  const r = hunt.event({ id: Number(body.id), event: String(body.event ?? ''), x: body.x, y: body.y, cost: body.cost, have: body.have, text: typeof body.text === 'string' ? body.text : '' }, cfg.op.hunt, now);
  if (hunt.active(now)) op.hold(now + 20_000);
  if (r.event !== undefined) delete r.event;
  if (body.event !== 'state') console.log(`[op-lov] ${body.event}${body.text ? `: ${String(body.text).slice(0, 120)}` : ''}${r.ok ? '' : ' (zakázka už neexistuje)'}`);
  if (r.notify) sendService(cfg, r.notify);
  if (r.disable) { // nedostatek naquadahu: automat se vypne i v nastavení, ať ho uživatel zapne až po doplnění
    cfg.op = { ...cfg.op, hunt: { ...cfg.op.hunt, enabled: false } };
    saveConfig(cfg);
  }
  pushState();
  const { notify, disable, ...out } = r;
  return [200, out];
}

// tlačítko bdělosti na mapě: skript hlásí, že se objevilo a že ho potvrdil; zaseknuté potvrzení jde do servisního chatu
const vig = { seenAt: 0, clickedAt: 0, stillAt: 0, count: 0, pending: false, alerted: false };
const tele = createTelescope();
const hunt = createHunt(); // automat na OP: zakázky na sektory s OP
const VIG_ALERT_MS = 150_000; // hra dává ~5 minut, upozornit dřív, než je pozdě

/**
 * Teleskop se nezastavuje (šetření po OP) a bdělost se záměrně nevynechává, když: se právě loví OP, nebo čeká nepotvrzené tlačítko bdělosti,
 * nebo svítí OP a chytání je zapnuté (bez teleskopu by tečka zmizela dřív, než se stihne osídlit).
 */
function opHold(now) {
  return hunt.active(now) || vig.pending || (cfg.op.enabled && !!cfg.op.hunt?.enabled && op.current(now).length > 0);
}

/** Chytání OP zapnuté (a OP hlídání zapnuté): teleskop musí jet pořád, takže se nešetří, bdělost se nevynechává a žádné pauzy neplatí. Samotné alerty smějí šetřit. */
const keepOn = () => !!cfg.op.enabled && !!cfg.op.hunt?.enabled;

async function handleVigilance(req) {
  if (!authOk(req)) return [401, { error: 'bad token' }];
  const body = await readJson(req);
  const now = Date.now();
  if (body.event === 'seen') {
    if (!cfg.op.enabled) { tele.resetOp(); return [200, { ok: true, action: 'ignore' }]; } // OP vypnuto: bot nic nepotvrzuje
    const d = tele.vigilanceSeen(cfg.op.vigilance, { now, hold: opHold(now), keepOn: keepOn() }); // občas záměrně vynechat, ať to nevypadá jako stroj (ne při lovení OP, šetření a pauze)
    if (d.action === 'skip') {
      vig.pending = false;
      console.log('[bdělost] tlačítko se objevilo, tentokrát ho záměrně nepotvrdím (teleskop se zastaví a chvíli zůstane vypnutý)');
      return [200, { ok: true, action: 'skip' }];
    }
    vig.pending = true; vig.seenAt = now; vig.stillAt = now; vig.alerted = false;
    console.log(`[bdělost] tlačítko se objevilo, kliknu za ${Math.round(Number(body.delayMs) / 100) / 10} s`);
    return [200, { ok: true, action: 'click' }];
  } else if (body.event === 'still') { // skript pořád vidí tlačítko (hlásí se, dokud je na stránce)
    vig.stillAt = now;
  } else if (body.event === 'gone') { // tlačítko zmizelo bez našeho kliknutí (hra ho zrušila, potvrzeno jinde, stránka se přenačetla): nic nečeká
    vig.pending = false;
    console.log('[bdělost] tlačítko zmizelo, nic už nečeká na potvrzení');
  } else if (body.event === 'clicked') {
    tele.vigilanceClicked();
    vig.pending = false; vig.clickedAt = now; vig.count++;
    console.log('[bdělost] potvrzeno');
    if (vig.alerted) sendService(cfg, '✅ Tlačítko bdělosti je potvrzené (se zpožděním).');
    vig.alerted = false;
  } else if (body.event === 'failed') {
    const err = typeof body.error === 'string' ? body.error.slice(0, 120) : '';
    console.log(`[bdělost] potvrzení selhalo: ${err}`);
    sendService(cfg, `⚠️ Tlačítko bdělosti se nepodařilo potvrdit${err ? ` (${err})` : ''}. Zkontroluj mapu, hrozí přerušení teleskopu.`);
  } else return [400, { error: 'invalid event' }];
  return [200, { ok: true }];
}
/** Stav teleskopu z mapy -> instrukce (aktivovat po lidské prodlevě / počkat / nic). */
let teleLast = '';
async function handleTelescope(req) {
  if (!authOk(req)) return [401, { error: 'bad token' }];
  const body = await readJson(req);
  const now = Date.now();
  if (body.event === 'attempt') {
    const r = tele.attempt(now);
    console.log('[teleskop] klikám na Aktivovat');
    if (r.alert === 'failed') { console.log('[teleskop] aktivace se nepovedla ani na několikátý pokus'); sendService(cfg, '⚠️ Teleskop se nepodařilo aktivovat ani na několikátý pokus. Zkontroluj mapu, příštích 30 minut to zkoušet nebudu.'); }
    return [200, { ok: true }];
  }
  if (body.event !== 'state') return [400, { error: 'invalid event' }];
  const remaining = Number.isFinite(Number(body.remainingSec)) && body.remainingSec !== null ? Number(body.remainingSec) : null;
  const state = body.state === 'stopped' ? 'stopped' : 'active';
  if (!cfg.op.enabled) { tele.resetOp(); tele.noteState(state); return [200, { action: 'none' }]; } // OP vypnuto: teleskop se nezapíná
  const r = tele.telescopeState({ state, remainingSec: remaining }, cfg.op, now, { hold: opHold(now), keepOn: keepOn() });
  if (r.action === 'stop') console.log('[teleskop] šetření po OP: zastavuji');
  if (state !== teleLast) { teleLast = state; console.log(`[teleskop] ${state === 'active' ? 'aktivní' : 'zastavený'}`); }
  if (r.alert === 'zero') { console.log('[teleskop] nezbývá žádný čas'); sendService(cfg, '⚠️ Teleskop je zastavený a nezbývá mu žádný čas, nelze ho aktivovat.'); }
  return [200, r];
}

setInterval(() => {
  const now = Date.now();
  // upozornit jen když tlačítko opravdu pořád visí (skript ho viděl v posledních 90 s, skrytá karta hlásí pomalu) a okno mapy se zrovna nevěnuje lovení OP
  if (vig.pending && !vig.alerted && now - vig.seenAt > VIG_ALERT_MS && now - vig.stillAt < 90_000 && !hunt.active(now)) {
    vig.alerted = true;
    sendService(cfg, `⚠️ Tlačítko bdělosti čeká na potvrzení už ${Math.round((now - vig.seenAt) / 1000)} s. Zkontroluj mapu, hrozí přerušení teleskopu.`);
  }
}, 10_000);

/** Stav pro UI: rasy s hráči a jejich efektivním nastavením hlídání. */
function buildState() {
  const now = Date.now();
  const ids = new Set([...Object.keys(cfg.races), ...store.raceIds()]);
  const races = [...ids].map((id) => {
    const snap = store.snapshot(id, now);
    const rec = cfg.races[id] ?? { name: `Rasa #${id}`, mode: 'off', threshold: null, criticalPct: null };
    return {
      id,
      name: rec.name,
      mode: rec.mode,
      role: rec.role ?? 'defend',
      threshold: rec.threshold,
      criticalPct: rec.criticalPct ?? null,
      conquest: conquestFor(id), conquestOwn: rec.conquest ?? null,
      script: scriptInfo.get(id)?.ver ?? null, // verze skriptu Síla hráčů, který data této rasy posílá (diagnostika)
      at: snap.at,
      sources: snap.sources,
      rate: (raceIngest.get(id) ?? []).filter((t) => t > now - 5_000).length / 5, // příjmů za vteřinu (posledních 5 s)
      players: snap.players.map((p) => ({
        name: p.name, power: p.power, planets: p.planets ?? null, planetsDelta: p.planetsDelta ?? null, planetsChange: p.planetsChange ?? 0, planetsAt: p.planetsAt ?? 0,
        powerDelta: p.powerDelta, powerAt: p.powerAt, attackable: p.attackable ?? null, online: p.online ?? null, rank: p.rank ?? null, ...recalcShown(id, p.name, now), hracId: p.hracId ?? null, utokId: p.utokId ?? null, attacks: p.attacks ?? null, ...conquest.status(id, p.name), ...resolveWatch(cfg, id, p.name),
      })),
    };
  });
  const recent = ingestTimes.filter((t) => t > now - 10_000);
  const ratePerSec = recent.length ? recent.length / Math.min(10, (now - recent[0]) / 1000 + 1) : 0;
  const opState = {
    enabled: cfg.op.enabled, at: opLastAt, dots: op.current(now), hunt: { enabled: !!cfg.op.hunt?.enabled, dryRun: cfg.op.hunt?.dryRun !== false },
    vigilance: { count: vig.count, lastClickedAt: vig.clickedAt, pendingSince: vig.pending ? vig.seenAt : 0 },
    telescope: tele.snapshot(),
  };
  return { races, alerts: db.recentAlerts(40), serverTime: now, ratePerSec, op: opState, opHunt: hunt.snapshot(now), autoArmy: { ...autoArmy.snapshot(now), rankPaused }, sound: cfg.sound, sendStatus: { ...sendStatus }, sessionLog: sessionLog.slice(0, 12), statsRev: dohozStats.rev, profile: { name: prof.name, uiRev: profRt.uiRev, conflict: profRt.conflict, syncedAt: prof.syncedAt, fileAt: profRt.fileAt }, recalcStats: { military: recalc.count(), economic: econ.count() }, shared: sharedView() };
}

/** Panely otevřené v oknech Dominatoru: okno je každých ~30 s hlásí (/api/panels); rasa bez otevřeného panelu a mimo naši rasu se nehlídá. */
const openPanels = new Map(); // id okna -> { ids:Set, at }
const PANELS_TTL_MS = 150_000; // skryté okno hlásí pomalu
function panelOpen(id, now) {
  for (const [win, w] of openPanels) {
    if (now - w.at > PANELS_TTL_MS) { openPanels.delete(win); continue; }
    if (w.ids.has(String(id))) return true;
  }
  return false;
}

/** Hlídač výpadku: hlídané rasy a mapa (když je OP alert zapnutý) musí dodávat data. */
function watchdogTick(now = Date.now()) {
  if (!cfg.watchdog.enabled) return;
  const items = watchItems(cfg, (id) => panelOpen(id, now), (id) => raceLastAt.get(id) ?? 0, opLastAt);
  for (const ev of watchdog.check(items, now, { staleMs: cfg.watchdog.staleSec * 1000 })) {
    const a = { name: ev.name, power: 0, prev: null, reason: ev.type, race: null, ageMs: ev.ageMs };
    db.recordAlert(now, a);
    console.log(`[watchdog] ${ev.type === 'down' ? 'VÝPADEK' : 'obnoveno'}: ${ev.name} (${Math.round(ev.ageMs / 1000)} s)`);
    sendService(cfg, formatAlert(a)); // výpadek dat (rasy i mapa) je systémová věc: jen servisní chat
  }
}
setInterval(watchdogTick, 5000);
// doplnění nezaměstnaných na planety (Obchod → Nezaměstnaní); zprávy jen do servisního chatu
const unemp = createUnemp();
const unempSummary = (s) => { if (s) { console.log(`[nezaměstnaní] ${s}`); sendService(cfg, s); } };
setInterval(() => unempSummary(unemp.staleCheck()), 10_000);
setInterval(() => { if (build.staleCheck()) { console.log('[stavění] skript přestal hlásit'); sendService(cfg, '⚠️ Stavění: skript přestal hlásit (zavřená karta nebo odhlášení?)'); } }, 10_000);

/** Hlášení ze stránky stavby.php -> instrukce, co dělat dál. */
async function handleBuildReport(req) {
  if (!authOk(req)) return [401, { error: 'bad token' }];
  const body = await readJson(req);
  return [200, build.report(body, cfg.build, Date.now(), { forceAll: !!cfg.build.forceAll })];
}
const buildView = () => [200, { buildings: BUILDINGS, config: cfg.build, run: build.snapshot(), knownPlanets: Object.keys(ledger.planets).length, serverTime: Date.now() }];

/** Dobývací útok: skript na stránce utok.php si bere nastavení a hlásí, co našel a vyplnil. */
let attackSeen = { at: 0, units: [] }; // jednotky z poslední navštívené stránky útoku
let attackReport = null; // poslední hlášení o vyplnění

// ---------- profily nastavení (profiles/<jméno>.json v repozitáři; přenos mezi počítači přes git) ----------
const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url));
// sdílená data (profily, přepočty) žijí v samostatném repozitáři na větvi „sdilena-data“ mimo složku projektu, ať se nemíchají s kódem
const PROFILES_DIR = process.env.SG_PROFILES_DIR || join(DATA_DIR, 'sdilena-data');
const dataRepo = { ready: !!process.env.SG_PROFILES_DIR, error: '', pulledAt: 0 };
const PROFILE_STATE_PATH = join(DATA_DIR, 'profile.json');
const prof = { name: '', autoSave: true, autoLoad: true, syncedAt: 0, ...(() => { try { return JSON.parse(readFileSync(PROFILE_STATE_PATH, 'utf8')); } catch { return {}; } })() };
const profRt = { ui: null, uiRev: 0, conflict: false, fileAt: 0, msg: '' }; // ui = poslední vzhled z prohlížeče; uiRev = čas profilu, ze kterého se vzhled naposledy načetl
function persistProfState() {
  try { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(`${PROFILE_STATE_PATH}.tmp`, JSON.stringify({ name: prof.name, autoSave: prof.autoSave, autoLoad: prof.autoLoad, syncedAt: prof.syncedAt })); renameSync(`${PROFILE_STATE_PATH}.tmp`, PROFILE_STATE_PATH); }
  catch (e) { console.error('stav profilu se neuložil:', e.message); }
}
/** Nabídka profilů: výchozí dva + další soubory ve složce profiles (a aktuálně vybraný). */
function profileChoices() {
  const files = new Map(listProfiles(PROFILES_DIR).map((f) => [f.name, f]));
  const out = DEFAULT_PROFILES.map((d) => ({ name: d.id, label: d.label, savedAt: files.get(d.id)?.savedAt ?? 0, savedBy: files.get(d.id)?.savedBy ?? '' }));
  for (const f of files.values()) if (!out.some((o) => o.name === f.name)) out.push({ ...f, label: f.name });
  if (prof.name && !out.some((o) => o.name === prof.name)) out.push({ name: prof.name, label: prof.name, savedAt: 0, savedBy: '' });
  return out;
}
function profileView() {
  return { name: prof.name, autoSave: prof.autoSave, autoLoad: prof.autoLoad, syncedAt: prof.syncedAt, fileAt: profRt.fileAt, conflict: profRt.conflict, uiRev: profRt.uiRev, msg: profRt.msg };
}
/** Uloží nastavení do souboru profilu. Když je v repozitáři novější verze (po pullu), nepřepíše ji (conflict), pokud nejde o force. */
function profileSaveNow(force = false) {
  if (!validName(prof.name)) return { ok: false, error: 'Nejdřív vyber profil' };
  const file = readProfile(PROFILES_DIR, prof.name);
  profRt.fileAt = file?.savedAt ?? 0;
  if (file && file.savedAt > prof.syncedAt && !force) { profRt.conflict = true; profRt.msg = 'V profilu je novější nastavení (z jiného počítače). Načti ho, nebo ho přepiš.'; pushState(); return { ok: false, conflict: true }; }
  const now = Date.now();
  const next = buildProfile(prof.name, cfg, profRt.ui ?? file?.ui ?? null, now, hostname());
  if (file && sameContent(file, next)) { prof.syncedAt = file.savedAt; }
  else { writeProfile(PROFILES_DIR, next); prof.syncedAt = now; profRt.fileAt = now; console.log(`[profil] uloženo do ${prof.name}.json (větev sdílených dat)`); }
  profRt.conflict = false; profRt.msg = '';
  persistProfState(); pushState();
  return { ok: true };
}
let profSaveTimer = null;
function scheduleProfileSave() {
  if (!prof.name || !prof.autoSave) return;
  clearTimeout(profSaveTimer);
  profSaveTimer = setTimeout(() => { try { profileSaveNow(false); } catch (e) { console.error('profil se neuložil:', e.message); } }, 2000);
}
/** Načte nastavení z profilu (po pullu z gitu). Tajné věci a port zůstávají tady. */
function profileLoadNow() {
  const file = readProfile(PROFILES_DIR, prof.name);
  if (!file) return { ok: false, error: 'Profil nebyl nalezen' };
  cfg = normalizeConfig(mergeProfileConfig(cfg, file.config));
  if (process.env.SG_PORT) cfg.port = Number(process.env.SG_PORT);
  saveConfigRaw(cfg);
  rebaseline(state, (name) => resolveWatch(cfg, playerRace.get(name), name).threshold, (name) => resolveWatch(cfg, playerRace.get(name), name).critical);
  if (file.ui) { profRt.ui = file.ui; profRt.uiRev = file.savedAt; }
  prof.syncedAt = file.savedAt; profRt.fileAt = file.savedAt; profRt.conflict = false; profRt.msg = '';
  persistProfState(); pushState();
  console.log(`[profil] načteno z ${prof.name}.json (větev sdílených dat)`);
  return { ok: true };
}
/** Po pullu z gitu: novější profil se sám načte (když je zapnuto automatické načítání). */
function profilePoll() {
  if (!validName(prof.name)) return;
  const file = readProfile(PROFILES_DIR, prof.name);
  profRt.fileAt = file?.savedAt ?? 0;
  if (file && file.savedAt > prof.syncedAt && prof.autoLoad) { try { profileLoadNow(); } catch (e) { console.error('profil se nenačetl:', e.message); } }
}
setInterval(profilePoll, 60_000);

// ---------- sdílená data o přepočtech (profiles/data-<počítač>.json; každý počítač píše jen svůj soubor, čte všechny) ----------
const HOST = process.env.SG_HOST || hostname();
const SHARED_FILE = sharedFileName(HOST);
const shared = { clearedAt: { military: 0, economic: 0 }, files: 0, mergedAt: 0, received: 0, error: '' };
/** Sloučí data ze všech souborů do paměti a (když se něco změnilo) zapíše vlastní soubor. */
function sharedSync() {
  if (!cfg.recalc.shared) return;
  try {
    const files = readAllShared(PROFILES_DIR);
    for (const f of files) for (const k of ['military', 'economic']) shared.clearedAt[k] = Math.max(shared.clearedAt[k], f.clearedAt?.[k] ?? 0); // náhrobky (nový věk) se šíří
    const others = files.filter((f) => f.file !== SHARED_FILE);
    const before = [Object.keys(recalcRec).length, Object.keys(econRec).length];
    const now = Date.now();
    const ch1 = mergeRecalc(recalcRec, files.map((f) => f.recalc), { clearedAt: shared.clearedAt.military, now });
    const ch2 = mergeEcon(econRec, files.map((f) => f.econ), { clearedAt: shared.clearedAt.economic, now });
    if (ch1) saveRecalcFile(recalcRec);
    if (ch2) saveEconFile(econRec);
    if (ch1 || ch2) { shared.received += Math.max(0, Object.keys(recalcRec).length - before[0]) + Math.max(0, Object.keys(econRec).length - before[1]); pushState(); }
    const own = files.find((f) => f.file === SHARED_FILE);
    const next = buildShared(HOST, recalcRec, econRec, shared.clearedAt, now);
    if (!own || !sameShared(own, next)) { writeShared(PROFILES_DIR, SHARED_FILE, next); console.log(`[sdílení] uloženo ${SHARED_FILE} (větev sdílených dat)${ch1 || ch2 ? ' (po sloučení s cizími daty)' : ''}`); }
    shared.files = others.length + 1; shared.mergedAt = now; shared.error = ''; sharedDirty = false;
  } catch (e) { shared.error = e.message; console.error('sdílení přepočtů selhalo:', e.message); }
}
function sharedView() { return { branch: DATA_BRANCH, repoReady: dataRepo.ready, repoError: dataRepo.error, pulledAt: dataRepo.pulledAt, on: !!cfg.recalc.shared, files: shared.files, mergedAt: shared.mergedAt, received: shared.received, error: shared.error, file: SHARED_FILE }; }
/** Stáhne změny ostatních (git pull ve složce sdílených dat). */
async function pullSharedData() {
  if (!dataRepo.ready) return { ok: false, error: dataRepo.error || 'složka sdílených dat není připravená' };
  const r = await pullData({ dir: PROFILES_DIR });
  if (r.ok) { dataRepo.pulledAt = Date.now(); dataRepo.error = ''; } else { dataRepo.error = r.error; console.error('[sdílení] stažení selhalo:', r.error); }
  return r;
}
/** Start: připravit repozitář na větvi sdílených dat, přenést staré soubory, stáhnout novinky a načíst je. */
async function initSharedStorage() {
  try {
    if (!process.env.SG_PROFILES_DIR) {
      const r = await ensureDataRepo({ mainRoot: ROOT_DIR, dir: PROFILES_DIR });
      dataRepo.ready = r.ok; dataRepo.error = r.ok ? '' : r.error;
      if (!r.ok) console.error('[sdílení] větev sdílených dat není k dispozici:', r.error, '(data se ukládají jen lokálně)');
      else if (!r.existed) console.log(`[sdílení] připravena větev ${DATA_BRANCH} (${r.created ? 'nová' : 'stažená'})`);
      const n = migrateLegacyFiles(join(ROOT_DIR, 'profiles'), PROFILES_DIR);
      if (n) console.log(`[sdílení] přeneseno ${n} souborů ze staré složky profiles/`);
      if (!r.ok) { mkdirSync(PROFILES_DIR, { recursive: true }); }
    }
    if (dataRepo.ready && cfg.recalc.pullOnStart) await pullSharedData();
  } catch (e) { dataRepo.error = e.message; console.error('[sdílení] příprava selhala:', e.message); }
  profilePoll();
  sharedSync();
}
setTimeout(initSharedStorage, 1000);
// pravidelná výměna dat s ostatními za běhu (výchozí každých 15 min, v Nastavení → Data): odešle, co je nového (commit jen při změně), a stáhne novinky
let syncAt = Date.now();
setInterval(async () => {
  const m = Number(cfg.recalc.syncMinutes);
  if (!cfg.recalc.shared || !(m > 0) || Date.now() - syncAt < m * 60_000 - 5_000 || !dataRepo.ready) return;
  syncAt = Date.now();
  try { await sharePush({ quiet: true }); await pullSharedData(); sharedSync(); } catch (e) { console.error('[sdílení] pravidelná výměna selhala:', e.message); }
}, 30_000);
setInterval(sharedSync, 60_000); // po pullu z gitu se cizí data načtou do minuty; vlastní se zapisují jen při změně

let shareBusy = null;
/** Pošle ostatním (commit + pull --rebase + push) soubor s daty tohoto počítače a vybraný profil. Najednou běží jen jedno odeslání. */
async function sharePush({ quiet = false } = {}) {
  if (shareBusy) return shareBusy;
  shareBusy = (async () => {
    try {
      sharedSync(); // nejdřív se sloučí a zapíše všechno nejnovější
      if (validName(prof.name) && prof.autoSave) { try { profileSaveNow(false); } catch { /* profil se jen nepřidá */ } }
      const files = [SHARED_FILE];
      if (validName(prof.name)) files.push(`${prof.name}.json`);
      const r = await pushShared({ root: PROFILES_DIR, files, message: `Sdílená data přepočtů a profil (${HOST})` });
      if (!(quiet && r.ok && !r.committed)) console.log(r.ok ? `[sdílení] ${r.nothing ? 'není co odeslat' : r.committed ? (r.pushed ? 'odesláno ostatním (commit + push)' : 'commit, push nebyl potřeba') : 'beze změn, nic nového k odeslání'}` : `[sdílení] odeslání selhalo: ${r.error}`);
      return r;
    } catch (e) { return { ok: false, error: e.message }; }
    finally { shareBusy = null; }
  })();
  return shareBusy;
}

/** Zavření aplikace z rozhraní (totéž co stop.cmd): odešle data ostatním (když je zapnuto), zastaví hlídače (jinak by server hned spustil znovu) a ukončí se. */
async function shutdownApp() {
  const share = cfg.recalc.pushOnStop && cfg.recalc.shared ? await sharePush() : { ok: true, skipped: true };
  try { writeFileSync(join(DATA_DIR, 'hlidac.stop'), '1'); } catch { /* bez značky by hlídač server spustil znovu */ }
  try {
    const pid = parseInt(readFileSync(join(DATA_DIR, 'hlidac.pid'), 'utf8'), 10);
    if (pid > 0 && pid !== process.pid) process.kill(pid);
    unlinkSync(join(DATA_DIR, 'hlidac.pid'));
  } catch { /* hlídač neběží */ }
  console.log('[aplikace] zavřeno z rozhraní');
  setTimeout(() => process.exit(0), 500);
  return { ok: true, share };
}

const routes = {
  // statistika dohozů; filtry: source=auto|manual|mixed, name, outcome=ok|bad|…, hours (jen posledních N hodin), slow (jen první dohoz pomalejší než N s)
  'GET /api/stats': async (req) => {
    const q = new URL(req.url, 'http://x').searchParams;
    const snap = dohozStats.snapshot();
    const now = Date.now();
    const f = { source: q.get('source') || '', name: q.get('name') || '', outcome: q.get('outcome') || '', sinceMs: q.get('hours') ? now - Number(q.get('hours')) * 3_600_000 : 0, slowMs: q.get('slow') ? Number(q.get('slow')) * 1000 : 0 };
    const list = filterEpisodes(snap.episodes, f);
    return [200, { rev: snap.rev, keep: snap.keep, enabled: statsOn(), total: snap.episodes.length, open: filterEpisodes(snap.open, { ...f, outcome: '' }), episodes: list, summary: summarize(list), serverTime: now }];
  },
  'DELETE /api/stats': async () => { dohozStats.clear(); pushState(); return [200, { ok: true }]; },
  'POST /api/shutdown': async () => [200, await shutdownApp()],
  'POST /api/share/push': async () => [200, await sharePush()],
  // volá stop.cmd: odešle data jen když je to zapnuté (Nastavení → Data → Přepočty hráčů)
  'POST /api/share/stop': async () => [200, cfg.recalc.pushOnStop && cfg.recalc.shared ? await sharePush() : { ok: true, skipped: true }],
  'POST /api/recalc/sync': async () => { const p = await pullSharedData(); sharedSync(); pushState(); return [200, { ...sharedView(), pull: p }]; },
  'GET /api/profile': async () => [200, { ...profileView(), profiles: profileChoices() }],
  'PUT /api/profile': async (req) => {
    const b = await readJson(req);
    if ('name' in b) { if (b.name !== '' && !validName(b.name)) return [400, { error: 'Neplatné jméno profilu (písmena, číslice, _ a -, nejvýš 32 znaků)' }]; if (b.name !== prof.name) { prof.name = b.name; prof.syncedAt = 0; profRt.conflict = false; profRt.msg = ''; } }
    if ('autoSave' in b) prof.autoSave = !!b.autoSave;
    if ('autoLoad' in b) prof.autoLoad = !!b.autoLoad;
    persistProfState(); pushState();
    return [200, { ...profileView(), profiles: profileChoices() }];
  },
  'POST /api/profile/save': async (req) => {
    const b = await readJson(req).catch(() => ({}));
    const r = profileSaveNow(!!b.force);
    return [r.ok || r.conflict ? 200 : 400, { ...r, ...profileView(), profiles: profileChoices() }];
  },
  'POST /api/profile/load': async () => {
    const r = profileLoadNow();
    return [r.ok ? 200 : 400, { ...r, ...profileView(), profiles: listProfiles(PROFILES_DIR), config: publicConfig(cfg) }];
  },
  'GET /api/profile/ui': async () => [200, { ui: profRt.ui, rev: profRt.uiRev }],
  'POST /api/profile/ui': async (req) => {
    const ui = cleanUi(await readJson(req, 300_000));
    if (!ui) return [400, { error: 'invalid ui' }];
    profRt.ui = ui; scheduleProfileSave();
    return [200, { ok: true }];
  },
  // nastavení útoku pro skript na stránce hry; ?t=P = jednotky pro daný druh útoku (bez něj dobývací)
  'GET /attack/config': async (req) => {
    if (!authOk(req)) return [401, { error: 'bad token' }];
    const t = new URL(req.url, 'http://x').searchParams.get('t');
    return [200, { units: unitsFor(cfg.attack, ATTACK_TYPES.includes(t) ? t : 'D'), randomPlanet: cfg.attack.randomPlanet }];
  },
  'POST /attack/seen': async (req) => {
    if (!authOk(req)) return [401, { error: 'bad token' }];
    const body = await readJson(req);
    const units = sanitizeSeenUnits(body.units);
    attackSeen = { at: Date.now(), units };
    const merged = mergeSeenUnits(cfg.attack, units, ATTACK_TYPES.includes(body.type) ? body.type : 'D'); // nové názvy jednotek se doplní do nastavení s počtem 0
    if (merged) { cfg.attack = merged; saveConfig(cfg); }
    return [200, { ok: true }];
  },
  'POST /attack/report': async (req) => {
    if (!authOk(req)) return [401, { error: 'bad token' }];
    attackReport = { ...sanitizeReport(await readJson(req)), at: Date.now() };
    console.log(`[útok] ${attackReport.ok ? 'vyplněno' : 'nevyplněno'}${attackReport.submitted ? ', odesláno' : ''}${attackReport.problems.length ? ': ' + attackReport.problems.join('; ') : ''}`);
    return [200, { ok: true }];
  },
  'GET /api/attack': async () => [200, { seen: attackSeen, report: attackReport, scripts: Object.fromEntries(scriptInfo) }],
  // dohození rasové armády: skript na stránce Jednotky → Rasová armáda (s tokenem) a tlačítko v aplikaci
  // dohoz: jednotky k vyplnění do formuláře Rasová armáda (nastavuje se v aplikaci) a názvy jednotek viděné na stránce
  'GET /army/config': async (req) => (authOk(req) ? [200, { units: cfg.army.units }] : [401, { error: 'bad token' }]),
  'POST /army/seen': async (req) => {
    if (!authOk(req)) return [401, { error: 'bad token' }];
    const merged = mergeSeenUnits(cfg.army, sanitizeSeenUnits((await readJson(req)).units));
    if (merged) { cfg.army = merged; saveConfig(cfg); }
    return [200, { ok: true }];
  },
  // skript se ptá, jestli má něco odeslat. ?short=1 (skript 2.1.1+) odpoví hned; bez něj (starší skript 2.1.0 ve smyčce) server počká max 1 s na pokyn,
  // aby smyčka nebyla horká. Dlouhé držení spojení (20 s) zdržovalo ostatní dotazy z prohlížeče, hlavně posílání dat ze hry.
  'POST /unemp/report': async (req) => {
    if (!authOk(req)) return [401, { error: 'bad token' }];
    const r = unemp.report(await readJson(req));
    unempSummary(r.summary);
    return [200, { action: r.action, name: r.name }];
  },
  'GET /api/unemp': async () => [200, unemp.snapshot()],
  'POST /api/unemp/start': async () => { unemp.start(); return [200, unemp.snapshot()]; },
  'POST /api/unemp/stop': async () => { unempSummary(unemp.stop()); return [200, unemp.snapshot()]; },
  'POST /army/poll': async (req) => {
    if (!authOk(req)) return [401, { error: 'bad token' }];
    const inst = String((await readJson(req).catch(() => ({}))).inst ?? '').slice(0, 32); // která kopie stránky se ptá (po obnovení stránky se změní)
    const end = Date.now() + (new URL(req.url, 'http://x').searchParams.get('short') ? 0 : 1000);
    army.waitStart();
    try {
      for (;;) {
        const r = army.poll(Date.now(), inst);
        if (r.action === 'send' || Date.now() >= end) return [200, r];
        await armyWait(end - Date.now());
      }
    } finally { army.waitEnd(); }
  },
  'POST /army/report': async (req) => {
    if (!authOk(req)) return [401, { error: 'bad token' }];
    const body = await readJson(req);
    army.report({ id: Number(body.id), ok: !!body.ok, error: body.error, retry: !!body.retry });
    if (statsOn()) {
      const rid = Number(body.id), nowT = Date.now();
      if (body.ok) dohozStats.sent(rid, nowT);
      else if (body.retry && army.status().req?.status === 'pending') dohozStats.retried(rid, nowT);
      else dohozStats.failed(rid, nowT, body.error);
    }
    wakeArmy();
    console.log(`[dohodit] ${body.ok ? 'odesláno' : `neodesláno: ${String(body.error ?? '').slice(0, 120)}`}`);
    return [200, { ok: true }];
  },
  'POST /api/army': async (req) => {
    const r = army.request((await readJson(req)).name);
    if (r.ok) { console.log(`[dohodit] požadavek: ${army.status().req?.name}`); statsRequest(army.status().req?.name, 'manual', r.id); wakeArmy(); }
    return [r.ok ? 200 : 409, r];
  },
  'GET /api/army': async () => [200, army.status()],
  // aplikace čeká na výsledek dohození: odpoví, jakmile je požadavek vyřízený (nebo po ~20 s)
  'GET /api/army/wait': async (req) => {
    const id = Number(new URL(req.url, 'http://x').searchParams.get('id'));
    const end = Date.now() + 20_000;
    for (;;) {
      const st = army.status();
      if (!st.req || st.req.id !== id || !['pending', 'sending'].includes(st.req.status) || Date.now() >= end) return [200, st];
      await armyWait(Math.min(500, end - Date.now()));
    }
  },
  'POST /ingest': handleIngest,
  'POST /ingest-op': handleIngestOp,
  'POST /vigilance': handleVigilance,
  'POST /telescope': handleTelescope,
  'POST /op/hunt': handleOpHunt,
  'POST /build/report': handleBuildReport,
  'POST /session': handleSession,
  // uložené přihlašovací údaje dostane jen skript Přihlášení (token, jen 127.0.0.1) a jen když je jejich používání zapnuté; nikdy se nelogují
  'GET /session/credentials': async (req) => (!authOk(req) ? [401, { error: 'bad token' }] : [200, cfg.login.enabled && cfg.login.user && cfg.login.password ? { user: cfg.login.user, password: cfg.login.password } : {}]),
  'GET /session/config': async (req) => (authOk(req) ? [200, cfg.session] : [401, { error: 'bad token' }]),
  'GET /api/build': async () => buildView(),
  'PUT /api/build': async (req) => {
    cfg = sanitizeUpdate(cfg, { build: await readJson(req) });
    saveConfig(cfg);
    return buildView();
  },
  'POST /api/build/start': async () => {
    build.start(cfg.build);
    return buildView();
  },
  'DELETE /api/build/ledger': async () => {
    ledger.planets = {};
    saveLedger();
    return buildView();
  },
  'POST /api/build/scan': async () => {
    build.requestScan();
    return buildView();
  },
  'POST /api/build/stop': async () => {
    build.stop();
    return buildView();
  },
  'GET /api/config': async () => [200, publicConfig(cfg)],
  'POST /api/panels': async (req) => { // okno Dominatoru hlásí, které rasy má otevřené jako panel (pro hlídání výpadku dat)
    const body = await readJson(req, 4096);
    const win = String(body.win ?? '').slice(0, 40);
    if (!win || !Array.isArray(body.ids) || body.ids.length > 100) return [400, { error: 'invalid payload' }];
    openPanels.set(win, { ids: new Set(body.ids.map(String).filter((x) => /^\d{1,6}$/.test(x))), at: Date.now() });
    return [200, { ok: true }];
  },
  'PUT /api/config': async (req) => {
    cfg = sanitizeUpdate(cfg, await readJson(req), {
      playersOfRace: (id) => [...playerRace].filter(([, rid]) => rid === id).map(([name]) => name),
    });
    saveConfig(cfg);
    dohozStats.setKeep(cfg.dohozStats.keep);
    rebaseline(
      state,
      (name) => resolveWatch(cfg, playerRace.get(name), name).threshold,
      (name) => resolveWatch(cfg, playerRace.get(name), name).critical,
    );
    pushState();
    return [200, publicConfig(cfg)];
  },
  // smazání zachycených přepočtů (po novém věku nebo když se data rozladí); nastavení zůstává
  'DELETE /api/recalc/military': async () => { recalc.clear(); shared.clearedAt.military = Date.now(); sharedSync(); pushState(); return [200, { ok: true }]; },
  'DELETE /api/recalc/economic': async () => { econ.clear(); shared.clearedAt.economic = Date.now(); sharedSync(); pushState(); return [200, { ok: true }]; },
  'GET /api/state': async () => [200, buildState()],
  // nový věk: smaže rasy i výjimky u hráčů a zapomene načtená data; prahy a kanály zůstávají
  'DELETE /api/races': async () => {
    cfg.races = {};
    cfg.players = {};
    saveConfig(cfg);
    store.clear();
    state.clear();
    conquest.clear();
    playerRace.clear();
    lastWritten.clear();
    return [200, publicConfig(cfg)];
  },
  'DELETE /api/alerts': async () => {
    db.clearAlerts();
    return [200, { ok: true }];
  },
  'POST /api/telegram/chats': async (req) => {
    const body = await readJson(req);
    const token = (typeof body.botToken === 'string' && body.botToken.trim()) || cfg.telegram.botToken;
    if (!token) return [400, { error: 'Nejdřív vlož token bota' }];
    try {
      return [200, await findTelegramChats(token, [cfg.telegram.chatId, cfg.telegram.serviceChatId])];
    } catch (e) {
      return [400, { error: e.message }];
    }
  },
  'POST /api/test': async (req) => {
    const body = await readJson(req).catch(() => ({}));
    const only = body?.target; // 'main' | 'service' | (nic = oba)
    const noop = { sent: 0, total: 0 };
    const [main, service] = await Promise.all([
      only === 'service' ? noop : sendText({ ...cfg, notify: true }, '✅ Stargate dominator: testovací zpráva'), // test jde i při vypnutém hlavním vypínači
      only === 'main' ? noop : sendService({ ...cfg, notify: true, notifyTypes: {} }, 'Stargate dominator: testovací zpráva do servisního chatu'),
    ]);
    return [200, { sent: main.sent + service.sent, total: main.total + service.total, service }];
  },
};

// záložní cesta, když Tampermonkey instalaci z odkazu nenabídne: zkopírovat kód a vložit ho ručně
const INSTALL_PAGE = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Instalace skriptů – Stargate dominator</title>
<style>body{margin:0;background:#0b0d12;color:#e7e9ee;font:15px/1.55 system-ui,sans-serif;padding:24px;max-width:860px}h1{font-size:20px;color:#e0b84c}
.card{background:#151922;border:1px solid #272d3b;border-radius:10px;padding:16px;margin:14px 0}code{background:#10141b;padding:1px 6px;border-radius:4px}
a.btn,button{display:inline-block;background:#e0b84c;color:#1a1405;border:0;padding:7px 14px;border-radius:6px;font-weight:600;cursor:pointer;font-size:14px;text-decoration:none;margin:4px 8px 4px 0}
button.ghost{background:transparent;color:#e7e9ee;border:1px solid #272d3b}.muted{color:#8b93a5;font-size:13px}.ok{color:#5ad19a}ol{padding-left:20px}</style></head><body>
<h1>Instalace skriptů do Tampermonkey</h1>
<p class="muted">Když odkaz „Instalovat“ nic neotevře (jen to bliká nebo se otevře stránka tampermonkey.net a zasekne se), je to Chrome: blokuje přístup k místní síti. Použij <b>Stáhnout soubor</b>: Tampermonkey → Přehled → <b>Nástroje</b> → <b>Importovat ze souboru</b> a vyber stažený soubor. Nebo ruční cestu níže.</p>
<div class="card"><b>Ruční vložení (funguje vždy)</b><ol>
<li>Klikni u skriptu na <b>Zkopírovat kód</b>.</li>
<li>Ikona Tampermonkey → <b>Přehled</b> (Dashboard). Když skript už v seznamu je, klikni na jeho název; jinak ikona → <b>Vytvořit nový skript</b>.</li>
<li>V editoru <code>Ctrl+A</code>, <code>Ctrl+V</code> (nahradí se celý obsah) a <code>Ctrl+S</code>.</li>
<li>V Přehledu zkontroluj číslo verze u skriptu a že je zapnutý. Otevřené stránky hry pak obnov (<code>F5</code>).</li></ol>
<p class="muted">Kód už obsahuje tvůj token a adresu serveru, proto ho kopíruj odsud, ne ze souboru ve složce. Chrome musí mít v <code>chrome://extensions</code> u Tampermonkey povolené „Uživatelské skripty“ (Allow user scripts).</p></div>
<div id="list"></div>
<script>
const S=[['Nezaměstnaní','/nezamestnani.user.js','Doplní nezaměstnané na planety, kterým chybí lidé (tlačítko na kartě Stavění).'],['Rasová armáda','/armada.user.js','Tlačítko Dohodit: vepíše jméno hráče a odešle rasovou armádu.'],['Stavění','/stavby.user.js','Vyplňuje a staví na planetách.'],['Mapa (OP, bdělost, teleskop)','/mapa.user.js','Hlídá OP, potvrzuje bdělost a zapíná teleskop.'],['Síla hráčů','/userscript.user.js','Posílá sílu hráčů do hlídání.'],['Útok (D)','/utok.user.js','Vyplní dobývací útok: jednotky podle nastavení a náhodnou planetu cíle.'],['Přihlášení','/prihlaseni.user.js','Po odhlášení ze hry (každé ~3 h) se samo přihlásí a obnoví karty; v době údržby 3:00–3:31 počká.']];
const el=document.getElementById('list');
for(const [name,path,desc] of S){const d=document.createElement('div');d.className='card';
 d.innerHTML='<b></b> <span class="muted"></span><div class="v muted" style="margin:6px 0"></div><a class="btn"></a><button class="copy">Zkopírovat kód</button><button class="ghost show">Zobrazit kód</button><span class="msg ok"></span><textarea hidden readonly style="width:100%;height:200px;margin-top:8px;background:#10141b;color:#e7e9ee;border:1px solid #272d3b;border-radius:6px"></textarea>';
 d.querySelector('b').textContent=name;d.querySelector('span.muted').textContent='– '+desc;const a=d.querySelector('a');a.href=path;a.textContent='Instalovat odkazem';const f=document.createElement('a');f.className='btn';f.style.background='#5ad19a';f.href='/dl/'+path.slice(1).replace('.user.js','');f.textContent='Stáhnout soubor';a.after(f);
 const ta=d.querySelector('textarea'),msg=d.querySelector('.msg');
 const load=()=>fetch(path).then(r=>r.text());
 load().then(t=>{d.querySelector('.v').textContent='Verze na serveru: '+(t.match(/@version\\s+(\\S+)/)||[])[1];ta.value=t;});
 d.querySelector('.copy').onclick=async()=>{try{await navigator.clipboard.writeText(ta.value||await load());msg.textContent='Zkopírováno ✓';}catch(e){ta.hidden=false;ta.select();msg.textContent='Kopírování se nepovedlo, označ kód níže a zkopíruj ručně (Ctrl+C).';}};
 d.querySelector('.show').onclick=()=>{ta.hidden=!ta.hidden;};
 el.appendChild(d);}
</script></body></html>`;

async function serveFile(res, file, type, transform = (x) => x) {
  const body = transform(await readFile(file, 'utf8'));
  res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
  res.end(body);
}

/**
 * Živý stav do aplikace (Server-Sent Events): nová data se pošlou hned po příjmu místo čekání na dotaz z aplikace (dřív průměrně ~0,5 s a až 1 s zpoždění).
 * Víc změn v těsném sledu se sloučí do jedné zprávy (~10 ms); jednou za vteřinu jde zpráva vždy, ať se v aplikaci drží čas serveru.
 */
const sseClients = new Set();
let ssePending = false;
function pushNow() {
  if (!sseClients.size) return;
  const chunk = `data: ${JSON.stringify(buildState())}\n\n`;
  for (const r of sseClients) r.write(chunk);
}
function pushState() {
  if (!sseClients.size || ssePending) return;
  ssePending = true;
  setTimeout(() => { ssePending = false; pushNow(); }, 10);
}
setInterval(pushNow, 1000);

/**
 * Diagnostika výpadků dat ze skriptu Síla hráčů: do logu jde mezera mezi požadavky delší než 5 s,
 * každá odmítnutá odpověď (ne 200) a pomalé zpracování. Pozná se tak, jestli data nechodí z prohlížeče, nebo je odmítá server.
 */
let ingestLastAt = 0;
function ingestSeen(now = Date.now()) {
  if (ingestLastAt && now - ingestLastAt > 5000) console.log(`[ingest] mezera ${Math.round((now - ingestLastAt) / 1000)} s bez požadavku ze skriptu`);
  ingestLastAt = now;
}
function noteIngest(status, data, ms) {
  if (status !== 200) console.log(`[ingest] odmítnuto ${status}: ${String(data?.error ?? '').slice(0, 120)}`);
  else if (ms > 500) console.log(`[ingest] pomalé zpracování ${ms} ms`);
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (req.method === 'GET' && path === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write('retry: 1000\n\n');
      res.socket?.setNoDelay(true);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      res.write(`data: ${JSON.stringify(buildState())}\n\n`);
      return;
    }
    if (req.method === 'GET' && path === '/') return await serveFile(res, pub('public/index.html'), 'text/html');
    // statické soubory aplikace (styly a skripty rozhraní); jen z public/css a public/js
    const asset = req.method === 'GET' && /^\/(css|js)\/[a-z0-9._-]+\.(css|js)$/.exec(path);
    if (asset) return await serveFile(res, pub(`public${path}`), asset[2] === 'css' ? 'text/css' : 'text/javascript');
    if (req.method === 'GET' && path === '/install') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(INSTALL_PAGE);
    }
    const scripts = { '/userscript.user.js': 'stargate-notifikator.user.js', '/mapa.user.js': 'stargate-mapa.user.js', '/stavby.user.js': 'stargate-stavby.user.js', '/armada.user.js': 'stargate-armada.user.js', '/utok.user.js': 'stargate-utok.user.js', '/prihlaseni.user.js': 'stargate-prihlaseni.user.js', '/nezamestnani.user.js': 'stargate-nezamestnani.user.js' };
    if (req.method === 'GET' && scripts[path]) {
      return await serveFile(res, pub(`userscript/${scripts[path]}`), 'text/javascript', (s) =>
        s.replace('__TOKEN__', cfg.token).replace('__SERVER__', `http://127.0.0.1:${cfg.port}`),
      );
    }
    // stažení skriptu jako souboru (pro Tampermonkey → Nástroje → Importovat ze souboru, když „Instalovat odkazem“ blokuje Chrome)
    const dl = req.method === 'GET' && /^\/dl\/(userscript|mapa|stavby|armada|utok|prihlaseni)$/.exec(path);
    if (dl) {
      const file = scripts[`/${dl[1]}.user.js`];
      const body = (await readFile(pub(`userscript/${file}`), 'utf8')).replace('__TOKEN__', cfg.token).replace('__SERVER__', `http://127.0.0.1:${cfg.port}`);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${file.replace('stargate-', 'sg-dominator-')}"`, 'cache-control': 'no-store' });
      return res.end(body);
    }
    const handler = routes[`${req.method} ${path}`];
    if (path === '/ingest') ingestSeen(); // diagnostika výpadků: kdy od skriptu přišel požadavek
    if (!handler) {
      res.writeHead(404).end();
      return;
    }
    const t0 = Date.now();
    const [status, data] = await handler(req);
    if (path === '/ingest') noteIngest(status, data, Date.now() - t0);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (e) {
    const status = e.status ?? 500;
    if (path === '/ingest') noteIngest(status, { error: e.message }, 0);
    if (status === 500) console.error(e);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

// jen localhost – config API nemá autorizaci, takže se nesmí vystavit do sítě
server.listen(cfg.port, '127.0.0.1', () => {
  if (process.env.SG_RESTARTED === '1') { // spustil nás hlídač po pádu / zaseknutí
    console.log('[hlídač] aplikace byla automaticky znovu spuštěna');
    sendService(cfg, '⚠️ Dominator spadl nebo se zasekl a hlídač ho automaticky znovu spustil.');
  }
  console.log(`Stargate dominator běží na http://127.0.0.1:${cfg.port}`);
  console.log(`Userscript nainstaluješ otevřením: http://127.0.0.1:${cfg.port}/userscript.user.js`);
});
