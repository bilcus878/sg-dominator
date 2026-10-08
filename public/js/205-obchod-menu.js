/* ---------- Obchod: pruh funkcí jako pruh ras ve Vesmíru; klik otevře panel funkce (nebo na něj přejde), ✕ ho zavře ---------- */
(() => {
  const FNS = ['unemp', 'gates'];
  const KEY = 'shopOpen';
  let open = (() => { const v = store.get(KEY); return Array.isArray(v) ? v.filter((x) => FNS.includes(x)) : ['unemp']; })();

  const panelOf = (id) => $('fn_' + id);
  function apply() {
    for (const id of FNS) {
      const on = open.includes(id);
      panelOf(id).hidden = !on;
      document.querySelector(`#shopBar [data-fn="${id}"]`).classList.toggle('open', on);
    }
    $('shopEmpty').hidden = open.length > 0;
  }
  function flash(el) { el.classList.remove('rflash'); void el.offsetWidth; el.classList.add('rflash'); }
  function openFn(id) {
    const was = open.includes(id);
    if (!was) { open = [...open, id]; store.set(KEY, open); apply(); }
    setTimeout(() => { const p = panelOf(id); p.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); flash(p); }, 40);
  }
  window.renderShopChips = () => {
    for (const id of FNS) {
      const s = shopStat[id] ?? {};
      const chip = $('fchip_' + id);
      if (chip) { chip.textContent = s.text || ''; chip.classList.toggle('on', !!s.on); chip.hidden = !s.text; }
      document.querySelector(`#shopBar [data-fn="${id}"]`).classList.toggle('live', !!s.on);
      $('fdot_' + id)?.classList.toggle('on', !!s.on);
    }
  };
  for (const b of document.querySelectorAll('#shopBar [data-fn]')) b.onclick = () => openFn(b.dataset.fn);
  for (const b of document.querySelectorAll('.fnclose')) b.onclick = () => { open = open.filter((x) => x !== b.dataset.fn); store.set(KEY, open); apply(); };
  apply(); renderShopChips();
})();
