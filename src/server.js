import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { loadConfig, saveConfig, sanitizeUpdate, publicConfig, DATA_DIR, LEGACY_DATA_DIR, USING_DEFAULT_DIR } from './config.js';
import { migrateLegacyData } from './migrate.js';
import { createState, evaluate, rebaseline } from './rules.js';
import { formatAlert, sendText, sendService, findTelegramChats } from './notifiers.js';
import { openDb } from './db.js';
import { createStore } from './store.js';
import { createOpTracker } from './op.js';
import { resolveWatch } from './watch.js';
import { createWatchdog } from './watchdog.js';
import { BUILDINGS, createBuildRun } from './build.js';
import { createTelescope } from './telescope.js';
import { createConquest, CONQUEST_DEFAULTS } from './conquest.js';

// data bydlela dřív ve složce projektu (Dropbox); při prvním spuštění se přesunou mimo ni
if (USING_DEFAULT_DIR) migrateLegacyData(LEGACY_DATA_DIR, DATA_DIR);
let cfg = loadConfig();
if (process.env.SG_PORT) cfg.port = Number(process.env.SG_PORT);
const state = createState();
const conquest = createConquest(); // cizí rasy: kdo je k dobytí
const store = createStore();
const op = createOpTracker();
let opLastAt = 0;
const lastWritten = new Map();
const watchdog = createWatchdog();
const raceLastAt = new Map(); // raceId -> čas posledních dat (nezávisle na pročišťování store)
const playerRace = new Map(); // jméno -> raceId (pro přepočet prahů po změně konfigurace)
// historie planet pro stavění (spokojenost, co už bylo postaveno) – mimo konfiguraci, může být velká
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
    if (Number.isInteger(p.planetsDelta) && Math.abs(p.planetsDelta) < 1e6) q.planetsDelta = p.planetsDelta;
    if (typeof p.online === 'boolean') q.online = p.online; // zelená tečka ve hře
    if (typeof p.attackable === 'boolean') q.attackable = p.attackable; // sloupec Útok ve hře (false = „nelze“)
    out.push(q);
  }
  return out;
}

const raceRole = (id) => cfg.races[id]?.role ?? 'defend';

/** Rasu při prvním výskytu zaregistruje jako vypnutou (hlídání zapneš v jejím panelu). */
function registerRace(raceId, name) {
  const rec = cfg.races[raceId];
  if (!rec) {
    cfg.races[raceId] = {
      name: name || `Rasa #${raceId}`,
      mode: 'off', // nová rasa se nehlídá, dokud ji nezapneš
      role: 'attack', // nová rasa je cizí (k dobytí); naši rasu přepneš v jejím panelu
      threshold: null,
      criticalPct: null,
    };
    saveConfig(cfg);
  } else if (name && rec.name !== name) {
    rec.name = name;
    saveConfig(cfg);
  }
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

  const now = Date.now();
  registerRace(raceId, raceName);
  store.ingest({ raceId, page, src, players }, now);
  raceLastAt.set(raceId, now);
  ingestTimes.push(now);
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
  const alerts = evaluate(state, attack ? resolved.map((p) => ({ ...p, watched: false })) : resolved, cfg, now);
  if (attack) {
    for (const ev of conquest.evaluate(raceId, resolved, { ...CONQUEST_DEFAULTS, ...cfg.conquest }, now)) {
      const p = players.find((x) => x.name === ev.name);
      alerts.push({ name: ev.name, power: ev.power, prev: null, reason: ev.type, planets: p?.planets ?? null, since: ev.since });
    }
  }
  for (const a of alerts) {
    a.race = raceLabel;
    db.recordAlert(now, a);
    console.log(`[alert] [${a.race}] ${a.name} ${a.prev} -> ${a.power} (${a.reason})`);
    sendText(cfg, formatAlert(a)); // fire-and-forget, chyby se logují v notifieru
  }
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
    sectors.push({ id: String(s.id), label: s.label.slice(0, 40) });
  }
  const now = Date.now();
  opLastAt = now;
  // tracker běží i při vypnutém alertu (silent), ať se po zapnutí nehlásí staré tečky
  const { fresh, repeats } = op.update(sectors, now, { repeatMs: cfg.op.repeatSec * 1000, silent: !cfg.op.enabled });
  // jedna souhrnná zpráva za celou mapu (počet OP + sektory), ne zpráva za každý sektor
  if (fresh.length && cfg.op.enabled) {
    const r = tele.opAppeared(cfg.op, now);
    if (r.rest) console.log(`[teleskop] šetření po OP: zastavím za ${Math.round((r.stopAt - now) / 1000)} s, zapnu zpět za ${Math.round((r.restUntil - now) / 1000)} s`);
    else console.log('[teleskop] šetření po OP tentokrát ne, teleskop jede dál');
  }
  const notify = fresh.length > 0 || repeats.length > 0;
  if (notify) {
    op.markAllNotified(now); // připomínka pak přijde zase až po repeatSec pro všechny tečky naráz
    const list = sectors.map((s) => (/^\d+$/.test(s.label) || !s.label ? `Sektor ${s.id}` : `Sektor ${s.id} (${s.label})`)).join(', ');
    const a = { name: `${sectors.length}× OP – ${list}`, power: sectors.length, prev: null, reason: 'op', race: null, repeat: !fresh.length, count: sectors.length, sectors: list };
    db.recordAlert(now, a);
    console.log(`[alert] OP ${a.repeat ? 'stále ' : ''}na mapě: ${a.name}`);
    sendText(cfg, formatAlert(a));
  }
  return [200, { ok: true, alerts: notify ? 1 : 0, vigilance: cfg.op.vigilance, telescope: cfg.op.telescope }];
}

// tlačítko bdělosti na mapě: skript hlásí, že se objevilo a že ho potvrdil; zaseknuté potvrzení jde do servisního chatu
const vig = { seenAt: 0, clickedAt: 0, count: 0, pending: false, alerted: false };
const tele = createTelescope();
const VIG_ALERT_MS = 150_000; // hra dává ~5 minut, upozornit dřív, než je pozdě

async function handleVigilance(req) {
  if (!authOk(req)) return [401, { error: 'bad token' }];
  const body = await readJson(req);
  const now = Date.now();
  if (body.event === 'seen') {
    if (!cfg.op.enabled) return [200, { ok: true, action: 'ignore' }]; // OP vypnuto: bot nic nepotvrzuje
    const d = tele.vigilanceSeen(cfg.op.vigilance); // občas záměrně vynechat, ať to nevypadá jako stroj
    if (d.action === 'skip') {
      vig.pending = false;
      console.log('[bdělost] tlačítko se objevilo, tentokrát ho záměrně nepotvrdím (teleskop se zastaví a chvíli zůstane vypnutý)');
      return [200, { ok: true, action: 'skip' }];
    }
    vig.pending = true; vig.seenAt = now; vig.alerted = false;
    console.log(`[bdělost] tlačítko se objevilo, kliknu za ${Math.round(Number(body.delayMs) / 100) / 10} s`);
    return [200, { ok: true, action: 'click' }];
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
  if (!cfg.op.enabled) { tele.noteState(state); return [200, { action: 'none' }]; } // OP vypnuto: teleskop se nezapíná
  const r = tele.telescopeState({ state, remainingSec: remaining }, cfg.op, now);
  if (r.action === 'stop') console.log('[teleskop] šetření po OP: zastavuji');
  if (state !== teleLast) { teleLast = state; console.log(`[teleskop] ${state === 'active' ? 'aktivní' : 'zastavený'}`); }
  if (r.alert === 'zero') { console.log('[teleskop] nezbývá žádný čas'); sendService(cfg, '⚠️ Teleskop je zastavený a nezbývá mu žádný čas, nelze ho aktivovat.'); }
  return [200, r];
}

setInterval(() => {
  const now = Date.now();
  if (vig.pending && !vig.alerted && now - vig.seenAt > VIG_ALERT_MS) {
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
      at: snap.at,
      sources: snap.sources,
      players: snap.players.map((p) => ({
        name: p.name, power: p.power, planets: p.planets ?? null, planetsChange: p.planetsChange ?? 0, planetsAt: p.planetsAt ?? 0,
        powerDelta: p.powerDelta, powerAt: p.powerAt, attackable: p.attackable ?? null, online: p.online ?? null, ...conquest.status(id, p.name), ...resolveWatch(cfg, id, p.name),
      })),
    };
  });
  const recent = ingestTimes.filter((t) => t > now - 10_000);
  const ratePerSec = recent.length ? recent.length / Math.min(10, (now - recent[0]) / 1000 + 1) : 0;
  const opState = {
    enabled: cfg.op.enabled, at: opLastAt, dots: op.current(now),
    vigilance: { count: vig.count, lastClickedAt: vig.clickedAt, pendingSince: vig.pending ? vig.seenAt : 0 },
    telescope: tele.snapshot(),
  };
  return { races, alerts: db.recentAlerts(40), serverTime: now, ratePerSec, op: opState };
}

/** Hlídač výpadku: hlídané rasy a mapa (když je OP alert zapnutý) musí dodávat data. */
function watchdogTick(now = Date.now()) {
  if (!cfg.watchdog.enabled) return;
  const items = [];
  for (const [id, r] of Object.entries(cfg.races)) {
    if (r.mode !== 'off') items.push({ key: `race:${id}`, name: `Rasa ${r.name}`, at: raceLastAt.get(id) ?? 0 });
  }
  if (cfg.op.enabled) items.push({ key: 'op', name: 'Mapa (OP)', at: opLastAt });
  for (const ev of watchdog.check(items, now, { staleMs: cfg.watchdog.staleSec * 1000 })) {
    const a = { name: ev.name, power: 0, prev: null, reason: ev.type, race: null, ageMs: ev.ageMs };
    db.recordAlert(now, a);
    console.log(`[watchdog] ${ev.type === 'down' ? 'VÝPADEK' : 'obnoveno'}: ${ev.name} (${Math.round(ev.ageMs / 1000)} s)`);
    sendService(cfg, formatAlert(a)); // výpadek dat (rasy i mapa) je systémová věc: jen servisní chat
  }
}
setInterval(watchdogTick, 5000);
setInterval(() => { if (build.staleCheck()) { console.log('[stavění] skript přestal hlásit'); sendService(cfg, '⚠️ Stavění: skript přestal hlásit (zavřená karta nebo odhlášení?)'); } }, 10_000);

/** Hlášení ze stránky stavby.php -> instrukce, co dělat dál. */
async function handleBuildReport(req) {
  if (!authOk(req)) return [401, { error: 'bad token' }];
  const body = await readJson(req);
  return [200, build.report(body, cfg.build, Date.now(), { forceAll: !!cfg.build.forceAll })];
}
const buildView = () => [200, { buildings: BUILDINGS, config: cfg.build, run: build.snapshot(), knownPlanets: Object.keys(ledger.planets).length, serverTime: Date.now() }];

const routes = {
  'POST /ingest': handleIngest,
  'POST /ingest-op': handleIngestOp,
  'POST /vigilance': handleVigilance,
  'POST /telescope': handleTelescope,
  'POST /build/report': handleBuildReport,
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
  'PUT /api/config': async (req) => {
    cfg = sanitizeUpdate(cfg, await readJson(req), {
      playersOfRace: (id) => [...playerRace].filter(([, rid]) => rid === id).map(([name]) => name),
    });
    saveConfig(cfg);
    rebaseline(
      state,
      (name) => resolveWatch(cfg, playerRace.get(name), name).threshold,
      (name) => resolveWatch(cfg, playerRace.get(name), name).critical,
    );
    return [200, publicConfig(cfg)];
  },
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
      return [200, { chats: await findTelegramChats(token) }];
    } catch (e) {
      return [400, { error: e.message }];
    }
  },
  'POST /api/test': async () => {
    const [main, service] = await Promise.all([
      sendText(cfg, '✅ Stargate dominator: testovací zpráva'),
      sendService(cfg, 'Stargate dominator: testovací zpráva do servisního chatu'),
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
<p class="muted">Když odkaz „Instalovat“ nic neotevře (jen to bliká), použij ruční cestu níže.</p>
<div class="card"><b>Ruční vložení (funguje vždy)</b><ol>
<li>Klikni u skriptu na <b>Zkopírovat kód</b>.</li>
<li>Ikona Tampermonkey → <b>Přehled</b> (Dashboard). Když skript už v seznamu je, klikni na jeho název; jinak ikona → <b>Vytvořit nový skript</b>.</li>
<li>V editoru <code>Ctrl+A</code>, <code>Ctrl+V</code> (nahradí se celý obsah) a <code>Ctrl+S</code>.</li>
<li>V Přehledu zkontroluj číslo verze u skriptu a že je zapnutý. Otevřené stránky hry pak obnov (<code>F5</code>).</li></ol>
<p class="muted">Kód už obsahuje tvůj token a adresu serveru, proto ho kopíruj odsud, ne ze souboru ve složce. Chrome musí mít v <code>chrome://extensions</code> u Tampermonkey povolené „Uživatelské skripty“ (Allow user scripts).</p></div>
<div id="list"></div>
<script>
const S=[['Stavění','/stavby.user.js','Vyplňuje a staví na planetách.'],['Mapa (OP, bdělost, teleskop)','/mapa.user.js','Hlídá OP, potvrzuje bdělost a zapíná teleskop.'],['Síla hráčů','/userscript.user.js','Posílá sílu hráčů do hlídání.']];
const el=document.getElementById('list');
for(const [name,path,desc] of S){const d=document.createElement('div');d.className='card';
 d.innerHTML='<b></b> <span class="muted"></span><div class="v muted" style="margin:6px 0"></div><a class="btn"></a><button class="copy">Zkopírovat kód</button><button class="ghost show">Zobrazit kód</button><span class="msg ok"></span><textarea hidden readonly style="width:100%;height:200px;margin-top:8px;background:#10141b;color:#e7e9ee;border:1px solid #272d3b;border-radius:6px"></textarea>';
 d.querySelector('b').textContent=name;d.querySelector('span.muted').textContent='– '+desc;const a=d.querySelector('a');a.href=path;a.textContent='Instalovat odkazem';
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

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (req.method === 'GET' && path === '/') return await serveFile(res, pub('public/index.html'), 'text/html');
    if (req.method === 'GET' && path === '/install') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(INSTALL_PAGE);
    }
    const scripts = { '/userscript.user.js': 'stargate-notifikator.user.js', '/mapa.user.js': 'stargate-mapa.user.js', '/stavby.user.js': 'stargate-stavby.user.js' };
    if (req.method === 'GET' && scripts[path]) {
      return await serveFile(res, pub(`userscript/${scripts[path]}`), 'text/javascript', (s) =>
        s.replace('__TOKEN__', cfg.token).replace('__SERVER__', `http://127.0.0.1:${cfg.port}`),
      );
    }
    const handler = routes[`${req.method} ${path}`];
    if (!handler) {
      res.writeHead(404).end();
      return;
    }
    const [status, data] = await handler(req);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (e) {
    const status = e.status ?? 500;
    if (status === 500) console.error(e);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

// jen localhost – config API nemá autorizaci, takže se nesmí vystavit do sítě
server.listen(cfg.port, '127.0.0.1', () => {
  console.log(`Stargate dominator běží na http://127.0.0.1:${cfg.port}`);
  console.log(`Userscript nainstaluješ otevřením: http://127.0.0.1:${cfg.port}/userscript.user.js`);
});
