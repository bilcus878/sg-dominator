/* ---------- navigace mezi pohledy ---------- */
const viewMenu = $('viewMenu');
const VIEWS = { watch: ['🌌', 'Vesmír'], build: ['🏗', 'Stavby'], shop: ['🛒', 'Obchod'], stats: ['📊', 'Statistiky'] };
/** Která část právě něco dělá (stavění / nezaměstnaní): zelená tečka u položky v nabídce i u tlačítka pohledu. */
const viewBusy = { build: false, shop: false };
function refreshViewDot() {
  $('navDot').classList.toggle('on', viewBusy.build); $('shopDot').classList.toggle('on', viewBusy.shop);
  $('viewDot').classList.toggle('on', viewBusy.build || viewBusy.shop);
}
$('viewBtn').onclick = (e) => { e.stopPropagation(); viewMenu.hidden = !viewMenu.hidden; $('viewBtn').setAttribute('aria-expanded', String(!viewMenu.hidden)); };
document.addEventListener('click', (e) => { if (!viewMenu.hidden && !e.target.closest('.viewwrap')) { viewMenu.hidden = true; $('viewBtn').setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !viewMenu.hidden) { viewMenu.hidden = true; $('viewBtn').setAttribute('aria-expanded', 'false'); } });
function setView(v) {
  store.set('view', v);
  viewMenu.hidden = true; $('viewBtn').setAttribute('aria-expanded', 'false');
  $('viewIc').textContent = VIEWS[v][0]; $('viewLbl').textContent = VIEWS[v][1];
  if (v === 'stats' && typeof stLoad === 'function') stLoad();
  document.querySelectorAll('[data-view]').forEach((el) => { el.hidden = el.dataset.view !== v; });
  document.querySelectorAll('[data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === v));
}
document.querySelectorAll('[data-nav]').forEach((b) => { b.onclick = () => setView(b.dataset.nav); });
setView(['build', 'stats', 'shop'].includes(store.get('view')) ? store.get('view') : 'watch');


/* ---------- hlavní nabídka (Menu): přidat rasu, upozornění, poslední alerty, nastavení, zavřít ----------
   Původní tlačítka a jejich rozbalovací nabídky zůstávají (skrytá, kotvená pod tlačítkem Menu); položky je jen spouštějí. */
const mainMenu = $('mainMenu');
const closeMain = () => { mainMenu.hidden = true; $('mainBtn').setAttribute('aria-expanded', 'false'); };
$('mainBtn').onclick = (e) => {
  e.stopPropagation();
  const open = mainMenu.hidden;
  closeMenu(); toggleNt(false); toggleAl(false); viewMenu.hidden = true; $('hlMenu').hidden = true;
  mainMenu.hidden = !open; $('mainBtn').setAttribute('aria-expanded', String(open));
};
document.addEventListener('click', (e) => { if (!mainMenu.hidden && !e.target.closest('.mainwrap')) closeMain(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !mainMenu.hidden) closeMain(); });
const MAIN_ACTIONS = { add: 'addPanel', notify: 'notifyCaret', alerts: 'alBtn', settings: 'openSettings', close: 'hdrClose' };
for (const it of mainMenu.querySelectorAll('[data-go]')) {
  it.onclick = (e) => { e.stopPropagation(); closeMain(); $(MAIN_ACTIONS[it.dataset.go]).click(); };
}
