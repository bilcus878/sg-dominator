/* ---------- hlavička ---------- */
function renderChips() {
  const notify = cfg.notify !== false;
  if (document.activeElement !== $('notifyMaster')) $('notifyMaster').checked = notify;
  ntMenu.classList.toggle('chatoff', !notify);
  renderBell();
  for (const cb of ntMenu.querySelectorAll('input[data-nt]')) if (document.activeElement !== cb) cb.checked = cfg.notifyTypes?.[cb.dataset.nt] !== false;
  renderChannels();
}
/** Kanály dole v nabídce Alerty: nastaveno ✓, a když poslední odeslání selhalo (třeba neplatný token), červeně s důvodem. */
function renderChannels() {
  if (!cfg) return;
  const notify = cfg.notify !== false, st = S.sendStatus ?? {};
  const chip = (name, on, key) => {
    const s = st[key], bad = on && s && !s.ok;
    return `<span class="pill ${bad ? 'bad' : on && notify ? 'ok' : ''}" title="${bad ? esc(`Poslední odeslání selhalo: ${s.error}`) : ''}">${name} ${bad ? '⚠ zprávy nechodí' : on ? '✓' : '✗'}</span>`;
  };
  const html = chip('Telegram', cfg.telegram.enabled && cfg.telegram.configured, 'telegram')
    + chip('Discord', cfg.discord.enabled && cfg.discord.configured, 'discord')
    + `<span class="pill">Výchozí práh ${fmt(cfg.threshold)}</span>`;
  if ($('ntChan').dataset.h !== html) { $('ntChan').dataset.h = html; $('ntChan').innerHTML = html; }
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
  return { cls, txt, html: `<span class="dsrc ${cls}${extra.link ? ' link' : ''}" ${tip} ${extra.link ? 'data-go="op"' : ''}><i></i>${esc(label)}${extra.extra ? ' ' + esc(extra.extra) : ''} <b>${esc(txt)}</b></span>` };
}
function renderData() {
  const box = $('dstat');
  if (!S.races) return;
  const op = S.op, show = !!(op && (op.enabled || op.dots.length)); // jen OP, a to jen když je zapnuté nebo na mapě svítí tečky
  box.hidden = !show;
  if (!show) return;
  // jediný čip „● OP 🟠 N · stáří“: DOM je stálý, mění se jen text a třída (popover se sektory pod myší nemizí)
  const n = op.dots.length, chip = $('opChip');
  const d = dataItem('OP', op.at, { off: !op.enabled, wait: 'čeká na mapu', hit: n > 0 && op.enabled });
  const cls = 'dsrc opsum link ' + d.cls;
  if (chip.className !== cls) chip.className = cls;
  const nTxt = n ? ' 🟠 ' + n : '';
  if ($('opChipN').textContent !== nTxt) $('opChipN').textContent = nTxt;
  if ($('opChipAge').textContent !== d.txt) $('opChipAge').textContent = d.txt;
  const tip = op.enabled ? 'Mapa (mapa.php): data o OP. Klikni pro nastavení OP.' : 'OP je vypnuto (přepínač OP nahoře). Klikni pro nastavení.';
  if (chip.title !== tip) chip.title = tip;
  const key = op.dots.map((x) => `${x.id}|${x.label}`).join(',');
  const pop = $('opChipPop');
  if (pop.dataset.k !== key) {
    pop.dataset.k = key;
    pop.innerHTML = n ? `<b>${n === 1 ? 'OP na mapě' : `OP na mapě (${n})`}</b>${op.dots.map((x) => `<span class="opsec">🟠 Sektor ${esc(x.id)}${/^\d+$/.test(x.label) || !x.label ? '' : ` · ${esc(x.label)}`}</span>`).join('')}` : '';
  }
  pop.style.display = n ? '' : 'none';
  box.className = 'dstat ' + (d.cls === 'bad' ? 'bad' : d.cls === 'warn' ? '' : 'ok');
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

