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
  const au = a?.auto ?? { enabled: false, minSec: 2, maxSec: 4, gapMinSec: 0.9, gapMaxSec: 2.5, roundMinSec: 2, roundMaxSec: 4, cooldownMinSec: 60, cooldownMaxSec: 120, maxPerHour: 200, selfName: '', selfMinSec: 0.3, selfMaxSec: 1, selfRoundMinSec: 0.4, selfRoundMaxSec: 1.2 };
  $('armyAutoOn').checked = !!au.enabled; $('armyMin').value = au.minSec; $('armyMax').value = au.maxSec;
  $('armyGapMin').value = au.gapMinSec ?? 0.9; $('armyGapMax').value = au.gapMaxSec ?? 2.5;
  $('armyRoundMin').value = au.roundMinSec ?? 2; $('armyRoundMax').value = au.roundMaxSec ?? 4;
  $('armyCoolMin').value = au.cooldownMinSec ?? 60; $('armyCoolMax').value = au.cooldownMaxSec ?? 120;
  $('armyQuietMin').value = au.quietMinSec ?? 5; $('armyQuietMax').value = au.quietMaxSec ?? 15; $('armyMaxHour').value = au.maxPerHour ?? 200;
  $('armySelfName').value = au.selfName ?? ''; $('armySelfMin').value = au.selfMinSec ?? 0.3; $('armySelfMax').value = au.selfMaxSec ?? 1;
  $('armySelfRoundMin').value = au.selfRoundMinSec ?? 0.4; $('armySelfRoundMax').value = au.selfRoundMaxSec ?? 1.2;
  $('armyTopTarget').value = au.topUpTarget ? dots(au.topUpTarget) : '';
  setArmyMode(!!au.topUp);
}
const readArmy = () => ({ units: [...$('armyUnits').rows].map((tr) => ({ name: tr.querySelector('.aname').value.trim(), count: undots(tr.querySelector('.acount').value) ?? 0, max: tr.querySelector('.amax').checked })).filter((u) => u.name),
  auto: { enabled: $('armyAutoOn').checked, minSec: $('armyMin').value, maxSec: $('armyMax').value, gapMinSec: $('armyGapMin').value, gapMaxSec: $('armyGapMax').value, roundMinSec: $('armyRoundMin').value, roundMaxSec: $('armyRoundMax').value, cooldownMinSec: $('armyCoolMin').value, cooldownMaxSec: $('armyCoolMax').value, quietMinSec: $('armyQuietMin').value, quietMaxSec: $('armyQuietMax').value, maxPerHour: $('armyMaxHour').value, selfName: $('armySelfName').value.trim(), selfMinSec: $('armySelfMin').value, selfMaxSec: $('armySelfMax').value, selfRoundMinSec: $('armySelfRoundMin').value, selfRoundMaxSec: $('armySelfRoundMax').value, topUp: $('armyTopUp').checked, topUpTarget: undots($('armyTopTarget').value) ?? 0 } });
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
document.querySelector('[data-tab="army"]').addEventListener('click', loadAtkInfo);


/* ---------- Automatický dohoz: vypínač v hlavičce a stav ---------- */
function setAutoArmy(on) { // společné pro vypínač AUTO v záhlaví panelů a vypínač v nastavení
  cfg.army = { ...cfg.army, auto: { ...cfg.army.auto, enabled: on } };
  $('armyAutoOn').checked = on;
  renderAutoArmy();
  savePartial({ army: { auto: { enabled: on } } });
}
function renderAutoArmy() {
  const on = !!cfg?.army?.auto?.enabled;
  { // vypínače AUTO v záhlaví panelů: zapnuto = svítí zeleně (přepínač), poslední dohoz selhal = červený vykřičník
    const l = S.autoArmy?.recent?.[S.autoArmy.recent.length - 1];
    const bad = !!l && ['fail', 'stall', 'max', 'breaker'].includes(l.type) && S.serverTime - l.at < 600_000;
    for (const el of document.querySelectorAll('.autoh')) { el.classList.toggle('on', on); el.classList.toggle('warn', bad); if (!el.dataset.t0) el.dataset.t0 = el.title; el.title = bad ? `Poslední auto-dohoz selhal: ${l.name ? l.name + ' – ' : ''}${l.text || l.type}. Podrobnosti v Nastavení → Dohoz.` : el.dataset.t0; }
  }
  for (const cb of document.querySelectorAll('.autoarmy')) if (document.activeElement !== cb) cb.checked = on; // vypínače v záhlaví panelů
  const s = S.autoArmy;
  if (!s) return;
  const label = { plan: 'naplánováno', sent: 'odesláno', skip: 'přeskočeno', fail: 'selhalo', rescued: 'je nad prahem', rescue: 'znovu pod prahem', verified: 'dohoz zabral', cancel: 'zrušeno', breaker: 'pojistka: vypnuto', done: 'je nad cílem', stall: 'dohoz nezabral', max: 'bezpečnostní strop kol' };
  const last = s.recent[s.recent.length - 1];
  const txt = `${s.rankPaused && on ? '⏸ Pozastaveno: nemáš hodnost (jsi občan), dohazovat nelze. Rozběhne se samo, až budeš zase ministr.' : on ? 'Zapnuto.' : 'Vypnuto.'} Odesláno ${s.sent}×, přeskočeno ${s.skipped}×, selhalo ${s.failed}×.`
    + (s.topping?.length ? ` Dohazuje se: ${s.topping.map((t) => `${esc(t.name)} (${t.phase === 'rescue' ? 'nad práh' : 'k hranici'}, ${t.rounds}. dohoz, cíl ${dots(t.target)})`).join(', ')}.` : '')
    + (s.pending.length ? ` Čeká: ${s.pending.map((p) => `${esc(p.name)} za ${Math.ceil(p.inMs / 1000)} s`).join(', ')}.` : '')
    + (last ? ` Naposledy: ${esc(last.name)} – ${label[last.type] ?? last.type}${last.text ? ` (${esc(last.text)})` : ''}.` : '');
  { // moje jméno v rase: našlo se v načtených datech? (nabídka jmen pro dopisování + stav)
    const names = S.races.filter((x) => x.role !== 'attack').flatMap((x) => x.players.map((p) => p.name));
    const dl = $('armyNames'), key = names.join('|');
    if (dl.dataset.k !== key) { dl.dataset.k = key; dl.innerHTML = [...new Set(names)].sort((a, b) => a.localeCompare(b, 'cs')).map((n) => `<option value="${esc(n)}">`).join(''); }
    const typed = $('armySelfName').value.trim().toLowerCase(), saved = (cfg.army?.auto?.selfName ?? '').trim().toLowerCase();
    const want = typed || saved;
    const hit = want && S.races.flatMap((x) => x.players.map((p) => ({ x, p }))).find(({ p }) => p.name.toLowerCase() === want);
    const st = !want ? 'Bez jména se přednostní dohoz nepoužije.' : hit ? `✓ Nalezen: ${esc(hit.p.name)} (${esc(hit.x.name)}), síla ${dots(hit.p.power)}.` : '⚠ Hráč s tímto jménem zatím není v načtených datech (zkontroluj přesný zápis; po otevření stránky hráčů rasy se objeví).';
    const el2 = $('armySelfStatus'); if (el2.dataset.t !== st) { el2.dataset.t = st; el2.innerHTML = st; }
  }
  const au = cfg.army?.auto;
  const warnTop = au?.enabled && au.topUp && au.topUpTarget > 0 && au.topUpTarget <= cfg.threshold;
  const noSvc = !cfg.telegram?.serviceChatId;
  const full = txt
    + (warnTop ? ' <b style="color:var(--bad)">⚠ Horní hranice je pod výchozím prahem, cílem bude práh hráče.</b>' : '')
    + (noSvc ? '<br><span class="muted">ℹ Zprávy o automatu (selhání, pojistka) jdou jen do servisního chatu a ten není nastavený, uvidíš je tedy jen tady v aplikaci. V hlavní skupině se o automatu nikdy nic nepíše.</span>' : '<br><span class="muted">Zprávy o automatu jdou jen do servisního chatu, do hlavní skupiny se nikdy nepíše.</span>');
  const el = $('armyAutoStatus');
  if (el.dataset.t !== full) { el.dataset.t = full; el.innerHTML = full; }
}

/* ---------- Režim dohazování: jednou za pád / až do horní hranice (vzájemně se vylučují) ---------- */
function setArmyMode(top) {
  $('armyTopUp').checked = top;
  for (const b of document.querySelectorAll('#armyModeSeg button')) b.classList.toggle('on', (b.dataset.m === 'top') === top);
  $('armyTopBox').hidden = !top;
  $('armyModeHint').textContent = top
    ? 'Po každém dohození bot sleduje sílu hráče a dohazuje znovu, dokud hráč nepřekročí horní hranici.'
    : 'Bot dohazuje, dokud hráč nepřekročí svůj práh (většinou stačí jeden dohoz), a pak skončí. Když hráč po dohození znovu klesne, začne se znovu.';
}
$('armyModeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-m]');
  if (b) { setArmyMode(b.dataset.m === 'top'); markDirty(); }
});
