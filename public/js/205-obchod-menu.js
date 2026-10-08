/* ---------- Obchod: funkce jako rozbalovací panely (jako panely ras) + položky v nabídce pohledů ---------- */
(() => {
  const FNS = ['unemp', 'gates'];
  const KEY = 'shopOpen';
  let open = (() => { const v = store.get(KEY); return Array.isArray(v) ? v.filter((x) => FNS.includes(x)) : ['unemp']; })();

  const panelOf = (id) => $('fn_' + id);
  function apply() {
    for (const id of FNS) {
      const p = panelOf(id), on = open.includes(id);
      p.classList.toggle('open', on);
      p.querySelector('.fnhead').setAttribute('aria-expanded', String(on));
      p.querySelector('.fninner').inert = !on; // sbalený panel není dostupný z klávesnice
    }
  }
  function toggle(id, force) {
    const on = force ?? !open.includes(id);
    open = on ? [...new Set([...open, id])] : open.filter((x) => x !== id);
    store.set(KEY, open);
    apply();
  }
  /** Z nabídky pohledů: otevře jen tuhle funkci (ostatní sbalí) a přejde na ni. */
  window.openShopFn = (id, exclusive) => {
    if (exclusive) { open = [id]; store.set(KEY, open); apply(); } else toggle(id, true);
    markShopFn(id);
    setTimeout(() => panelOf(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  let current = null;
  /** Zvýrazní v nabídce právě otevřenou funkci Obchodu. */
  window.markShopFn = (id) => {
    if (id) current = id;
    const inShop = store.get('view') === 'shop';
    document.querySelectorAll('.vitem[data-fn]').forEach((b) => b.classList.toggle('on', inShop && open.length === 1 && open[0] === b.dataset.fn));
  };
  window.renderShopChips = () => {
    for (const id of FNS) {
      const s = shopStat[id] ?? {};
      const chip = $('fchip_' + id);
      if (chip) { chip.textContent = s.text || ''; chip.classList.toggle('on', !!s.on); chip.hidden = !s.text; }
      $('fdot_' + id)?.classList.toggle('on', !!s.on);
    }
  };
  for (const id of FNS) panelOf(id).querySelector('.fnhead').onclick = () => { toggle(id); markShopFn(); };
  apply(); renderShopChips();
})();
