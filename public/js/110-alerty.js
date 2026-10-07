/* ---------- alerty (pod nástěnkou, sbalitelné) ---------- */
const alMenu = $('alMenu');
let alSeen = Number(store.get('alSeen') ?? 0) || 0; // čas, kdy jsi alerty naposledy otevřel (kolik je nových = odznak)
const toggleAl = (open) => {
  alMenu.hidden = !(open ?? alMenu.hidden);
  $('alBtn').classList.toggle('open', !alMenu.hidden);
  if (!alMenu.hidden) { alSeen = Date.now(); store.set('alSeen', String(alSeen)); renderAlBadge(); }
};
function renderAlBadge() {
  const n = (S.alerts ?? []).filter((a) => a.ts > alSeen).length;
  $('alBadge').hidden = !n || !alMenu.hidden; $('alBadge').textContent = n > 9 ? '9+' : String(n);
  for (const id of ['mBadge', 'mBadge2']) { const el = $(id); if (el) { el.hidden = !n || !alMenu.hidden; el.textContent = n > 9 ? '9+' : String(n); } } // počet nových alertů i na tlačítku Menu
}
$('alBtn').onclick = (e) => { e.stopPropagation(); closeMenu(); viewMenu.hidden = true; toggleNt(false); toggleAl(); };
document.addEventListener('click', (e) => { if (!alMenu.hidden && !e.target.closest('.alwrap')) toggleAl(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !alMenu.hidden) toggleAl(false); });

function renderAlerts() {
  $('noalerts').hidden = S.alerts.length > 0;
  $('alertsCount').textContent = S.alerts.length ? `(${S.alerts.length})` : '';
  if (!alMenu.hidden) alSeen = Date.now(); // otevřená nabídka = vše vidíš
  renderAlBadge();
  const label = { drop: 'propad %', recovered: 'zpět nad prahem' };
  $('alerts').innerHTML = S.alerts.map((a) => {
    const t = new Date(a.ts).toLocaleTimeString('cs-CZ');
    const head = `<time>${t}</time>`;
    if (a.reason === 'op') return `<div class="alert">${head}<div><b>🟠 ${esc(a.name)}</b><span class="tag">OP</span></div></div>`;
    if (a.reason === 'target') return `<div class="alert">${head}<div><b>🎯 ${esc(a.name)}</b>${a.race ? `<span class="tag">${esc(a.race)}</span>` : ''}<span class="tag" style="background:#2b2108;border-color:var(--acc);color:var(--acc)">k dobytí</span><div class="v">${fmt(a.power)}</div></div></div>`;
    if (a.reason === 'released') return `<div class="alert">${head}<div><b>✅ ${esc(a.name)}</b>${a.race ? `<span class="tag">${esc(a.race)}</span>` : ''}<span class="tag ok">už není k dobytí</span><div class="v">${fmt(a.power)}</div></div></div>`;
    if (a.reason === 'down') return `<div class="alert">${head}<div><b>⚠️ ${esc(a.name)}</b><span class="tag bad">výpadek dat</span></div></div>`;
    if (a.reason === 'up') return `<div class="alert">${head}<div><b>✅ ${esc(a.name)}</b><span class="tag ok">data zpět</span></div></div>`;
    const tag = a.reason === 'critical' ? '<span class="tag crit">🆘 KRITICKÉ</span>' : `<span class="tag">${label[a.reason] ?? 'pod prahem'}</span>`;
    return `<div class="alert">${head}
    <div><b>${esc(a.name)}</b>${a.race ? `<span class="tag">${esc(a.race)}</span>` : ''}${tag}
    <div class="v">${a.prev != null && a.prev !== a.power ? fmt(a.prev) + ' → ' : ''}${fmt(a.power)}</div></div></div>`;
  }).join('');
}
async function clearAlerts() {
  if (!confirm('Smazat historii alertů?')) return;
  await api('/api/alerts', 'DELETE'); toast('Alerty vymazány'); refresh();
}
$('clearAlerts').onclick = clearAlerts;
$('clearAlerts2').onclick = clearAlerts;

function renderOp() {
  const op = S.op;
  if (!op) return;
  if (document.activeElement !== $('opMaster')) $('opMaster').checked = !!op.enabled;
  $('opTgl').classList.toggle('on', !!op.enabled);
  const v = op.vigilance;
  if (v) {
    const ago = (t) => { const m = Math.round((S.serverTime - t) / 60000); return m < 1 ? 'před chvílí' : `před ${m} min`; };
    $('opVigStatus').textContent = v.pendingSince ? `⏳ Tlačítko se objevilo ${ago(v.pendingSince)} a čeká na potvrzení.`
      : v.count ? `Potvrzeno ${v.count}× od startu aplikace, naposledy ${ago(v.lastClickedAt)}.` : 'Zatím nebylo potvrzeno žádné tlačítko.';
  }
  const tl = op.telescope;
  if (tl) {
    const inMin = (t) => Math.max(1, Math.round((t - S.serverTime) / 60000));
    const parts = [tl.state === 'active' ? '🔭 Teleskop jede' : tl.state === 'stopped' ? '⏸ Teleskop je zastavený' : 'Stav teleskopu zatím neznám'];
    if (tl.state === 'stopped' && tl.downUntil > S.serverTime) parts.push(`záměrná pauza, zapnu za ~${inMin(tl.downUntil)} min`);
    const inSec = (t) => Math.max(1, Math.round((t - S.serverTime) / 1000));
    if (tl.stopAt > S.serverTime) parts.push(`po OP zastavím za ~${inSec(tl.stopAt)} s`);
    if (tl.restUntil > S.serverTime) parts.push(`šetřím po OP, zapnu za ~${inSec(tl.restUntil)} s`);
    if (tl.rested) parts.push(`ušetřeno ${tl.rested}×`);
    if (tl.blockedUntil > S.serverTime) parts.push(`aktivace pozastavena na ~${inMin(tl.blockedUntil)} min (nepovedla se)`);
    if (tl.untilSkip !== null) parts.push(`další vynechání bdělosti po ${tl.untilSkip} potvrzeních`);
    if (tl.skipped) parts.push(`vynecháno ${tl.skipped}×`);
    $('opTeleStatus').textContent = parts.join(' · ') + '.';
  }
}
$('opMaster').onchange = () => savePartial({ op: { enabled: $('opMaster').checked } });
