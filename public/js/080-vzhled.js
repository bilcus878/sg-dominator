/* ---------- Vzhled: výchozí velikost panelů pro tento monitor ---------- */
function fillLook() {
  const L = lay();
  $('lookMon').textContent = `${screen.width}×${screen.height}` + ((screen.availLeft || screen.availTop) ? ` (poloha ${screen.availLeft ?? 0}, ${screen.availTop ?? 0})` : '');
  $('lookW').value = L.defW; $('lookWv').textContent = L.defW;
  $('lookH').value = L.defH; $('lookHv').textContent = L.defH ? `${L.defH} px` : 'automaticky';
}
$('lookW').addEventListener('input', (e) => { lay().defW = Number(e.target.value); $('lookWv').textContent = e.target.value; saveLayouts(); applyAllLayouts(); });
$('lookH').addEventListener('input', (e) => { const n = Number(e.target.value); lay().defH = n; $('lookHv').textContent = n ? `${n} px` : 'automaticky'; saveLayouts(); applyAllLayouts(); });
$('lookReset').addEventListener('click', () => { lay().panels = {}; saveLayouts(); applyAllLayouts(); renderBoard(); toast('Panely vráceny na výchozí velikost'); });
function fillUiSet() {
  $('uiShort').checked = ui.short;
  for (const b of $('uiDens').children) b.classList.toggle('on', b.dataset.v === ui.dens);
}
$('uiDens').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; ui.dens = b.dataset.v; saveUi2(); fillUiSet(); });
$('uiShort').addEventListener('change', () => { ui.short = $('uiShort').checked; saveUi2(); for (const id of view.keys()) updatePanel(id); });
document.querySelector('[data-tab="look"]').addEventListener('click', () => { fillLook(); fillUiSet(); });
fillUiSet();

