// Pomocné nástroje pro zkoušky rozhraní: testovací server na volném portu s dočasnými daty a headless Chrome ovládaný přes DevTools protokol
// (bez závislostí). Když Chrome nenajdeme, zkoušky se přeskočí (CHROME_PATH=cesta k chrome.exe ho určí ručně).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOKEN = 'testtoken';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function findChrome() {
  const c = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return c.find((p) => existsSync(p)) ?? null;
}

const freePort = () => new Promise((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); s.on('error', rej); });

/** Spustí aplikaci na volném portu s prázdnými daty. Vrací { base, api(), ingest(), stop() }. */
export async function startApp() {
  const dir = mkdtempSync(join(tmpdir(), 'sgd-ui-'));
  const port = await freePort();
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ token: TOKEN, port }));
  const node = existsSync(join(ROOT, 'runtime/node/node.exe')) ? join(ROOT, 'runtime/node/node.exe') : process.execPath;
  const proc = spawn(node, ['--disable-warning=ExperimentalWarning', 'src/server.js'], { cwd: ROOT, env: { ...process.env, SG_DATA_DIR: dir, SG_PROFILES_DIR: join(dir, 'profiles'), SG_PORT: String(port) }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/state')).ok) break; } catch { /* ještě startuje */ } await sleep(150); }
  const H = { 'x-token': TOKEN, 'content-type': 'application/json' };
  const api = (path, method = 'GET', body) => fetch(base + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
  const ingest = (raceId, raceName, players, extra = {}) => fetch(base + '/ingest', { method: 'POST', headers: H, body: JSON.stringify({ raceId: String(raceId), raceName, src: 'ui-test', ver: '3.12.1', players, ...extra }) });
  return { base, dir, api, ingest, stop: () => { proc.kill(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* soubory ještě drží proces */ } } };
}

/** Hráči pro zkoušky: síla klesá, planety rostou. */
export const makePlayers = (n, prefix = 'Hrac', power = 300_000_000) => Array.from({ length: n }, (_, i) => ({ name: prefix + i, power: power + (n - i) * 5e7, planets: 40 + i * 20, planetsDelta: i - 2 }));

/** Headless Chrome: vrací { goto, eval, shot, send, close }. */
export async function launchChrome({ width = 900, height = 800 } = {}) {
  const exe = findChrome();
  if (!exe) throw new Error('Chrome nenalezen');
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'sgd-chrome-'));
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, `--window-size=${width},${height}`, '--no-first-run', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* ještě startuje */ } }
  if (!target) { proc.kill(); throw new Error('Chrome se nespustil'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, (d) => (d.error ? rej(new Error(d.error.message)) : res(d.result))); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  return {
    send,
    async goto(url) { await send('Page.navigate', { url }); await sleep(1200); },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async waitFor(expr, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await this.eval(expr)) return true; await sleep(100); } return false; },
    async close() { try { ws.close(); } catch { /* nic */ } proc.kill(); await sleep(300); try { rmSync(dir, { recursive: true, force: true }); } catch { /* chrome ještě drží soubory */ } },
  };
}

/** Otevře aplikaci, přidá panel rasy a počká na data. */
export async function openApp(app, b, raceId) {
  await b.goto(app.base);
  await b.eval('localStorage.clear(); location.reload(); 1'); await sleep(1500);
  await b.eval(`(async () => { const w = (ms) => new Promise(r => setTimeout(r, ms)); document.getElementById('addPanel').click(); await w(300); document.querySelector('#addMenu [data-add="${raceId}"]')?.click(); await w(600); document.body.click(); return 1; })()`);
  await sleep(800);
}
