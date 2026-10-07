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


/* ---------- Vzhled v2: téma, akcent, velikost, efekty a živý náhled ---------- */
const ACCENTS = [['#e0b84c', 'Zlatá'], ['#ffa94d', 'Oranžová'], ['#ff6b6b', 'Červená'], ['#f783ac', 'Růžová'], ['#b197fc', 'Fialová'], ['#74a8ff', 'Modrá'], ['#38d9d9', 'Tyrkysová'], ['#5ad19a', 'Zelená'], ['#c9d1de', 'Stříbrná']];
const hexRgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; };
/** Použije nastavení vzhledu na celou stránku (barvy přes CSS proměnné, ostatní přes atributy na body). */
function applyLook() {
  const r = document.documentElement.style;
  r.setProperty('--acc', ui.accent); r.setProperty('--acc-bg', hexRgba(ui.accent, 0.14)); r.setProperty('--acc-soft', hexRgba(ui.accent, 0.08));
  document.body.dataset.theme = ui.theme; document.body.dataset.dot = ui.dot ? 'on' : 'off'; document.body.dataset.fx = ui.fx ? 'on' : 'off'; document.body.dataset.dens = ui.dens;
  if (typeof renderLookPreview === 'function' && $('lookPrev')) renderLookPreview();
}
function renderAccents() {
  const box = $('lkAccent'); if (!box.children.length) {
    box.innerHTML = ACCENTS.map(([c, n]) => `<button type="button" role="radio" data-c="${c}" title="${n}" aria-label="${n}" style="--c:${c}"></button>`).join('');
    box.onclick = (e) => { const b = e.target.closest('button[data-c]'); if (!b) return; ui.accent = b.dataset.c; saveUi2(); fillUiSet(); };
  }
  for (const b of box.children) { const on = b.dataset.c.toLowerCase() === ui.accent.toLowerCase(); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
  const named = ACCENTS.find(([c]) => c.toLowerCase() === ui.accent.toLowerCase());
  $('lkAccentName').textContent = named ? '· ' + named[1] : '· vlastní';
  $('lkCustom').value = ui.accent;
}
/** Živý náhled: pár vzorových řádků stejnými třídami jako skutečná tabulka, takže ukáže přesně to, co bude vidět. */
function renderLookPreview() {
  const rows = [
    { n: 'Daniell1', rank: 'ministr', on: true, pl: 606, pd: '+3', pw: 405_300_000, rc: '💰 22:09' },
    { n: 'Izra_92', rank: 'vudce', on: false, pl: 602, pd: '', pw: 419_700_000, rc: '' },
    { n: 'Mave', rank: 'zastupce', on: true, pl: 492, pd: '−2', pw: 63_400_000, rc: '⟳ 23:00', below: true },
    { n: 'heroes92', rank: 'obcan', on: false, pl: 561, pd: '', pw: 548_000_000, rc: '' },
  ];
  const pv = (v) => (ui.short ? short(v) : fmt(v));
  $('lookPrev').innerHTML = `<div class="card rpanel lk-rp"><div class="rbody"><table><thead><tr><th class="thname"><span class="nlbl">Jméno</span></th><th class="n pc"><div class="hw"><span class="hl">Planety</span></div></th><th class="n"><div class="hw"><span class="hl">Síla</span></div></th><th class="c hcol">Dohodit</th><th class="c">Hlídat</th></tr></thead><tbody>${rows.map((r) => `
    <tr class="${r.below ? 'below' : ''}"><td class="pname"><span class="nlw"><span class="nl1"><span class="on${r.on ? ' yes' : ''}"></span><span class="nm" data-rank="${r.rank}">${r.n}</span></span><span class="nl2"><span class="rc"><span class="ecl">${r.rc}</span></span><span class="thl"><button type="button" class="pset" tabindex="-1"><i class="pgear">⚙</i></button></span></span></span></td>
      <td class="n pc"><div class="pcw"><span class="pnum"><span class="pv">${r.pl}</span></span></div></td>
      <td class="n"><span class="pnum"><span class="pv">${pv(r.pw)}</span></span></td>
      <td class="c hcol"><button type="button" class="ghost dohodit" tabindex="-1">Dohodit</button></td>
      <td class="c"><label class="sw"><input type="checkbox" checked tabindex="-1"><span></span></label></td></tr>`).join('')}</tbody></table></div></div>`;
}
const fillUiSet0 = fillUiSet;
fillUiSet = function fillUiSet1() {
  fillUiSet0();
  $('uiDot').checked = ui.dot; $('uiFx').checked = ui.fx;
  for (const b of $('lkTheme').children) { b.classList.toggle('on', b.dataset.v === ui.theme); b.setAttribute('aria-checked', String(b.dataset.v === ui.theme)); }
  for (const b of $('uiDens').children) b.setAttribute('aria-checked', String(b.dataset.v === ui.dens));
  renderAccents();
  document.querySelectorAll('.lk-presets [data-w]').forEach((x) => x.classList.toggle('on', Number(x.dataset.w) === Number($('lookW').value)));
  renderLookPreview();
};
$('lkTheme').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; ui.theme = b.dataset.v; saveUi2(); fillUiSet(); });
$('lkCustom').addEventListener('input', (e) => { ui.accent = e.target.value; saveUi2(); fillUiSet(); });
$('uiDot').addEventListener('change', () => { ui.dot = $('uiDot').checked; saveUi2(); });
$('uiFx').addEventListener('change', () => { ui.fx = $('uiFx').checked; saveUi2(); });
document.querySelector('.lk-presets').addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (!b) return; $('lookW').value = b.dataset.w; $('lookW').dispatchEvent(new Event('input')); fillUiSet(); });
$('lookW').addEventListener('input', () => document.querySelectorAll('.lk-presets [data-w]').forEach((x) => x.classList.toggle('on', Number(x.dataset.w) === Number($('lookW').value))));
$('lkResetAll').addEventListener('click', () => { Object.assign(ui, { dens: 'l', short: false, theme: 'night', accent: '#e0b84c', dot: true, fx: true }); saveUi2(); fillUiSet(); for (const id of view.keys()) updatePanel(id); toast('Vzhled vrácen na výchozí'); });
applyLook(); fillUiSet();
