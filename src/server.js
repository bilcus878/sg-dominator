import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { loadConfig, saveConfig, sanitizeUpdate, publicConfig, DATA_DIR, LEGACY_DATA_DIR, USING_DEFAULT_DIR } from './config.js';
import { migrateLegacyData } from './migrate.js';
import { createState, evaluate, rebaseline } from './rules.js';
import { formatAlert, sendText, findTelegramChats } from './notifiers.js';
import { openDb } from './db.js';
import { createStore } from './store.js';
import { createOpTracker } from './op.js';
import { resolveWatch } from './watch.js';
import { createWatchdog } from './watchdog.js';
import { BUILDINGS, createBuildRun } from './build.js';

// data bydlela dřív ve složce projektu (Dropbox); při prvním spuštění se přesunou mimo ni
if (USING_DEFAULT_DIR) migrateLegacyData(LEGACY_DATA_DIR, DATA_DIR);
let cfg = loadConfig();
if (process.env.SG_PORT) cfg.port = Number(process.env.SG_PORT);
const state = createState();
const store = createStore();
const op = createOpTracker();
let opLastAt = 0;
const lastWritten = new Map();
const watchdog = createWatchdog();
const raceLastAt = new Map(); // raceId -> čas posledních dat (nezávisle na pročišťování store)
const playerRace = new Map(); // jméno -> raceId (pro přepočet prahů po změně konfigurace)
const build = createBuildRun({ notify: (t) => sendText(cfg, t) });
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
    out.push({ name: p.name.trim(), power: Math.round(power) });
  }
  return out;
}

/** Rasu při prvním výskytu zaregistruje jako vypnutou (hlídání zapneš v jejím panelu). */
function registerRace(raceId, name) {
  const rec = cfg.races[raceId];
  if (!rec) {
    cfg.races[raceId] = {
      name: name || `Rasa #${raceId}`,
      mode: 'off', // nová rasa se nehlídá, dokud ji nezapneš
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
  const resolved = players.map((p) => {
    playerRace.set(p.name, raceId);
    const { watched, threshold, critical } = resolveWatch(cfg, raceId, p.name);
    return { ...p, watched, threshold, critical };
  });
  const alerts = evaluate(state, resolved, cfg, now);
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
  const todo = [...fresh.map((f) => ({ f, repeat: false })), ...repeats.map((f) => ({ f, repeat: true }))];
  for (const { f, repeat } of todo) {
    const name = /^\d+$/.test(f.label) || !f.label ? `Sektor ${f.id}` : `Sektor ${f.id} (${f.label})`;
    const a = { name, power: 0, prev: null, reason: 'op', race: null, repeat };
    db.recordAlert(now, a);
    console.log(`[alert] OP ${repeat ? 'stále ' : ''}v ${name}`);
    sendText(cfg, formatAlert(a));
  }
  return [200, { ok: true, alerts: todo.length }];
}

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
      threshold: rec.threshold,
      criticalPct: rec.criticalPct ?? null,
      at: snap.at,
      sources: snap.sources,
      players: snap.players.map((p) => ({ name: p.name, power: p.power, ...resolveWatch(cfg, id, p.name) })),
    };
  });
  const recent = ingestTimes.filter((t) => t > now - 10_000);
  const ratePerSec = recent.length ? recent.length / Math.min(10, (now - recent[0]) / 1000 + 1) : 0;
  const opState = { enabled: cfg.op.enabled, at: opLastAt, dots: op.current(now) };
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
    sendText(cfg, formatAlert(a));
  }
}
setInterval(watchdogTick, 5000);
setInterval(() => { if (build.staleCheck()) sendText(cfg, '⚠️ Stavění: skript přestal hlásit (zavřená karta nebo odhlášení?)'); }, 10_000);

/** Hlášení ze stránky stavby.php -> instrukce, co dělat dál. */
async function handleBuildReport(req) {
  if (!authOk(req)) return [401, { error: 'bad token' }];
  const body = await readJson(req);
  return [200, build.report(body, cfg.build)];
}
const buildView = () => [200, { buildings: BUILDINGS, config: cfg.build, run: build.snapshot(), serverTime: Date.now() }];

const routes = {
  'POST /ingest': handleIngest,
  'POST /ingest-op': handleIngestOp,
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
  'POST /api/test': async () => [
    200,
    await sendText(cfg, '✅ Stargate dominator: testovací zpráva'),
  ],
};

async function serveFile(res, file, type, transform = (x) => x) {
  const body = transform(await readFile(file, 'utf8'));
  res.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (req.method === 'GET' && path === '/') return await serveFile(res, pub('public/index.html'), 'text/html');
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
