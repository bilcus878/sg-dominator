/* ---------- Nezaměstnaní: doplnění lidí na planety, kterým chybí (karta v pohledu Obchod) ---------- */
(() => {
  const STATUS = { idle: 'nečinné', running: 'běží', stopped: 'zastaveno', finished: 'hotovo', error: 'chyba' };
  let U = null;
  function render() {
    if (!U) return;
    const on = U.status === 'running';
    viewBusy.shop = on; refreshViewDot();
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
})();
