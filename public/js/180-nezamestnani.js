/* ---------- Nezaměstnaní: doplnění lidí na planety, kterým chybí (karta v pohledu Obchod) ---------- */
(() => {
  const STATUS = { idle: 'nečinné', running: 'běží', stopped: 'zastaveno', finished: 'hotovo', error: 'chyba' };
  let U = null;
  function render() {
    if (!U) return;
    const on = U.status === 'running';
    viewBusy.shop = on || R?.status === 'running'; refreshViewDot();
    $('uStart').disabled = on; $('uStart').style.opacity = on ? 0.5 : 1;
    $('uStop').disabled = !on;
    const fmtN = (n) => Number(n || 0).toLocaleString('cs-CZ');
    $('uState').innerHTML = `<b>${STATUS[U.status] ?? U.status}</b>${U.target ? ` · teď: ${esc(U.target)}` : ''}`
      + `${U.filled?.length ? ` · doplněno ${U.filled.length} planet (${fmtN(U.moved)} lidí)` : ''}${U.reason && !on ? ` · ${esc(U.reason)}` : ''}`;
    $('uLog').innerHTML = (U.log ?? []).slice().reverse().map((l) => `<div><span class="muted">${new Date(l.at).toLocaleTimeString('cs-CZ')}</span> ${esc(l.msg)}</div>`).join('');
  }
  async function poll() { try { U = await api('/api/unemp'); render(); } catch { /* server nedostupný */ } }
  $('uStart').onclick = async () => {
    try { U = await api('/api/unemp/start', 'POST'); render(); toast('Doplňování nezaměstnaných spuštěno – otevři ve hře Obchod → Nezaměstnaní'); } catch (e) { toast(e.message, true); }
  };
  $('uStop').onclick = async () => { try { U = await api('/api/unemp/stop', 'POST'); render(); } catch (e) { toast(e.message, true); } };
  poll(); setInterval(poll, 1500);

  /* ----- Přerozdělení nezaměstnaných (plné planety -> planety s volným místem) ----- */
  let R = null, rdSaveTimer = null;
  const RD_STATUS = { idle: 'nečinné', running: 'běží', stopped: 'zastaveno', finished: 'hotovo', error: 'chyba' };
  const fmtMil = (n) => (Number(n) / 1e6).toLocaleString('cs-CZ', { maximumFractionDigits: 1 }) + ' mil.';
  const paceNow = () => Number(document.querySelector('#rdPace .on')?.dataset.v ?? 1);
  function rdFields() { return { minM: $('rdMin').value, maxM: $('rdMax').value, freeMaxM: $('rdFree').value, maxMoves: $('rdMoves').value, dry: $('rdDry').checked, pace: paceNow(), pauseMinSec: $('rdPauseMin').value, pauseMaxSec: $('rdPauseMax').value }; }
  function rdFill(c) { if (!c) return; $('rdMin').value = c.minM; $('rdMax').value = c.maxM; $('rdFree').value = c.freeMaxM; $('rdMoves').value = c.maxMoves; $('rdDry').checked = !!c.dry; $('rdPauseMin').value = c.pauseMinSec ?? 4; $('rdPauseMax').value = c.pauseMaxSec ?? 10; for (const b of $('rdPace').children) b.classList.toggle('on', Math.abs(Number(b.dataset.v) - Number(c.pace ?? 1)) < 0.01); }
  async function rdSave() { clearTimeout(rdSaveTimer); const cfgNew = await api('/api/config', 'PUT', { redist: rdFields() }); cfg = cfgNew; rdFill(cfgNew.redist); }
  for (const b of $('rdPace').children) b.onclick = () => { for (const x of $('rdPace').children) x.classList.toggle('on', x === b); clearTimeout(rdSaveTimer); rdSaveTimer = setTimeout(() => rdSave().catch((e) => toast(e.message, true)), 150); };
  for (const id of ['rdMin', 'rdMax', 'rdFree', 'rdMoves', 'rdDry', 'rdPauseMin', 'rdPauseMax']) $(id).addEventListener('change', () => { clearTimeout(rdSaveTimer); rdSaveTimer = setTimeout(() => rdSave().catch((e) => toast(e.message, true)), 250); });
  function rdRender() {
    if (!R) return;
    const on = R.status === 'running';
    $('rdStart').disabled = on; $('rdStart').style.opacity = on ? 0.5 : 1; $('rdStop').disabled = !on;
    for (const id of ['rdMin', 'rdMax', 'rdFree', 'rdMoves', 'rdDry']) $(id).disabled = on;
    $('rdState').innerHTML = `<b>${RD_STATUS[R.status] ?? R.status}</b>${R.dry && (on || R.count) ? ' (zkušebně)' : ''}${R.target ? ` · teď: ${esc(R.target)}` : ''}${R.count ? ` · ${R.dry ? 'by přesunul' : 'přesunuto'} ${R.count}× (${fmtMil(R.movedTotal)})` : ''}${R.skipped ? ` · přeskočeno ${R.skipped}` : ''}${R.reason && !on ? ` · ${esc(R.reason)}` : ''}`;
    $('rdLog').innerHTML = (R.log ?? []).slice().reverse().map((l) => `<div><span class="muted">${new Date(l.at).toLocaleTimeString('cs-CZ')}</span> ${esc(l.msg)}</div>`).join('');
    viewBusy.shop = on || U?.status === 'running'; refreshViewDot();
  }
  async function rdPoll() { try { R = await api('/api/redist'); rdRender(); } catch { /* server nedostupný */ } }
  $('rdStart').onclick = async () => {
    try {
      await rdSave();
      R = await api('/api/redist/start', 'POST'); rdRender();
      toast(cfg.redist?.dry ? 'Zkušební přerozdělení spuštěno – otevři ve hře Obchod → Nezaměstnaní' : 'Přerozdělení spuštěno – otevři ve hře Obchod → Nezaměstnaní');
    } catch (e) { toast(e.message, true); }
  };
  $('rdStop').onclick = async () => { try { R = await api('/api/redist/stop', 'POST'); rdRender(); } catch (e) { toast(e.message, true); } };
  (async () => { try { rdFill((await api('/api/config')).redist); } catch { /* nic */ } })();
  rdPoll(); setInterval(rdPoll, 1500);
})();
