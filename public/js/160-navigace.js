/* ---------- navigace mezi pohledy ---------- */
const viewMenu = { hidden: true }; // rozbalovací nabídka pohledů už není (pohledy jsou záložky pod hlavním řádkem); objekt zůstává kvůli kódu, který ji zavírá
function setView(v) {
  store.set('view', v);
  if (v === 'stats' && typeof stLoad === 'function') stLoad();
  document.querySelectorAll('[data-view]').forEach((el) => { el.hidden = el.dataset.view !== v; });
  document.querySelectorAll('[data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === v));
}
document.querySelectorAll('[data-nav]').forEach((b) => { b.onclick = () => setView(b.dataset.nav); });
setView(['build', 'stats'].includes(store.get('view')) ? store.get('view') : 'watch');

