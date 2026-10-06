/* ---------- Útok (D): nastavení jednotek ---------- */
const markDirty = () => ($('dirtyNote').textContent = 'neuložené změny');
function atkRow(u) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input type="text" class="aname" placeholder="Název jednotky"></td>
    <td class="n"><input type="text" inputmode="numeric" class="num acount"></td>
    <td class="c"><label class="sw"><input type="checkbox" class="amax"><span></span></label></td>
    <td class="c"><button type="button" class="icon adel" title="Odebrat jednotku">✕</button></td>`;
  tr.querySelector('.aname').value = u.name;
  tr.querySelector('.acount').value = dots(u.count || '');
  tr.querySelector('.amax').checked = !!u.max;
  return tr;
}
let atkDraft = { D: [] }, atkType = 'D'; // rozpracované jednotky po druzích útoku (uloží se až tlačítkem Uložit)
const tableUnits = () => [...$('atkUnits').rows].map((tr) => ({ name: tr.querySelector('.aname').value.trim(), count: undots(tr.querySelector('.acount').value) ?? 0, max: tr.querySelector('.amax').checked })).filter((u) => u.name);
function showAtkType(t, store = true) {
  if (store) atkDraft[atkType] = tableUnits(); // uložit rozpracované jednotky odcházejícího druhu
  atkType = t;
  const body = $('atkUnits');
  body.innerHTML = '';
  for (const u of atkDraft[t] ?? []) body.appendChild(atkRow(u));
  $('atkNone').hidden = (atkDraft[t] ?? []).length > 0;
  $('atkTypes').innerHTML = Object.keys(ATK_NAMES).map((k) => `<button type="button" class="${k === t ? 'on' : ''}" data-t="${k}" title="${esc(ATK_NAMES[k])} útok${(atkDraft[k] ?? []).length ? ' · ' + atkDraft[k].length + ' jednotek' : ''}">${k}${(atkDraft[k] ?? []).length ? ' ·' + atkDraft[k].length : ''}</button>`).join('');
}
$('atkTypes').addEventListener('click', (e) => { const b = e.target.closest('button[data-t]'); if (b) showAtkType(b.dataset.t); });
function renderAtk(a) {
  atkDraft = { D: a.units ?? [], ...(a.types ?? {}) };
  atkType = 'D';
  showAtkType('D', false);
  $('atkRandom').checked = !!a.randomPlanet;
}
function renderArmy(a) {
  const body = $('armyUnits');
  body.innerHTML = '';
  for (const u of a?.units ?? []) body.appendChild(atkRow(u));
  $('armyNone').hidden = (a?.units ?? []).length > 0;
  const au = a?.auto ?? { enabled: false, minSec: 2, maxSec: 4, gapMinSec: 0.9, gapMaxSec: 2.5, repeat: false, cooldownSec: 60 };
  $('armyAutoOn').checked = !!au.enabled; $('armyMin').value = au.minSec; $('armyMax').value = au.maxSec;
  $('armyGapMin').value = au.gapMinSec ?? 0.9; $('armyGapMax').value = au.gapMaxSec ?? 2.5;
  $('armyRepeat').checked = !!au.repeat; $('armyCooldown').value = au.cooldownSec;
}
const readArmy = () => ({ units: [...$('armyUnits').rows].map((tr) => ({ name: tr.querySelector('.aname').value.trim(), count: undots(tr.querySelector('.acount').value) ?? 0, max: tr.querySelector('.amax').checked })).filter((u) => u.name),
  auto: { enabled: $('armyAutoOn').checked, minSec: $('armyMin').value, maxSec: $('armyMax').value, gapMinSec: $('armyGapMin').value, gapMaxSec: $('armyGapMax').value, repeat: $('armyRepeat').checked, cooldownSec: $('armyCooldown').value } });
$('armyAdd').onclick = () => { $('armyUnits').appendChild(atkRow({ name: '', count: 0, max: false })); $('armyNone').hidden = true; markDirty(); };
$('armyUnits').addEventListener('click', (e) => { const b = e.target.closest('.adel'); if (b) { b.closest('tr').remove(); markDirty(); } });
function readAtk() {
  atkDraft[atkType] = tableUnits();
  const { D, ...types } = atkDraft;
  return { randomPlanet: $('atkRandom').checked, units: D ?? [], types };
}
$('atkAdd').onclick = () => { $('atkUnits').appendChild(atkRow({ name: '', count: 0, max: false })); $('atkNone').hidden = true; markDirty(); };
$('atkUnits').addEventListener('click', (e) => { const b = e.target.closest('.adel'); if (b) { b.closest('tr').remove(); markDirty(); } });
async function loadAtkInfo() {
  try {
    const { seen, report } = await api('/api/attack');
    const when = (t) => new Date(t).toLocaleTimeString('cs-CZ');
    const parts = [];
    parts.push(seen.at
      ? `Jednotky na stránce útoku (${when(seen.at)}): ${seen.units.map((u) => `${esc(u.name)}${u.available != null ? ` (${dots(u.available)})` : ''}`).join(', ') || '–'}`
      : 'Stránku útoku jsi zatím neotevřel (klikni u cizí rasy na D).');
    if (report) {
      const filled = report.filled.map((f) => `${esc(f.name)} ${f.value === 'max' ? 'max' : dots(f.value)}`).join(', ');
      parts.push(`<br>Poslední vyplnění (${when(report.at)}): ${report.ok ? '<span style="color:var(--ok)">✓ v pořádku</span>' : '<span style="color:var(--bad)">✗ s problémem</span>'}`
        + `${report.target ? ` · cíl ${esc(report.target)}` : ''}${report.planet ? ` · planeta ${esc(report.planet)}` : ''}`
        + `${filled ? `<br>Vyplněno: ${filled}` : ''}${report.submitted ? ' · <b>odesláno</b>' : ' · neodesláno'}`
        + `${report.problems.length ? `<br><span style="color:var(--bad)">${report.problems.map(esc).join('; ')}</span>` : ''}`);
    }
    $('atkReport').innerHTML = parts.join('');
  } catch (e) { $('atkReport').textContent = 'Nelze načíst: ' + e.message; }
}
$('atkRefresh').onclick = loadAtkInfo;
document.querySelector('[data-tab="attack"]').addEventListener('click', loadAtkInfo);


/* ---------- Automatický dohoz: vypínač v hlavičce a stav ---------- */
$('armyAuto').onchange = () => {
  const on = $('armyAuto').checked;
  cfg.army = { ...cfg.army, auto: { ...cfg.army.auto, enabled: on } };
  $('armyAutoOn').checked = on;
  renderAutoArmy();
  savePartial({ army: { auto: { enabled: on } } });
};
function renderAutoArmy() {
  const on = !!cfg?.army?.auto?.enabled;
  $('armyTgl').classList.toggle('on', on);
  const s = S.autoArmy;
  if (!s) return;
  const label = { plan: 'naplánováno', sent: 'odesláno', skip: 'přeskočeno', fail: 'selhalo' };
  const last = s.recent[s.recent.length - 1];
  const txt = `${on ? 'Zapnuto' : 'Vypnuto'}. Odesláno ${s.sent}×, přeskočeno ${s.skipped}×, selhalo ${s.failed}×.`
    + (s.pending.length ? ` Čeká: ${s.pending.map((p) => `${esc(p.name)} za ${Math.ceil(p.inMs / 1000)} s`).join(', ')}.` : '')
    + (last ? ` Naposledy: ${esc(last.name)} – ${label[last.type] ?? last.type}${last.text ? ` (${esc(last.text)})` : ''}.` : '');
  const el = $('armyAutoStatus');
  if (el.dataset.t !== txt) { el.dataset.t = txt; el.innerHTML = txt; }
}
