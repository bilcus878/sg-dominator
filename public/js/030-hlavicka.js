/* ---------- hlavička ---------- */
function renderChips() {
  const notify = cfg.notify !== false;
  if (document.activeElement !== $('notifyMaster')) $('notifyMaster').checked = notify;
  if (document.activeElement !== $('armyAuto')) $('armyAuto').checked = !!cfg.army?.auto?.enabled;
  $('armyTgl').classList.toggle('on', !!cfg.army?.auto?.enabled);
  ntMenu.classList.toggle('chatoff', !notify);
  renderBell();
  for (const cb of ntMenu.querySelectorAll('input[data-nt]')) if (document.activeElement !== cb) cb.checked = cfg.notifyTypes?.[cb.dataset.nt] !== false;
  const chip = (t, on) => `<span class="pill ${on && notify ? 'ok' : ''}">${t}</span>`;
  $('ntChan').innerHTML = chip('Telegram ' + (cfg.telegram.enabled && cfg.telegram.configured ? '✓' : '✗'), cfg.telegram.enabled && cfg.telegram.configured)
    + chip('Discord ' + (cfg.discord.enabled && cfg.discord.configured ? '✓' : '✗'), cfg.discord.enabled && cfg.discord.configured)
    + `<span class="pill">Výchozí práh ${fmt(cfg.threshold)}</span>`;
}

const ageOf = (r) => (r.at ? S.serverTime - r.at : null);
const isLive = (r) => ageOf(r) != null && ageOf(r) < 3000;
const watchedCount = (r) => r.players.filter((p) => p.watched).length;

// stav dat po zdrojích (sledované rasy a OP): zelená do 3 s od posledního příjmu, žlutá do 10 s, červená dál; stáří se přepočítává i mezi dotazy na server
let fetchedAt = Date.now();
const dAge = (at) => (at ? Math.max(0, S.serverTime + (Date.now() - fetchedAt) - at) : null);
const dSec = (ms) => (ms < 10_000 ? (ms / 1000).toFixed(1).replace('.', ',') : Math.round(ms / 1000)) + ' s';
function dataItem(label, at, extra = {}) {
  const age = dAge(at);
  let cls = 'ok', txt;
  if (extra.off) { cls = ''; txt = 'vypnuto'; }
  else if (age == null) { cls = 'bad'; txt = extra.wait ?? 'čeká na data'; }
  else if (age < 3000) txt = dSec(age);
  else if (age < 10_000) { cls = 'warn'; txt = dSec(age); }
  else { cls = 'bad'; txt = 'bez dat ' + dSec(age); }
  if (extra.hit && cls === 'ok') cls = 'hit';
  const tip = extra.tip ? `title="${esc(extra.tip)}"` : '';
  return { cls, html: `<span class="dsrc ${cls}${extra.link ? ' link' : ''}" ${tip} ${extra.link ? 'data-go="op"' : ''}><i></i>${esc(label)}${extra.extra ? ' ' + esc(extra.extra) : ''} <b>${esc(txt)}</b></span>` };
}
function renderData() {
  const box = $('dstat');
  if (!S.races) return;
  const items = []; // data ras jsou u názvu každého panelu (stáří v s); tady jen OP a to jen když je zapnuté
  const op = S.op;
  if (op && (op.enabled || op.dots.length)) {
    const n = op.dots.length;
    items.push(dataItem('OP', op.at, { off: !op.enabled, wait: 'čeká na mapu', hit: n > 0 && op.enabled, link: true, extra: n ? `${n} ${n === 1 ? 'tečka' : n < 5 ? 'tečky' : 'teček'}` : '', tip: op.enabled ? 'Mapa (mapa.php): data o OP. Klikni pro nastavení OP.' : 'OP je vypnuto (přepínač OP nahoře). Klikni pro nastavení.' }));
  }
  const bad = items.some((i) => i.cls === 'bad'), warn = items.some((i) => i.cls === 'warn');
  box.className = 'dstat ' + (bad ? 'bad' : warn ? '' : items.length ? 'ok' : '');
  const html = items.length ? items.map((i) => i.html).join('') : '';
  if (box.dataset.h !== html) { box.dataset.h = html; box.innerHTML = html; }
}
/** Stáří dat u názvu každého panelu rasy: přepočítává se čtyřikrát za vteřinu (zelená do 3 s, žlutá do 10 s, červená dál). */
function tickAges() {
  if (!S.serverTime) return;
  for (const [id, v] of view) {
    if (v.isW) { v.age.hidden = true; continue; }
    const r = raceOf(id), age = r?.at ? dAge(r.at) : null;
    const cls = age == null ? '' : age < 3000 ? 'ok' : age < 10_000 ? 'warn' : 'bad';
    const txt = age == null ? 'bez dat' : age >= 10_000 ? '⚠ ' + dSec(age) : dSec(age);
    if (v.age.dataset.c !== cls) { v.age.dataset.c = cls; v.age.className = 'rage ' + cls; }
    if (v.age.textContent !== txt) v.age.textContent = txt;
    const dot = 'dot' + (age == null ? '' : age < 3000 ? ' live' : ' stale');
    if (v.dot.className !== dot) v.dot.className = dot;
    const fresh = cls || 'none';
    if (v.root.dataset.fresh !== fresh) v.root.dataset.fresh = fresh; // warn/bad: tabulka ztlumená, alarmy vypnuté
  }
}
setInterval(() => { if (S.serverTime) { renderData(); tickAges(); } }, 250);
$('dstat').addEventListener('click', (e) => { if (e.target.closest('[data-go=op]')) { openDrawer(); document.querySelector('[data-tab="op"]').click(); } });

