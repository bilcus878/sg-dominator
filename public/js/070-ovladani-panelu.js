/* ---------- ovládání panelů (delegace událostí) ---------- */
function setMode(raceId, mode) {
  const r = raceOf(raceId); if (!r || r.mode === mode) return;
  if (mode === 'all' && r.role === 'attack') {
    const n = r.players.filter((p) => p.target && p.attackable !== false).length;
    if (n && !confirm(`${n} hráčů z rasy ${r.name} je teď k dobytí a přijde o nich zpráva.\n\nPokračovat?`)) return;
  } else if (mode === 'all') { // varování: hráči pod prahem začnou hned hlásit
    const th = r.threshold ?? cfg.threshold;
    const below = r.players.filter((p) => p.power < (p.ownThreshold ?? th)).length;
    if (below && !confirm(`${below} hráčů z rasy ${r.name} je teď pod prahem a začne hlásit${cfg.repeatWhileBelow ? ' opakovaně' : ''}.\n\nPokračovat? (Předtím můžeš nastavit vyšší/nižší práh rasy.)`)) return;
  }
  // změna režimu zruší ruční zapnutí/vypnutí hráčů této rasy (stejně to udělá server)
  r.mode = mode;
  for (const p of r.players) { p.overridden = false; p.watched = mode === 'all'; }
  renderBoard();
  savePartial({ races: { [raceId]: { mode } } });
}

const v_ = (id) => view.get(id);
// nabídka ⋮ je u těla stránky (position: fixed), ne uvnitř panelu: panel má overflow:hidden, takže uvnitř by se u sbaleného nebo úzkého panelu uřízla
const rmenuPop = document.createElement('div');
rmenuPop.className = 'rmenu'; rmenuPop.hidden = true;
rmenuPop.innerHTML = '<button data-rm="left">◀ Posunout doleva</button><button data-rm="right">▶ Posunout doprava</button><button data-rm="close">✕ Odebrat panel</button>';
document.body.appendChild(rmenuPop);
let rmenuId = null;
const closeRmenus = () => { rmenuPop.hidden = true; rmenuId = null; };
document.addEventListener('click', (e) => { if (!e.target.closest('.rmwrap, .rmenu')) closeRmenus(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRmenus(); });
rmenuPop.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-rm]'); if (!b || rmenuId == null) return;
  const id = rmenuId, act = b.dataset.rm; closeRmenus();
  if (act === 'close') { panels = panels.filter((x) => x !== id); saveUi(); renderBoard(); return; }
  const i = panels.indexOf(id), j = act === 'left' ? i - 1 : i + 1;
  if (j >= 0 && j < panels.length) { [panels[i], panels[j]] = [panels[j], panels[i]]; saveUi(); renderBoard(); }
});
function openRmenu(id, btn) {
  const same = !rmenuPop.hidden && rmenuId === id; closeRmenus(); if (same) return;
  rmenuId = id; rmenuPop.hidden = false;
  const r = btn.getBoundingClientRect(), w = rmenuPop.offsetWidth || 200;
  rmenuPop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  rmenuPop.style.top = Math.min(innerHeight - rmenuPop.offsetHeight - 8, r.bottom + 6) + 'px';
}
$('board').addEventListener('click', (e) => {
  if (e.target.closest('.rfilter')) return; // klik do hledacího pole neřadí
  const chip = e.target.closest('a.atk');
  if (chip) { // odkaz na útok se otevře sám (nová karta); bez ID hráče nemá kam vést
    if (!chip.getAttribute('href')) { e.preventDefault(); toast('U hráče chybí ID z odkazu útoku. Aktualizuj skript „Síla hráčů“ v Tampermonkey a obnov stránku rasy ve hře.', true); }
    return;
  }
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const id = btn.closest('.rpanel').dataset.p;
  const act = btn.dataset.act;
  if (act === 'fold') { const P = lp(id); P.folded = !P.folded; saveLayouts(); renderBoard(); }
  else if (act === 'close') { panels = panels.filter((x) => x !== id); saveUi(); renderBoard(); }
  else if (act === 'why') { if (btn.classList.contains('bad') || btn.classList.contains('warn')) showWhy(id, btn); }
  else if (act === 'menu') openRmenu(id, btn);
  else if (act === 'search') {
    const st = ps(id), open = !(st.searchOpen || st.filter);
    st.searchOpen = open; if (!open) st.filter = '';
    v_(id).filter.value = st.filter; saveUi(); updatePanel(id);
    if (open) v_(id).filter.focus();
  }
  else if (act === 'left' || act === 'right') {
    const i = panels.indexOf(id), j = act === 'left' ? i - 1 : i + 1;
    if (j >= 0 && j < panels.length) { [panels[i], panels[j]] = [panels[j], panels[i]]; saveUi(); renderBoard(); }
  } else if (act === 'mode') setMode(id, btn.dataset.mode);
  else if (act === 'dohodit') dohodit(btn);
  else if (act === 'cfg') { const st = ps(id); st.cfgOpen = !st.cfgOpen; saveUi(); updatePanel(id); }
  else if (act === 'dday') { const st = ps(id); st.dday = !st.dday; saveUi(); updatePanel(id); }
  else if (act === 'sort') {
    // jméno: abecedně nahoru, pak dolů; čísla: od největšího, pak od nejmenšího; třetí klik = pořadí ze hry
    const st = ps(id), key = btn.dataset.key ?? 'power';
    const first = key === 'name' ? 'asc' : 'desc', second = first === 'asc' ? 'desc' : 'asc';
    if ((st.sortKey ?? 'power') !== key || st.sort === 'game') { st.sortKey = key; st.sort = first; }
    else st.sort = st.sort === first ? second : 'game';
    saveUi(); updatePanel(id);
  }
});

// změna velikosti tažením hrany (jen šířka / jen výška) nebo rohu (obojí); dvojklik = zpět na výchozí
let drag = null;
$('board').addEventListener('pointerdown', (e) => {
  const g = e.target.closest('.rgrip'); if (!g) return;
  const root = g.closest('.rpanel'), v = view.get(root.dataset.p);
  drag = { v, g, id: root.dataset.p, dir: g.dataset.dir, x: e.clientX, y: e.clientY, w: root.offsetWidth, h: v.body.offsetHeight };
  g.classList.add('on');
  g.setPointerCapture(e.pointerId);
  e.preventDefault();
});
$('board').addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (drag.dir.includes('e')) {
    const w = clamp(drag.w + e.clientX - drag.x, 320, 1800);
    drag.v.root.style.width = w + 'px'; drag.v._w = w; drag.nw = w;
  }
  if (drag.dir.includes('s')) {
    const h = clamp(drag.h + e.clientY - drag.y, 80, 3000);
    drag.v.body.style.height = h + 'px'; drag.v.body.style.maxHeight = 'none'; drag.v._h = h; drag.nh = h;
  }
});
const endDrag = () => {
  if (!drag) return;
  drag.g.classList.remove('on');
  const P = lp(drag.id);
  if (drag.nw) P.w = drag.nw;
  if (drag.nh) P.h = drag.nh;
  if (drag.nw || drag.nh) saveLayouts();
  drag = null;
};
$('board').addEventListener('pointerup', endDrag);
$('board').addEventListener('pointercancel', endDrag);
$('board').addEventListener('dblclick', (e) => {
  const g = e.target.closest('.rgrip');
  if (g) {
    const id = g.closest('.rpanel').dataset.p, P = lp(id);
    if (g.dataset.dir.includes('e')) delete P.w;
    if (g.dataset.dir.includes('s')) delete P.h;
    saveLayouts(); updatePanel(id); return;
  }
  const t = e.target.closest('.rtitle');
  if (t) { const id = t.closest('.rpanel').dataset.p; const P = lp(id); P.folded = !P.folded; saveLayouts(); renderBoard(); }
});

$('board').addEventListener('input', (e) => {
  const id = e.target.closest('.rpanel')?.dataset.p; if (!id) return;
  if (e.target.classList.contains('rfilter')) { ps(id).filter = e.target.value; saveUi(); updatePanel(id); }
  else if (e.target.classList.contains('rbelow')) { ps(id).below = e.target.checked; saveUi(); updatePanel(id); }
});

/* ---------- Nastavení hráče: dolní práh + horní hranice auto-dohozu v jednom rozbalovacím okně ---------- */
let psCtx = null; // { raceId, name } hráče, kterého okno právě upravuje
function closePset() { $('psetPop').hidden = true; psCtx = null; }
function openPset(btn) {
  const raceId = btn.dataset.race, name = btn.dataset.name;
  const r = raceOf(raceId), p = r?.players.find((x) => x.name === name);
  if (!p) return;
  psCtx = { raceId, name };
  const defLow = r.threshold ?? cfg.threshold, gTop = cfg.army?.auto?.topUpTarget ?? 0, topMode = !!cfg.army?.auto?.topUp;
  $('psName').textContent = name;
  $('psRace').textContent = r.name;
  $('psLow').value = dots(p.ownThreshold); $('psLow').placeholder = dots(defLow);
  $('psTop').value = dots(p.ownTop); $('psTop').placeholder = gTop ? dots(gTop) : 'např. 750 000 000';
  $('psLowHelp').textContent = `Když síla hráče klesne pod toto číslo, přijde alert (a spustí se auto-dohoz). Prázdné = výchozí práh ${dots(defLow)}.`;
  $('psTopHelp').textContent = `Auto-dohoz dohazuje, dokud síla hráče nepřekročí toto číslo. Prázdné = výchozí ${gTop ? dots(gTop) : '(zatím nenastavená)'} z Nastavení → Dohoz.`
    + (topMode ? '' : ' Pozor: auto-dohoz je teď v režimu „Nad práh“, horní hranice se použije až po přepnutí na „Až do horní hranice“.');
  $('psHunt').checked = !!p.hunt;
  $('psErr').textContent = '';
  const pop = $('psetPop'), rc = btn.getBoundingClientRect();
  pop.hidden = false;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(rc.left, innerWidth - w - 8))}px`;
  pop.style.top = `${rc.bottom + 6 + h > innerHeight ? Math.max(8, rc.top - h - 6) : rc.bottom + 6}px`;
  $('psLow').focus(); $('psLow').select();
}
function savePset() {
  if (!psCtx) return;
  const low = undots($('psLow').value), top = undots($('psTop').value);
  const r = raceOf(psCtx.raceId), p = r?.players.find((x) => x.name === psCtx.name);
  const effLow = low ?? (r?.threshold ?? cfg.threshold);
  if (top != null && top <= effLow) { $('psErr').textContent = `Horní hranice musí být vyšší než dolní práh (${dots(effLow)}).`; $('psTop').focus(); return; }
  const huntOn = $('psHunt').checked;
  if (p) { p.ownThreshold = low; p.ownTop = top; p.hunt = huntOn; } // lokálně hned
  savePartial({ players: { [psCtx.name]: { threshold: low, topTarget: top, hunt: huntOn } } });
  closePset();
  renderBoard();
}
$('board').addEventListener('click', (e) => {
  const b = e.target.closest('.pset');
  if (!b) return;
  e.stopPropagation();
  if (!$('psetPop').hidden && psCtx && psCtx.name === b.dataset.name && psCtx.raceId === b.dataset.race) closePset(); else openPset(b);
});
$('psetPop').addEventListener('click', (e) => {
  const reset = e.target.closest('[data-reset]');
  if (reset) { $(reset.dataset.reset === 'low' ? 'psLow' : 'psTop').value = ''; return; }
  if (e.target.closest('#psSave')) savePset();
  else if (e.target.closest('#psClose')) closePset();
});
$('psetPop').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); savePset(); }
  else if (e.key === 'Escape') closePset();
});
document.addEventListener('pointerdown', (e) => { if (!$('psetPop').hidden && !e.target.closest('#psetPop') && !e.target.closest('.pset')) closePset(); });
document.addEventListener('scroll', (e) => { if (!$('psetPop').hidden && !e.target.closest?.('#psetPop')) closePset(); }, true);
window.addEventListener('resize', closePset);
$('board').addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target.classList?.contains('rfilter')) { // Esc: smazat hledání a zavřít pole
    const id = e.target.closest('.rpanel').dataset.p, st = ps(id);
    st.filter = ''; st.searchOpen = false; e.target.value = ''; saveUi(); updatePanel(id); return;
  }
});
$('board').addEventListener('change', (e) => {
  const t = e.target;
  const id = t.closest('.rpanel')?.dataset.p; if (!id) return;
  if (t.classList.contains('autoarmy')) return setAutoArmy(t.checked); // vypínač auto-dohozu v záhlaví sloupce Dohodit
  if (t.classList.contains('rcrit')) {
    const r = raceOf(id); if (!r) return;
    const v = t.value === '' ? null : Number(t.value);
    r.criticalPct = v; savePartial({ races: { [id]: { criticalPct: v } } });
    return;
  }
  if (t.classList.contains('rqb') || t.classList.contains('rqa')) { // vlastní hranice k dobytí této rasy
    const r = raceOf(id); if (!r) return;
    const k = t.classList.contains('rqb') ? 'below' : 'above', v = undots(t.value);
    r.conquestOwn = { ...(r.conquestOwn ?? {}), [k]: v }; if (v == null) delete r.conquestOwn[k]; if (!Object.keys(r.conquestOwn).length) r.conquestOwn = null;
    savePartial({ races: { [id]: { conquest: { [k]: v } } } });
    return;
  }
  if (t.classList.contains('rth')) {
    const r = raceOf(id); if (!r) return;
    const v = undots(t.value);
    r.threshold = v; savePartial({ races: { [id]: { threshold: v } } });
    return;
  }
  const { kind, name, race } = t.dataset;
  const r = raceOf(race); const p = r?.players.find((x) => x.name === name);
  if (!p) return;
  if (kind === 'watch') {
    const want = t.checked;
    if (r.mode === 'off') {
      // zapnutí hráče v režimu "Nehlídat" přepne rasu na "Vybraní" a zapne jen jeho
      r.mode = 'selected';
      for (const x of r.players) { x.overridden = false; x.watched = false; }
      p.watched = true; p.overridden = true;
      renderBoard();
      savePartial({ races: { [race]: { mode: 'selected' } }, players: { [name]: { watch: true } } });
      return;
    }
    p.watched = want; // lokálně hned
    p.overridden = want !== (r.mode === 'all');
    savePartial({ players: { [name]: { watch: want === (r.mode === 'all') ? null : want } } });
  }
});

