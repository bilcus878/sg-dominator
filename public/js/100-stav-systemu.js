/* ---------- stav systému (LED v hlavičce) ---------- */
let sseUp = false;
function healthItems() {
  const items = [];
  const stream = sseUp && Date.now() - lastPush < 4000;
  items.push({ cls: stream ? 'ok' : 'bad', t: 'Server Dominatora', v: stream ? 'připojeno' : 'bez spojení' });
  for (const r of S.races ?? []) {
    if (r.mode === 'off') continue;
    const age = r.at ? dAge(r.at) : null;
    items.push({ cls: age == null ? 'bad' : age < 3000 ? 'ok' : age < 10_000 ? 'warn' : 'bad', t: `Data: ${r.name}`, v: age == null ? 'čeká na data' : dSec(age) });
  }
  const op = S.op;
  if (op?.enabled) { const a = op.at ? dAge(op.at) : null; items.push({ cls: a == null ? 'bad' : a < 3000 ? 'ok' : a < 10_000 ? 'warn' : 'bad', t: 'OP: mapa', v: a == null ? 'čeká na mapu' : dSec(a) }); }
  if (cfg && cfg.notify !== false) { const ok = cfg.telegram?.enabled && cfg.telegram?.configured; items.push({ cls: ok ? 'ok' : 'warn', t: 'Telegram', v: ok ? 'nastaveno' : 'nenastaveno, zprávy se neposílají' }); }
  return items;
}
function renderHealth() {
  if (!S.serverTime) return;
  const items = healthItems();
  const worst = items.some((i) => i.cls === 'bad') ? 'bad' : items.some((i) => i.cls === 'warn') ? 'warn' : 'ok';
  const led = $('hlLed'); if (led.dataset.c !== worst) { led.dataset.c = worst; led.className = 'led ' + worst; $('hlBtn').title = { ok: 'Vše v pořádku', warn: 'Něco je zpožděné nebo nenastavené', bad: 'Problém: klikni pro podrobnosti' }[worst]; }
  if (!$('hlMenu').hidden) $('hlMenu').innerHTML = '<div class="hlhd">Stav systému</div>' + items.map((i) => `<div class="hlrow"><i class="${i.cls}"></i><span>${esc(i.t)}</span><b>${esc(i.v)}</b></div>`).join('');
}
$('hlBtn').onclick = (e) => { e.stopPropagation(); closeMenu(); viewMenu.hidden = true; toggleNt(false); toggleAl(false); $('hlMenu').hidden = !$('hlMenu').hidden; renderHealth(); };
document.addEventListener('click', (e) => { if (!$('hlMenu').hidden && !e.target.closest('.hlwrap')) $('hlMenu').hidden = true; });
setInterval(renderHealth, 500);


