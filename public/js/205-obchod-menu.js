/* ---------- Obchod: pruh funkcí jako pruh ras ve Vesmíru; panely jsou zabalené, klik na funkci ji rozbalí (další pod ni), druhý klik nebo ✕ ji zabalí ---------- */
(() => {
  const FNS = ['unemp', 'gates'];
  const KEY = 'shopOpen';
  let open = (() => { const v = store.get(KEY); return Array.isArray(v) ? v.filter((x) => FNS.includes(x)) : []; })(); // výchozí: vše zabalené

  const panelOf = (id) => $('fn_' + id);
  function apply() {
    for (const id of FNS) {
      const on = open.includes(id);
      const p = panelOf(id), was = !p.hidden;
      p.hidden = !on;
      if (on && !was) { p.classList.remove('fnin'); void p.offsetWidth; p.classList.add('fnin'); } // plynulé rozbalení
      document.querySelector(`#shopBar [data-fn="${id}"]`).classList.toggle('open', on);
    }
    $('shopEmpty').hidden = open.length > 0;
  }
  /** Klik na funkci v pruhu: zabalená se rozbalí (pod už otevřené), otevřená se zabalí. */
  function toggleFn(id) {
    const was = open.includes(id);
    open = was ? open.filter((x) => x !== id) : [...open, id];
    store.set(KEY, open); apply();
    if (!was) setTimeout(() => { const p = panelOf(id); p.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 40);
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
  for (const b of document.querySelectorAll('#shopBar [data-fn]')) b.onclick = () => toggleFn(b.dataset.fn);
  for (const b of document.querySelectorAll('.fnclose')) b.onclick = () => { open = open.filter((x) => x !== b.dataset.fn); store.set(KEY, open); apply(); };
  apply(); renderShopChips();
})();
