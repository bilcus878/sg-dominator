/* ---------- přidání panelu ---------- */
function candidates() {
  const shown = new Set(panels ?? []);
  return S.races.filter((r) => !shown.has(r.id)).sort((a, b) => (isLive(b) ? 1 : 0) - (isLive(a) ? 1 : 0) || a.name.localeCompare(b.name, 'cs'));
}
function addPanel(id) {
  panels = [...(panels ?? []), id]; saveUi(); closeMenu(); renderBoard();
  view.get(id)?.root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function closeMenu() { $('addMenu').hidden = true; }
$('addPanel').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = $('addMenu');
  if (!menu.hidden) return closeMenu();
  const cand = candidates();
  const live = cand.filter(isLive);
  // jediná otevřená rasa = přidá se hned; víc = nabídka k výběru
  if (live.length === 1 && cand.length === live.length) { addPanel(live[0].id); toast(`Přidána rasa ${live[0].name}`); return; }
  const item = (r) => `<button class="item" data-add="${esc(r.id)}"><span class="dot ${isLive(r) ? 'live' : r.at ? 'stale' : ''}"></span>${esc(r.name)}
    <span class="sub">${isLive(r) ? `${r.sources} ${plural(r.sources)} · ` : ''}${r.players.length} hráčů</span></button>`;
  const liveHtml = live.length ? `<div class="mhead">Otevřené v prohlížeči</div>${live.map(item).join('')}` : '';
  const old = cand.filter((r) => !isLive(r));
  const oldHtml = old.length ? `<div class="mhead">${live.length ? 'Dříve načtené' : 'Právě žádná rasa není otevřená – dříve načtené'}</div>${old.map(item).join('')}` : '';
  const watchedHtml = !(panels ?? []).includes(WATCHED)
    ? `<div class="mhead">Přehled</div><button class="item" data-add="${WATCHED}">★ Hlídaní hráči <span class="sub">ze všech ras</span></button>` : '';
  menu.innerHTML = (liveHtml + oldHtml + watchedHtml) || '<div class="none">Všechny známé rasy už mají panel. Otevři stránku další rasy v prohlížeči.</div>';
  if (!live.length && !old.length) menu.innerHTML = '<div class="none">Zatím nic k přidání. Otevři v prohlížeči stránku rasy.</div>' + watchedHtml;
  menu.hidden = false;
});
$('addMenu').addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (b) addPanel(b.dataset.add); });
document.addEventListener('click', (e) => { if (!e.target.closest('.addwrap')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });


/* ---------- pruh ras nad panely (jen na široké obrazovce; jako seznam ras ve hře) ----------
   Klik na rasu: nemá panel = přidá se, má = doscrolluje se na něj a krátce se zvýrazní. */
let raceBarSig = '';
function renderRaceBar() {
  const bar = $('raceBar'); if (!bar) return;
  const shown = new Set(panels ?? []);
  const races = [...S.races].sort((a, b) => (b.id === cfg?.myRace) - (a.id === cfg?.myRace) || a.name.localeCompare(b.name, 'cs'));
  const items = races.map((r) => {
    const open = shown.has(r.id), live = isLive(r), mine = r.id === cfg?.myRace, dead = !r.players.length; // zatím bez dat (třeba rasa známá jen z nabídky ve hře)
    return { id: r.id, name: r.name, open, live, mine, dead, role: r.role, n: r.players.length, src: r.sources ?? 0 };
  });
  const watchedOpen = shown.has(WATCHED);
  const sig = JSON.stringify([items, watchedOpen]);
  if (sig === raceBarSig) return;
  raceBarSig = sig;
  bar.hidden = !items.length;
  bar.innerHTML = items.map((r) => `<button type="button" class="rchip${r.open ? ' open' : ''}${r.mine ? ' mine' : ''}${r.role === 'attack' && !r.mine ? ' foe' : ''}${r.dead ? ' dead' : ''}${r.live ? ' live' : ''}" data-race="${esc(r.id)}" title="${esc(r.name)} – ${r.n} hráčů${r.live ? ', data právě přicházejí (' + r.src + ' ' + plural(r.src) + ')' : ''}${r.open ? ' · panel je otevřený (klik = přejít na něj)' : ' · klik = přidat panel'}">${r.mine ? '<i class="rstar">⭐</i>' : ''}<span class="rname">${esc(r.name)}</span><i class="rdot"></i></button>`).join('')
    + `<button type="button" class="rchip watched${watchedOpen ? ' open' : ''}" data-race="${WATCHED}" title="Hlídaní hráči ze všech ras"><i class="rstar">★</i><span class="rname">Hlídaní</span></button>`;
}
$('raceBar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-race]'); if (!b) return;
  const id = b.dataset.race;
  if (!(panels ?? []).includes(id)) { addPanel(id); return; }
  const root = view.get(id)?.root; if (!root) return;
  root.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  root.classList.remove('rflash'); void root.offsetWidth; root.classList.add('rflash'); setTimeout(() => root.classList.remove('rflash'), 1200);
});
