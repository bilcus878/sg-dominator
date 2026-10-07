/* ---------- navigace mezi pohledy ---------- */
const viewMenu = $('viewMenu');
$('viewBtn').onclick = (e) => { e.stopPropagation(); viewMenu.hidden = !viewMenu.hidden; };
document.addEventListener('click', (e) => { if (!viewMenu.hidden && !e.target.closest('.viewwrap')) viewMenu.hidden = true; });
function setView(v) {
  store.set('view', v);
  viewMenu.hidden = true;
  $('viewLbl').textContent = v === 'build' ? 'Stavění' : v === 'stats' ? 'Statistiky' : 'Sledování';
  if (v === 'stats' && typeof stLoad === 'function') stLoad();
  document.querySelectorAll('[data-view]').forEach((el) => { el.hidden = el.dataset.view !== v; });
  document.querySelectorAll('[data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === v));
}
document.querySelectorAll('[data-nav]').forEach((b) => { b.onclick = () => setView(b.dataset.nav); });
setView(['build', 'stats'].includes(store.get('view')) ? store.get('view') : 'watch');

