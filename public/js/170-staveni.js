/* ---------- stavění ---------- */
(() => {
  let B = null;        // { buildings, config, run, knownPlanets, serverTime }
  let built = false;   // tabulka plánu se vykreslí jednou, ať se nepřepisuje, co právě píšeš
  const tm = (t) => new Date(t).toLocaleTimeString('cs-CZ');
  const dur = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
  const STATUS = { idle: 'nečinné', running: 'běží', stopped: 'zastaveno', finished: 'hotovo', error: 'chyba' };
  const MODES = [['skip', 'Nestavět'], ['target', 'Cílový počet'], ['max', 'Maximum']];
  const STEPS = [
    { title: '1 · Města', rows: [['mesto', 'Město']] },
    { title: '2 · Ostatní stavby (bez dolu)', rows: [['laborator', 'Laboratoř'], ['bs', 'Bezpečnostní (BS)'], ['sdi', 'RL štít'], ['po', 'RL paprsek'], ['kasarna', 'Kasárny']] },
    { title: '3 · Naquadahový důl (doplní se na konec)', rows: [['vyrobna', 'Naquadahový důl']] },
  ];
  const IDS = STEPS.flatMap((s) => s.rows.map((r) => r[0]));
  const NAMES = Object.fromEntries(STEPS.flatMap((s) => s.rows));
  const PHASES = ['města', 'ostatní stavby', 'naquadahový důl'];
  const REASON = { bs: 'BS', sdi: 'RL štít', po: 'RL paprsek', kasarna: 'Kasárny', laborator: 'Laboratoř', mesto: 'Města', vyrobna: 'Doly', park: 'Parky', 'park?': 'Parky (spokojenost neznámá)', vynuceno: 'vynucený průchod' };
  const SATS = [['-50', '− 50 %', 'neg'], ['-25', '− 25 %', 'neg'], ['0', '~', 'neu'], ['5', '+ 5 %', 'pos'], ['10', '+ 10 %', 'pos']];

  const paceNow = () => Number(document.querySelector('#bPace .on')?.dataset.v ?? 1);
  function planFromUi() {
    if (!built) return null;
    const plan = {};
    for (const id of IDS) plan[id] = { mode: $('bm-' + id).value, n: Number($('bn-' + id).value) || 0 };
    const parks = {};
    for (const [k] of SATS) { const v = $('bk-' + k).value.trim(); parks[k] = v === '' ? null : Number(v); }
    const pm = $('bParksMin').value.trim();
    return { plan, parks, parksMinAll: pm === '' ? null : Number(pm), pace: paceNow(), dryRun: $('bDry').checked, forceAll: $('bRecheck').checked };
  }
  /** Plán jako krátké štítky („BS 1000“, „Města max“, „Parky 100–300“). */
  function summary(c) {
    const out = [];
    for (const id of IDS) {
      const p = c.plan[id];
      if (p.mode === 'max') out.push(`${NAMES[id]} max`);
      else if (p.mode === 'target' && p.n > 0) out.push(`${NAMES[id]} ${fmt(p.n)}`);
    }
    const pk = Object.values(c.parks).filter((v) => v !== null && Number.isFinite(v));
    if (pk.length) out.push(`Parky ${fmt(Math.min(...pk))}${Math.min(...pk) === Math.max(...pk) ? '' : '–' + fmt(Math.max(...pk))}${c.parksMinAll !== null ? ` (min ${fmt(c.parksMinAll)})` : ''}`);
    return out;
  }
  function renderPlanInfo() {
    const c = planFromUi();
    if (!c) return;
    const sum = summary(c);
    $('bSummary').innerHTML = sum.length ? sum.map((t) => `<span class="pill">${esc(t)}</span>`).join('') : '<span class="muted">prázdný plán</span>';
    const warn = [];
    if (!sum.length) warn.push('Plán je prázdný, nic se nebude stavět.');
    if (c.dryRun) warn.push('Zkušební běh je zapnutý: bot vyplní políčka, ale neklikne na Postavit.');
    if (c.forceAll) warn.push('Zapnuto „Projít všechny planety“: bot nebude vynechávat hotové planety.');
    $('bWarn').innerHTML = warn.map((w) => `<div class="bwarn">${esc(w)}</div>`).join('');
  }
  let saveT;
  function save() {
    renderPlanInfo();
    clearTimeout(saveT);
    saveT = setTimeout(() => api('/api/build', 'PUT', planFromUi()).then(() => toast('Plán uložen')).catch((e) => toast(e.message, true)), 400);
  }
  function buildTable() {
    $('bRows').innerHTML = STEPS.map((st) => `<tr class="step"><td colspan="3">${esc(st.title)}</td></tr>` + st.rows.map(([id, label]) => {
      const p = B.config.plan[id] ?? { mode: 'skip', n: 0 };
      return `<tr><td>${esc(label)}</td>
        <td><select id="bm-${id}">${MODES.map(([v, t]) => `<option value="${v}"${p.mode === v ? ' selected' : ''}>${t}</option>`).join('')}</select></td>
        <td class="n"><input type="number" min="0" id="bn-${id}" value="${p.n || ''}" ${p.mode === 'target' ? '' : 'disabled'}></td></tr>`;
    }).join('')).join('');
    $('bParks').innerHTML = SATS.map(([k, label, cls]) => `<div><label class="${cls}" for="bk-${k}">${label}</label><input type="number" min="0" id="bk-${k}" value="${B.config.parks?.[k] ?? ''}"></div>`).join('');
    $('bParksMin').value = B.config.parksMinAll ?? '';
    for (const id of IDS) {
      $('bm-' + id).onchange = () => { $('bn-' + id).disabled = $('bm-' + id).value !== 'target'; save(); };
      $('bn-' + id).oninput = save;
    }
    for (const [k] of SATS) $('bk-' + k).oninput = save;
    $('bParksMin').oninput = save;
    document.querySelectorAll('#bPace button').forEach((b) => {
      b.classList.toggle('on', Number(b.dataset.v) === Number(B.config.pace));
      b.onclick = () => { document.querySelectorAll('#bPace button').forEach((x) => x.classList.toggle('on', x === b)); save(); };
    });
    $('bDry').checked = !!B.config.dryRun;
    $('bRecheck').checked = !!B.config.forceAll;
    $('bDry').onchange = $('bRecheck').onchange = save;
    built = true;
    renderPlanInfo();
  }
  const reasonsText = (re) => Object.entries(re ?? {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${REASON[k] ?? k} <b>${n}</b>`).join(' · ');
  const ago = (t) => { const m = Math.round((B.serverTime - t) / 60000); return m < 1 ? 'před chvílí' : `před ${m} min`; };

  function renderRun() {
    const r = B.run, on = r.status === 'running', q = r.queue;
    const st = $('bStatus');
    st.textContent = STATUS[r.status] + (r.dry && on ? ' (zkušebně)' : '');
    st.className = 'pill' + (on ? ' ok' : r.status === 'error' ? ' bad' : '');
    viewBusy.build = on; refreshViewDot();
    $('bStart').disabled = on; $('bStop').disabled = !on;
    $('bStart').style.opacity = on ? .5 : 1;
    const stale = on && B.serverTime - r.lastSeenAt > 20000;
    $('bHint').textContent = stale ? '⚠ skript neodpovídá – je otevřená stránka Stavby?' : '';

    const done = q ? q.total - q.left : 0;
    const pct = q && q.total ? Math.min(100, (done / q.total) * 100) : r.status === 'finished' ? 100 : 0;
    $('bBar').style.width = pct + '%';
    $('bBarWrap').classList.toggle('done', r.status === 'finished');
    let prog = on ? 'Načítám tabulku planet…' : 'Čeká na spuštění.';
    if (q) {
      prog = `${done} / ${q.total} planet`;
      if (on) {
        prog += ` · běží ${dur(B.serverTime - r.startedAt)}`;
        if (r.total >= 3 && q.left > 0) prog += ` · zbývá cca ${dur(((B.serverTime - r.startedAt) / r.total) * q.left)}`;
      } else if (r.status === 'finished') prog += ' · hotovo';
    }
    $('bProg').textContent = prog;
    $('bNow').innerHTML = on
      ? (r.step ? `Teď: <b>${esc(r.step.name)}</b> · krok ${r.step.phase + 1}/3 ${PHASES[r.step.phase]}` : r.current ? 'Přecházím na další planetu…' : '')
      : r.status === 'finished' ? '✅ Hotovo' : r.status === 'error' ? '⚠ Zastaveno chybou, podrobnosti v průběhu níže' : r.status === 'stopped' ? 'Zastaveno.' : '';

    const c = r.counts;
    $('bStats').innerHTML = [
      ['ok', c.built + c.dry, c.dry ? 'zkušebně / postaveno' : 'postaveno'], ['', c.nothing, 'beze změny'],
      ['', q ? q.skipped : 0, 'přeskočeno'], [c.failed ? 'bad' : '', c.failed, 'chyb'],
    ].map(([cls, n, label]) => `<div class="bstat ${cls}"><b>${fmt(n)}</b><span>${label}</span></div>`).join('');

    const p = r.preview;
    $('bPreview').innerHTML = B.run.scanPending
      ? '⏳ Čekám na stránku Stavby (musí být otevřená ve hře)…'
      : on && q ? `<b>Fronta:</b> ${reasonsText(q.reasons) || 'nic'}<br><span class="muted">Vyloučeno ${q.excluded} planet (CP/DP/PP, neobyvatelné), přeskočeno ${q.skipped} hotových.</span>`
      : p ? `<b>Náhled (${ago(p.at)}):</b> z ${p.tableSize} planet by se navštívilo <b>${p.visit}</b>, přeskočilo ${p.skipped}, vyloučeno ${p.excluded}.${p.visit ? `<br><span class="muted">Důvody: ${reasonsText(p.reasons)}</span>` : ''}`
      : '<span class="muted">Náhled ukáže, kolik planet bot navštíví a proč, bez spuštění. Potřebuje otevřenou stránku Stavby ve hře.</span>';

    $('bKnown').textContent = `Historie planet: ${B.knownPlanets} známých`;
    $('bPlanetsHint').textContent = r.total ? `zpracováno ${r.total}, zobrazeno posledních ${r.planets.length}` : '';
    $('bPlanets').innerHTML = r.planets.map((x) => `<span class="bp ${x.state}" title="${esc(x.note)}">${esc(x.name)}</span>`).join('')
      + (on && r.current && !r.planets.some((x) => x.name === r.current) ? `<span class="bp cur">${esc(r.current)} …</span>` : '');
    $('bLog').innerHTML = r.log.length ? r.log.slice().reverse().map((l) => `<div><time>${tm(l.at)}</time>${esc(l.msg)}</div>`).join('') : '<span class="muted">Zatím nic.</span>';
  }
  async function poll() {
    try {
      B = await api('/api/build');
      if (!built) buildTable();
      renderRun();
    } catch {}
  }
  $('bStart').onclick = async () => {
    const c = planFromUi();
    if (!c) return;
    const sum = summary(c).join(', ') || 'nic';
    const ok = c.dryRun ? confirm(`Spustit ZKUŠEBNÍ běh?\n\nPlán: ${sum}`) : confirm(`Spustit OSTRÝ běh?\n\nBot opravdu postaví: ${sum}.\nNa planetách se budou utrácet suroviny.`);
    if (!ok) return;
    try { clearTimeout(saveT); await api('/api/build', 'PUT', c); B = await api('/api/build/start', 'POST'); renderRun(); }
    catch (e) { toast(e.message, true); }
  };
  $('bScan').onclick = async () => {
    try { clearTimeout(saveT); await api('/api/build', 'PUT', planFromUi()); B = await api('/api/build/scan', 'POST'); renderRun(); }
    catch (e) { toast(e.message, true); }
  };
  $('bForget').onclick = async () => {
    if (!confirm('Smazat historii planet? Příští běh pak znovu projde všechny planety, na kterých je práce.')) return;
    try { B = await api('/api/build/ledger', 'DELETE'); renderRun(); toast('Historie smazána'); } catch (e) { toast(e.message, true); }
  };
  $('bStop').onclick = async () => { try { B = await api('/api/build/stop', 'POST'); renderRun(); } catch (e) { toast(e.message, true); } };
  poll(); setInterval(poll, 1500);
})();
