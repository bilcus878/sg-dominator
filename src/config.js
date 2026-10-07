import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isBuildingId, isSatKey } from './build.js';
import { VIGILANCE_DEFAULTS, TELESCOPE_DEFAULTS } from './telescope.js';
import { REDIST_DEFAULTS } from './redist.js';
import { HUNT_DEFAULTS } from './ophunt.js';
import { CONQUEST_DEFAULTS } from './conquest.js';
import { ATTACK_DEFAULTS, sanitizeAttack, ARMY_DEFAULTS, sanitizeArmy } from './attack.js';

/** Druhy upozornění, které jdou zapnout/vypnout zvlášť (notifyTypes). Klíč = a.reason alertu; service = všechny systémové zprávy. */
export const NOTIFY_KINDS = ['threshold', 'drop', 'critical', 'recovered', 'target', 'released', 'op', 'service'];

/**
 * Datová složka (config s tajnými tokeny + databáze). Záměrně MIMO složku projektu,
 * protože ta bývá v cloudové synchronizaci (Dropbox) a tokeny i SQLite do ní nepatří.
 * SG_DATA_DIR ji přepíše (testy, oddělená instance).
 */
function defaultDataDir() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, 'sg-dominator');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'sg-dominator');
}
export const USING_DEFAULT_DIR = !process.env.SG_DATA_DIR;
export const DATA_DIR = process.env.SG_DATA_DIR || defaultDataDir();
export const LEGACY_DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url)); // dřívější umístění ve složce projektu
export const CONFIG_PATH = join(DATA_DIR, 'config.json');

/** Přihlášení po odhlášení ze hry: vše, co skript Přihlášení umí nastavit. Dvojice od–do jsou vždy náhodné v rozmezí. */
export const SESSION_DEFAULTS = {
  enabled: true, // vypnuto = skript odhlášení jen hlídá, ale sám se nepřihlašuje
  reactMinSec: 1.5, reactMaxSec: 3, // po odhlášení: za jak dlouho začít
  maintStart: '03:00', maintEnd: '03:31', // denní údržba hry (po jejím konci + 20 s se čeká ještě maintMin–maintMax)
  maintMinSec: 8, maintMaxSec: 70,
  formMinSec: 1.5, formMaxSec: 4, // prodleva před kliknutím na Přihlaš, když Chrome doplnil údaje
  maxAttempts: 3, // kolikrát se zkusí kliknout, než se to vzdá a ohlásí
  retryFirstMinSec: 110, retryFirstMaxSec: 150, // čekání před 2. pokusem
  retryNextMinSec: 280, retryNextMaxSec: 340, // čekání před dalšími pokusy
  tabWaitMin: 8, // jak dlouho (min) karta čeká, než přihlašovací panel dokončí
  closeTab: true, // po přihlášení zavřít panel otevřený skriptem
  reloadOthers: true, reloadMinSec: 2, reloadMaxSec: 8, // po přihlášení obnovit ostatní karty hry (každá v jiný okamžik)
  probeMinSec: 60, probeMaxSec: 120, // jak často hlídat, jestli přihlášení nevypršelo
  notify: { expired: true, maintenance: true, ok: true, retry: true, failed: true, 'needs-user': true }, // které zprávy jdou do servisního chatu
};
export const SESSION_EVENTS = Object.keys(SESSION_DEFAULTS.notify);

export const DEFAULTS = {
  port: 3940,
  token: '',
  threshold: 100_000_000, // globální práh síly
  criticalPct: 50, // kritická hranice = X % z hranice hráče (0 = vypnuto)
  criticalCooldownSec: 5, // pauza mezi kritickými zprávami o jednom hráči
  cooldownSec: 10, // minimum mezi alerty pro jednoho hráče
  dropPct: 0, // alert i nad prahem při propadu o X % (0 = vypnuto)
  dropWindowSec: 300, // okno pro měření propadu
  repeatWhileBelow: true, // opakovat zprávu po každé pauze, dokud je hráč pod prahem
  minDrop: 0, // pod prahem hlásit další pokles jen o aspoň tolik
  notifyRecovery: false, // hlásit i návrat nad práh
  myRace: '', // id naší rasy; všechny ostatní rasy jsou cizí (k dobytí). Prázdné = zatím nevybráno
  notify: true, // hlavní vypínač: vypnuto = bot neposílá nic do Telegramu ani Discordu
  sound: null, // zvukový poplach v prohlížeči – SDÍLENÉ mezi všemi otevřenými okny Dominatoru: { on, vol, types: { druh: bool } }; null = zatím nenastaveno (okna použijí výchozí nebo to své uložené)
  notifyTypes: {}, // vypnuté druhy upozornění: { threshold: false, … } (chybí = zapnuto); druhy v NOTIFY_KINDS
  // rasy: { [id]: { name, mode: 'off'|'all'|'selected', role: 'defend'|'attack', threshold: číslo|null, criticalPct: číslo|null } }
  // role: defend = naše rasa (hlídá se pokles pod práh), attack = cizí rasa (hlídá se „k dobytí“ podle conquest)
  races: {},
  // výjimky pro hráče: { [jméno]: { watch?: true|false, threshold?: číslo } }
  players: {},
  // skript Přihlášení: prodlevy (s) – po odhlášení do kliknutí a po konci denní údržby (3:31:20) do přihlášení
  login: { enabled: false, user: '', password: '' }, // uložené přihlašovací údaje ke hře (jen na tomto počítači v config.json, nikdy v repozitáři); enabled = skript je při přihlášení sám vyplní
  session: { ...SESSION_DEFAULTS, notify: { ...SESSION_DEFAULTS.notify } }, // opětovné přihlášení po odhlášení ze hry (skript Přihlášení čte přes /session/config)
  op: { enabled: false, repeatSec: 10, vigilance: { ...VIGILANCE_DEFAULTS }, telescope: { ...TELESCOPE_DEFAULTS }, hunt: { ...HUNT_DEFAULTS } }, // alert na tečky OP na mapě; repeatSec = připomínka, dokud svítí (0 = jen jednou); vigilance = automatické potvrzení tlačítka bdělosti po minSec až maxSec
  conquest: { ...CONQUEST_DEFAULTS }, // cizí rasy: k dobytí pod `below`, konec až nad `above`
  redist: { ...REDIST_DEFAULTS }, // přerozdělení nezaměstnaných (Obchod): podmínky zdroje a zkušební běh
  dohozStats: { enabled: true, keep: 200 }, // statistika dohozů: zapisovat a kolik posledních hotových dohazování držet
  recalc: { shared: true, pushOnStop: true, pullOnStart: true, syncMinutes: 15, military: true, economic: true, showMilitary: true, showEconomic: true, econMinGrowthPct: 0.1, hideOlderDays: 0 }, // přepočty hráčů: co se sbírá (military = vynulování Dobyt, economic = odhad z růstu populace), co se ukazuje u jmen, citlivost a stáří
  watchdog: { enabled: true, staleSec: 30 }, // hlášení, že hlídaná rasa / mapa přestala dodávat data
  discord: { enabled: false, webhookUrl: '' },
  telegram: { enabled: false, botToken: '', chatId: '', serviceChatId: '' }, // serviceChatId = servisní chat pro systémové zprávy
  // automatické stavění: plan = { [id stavby]: { mode: 'skip'|'target'|'max', n } }, parks = { [spokojenost -50|-25|0|5|10]: cílový počet }, parksMinAll = globální minimum parků (od něj výš je park hotový, planeta se kvůli němu nenavštěvuje),
  // pace = násobek lidského tempa
  build: { plan: {}, parks: {}, parksMinAll: null, dryRun: false, forceAll: false, pace: 1 },
  // dobývací útok přes D: units = [{ name, count, max }], autoSubmit = po vyplnění útok i odeslat (výchozí ne), randomPlanet = náhodná planeta cíle
  attack: { ...ATTACK_DEFAULTS, units: [] },
  army: { ...ARMY_DEFAULTS }, // dohoz: jednotky k vyplnění do formuláře Rasová armáda
};

function readJson(path) {
  // Poznámkový blok a PowerShell ukládají UTF-8 s BOM, který JSON.parse nepřijme
  return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
}

export function loadConfig() {
  let stored = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      stored = readJson(CONFIG_PATH);
    } catch (e) {
      const bak = `${CONFIG_PATH}.bak`;
      if (!existsSync(bak)) throw new Error(`Konfigurace ${CONFIG_PATH} je poškozená (${e.message}) a není záloha.`);
      console.warn(`Konfigurace je poškozená (${e.message}), načítám zálohu ${bak}`);
      stored = readJson(bak);
    }
  }
  const cfg = normalizeConfig(stored);
  if (!cfg.token) {
    cfg.token = randomBytes(16).toString('hex');
    saveConfig(cfg);
  }
  return cfg;
}

/** Uložené/profilové nastavení -> úplné nastavení (chybějící pole se doplní výchozími, hodnoty se ošetří). */
export function normalizeConfig(stored) {
  const cfg = merge(DEFAULTS, stored);
  // uložená podobjekty se s výchozími slučují jen mělce, takže chybějící nová pole se doplní tady
  cfg.recalc = { ...DEFAULTS.recalc, ...cfg.recalc };
  cfg.dohozStats = { ...DEFAULTS.dohozStats, ...cfg.dohozStats };
  cfg.redist = { ...REDIST_DEFAULTS, ...cfg.redist };
  cfg.login = { ...DEFAULTS.login, ...cfg.login };
  cfg.session = { ...DEFAULTS.session, ...cfg.session, notify: { ...SESSION_DEFAULTS.notify, ...cfg.session?.notify } };
  cfg.op.vigilance = { ...VIGILANCE_DEFAULTS, ...cfg.op.vigilance };
  cfg.op.telescope = { ...TELESCOPE_DEFAULTS, ...cfg.op.telescope };
  cfg.op.hunt = { ...HUNT_DEFAULTS, ...cfg.op.hunt };
  cfg.attack = sanitizeAttack(ATTACK_DEFAULTS, cfg.attack);
  cfg.army = sanitizeArmy(ARMY_DEFAULTS, cfg.army);
  migrateLegacy(cfg, stored);
  if (!cfg.myRace) { // starší konfigurace: naše rasa byla ta, která měla roli 'defend' (když je právě jedna)
    const mine = Object.entries(cfg.races ?? {}).filter(([, r]) => r.role === 'defend').map(([id]) => id);
    if (mine.length === 1) cfg.myRace = mine[0];
  }
  applyMyRace(cfg);
  return cfg;
}

/** Role ras podle vybrané naší rasy: naše = hlídá se pokles pod práh (defend), všechny ostatní cizí = k dobytí (attack). */
export function applyMyRace(cfg) {
  if (!cfg.myRace) return;
  for (const [id, r] of Object.entries(cfg.races ?? {})) r.role = id === cfg.myRace ? 'defend' : 'attack';
}

/** Starý formát (ignore + playerThresholds) -> players. */
function migrateLegacy(cfg, stored) {
  for (const name of stored.ignore ?? []) (cfg.players[name] ??= {}).watch = false;
  for (const [name, th] of Object.entries(stored.playerThresholds ?? {})) (cfg.players[name] ??= {}).threshold = th;
  delete cfg.ignore;
  delete cfg.playerThresholds;
  delete cfg.stats; // zrušená statistika útoků
}

/** Atomický zápis: nejdřív do dočasného souboru, pak přejmenování; předchozí verze se uchová jako .bak. */
export function saveConfig(cfg) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  if (existsSync(CONFIG_PATH)) copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.bak`);
  renameSync(tmp, CONFIG_PATH);
}

function merge(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && k in base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = { ...base[k], ...v };
    } else out[k] = v;
  }
  return out;
}

/** Validace a sanitizace konfigurace přicházející z UI. */
/**
 * @param {object} ctx { playersOfRace(id) -> jména hráčů, které známe z dané rasy }; změna režimu rasy
 *   smaže jejich ruční výjimky hlídání, aby přepínač (Nehlídat / Vybraní / Celá rasa) dělal přesně to, co říká.
 */
/** Nastavení přihlášení: čísla v mezích, dvojice od–do (konec nikdy pod začátkem), časy HH:MM, přepínače. */
export function sanitizeSession(cur, body) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  const ns = { ...SESSION_DEFAULTS, ...cur, notify: { ...SESSION_DEFAULTS.notify, ...cur?.notify } };
  const rng = (a, b, lo, hi) => {
    for (const k of [a, b]) if (k in body) ns[k] = Math.min(hi, Math.max(lo, num(body[k], ns[k])));
    if (ns[b] < ns[a]) ns[b] = ns[a];
  };
  rng('reactMinSec', 'reactMaxSec', 0.5, 30);
  rng('maintMinSec', 'maintMaxSec', 0, 900);
  rng('formMinSec', 'formMaxSec', 0.5, 30);
  rng('retryFirstMinSec', 'retryFirstMaxSec', 30, 900);
  rng('retryNextMinSec', 'retryNextMaxSec', 30, 1800);
  rng('reloadMinSec', 'reloadMaxSec', 0, 60);
  rng('probeMinSec', 'probeMaxSec', 20, 600);
  if ('maxAttempts' in body) ns.maxAttempts = Math.min(5, Math.max(1, Math.round(num(body.maxAttempts, ns.maxAttempts))));
  if ('tabWaitMin' in body) ns.tabWaitMin = Math.min(30, Math.max(2, Math.round(num(body.tabWaitMin, ns.tabWaitMin))));
  for (const k of ['enabled', 'closeTab', 'reloadOthers']) if (k in body) ns[k] = !!body[k];
  const hhmm = (s) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) : null);
  const st = 'maintStart' in body ? hhmm(body.maintStart) : hhmm(ns.maintStart);
  const en = 'maintEnd' in body ? hhmm(body.maintEnd) : hhmm(ns.maintEnd);
  if (st !== null && en !== null && en > st) { ns.maintStart = 'maintStart' in body ? body.maintStart : ns.maintStart; ns.maintEnd = 'maintEnd' in body ? body.maintEnd : ns.maintEnd; } // údržba musí skončit později, než začne (v rámci jednoho dne)
  if (body.notify && typeof body.notify === 'object') for (const k of SESSION_EVENTS) if (k in body.notify) ns.notify[k] = !!body.notify[k];
  return ns;
}

export function sanitizeUpdate(cur, body, ctx = {}) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const next = structuredClone(cur);
  next.threshold = num(body.threshold, cur.threshold);
  next.criticalPct = Math.min(100, num(body.criticalPct, cur.criticalPct));
  next.criticalCooldownSec = num(body.criticalCooldownSec, cur.criticalCooldownSec);
  next.cooldownSec = num(body.cooldownSec, cur.cooldownSec);
  next.dropPct = num(body.dropPct, cur.dropPct);
  next.minDrop = num(body.minDrop, cur.minDrop);
  if ('repeatWhileBelow' in body) next.repeatWhileBelow = !!body.repeatWhileBelow;
  if ('notifyRecovery' in body) next.notifyRecovery = !!body.notifyRecovery;
  if ('notify' in body) next.notify = !!body.notify;
  if ('myRace' in body) { // naše rasa (jedna); všechny ostatní se tím stanou cizími
    const v = String(body.myRace ?? '').trim();
    next.myRace = v === '' || next.races[v] ? v : cur.myRace ?? '';
    applyMyRace(next);
  }
  if (body.sound && typeof body.sound === 'object') { // nastavení zvuku platí pro všechna okna Dominatoru najednou (každé okno si ho jinak mělo samo)
    const cs = cur.sound ?? { on: true, vol: 80, types: {} };
    const types = { ...cs.types };
    for (const k of NOTIFY_KINDS) if (body.sound.types && k in body.sound.types) types[k] = !!body.sound.types[k];
    const vol = Number(body.sound.vol);
    next.sound = { on: 'on' in body.sound ? !!body.sound.on : cs.on, vol: Number.isFinite(vol) ? Math.min(100, Math.max(5, Math.round(vol))) : cs.vol, types };
  }
  if (body.notifyTypes && typeof body.notifyTypes === 'object') {
    next.notifyTypes = { ...cur.notifyTypes };
    for (const k of NOTIFY_KINDS) if (k in body.notifyTypes) { if (body.notifyTypes[k]) delete next.notifyTypes[k]; else next.notifyTypes[k] = false; }
  }
  next.dropWindowSec = num(body.dropWindowSec, cur.dropWindowSec) || 300;
  // rasy a hráči se aktualizují po částech (merge), null maže hodnotu / celý záznam
  if (body.races && typeof body.races === 'object') {
    for (const [id, r] of Object.entries(body.races)) {
      if (!/^\d{1,6}$/.test(id) || !r || typeof r !== 'object') continue;
      const rec = (next.races[id] ??= { name: `Rasa #${id}`, mode: 'off', threshold: null, criticalPct: null });
      if (['off', 'all', 'selected'].includes(r.mode)) {
        if (r.mode !== rec.mode) {
          for (const name of ctx.playersOfRace?.(id) ?? []) {
            const pl = next.players[name];
            if (!pl || pl.watch === undefined) continue;
            delete pl.watch;
            if (!Object.keys(pl).length) delete next.players[name];
          }
        }
        rec.mode = r.mode;
      }
      if (!cur.myRace && ['defend', 'attack'].includes(r.role)) rec.role = r.role; // roli určuje vybraná naše rasa; ruční přepínání jen dokud není vybrána
      if ('conquest' in r) { // vlastní hranice „k dobytí“ pro tuto cizí rasu (chybějící = společné z Nastavení)
        if (r.conquest === null) delete rec.conquest;
        else if (r.conquest && typeof r.conquest === 'object') {
          const c = { ...(rec.conquest ?? {}) };
          for (const k of ['below', 'above']) {
            if (!(k in r.conquest)) continue;
            if (r.conquest[k] === null || r.conquest[k] === '') delete c[k];
            else c[k] = Math.min(1e12, num(r.conquest[k], c[k] ?? 0));
          }
          if (c.below != null && c.above != null && c.above < c.below) c.above = c.below;
          if (Object.keys(c).length) rec.conquest = c; else delete rec.conquest;
        }
      }
      if ('threshold' in r) rec.threshold = r.threshold === null || r.threshold === '' ? null : num(r.threshold, rec.threshold);
      if ('criticalPct' in r) rec.criticalPct = r.criticalPct === null || r.criticalPct === '' ? null : Math.min(100, num(r.criticalPct, rec.criticalPct ?? 0));
      if (typeof r.name === 'string' && r.name.trim()) rec.name = r.name.trim().slice(0, 64);
    }
  }
  if (body.players && typeof body.players === 'object') {
    for (const [name, p] of Object.entries(body.players)) {
      if (!name.trim() || name.length > 64) continue;
      if (p === null) { delete next.players[name]; continue; }
      if (typeof p !== 'object') continue;
      const rec = { ...(next.players[name] ?? {}) };
      if ('watch' in p) { if (p.watch === null) delete rec.watch; else rec.watch = !!p.watch; }
      if ('threshold' in p) {
        if (p.threshold === null || p.threshold === '') delete rec.threshold;
        else if (Number.isFinite(Number(p.threshold)) && Number(p.threshold) >= 0) rec.threshold = Number(p.threshold);
      }
      if ('topTarget' in p) { // vlastní horní hranice pro dohazování (prázdné = výchozí z Nastavení → Dohoz)
        if (p.topTarget === null || p.topTarget === '') delete rec.topTarget;
        else if (Number.isFinite(Number(p.topTarget)) && Number(p.topTarget) >= 0) rec.topTarget = Math.min(1e13, Math.floor(Number(p.topTarget)));
      }
      if (Object.keys(rec).length) next.players[name] = rec; else delete next.players[name];
    }
  }
  if (body.login && typeof body.login === 'object') {
    const l = { ...DEFAULTS.login, ...cur.login };
    if (typeof body.login.user === 'string') l.user = body.login.user.trim().slice(0, 64);
    if (typeof body.login.password === 'string' && body.login.password) l.password = body.login.password.slice(0, 128); // prázdné pole = beze změny
    if (body.login.clearPassword) l.password = '';
    if ('enabled' in body.login) l.enabled = !!body.login.enabled;
    next.login = l;
  }
  if (body.session && typeof body.session === 'object') next.session = sanitizeSession(cur.session, body.session);
  if (body.op && typeof body.op === 'object') {
    next.op = { ...cur.op };
    if ('enabled' in body.op) next.op.enabled = !!body.op.enabled;
    if ('repeatSec' in body.op) next.op.repeatSec = num(body.op.repeatSec, cur.op.repeatSec);
    if (body.op.vigilance && typeof body.op.vigilance === 'object') {
      const v = body.op.vigilance;
      const cv = { ...VIGILANCE_DEFAULTS, ...cur.op.vigilance };
      const nv = { ...cv };
      const rng = (a, b, lo, hi, int) => { // dvojice min/max v mezích; max nikdy pod min
        for (const k of [a, b]) if (k in v) nv[k] = Math.min(hi, Math.max(lo, num(v[k], cv[k])));
        if (int) { nv[a] = Math.floor(nv[a]); nv[b] = Math.floor(nv[b]); }
        if (nv[b] < nv[a]) nv[b] = nv[a];
      };
      for (const k of ['enabled', 'skipEnabled']) if (k in v) nv[k] = !!v[k];
      rng('minSec', 'maxSec', 1, 120, false);
      rng('skipMin', 'skipMax', 1, 50, true);
      rng('downMin', 'downMax', 1, 240, false);
      next.op.vigilance = nv;
    }
    if (body.op.telescope && typeof body.op.telescope === 'object') {
      const t = body.op.telescope;
      const ct = { ...TELESCOPE_DEFAULTS, ...cur.op.telescope };
      const nt = { ...ct };
      if ('auto' in t) nt.auto = !!t.auto;
      for (const k of ['reactMinSec', 'reactMaxSec']) if (k in t) nt[k] = Math.min(600, Math.max(1, num(t[k], ct[k])));
      if (nt.reactMaxSec < nt.reactMinSec) nt.reactMaxSec = nt.reactMinSec;
      if ('restEnabled' in t) nt.restEnabled = !!t.restEnabled;
      if ('restChance' in t) nt.restChance = Math.min(100, num(t.restChance, ct.restChance));
      for (const k of ['restStopMin', 'restStopMax', 'restResumeMin', 'restResumeMax']) if (k in t) nt[k] = Math.min(240, Math.max(5, num(t[k], ct[k])));
      if (nt.restStopMax < nt.restStopMin) nt.restStopMax = nt.restStopMin;
      if (nt.restResumeMax < nt.restResumeMin) nt.restResumeMax = nt.restResumeMin;
      if (nt.restResumeMin < nt.restStopMax + 60) nt.restResumeMin = Math.min(240, nt.restStopMax + 60); // ať má smysl zastavovat
      if (nt.restResumeMax < nt.restResumeMin) nt.restResumeMax = nt.restResumeMin;
      next.op.telescope = nt;
    }
    if (body.op.hunt && typeof body.op.hunt === 'object') { // automat na OP (lovení opuštěných planet)
      const h = body.op.hunt;
      const ch = { ...HUNT_DEFAULTS, ...cur.op.hunt };
      const nh = { ...ch };
      for (const k of ['enabled', 'dryRun']) if (k in h) nh[k] = !!h[k];
      const rng = (a, b, lo, hi) => { // dvojice od–do v mezích; konec nikdy pod začátkem
        for (const k of [a, b]) if (k in h) nh[k] = Math.min(hi, Math.max(lo, num(h[k], ch[k])));
        if (nh[b] < nh[a]) nh[b] = nh[a];
      };
      rng('reactMinSec', 'reactMaxSec', 0.3, 60);
      rng('stepMinSec', 'stepMaxSec', 0.3, 30);
      rng('claimMinSec', 'claimMaxSec', 0.3, 60);
      if ('tolerancePx' in h) nh.tolerancePx = Math.min(120, Math.max(8, num(h.tolerancePx, ch.tolerancePx)));
      if ('maxTries' in h) nh.maxTries = Math.min(10, Math.max(1, Math.floor(num(h.maxTries, ch.maxTries))));
      if ('retrySectorSec' in h) nh.retrySectorSec = Math.min(3600, Math.max(10, Math.floor(num(h.retrySectorSec, ch.retrySectorSec))));
      if ('maxPerHour' in h) nh.maxPerHour = Math.min(120, Math.max(1, Math.floor(num(h.maxPerHour, ch.maxPerHour))));
      next.op.hunt = nh;
    }
  }
  if (body.conquest && typeof body.conquest === 'object') {
    const c = { ...CONQUEST_DEFAULTS, ...cur.conquest };
    if ('below' in body.conquest) c.below = Math.min(1e12, num(body.conquest.below, c.below));
    if ('above' in body.conquest) c.above = Math.min(1e12, num(body.conquest.above, c.above));
    if (c.above < c.below) c.above = c.below; // konec nikdy pod začátkem
    next.conquest = c;
  }
  if (body.redist && typeof body.redist === 'object') {
    const r = { ...REDIST_DEFAULTS, ...cur.redist };
    const lim = (k, lo, hi) => { if (k in body.redist) r[k] = Math.min(hi, Math.max(lo, num(body.redist[k], r[k]))); };
    lim('minM', 1, 10_000); lim('maxM', 1, 10_000); lim('freeMaxM', 0, 10_000); lim('maxMoves', 1, 1000);
    lim('pace', 0.25, 3); lim('pauseMinSec', 0, 300); lim('pauseMaxSec', 0, 300);
    if (r.pauseMaxSec < r.pauseMinSec) r.pauseMaxSec = r.pauseMinSec; // konec nikdy pod začátkem
    r.maxMoves = Math.round(r.maxMoves);
    if (r.maxM < r.minM) r.maxM = r.minM; // horní hranice nikdy pod dolní
    if ('dry' in body.redist) r.dry = !!body.redist.dry;
    next.redist = r;
  }
  if (body.dohozStats && typeof body.dohozStats === 'object') {
    const st = { ...DEFAULTS.dohozStats, ...cur.dohozStats };
    if ('enabled' in body.dohozStats) st.enabled = !!body.dohozStats.enabled;
    if ('keep' in body.dohozStats) st.keep = Math.min(1000, Math.max(20, Math.round(num(body.dohozStats.keep, st.keep))));
    next.dohozStats = st;
  }
  if (body.recalc && typeof body.recalc === 'object') {
    const r = { ...DEFAULTS.recalc, ...cur.recalc };
    for (const k of ['shared', 'pushOnStop', 'pullOnStart', 'military', 'economic', 'showMilitary', 'showEconomic']) if (k in body.recalc) r[k] = !!body.recalc[k];
    if ('syncMinutes' in body.recalc) r.syncMinutes = Math.min(1440, Math.max(0, Math.round(num(body.recalc.syncMinutes, r.syncMinutes)))); // 0 = jen při startu/zastavení
    if ('econMinGrowthPct' in body.recalc) r.econMinGrowthPct = Math.min(5, Math.max(0.01, num(body.recalc.econMinGrowthPct, r.econMinGrowthPct)));
    if ('hideOlderDays' in body.recalc) r.hideOlderDays = Math.min(365, Math.round(num(body.recalc.hideOlderDays, r.hideOlderDays)));
    next.recalc = r;
  }
  if (body.watchdog && typeof body.watchdog === 'object') {
    next.watchdog = { ...cur.watchdog };
    if ('enabled' in body.watchdog) next.watchdog.enabled = !!body.watchdog.enabled;
    if ('staleSec' in body.watchdog) next.watchdog.staleSec = Math.max(10, num(body.watchdog.staleSec, cur.watchdog.staleSec));
  }
  if (body.build && typeof body.build === 'object') {
    const b = body.build;
    next.build = { ...cur.build, plan: { ...cur.build.plan }, parks: { ...cur.build.parks } };
    if ('dryRun' in b) next.build.dryRun = !!b.dryRun;
    if ('forceAll' in b) next.build.forceAll = !!b.forceAll;
    if ('pace' in b) next.build.pace = [0.4, 0.7, 1, 1.6].includes(Number(b.pace)) ? Number(b.pace) : 1;
    for (const [id, p] of Object.entries(b.plan ?? {})) {
      if (!isBuildingId(id) || !p || typeof p !== 'object') continue;
      const mode = ['skip', 'target', 'max'].includes(p.mode) ? p.mode : 'skip';
      const n = Math.min(1e9, Math.floor(num(p.n, 0)));
      next.build.plan[id] = { mode, n };
    }
    for (const [k, v] of Object.entries(b.parks ?? {})) {
      if (!isSatKey(k)) continue;
      if (v === null || v === '') delete next.build.parks[k];
      else if (Number.isFinite(Number(v)) && Number(v) >= 0) next.build.parks[k] = Math.min(1e9, Math.floor(Number(v)));
    }
    if ('parksMinAll' in b) {
      const v = b.parksMinAll;
      next.build.parksMinAll = v === null || v === '' ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(1e9, Math.floor(Number(v))) : cur.build.parksMinAll ?? null;
    }
  }
  if (body.attack && typeof body.attack === 'object') next.attack = sanitizeAttack(cur.attack, body.attack);
  if (body.army && typeof body.army === 'object') next.army = sanitizeArmy(cur.army, body.army);
  // tajné hodnoty UI nikdy nedostane zpět, takže prázdné pole = ponechat uloženou hodnotu
  if (body.discord) {
    next.discord = {
      enabled: !!body.discord.enabled,
      webhookUrl: body.discord.clear ? '' : str(body.discord.webhookUrl) || cur.discord.webhookUrl,
    };
  }
  if (body.telegram) {
    next.telegram = {
      enabled: !!body.telegram.enabled,
      botToken: body.telegram.clear ? '' : str(body.telegram.botToken) || cur.telegram.botToken,
      chatId: str(body.telegram.chatId),
      serviceChatId: 'serviceChatId' in body.telegram ? str(body.telegram.serviceChatId) : cur.telegram.serviceChatId ?? '',
    };
  }
  return next;
}

/** Konfigurace pro UI: bez ingest tokenu a bez tajných hodnot (jen příznak, zda jsou nastavené). */
export function publicConfig(cfg) {
  const { token, ...rest } = cfg;
  return {
    ...rest,
    login: { enabled: cfg.login.enabled, user: cfg.login.user, hasPassword: !!cfg.login.password }, // heslo se do rozhraní nikdy nevrací
    discord: { enabled: cfg.discord.enabled, configured: !!cfg.discord.webhookUrl },
    telegram: { enabled: cfg.telegram.enabled, configured: !!cfg.telegram.botToken, chatId: cfg.telegram.chatId, serviceChatId: cfg.telegram.serviceChatId ?? '' },
  };
}
