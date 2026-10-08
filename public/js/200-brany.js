/* ---------- Hvězdné brány: nákup pod limitem ceny (karta v pohledu Obchod) ---------- */
(() => {
  const NUM = { gtAfterMin: 'afterMinSec', gtAfterMax: 'afterMaxSec', gtFirstMin: 'firstMinSec', gtFirstMax: 'firstMaxSec', gtStepMin: 'stepMinSec', gtStepMax: 'stepMaxSec', gtMidChance: 'midChance', gtMidMin: 'midMinSec', gtMidMax: 'midMaxSec', gtPerOffer: 'maxPerOffer' };
  let G = null, saveTimer = null;
  const fmtN = (n) => Number(n || 0).toLocaleString('cs-CZ');

  function fill(c) {
    if (!c) return;
    $('gtEnabled').checked = !!c.enabled; $('gtDry').checked = c.dryRun !== false;
    $('gtMaxPrice').value = dots(c.maxPrice); $('gtReserve').value = dots(c.reserveNaq);
    for (const [id, k] of Object.entries(NUM)) if (document.activeElement !== $(id)) $(id).value = c[k] ?? '';
  }
  function collect() {
    const g = { enabled: $('gtEnabled').checked, dryRun: $('gtDry').checked, maxPrice: undots($('gtMaxPrice').value) ?? 0, reserveNaq: undots($('gtReserve').value) ?? 0 };
    for (const [id, k] of Object.entries(NUM)) g[k] = $(id).value;
    return g;
  }
  async function save() {
    clearTimeout(saveTimer);
    try { cfg = await api('/api/config', 'PUT', { gates: collect() }); fill(cfg.gates); } catch (e) { toast('Uložení selhalo: ' + e.message, true); }
  }
  for (const id of ['gtEnabled', 'gtDry', 'gtMaxPrice', 'gtReserve', ...Object.keys(NUM)]) {
    $(id).addEventListener('change', () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); });
  }
  for (const id of ['gtMaxPrice', 'gtReserve']) $(id).addEventListener('input', () => { const v = undots($(id).value); $(id).value = v == null ? '' : dots(v); });

  function render() {
    if (!G) return;
    const c = cfg?.gates ?? {};
    const l = G.last;
    const parts = [];
    parts.push(c.enabled ? (c.dryRun !== false ? '<b>zapnuto (zkušební režim)</b>' : '<b>zapnuto</b>') : '<b>vypnuto</b>');
    if (G.active && l) {
      const ok = l.price != null && c.maxPrice > 0 && l.price <= c.maxPrice;
      parts.push(`nabídka: ${l.count ?? '?'}× po ${l.price != null ? fmtN(l.price) : '?'} kg ${ok ? '✅ pod limitem' : '⛔ nad limitem'}${l.remainingSec != null ? `, další změna za ~${l.remainingSec} s (před ${l.ageSec} s)` : ''}`);
      if (l.naq != null) parts.push(`naquadah: ${fmtN(l.naq)} kg`);
    } else if (c.enabled) parts.push('čeká na otevřenou stránku Obchod → Hvězdné brány');
    if (G.batch?.bought) parts.push(`v téhle nabídce koupeno ${G.batch.bought}× (${fmtN(G.batch.spent)} kg)`);
    if (G.totals?.bought) parts.push(`celkem od spuštění ${G.totals.bought}× za ${fmtN(G.totals.spent)} kg`);
    $('gtState').innerHTML = parts.join(' · ');
    $('gtLog').innerHTML = (G.log ?? []).slice().reverse().map((e) => `<div><span class="muted">${new Date(e.at).toLocaleTimeString('cs-CZ')}</span> ${esc(e.text)}</div>`).join('');
  }
  async function poll() {
    try { G = await api('/api/gates'); render(); } catch { /* server nedostupný */ }
  }
  let filled = false;
  setInterval(() => { if (cfg?.gates && !filled) { fill(cfg.gates); filled = true; } }, 500);
  poll(); setInterval(poll, 2000);
})();
