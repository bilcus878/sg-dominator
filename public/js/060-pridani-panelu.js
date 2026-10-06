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

