/* ---------- rozložení: velikost a sbalení panelů, zvlášť pro každý monitor ---------- */
// klíč monitoru: rozlišení + poloha okna (screen.availLeft/Top ukazují na monitor, kde okno leží)
const monKey = () => `${screen.width}x${screen.height}@${screen.availLeft ?? 0},${screen.availTop ?? 0}`;
const readLayouts = () => loadJson('layouts', {});
let layouts = readLayouts();
const ui = (() => { const c = (() => { try { return JSON.parse(store.get('uicfg')) ?? {}; } catch { return {}; } })(); return { dens: ['s', 'm', 'l'].includes(c.dens) ? c.dens : 'l', short: !!c.short }; })();
const saveUi2 = () => { store.set('uicfg', JSON.stringify(ui)); document.body.dataset.dens = ui.dens; };
document.body.dataset.dens = ui.dens;
const lay = () => (layouts[monKey()] ??= { defW: 600, defH: 0, panels: {} });
const lp = (id) => (lay().panels[id] ??= {});
/** Uloží jen klíč tohoto monitoru; ostatní se čtou znovu, ať okno na jiném monitoru nepřepíše cizí změny. */
function saveLayouts() {
  const latest = readLayouts();
  latest[monKey()] = lay();
  layouts = latest;
  store.set('layouts', JSON.stringify(latest));
}
window.addEventListener('storage', (e) => { if (e.key === 'layouts') layouts = readLayouts(); });

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
function applyLayout(v, id) {
  const L = lay(), P = lp(id);
  const w = clamp(P.w ?? L.defW, 320, 1800);
  const h = P.h ?? L.defH;
  if (v._w !== w) { v.root.style.width = w + 'px'; v._w = w; }
  if (v._h !== h) { v.body.style.height = h ? h + 'px' : ''; v.body.style.maxHeight = h ? 'none' : ''; v._h = h; }
  v.root.classList.toggle('folded', !!P.folded);
  v.foldBtn.textContent = P.folded ? '▸' : '▾';
}
function applyAllLayouts() { for (const [id, v] of view) applyLayout(v, id); }

function buildPanel(id) {
  const isW = id === WATCHED;
  const root = document.createElement('section');
  root.className = 'card rpanel';
  root.dataset.p = id;
  root.dataset.mode = isW ? 'all' : 'off';
  root.innerHTML = `
    <div class="rhead">
      <span class="dot"></span>
      <div class="rtitle"><b class="rname"></b><span class="rage" data-act="why" title="Jak čerstvá jsou data z hry (zelená do 3 s). Když jsou stará, klikni pro nápovědu."></span><span class="muted rinfo" hidden></span></div>
      <span class="rfsum"></span>
      ${isW ? '' : `<div class="rmode" role="group" aria-label="Co hlídat">
        ${modeBtn.map(([m, ic, t]) => `<button data-act="mode" data-mode="${m}" title="${modeHint[m]}"><span class="mi">${ic}</span><span class="mt">${t}</span></button>`).join('')}
      </div>
      <button class="icon rrole chip" hidden data-act="role" title="Naše rasa = hlídá se pokles pod práh (obrana). Cizí rasa = hlídá se, kdo je k dobytí. Klikni pro přepnutí."></button>
      <button class="icon rcfgbtn chip" data-act="cfg" title="Práh a kritická hranice této rasy"></button>`}
      <div class="rtools">
        <button class="icon" data-act="fold" title="Sbalit / rozbalit panel">▾</button>
        <div class="rmwrap"><button class="icon" data-act="menu" title="Další: posunout, odebrat">⋮</button>
          <div class="rmenu" hidden>
            <button data-act="left">◀ Posunout doleva</button>
            <button data-act="right">▶ Posunout doprava</button>
            <button data-act="close">✕ Odebrat panel</button>
          </div>
        </div>
      </div>
    </div>
    ${isW ? '' : `<div class="rcfg" hidden>
      <label>Práh rasy<input type="text" inputmode="numeric" class="num rth"></label>
      <label title="Kritická hranice jako % z prahu hráče">Kritická (% prahu)<input type="number" min="0" max="100" class="rcrit"></label>
      <label class="qatk" title="Hráč je k dobytí, když mu síla klesne pod toto číslo. Prázdné = společná hranice z Nastavení.">K dobytí pod<input type="text" inputmode="numeric" class="num rqb"></label>
      <label class="qatk" title="Hráč přestane být k dobytí, až mu síla stoupne nad toto číslo. Prázdné = společná hranice z Nastavení.">Konec nad<input type="text" inputmode="numeric" class="num rqa"></label>
    </div>`}
    <div hidden><span class="rcount"></span><input type="checkbox" class="rbelow"><span class="rbelowtxt"></span></div>
    <div class="rbody"><table>
      <thead><tr><th class="sortable thname" data-act="sort" data-key="name" title="Řadit podle jména"><span class="nlbl">Jméno <span class="sarrow"></span></span><input type="search" class="rfilter" placeholder="Hledat…" hidden><button type="button" class="mini srch" data-act="search" title="Hledat hráče (jméno)">🔍</button><span class="rwatch"></span></th>${isW ? '<th>Rasa</th>' : ''}<th class="n pc sortable" data-act="sort" data-key="planets" title="Řadit podle počtu planet. Získaná planeta zeleně +1, ztracená červeně −1 (30 s od poslední změny)"><div class="hw"><span class="hl">Planety<span class="sarrow"></span></span><span class="ddslot"><button type="button" class="mini ddbtn" data-act="dday" title="Ukázat u každého hráče, kolik planet získal nebo ztratil za den (údaj ze hry, jako ve hře)">±</button></span></div></th><th class="n sortable" data-act="sort" data-key="power" title="Řadit podle síly"><div class="hw"><span class="hl">Síla<span class="sarrow"></span></span></div></th><th class="dcol" title="Druhy útoku jako ve hře: D dobývací, P partyzánský, Z, U univerzální, N orbitální, L loupežný, S špionážní, T otrokářský. Svítí = jde zahájit">Útok</th><th class="c hcol" title="Pošle hráči rasovou armádu (stránka Jednotky → Rasová armáda musí být otevřená a vyplněná)"></th><th class="c">Hlídat</th></tr></thead>
      <tbody></tbody></table><div class="empty rempty"></div></div>
    <div class="rgrip e" data-dir="e" title="Táhni pro změnu šířky (dvojklik = výchozí)"></div>
    <div class="rgrip s" data-dir="s" title="Táhni pro změnu výšky (dvojklik = výchozí)"></div>
    <div class="rgrip se" data-dir="se" title="Táhni pro změnu velikosti (dvojklik = výchozí)"></div>`;
  root.querySelectorAll('button[title]').forEach((b) => { if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', b.title); });
  const q = (s) => root.querySelector(s);
  const v = { root, isW, rows: new Map(), body: q('.rbody'), fsum: q('.rfsum'), foldBtn: q('[data-act=fold]'), dot: q('.dot'), name: q('.rname'), age: q('.rage'), info: q('.rinfo'), th: q('.rth'), crit: q('.rcrit'), qb: q('.rqb'), qa: q('.rqa'),
    watchTxt: q('.rwatch'), cfgBtn: q('.rcfgbtn'), cfgBox: q('.rcfg'), roleBtn: q('.rrole'), belowTxt: q('.rbelowtxt'),
    filter: q('.rfilter'), searchBtn: q('.srch'), nameLbl: q('.nlbl'), below: q('.rbelow'), count: q('.rcount'), tbody: q('tbody'), empty: q('.rempty'), sortHeads: [...root.querySelectorAll('th[data-act=sort]')], ddBtn: q('.ddbtn') };
  v.filter.value = ps(id).filter;
  v.below.checked = ps(id).below;
  return v;
}

function makeRow(v, r, p) {
  const tr = document.createElement('tr');
  tr.dataset.race = r.id; tr.dataset.name = p.name;
  tr.innerHTML = `<td class="pname" title="Klikni pro zkopírování jména"></td>${v.isW ? '<td></td>' : ''}<td class="n pc"><div class="pcw"><span class="pnum"><span class="pv"></span><span class="pd"></span></span><span class="pdd"></span></div></td>
    <td class="n"><span class="pnum"><span class="pv"></span><span class="pd"></span></span></td>
    <td class="dcol"><span class="atks"></span></td>
    <td class="c hcol"><button class="ghost dohodit" data-act="dohodit" title="Pošle hráči rasovou armádu">Dohodit</button></td>
    <td class="c"><label class="sw"><input type="checkbox"><span></span></label></td>`;
  const nameTd = tr.children[0];
  nameTd.innerHTML = '<span class="on"></span><span class="nm"></span><span class="tg"></span><span class="thl"><span class="thv" title="Práh, pod který klesne síla = alert. Klikni a nastav hráči vlastní (prázdné = výchozí rasy)"></span><input type="text" inputmode="numeric" class="num thin" hidden></span>';
  nameTd.querySelector('.nm').textContent = p.name;
  nameTd.addEventListener('click', (e) => { if (!e.target.closest('.thl')) copyName(p.name); });
  if (v.isW) tr.children[1].textContent = r.name;
  const input = nameTd.querySelector('input.thin'), sw = tr.querySelector('.sw input');
  for (const el of [input, sw]) { el.dataset.name = p.name; el.dataset.race = r.id; }
  input.dataset.kind = 'th'; sw.dataset.kind = 'watch';
  const cell = (td) => ({ td, v: td.querySelector('.pv'), d: td.querySelector('.pd'), dd: td.querySelector('.pdd') });
  const hb = tr.querySelector('.dohodit'); hb.dataset.name = p.name;
  return { tr, hb, nm: nameTd.querySelector('.nm'), on: nameTd.querySelector('.on'), tag: nameTd.querySelector('.tg'), thl: nameTd.querySelector('.thl'), thv: nameTd.querySelector('.thv'), atks: tr.querySelector('.atks'), planets: cell(tr.children[v.isW ? 2 : 1]), pw: cell(tr.children[v.isW ? 3 : 2]), power: tr.children[v.isW ? 3 : 2], input, sw };
}

/** Dohodit: pošle hráči rasovou armádu přes skript na stránce Jednotky → Rasová armáda a počká na výsledek. */
async function dohodit(btn) {
  const name = btn.dataset.name;
  btn.classList.add('busy');
  try {
    const r = await fetch('/api/army', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).then((x) => x.json());
    if (!r.ok) return toast(r.error || 'Dohodit nejde', true);
    toast(`Dohazuji ${name}…`);
    for (let i = 0; i < 3; i++) { // server odpoví, jakmile je vyřízeno (dlouhé dotazování), max ~20 s na pokus
      const st = (await api(`/api/army/wait?id=${r.id}`)).req;
      if (!st || st.id !== r.id) break;
      if (st.status === 'sent') return toast(`Odesláno: ${name} ✓`);
      if (st.status === 'error') return toast(`Neodesláno (${name}): ${st.error}`, true);
      if (st.status === 'expired') return toast('Stránka Rasová armáda si požadavek nevyzvedla, nic se neodeslalo', true);
    }
    toast('Nevím, jestli se odeslalo – zkontroluj stránku Rasová armáda', true);
  } catch (e) { toast('Dohodit selhalo: ' + e.message, true); }
  finally { btn.classList.remove('busy'); }
}

async function copyName(name) {
  try { await navigator.clipboard.writeText(name); toast(`Zkopírováno: ${name}`); }
  catch { toast('Kopírování se nepovedlo', true); }
}

/** „před 12 min“ od času serveru. */
const ago = (t) => { const m = Math.round((S.serverTime - t) / 60000); return m < 1 ? 'před chvílí' : m < 90 ? `před ${m} min` : `před ${(m / 60).toFixed(1)} h`; };
const PLANET_MS = 30_000; // jak dlouho je vidět získaná/ztracená planeta (od poslední změny)
const CHANGE_MS = 10_000; // jak dlouho je změna síly vidět barevně, pak zpět na výchozí vzhled
const signed = (n) => (n > 0 ? '+' : '−') + fmt(Math.abs(n));
/** Číslo + změna jako ve hře: nárůst zeleně, ztráta červeně (cls '' = beze změny). */
function setDelta(c, delta) {
  const txt = delta ? ` ${signed(delta)}` : '';
  if (c.d.textContent !== txt) c.d.textContent = txt;
  c.d.className = 'pd' + (delta > 0 ? ' plus' : delta < 0 ? ' minus' : '');
}

function panelItems(id) {
  if (id === WATCHED) return S.races.flatMap((r) => r.players.filter((p) => p.watched).map((p) => ({ r, p })));
  const r = raceOf(id);
  return r ? r.players.map((p) => ({ r, p })) : [];
}

/** Blikání jména při pádu pod práh: poslední stav (pod/nad) a do kdy blikat; klíč raceId|jméno. */
const BLINK_MS = 10_000;
const belowSeen = new Map();
const blinkUntil = new Map();

const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
/** Krátké zbarvení hodnoty při změně (zeleně nahoru, červeně dolů); bez přepínání tříd a vynuceného přepočtu rozložení. */
function flashValue(el, d) {
  if (!d || reduceMotion || !el.animate) return;
  el.animate([{ backgroundColor: d > 0 ? 'rgba(46,204,64,.42)' : 'rgba(255,77,77,.42)' }, { backgroundColor: 'rgba(0,0,0,0)' }], { duration: 1100, easing: 'ease-out' });
}
/** Pád pod práh: řádek vzplane červeně, jméno se zatřese a síla „udeří“. */
function dropFx(row) {
  if (reduceMotion || !row.tr.animate) return;
  for (const td of row.tr.children) td.animate([{ backgroundColor: 'rgba(255,60,60,.8)' }, { backgroundColor: 'rgba(255,60,60,.18)' }], { duration: 1000, easing: 'ease-out' });
  row.nm.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], { duration: 460 });
  row.pw.v.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22)', offset: .3 }, { transform: 'scale(1)' }], { duration: 520 });
}
/** Návrat nad práh: řádek se zalije zelenou, jméno se rozzáří a síla se zvedne. */
function riseFx(row) {
  if (reduceMotion || !row.tr.animate) return;
  for (const td of row.tr.children) td.animate([{ backgroundColor: 'rgba(90,209,154,.6)' }, { backgroundColor: 'rgba(90,209,154,0)' }], { duration: 1900, easing: 'ease-out' });
  row.nm.animate([{ textShadow: '0 0 0 rgba(90,209,154,0)', transform: 'scale(1)' }, { textShadow: '0 0 14px rgba(90,209,154,1)', transform: 'scale(1.16)', offset: .35 }, { textShadow: '0 0 0 rgba(90,209,154,0)', transform: 'scale(1)' }], { duration: 1500, easing: 'ease-out' });
  row.pw.v.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-5px) scale(1.15)', offset: .35 }, { transform: 'translateY(0)' }], { duration: 650, easing: 'ease-out' });
}
/** Plynulé přesunutí řádků po změně pořadí (FLIP): řádek se nejdřív vrátí na starou pozici a pak do nové doklouzne. */
function flipRows(rows, first) {
  if (reduceMotion) return;
  const moves = [];
  for (const [key, row] of rows) {
    const was = first.get(key);
    if (was == null) continue;
    const d = was - row.tr.offsetTop;
    if (d && Math.abs(d) < 600) moves.push([row.tr, d]);
  }
  if (!moves.length) return;
  for (const [tr, d] of moves) { tr.style.transition = 'none'; tr.style.transform = `translateY(${d}px)`; }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const [tr] of moves) { tr.style.transition = 'transform .32s cubic-bezier(.2,.8,.2,1)'; tr.style.transform = ''; }
  }));
}

function updatePanel(id) {
  const v = view.get(id);
  const r = v.isW ? null : raceOf(id);
  const st = ps(id);
  const items = panelItems(id);
  applyLayout(v, id);

  // hlavička
  if (v.isW) {
    v.name.textContent = '★ Hlídaní hráči';
    v.info.textContent = `${items.length} hráčů z ${new Set(items.map((i) => i.r.id)).size} ras`;
    v.dot.className = 'dot' + (items.length && items.every((i) => isLive(i.r)) ? ' live' : '');
  } else {
    const mode = r?.mode ?? 'off';
    v.root.dataset.mode = mode;
    v.name.textContent = r ? r.name : `Rasa #${id}`;
    const age = r ? ageOf(r) : null;
    v.info.textContent = r && r.at
      ? `${r.players.length} hráčů · ${(age / 1000).toFixed(1).replace('.', ',')} s`
      : 'zatím žádná data – otevři stránku této rasy';
    v.dot.className = 'dot' + (!r || !r.at ? '' : isLive(r) ? ' live' : ' stale');
    v.root.querySelectorAll('[data-act=mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    const attack = r?.role === 'attack';
    v.root.dataset.role = attack ? 'attack' : 'defend';
    v.roleBtn.innerHTML = attack ? '<span>🎯</span><span class="rt"> Cizí</span>' : '<span>🛡</span><span class="rt"> Naše</span>';
    v.roleBtn.title = (attack ? 'Cizí rasa: hlídá se, kdo je k dobytí.' : 'Naše rasa: hlídá se pokles pod práh.') + ' Klikni pro přepnutí.';
    v.belowTxt.textContent = attack ? 'jen k dobytí' : 'jen pod prahem';

    const total = r ? r.players.length : 0;
    const w = r ? r.players.filter((p) => p.watched).length : 0;
    v.watchTxt.innerHTML = mode === 'off' ? 'nehlídá se'
      : mode === 'selected' && !w ? 'zapni hráče vpravo'
      : `<b>${w}</b>/${total}${attack && r.players.some((p) => p.target) ? ` · 🎯 <b>${r.players.filter((p) => p.target).length}</b>` : ''}`;
    v.watchTxt.title = mode === 'off' ? 'Nic se nehlídá' : `Hlídá se ${w} z ${total} hráčů${attack ? `, k dobytí ${r.players.filter((p) => p.target).length}` : ''}`;
    const th = r?.threshold ?? cfg.threshold;
    const pct = r?.criticalPct ?? cfg.criticalPct;
    const cq = r?.conquest ?? cfg.conquest;
    v.cfgBtn.textContent = attack ? `⚙ 🎯 <${short(cq.below)} / >${short(cq.above)}${r?.conquestOwn ? ' ✎' : ''}` : `⚙ ${short(th)}${pct ? ` · 🆘${pct}%` : ''}`;
    v.cfgBtn.title = attack ? `Hranice k dobytí pro ${r?.name ?? 'tuto rasu'}${r?.conquestOwn ? ' (vlastní)' : ' (společná z Nastavení)'}: k dobytí pod ${dots(cq.below)}, konec nad ${dots(cq.above)}. Klikni pro nastavení této rasy.` : 'Práh a kritická hranice této rasy';
    v.cfgBtn.classList.toggle('open', !!st.cfgOpen);
    v.cfgBox.hidden = !st.cfgOpen;
    v.qb.placeholder = dots(cfg.conquest.below); v.qa.placeholder = dots(cfg.conquest.above);
    if (document.activeElement !== v.qb && !pending) v.qb.value = dots(r?.conquestOwn?.below);
    if (document.activeElement !== v.qa && !pending) v.qa.value = dots(r?.conquestOwn?.above);
    v.cfgBox.style.top = (v.root.querySelector('.rhead')?.offsetHeight ?? 44) + 'px';
    v.th.placeholder = dots(cfg.threshold);
    if (document.activeElement !== v.th && !pending) v.th.value = dots(r?.threshold);
    v.crit.placeholder = String(cfg.criticalPct);
    if (document.activeElement !== v.crit && !pending) v.crit.value = r?.criticalPct ?? '';
  }
  { // hledání ve sloupci Jméno: pole se ukáže po kliknutí na lupu nebo dokud je v něm text
    const open = !!st.searchOpen || !!st.filter;
    if (v.filter.hidden === open) { v.filter.hidden = !open; v.nameLbl.hidden = open; }
    v.searchBtn.classList.toggle('on', open);
  }
  const sortKey = st.sortKey ?? 'power';
  for (const th of v.sortHeads) {
    const active = th.dataset.key === sortKey && st.sort !== 'game';
    th.classList.toggle('active', active);
    th.querySelector('.sarrow').textContent = active ? (st.sort === 'desc' ? '↓' : '↑') : '↕';
    th.setAttribute('aria-sort', active ? (st.sort === 'desc' ? 'descending' : 'ascending') : 'none');
  }
  v.root.classList.toggle('dday', !!st.dday);
  v.ddBtn.classList.toggle('on', !!st.dday);
  // souhrn pro sbalený panel: kolik hráčů je k dobytí / pod prahem
  if (v.isW) { v.fsum.textContent = `${items.length} hráčů`; v.fsum.classList.remove('hot'); }
  else {
    const atkR = r?.role === 'attack';
    const n = !r ? 0 : atkR ? r.players.filter((p) => p.target).length : r.players.filter((p) => p.watched && p.power < p.threshold).length;
    v.fsum.textContent = atkR ? `🎯 ${n} k dobytí` : `${n} pod prahem`;
    v.fsum.classList.toggle('hot', n > 0);
  }

  // filtr a řazení
  const q = st.filter.trim().toLowerCase();
  let out = items.filter(({ r: pr, p }) => (!q || p.name.toLowerCase().includes(q)));
  if (st.sort !== 'game') {
    const dir = st.sort === 'desc' ? -1 : 1;
    out = [...out].sort((a, b) => dir * (sortKey === 'name' ? a.p.name.localeCompare(b.p.name, 'cs') : sortKey === 'planets' ? (a.p.planets ?? -1) - (b.p.planets ?? -1) : a.p.power - b.p.power));
  }

  // řádky (klíčované, žádné přepisování celé tabulky)
  const seen = new Set();
  let moved = false;
  const first = st.sort !== 'game' && !reduceMotion ? new Map([...v.rows].map(([k, r]) => [k, r.tr.offsetTop])) : null; // staré pozice pro plynulý přesun
  out.forEach(({ r: pr, p }, i) => {
    const key = `${pr.id}|${p.name}`;
    seen.add(key);
    let row = v.rows.get(key);
    if (!row) { row = makeRow(v, pr, p); v.rows.set(key, row); }
    if (v.tbody.children[i] !== row.tr) { v.tbody.insertBefore(row.tr, v.tbody.children[i] ?? null); moved = true; }
    const txt = ui.short ? short(p.power) : fmt(p.power);
    if (row.pw.v.title !== fmt(p.power)) row.pw.v.title = ui.short ? fmt(p.power) : '';
    if (row.pw.v.textContent !== txt) { if (row.lastPower != null) flashValue(row.pw.v, p.power - row.lastPower); row.pw.v.textContent = txt; }
    row.lastPower = p.power;
    const recent = p.powerDelta && p.powerAt && S.serverTime - p.powerAt < CHANGE_MS ? p.powerDelta : 0;
    setDelta(row.pw, recent);
    row.pw.v.classList.toggle('plus', recent > 0);
    row.pw.v.classList.toggle('minus', recent < 0);
    const pl = p.planets == null ? '' : fmt(p.planets);
    if (row.planets.v.textContent !== pl) { if (row.lastPlanets != null && p.planets != null) flashValue(row.planets.v, p.planets - row.lastPlanets); row.planets.v.textContent = pl; }
    row.lastPlanets = p.planets;
    // okamžitá změna planet (ne denní přírůstek ze hry): zeleně +N / červeně −N, 30 s od poslední změny
    const dd = p.planetsDelta; // denní změna planet ze hry (+25 / −3 / 0); null = zatím nevíme
    const ddTxt = dd == null ? '–' : dd > 0 ? `+${dd}` : dd < 0 ? `−${Math.abs(dd)}` : '0';
    if (row.planets.dd.textContent !== ddTxt) row.planets.dd.textContent = ddTxt;
    row.planets.dd.className = 'pdd' + (dd > 0 ? ' plus' : dd < 0 ? ' minus' : '');
    row.planets.dd.title = dd == null ? 'Denní změna planet zatím není známá (skript ji stahuje z hry jednou za minutu)' : 'Změna planet za den (údaj ze hry)';
    const plRecent = p.planetsChange && p.planetsAt && S.serverTime - p.planetsAt < PLANET_MS ? p.planetsChange : 0;
    setDelta(row.planets, plRecent);
    row.planets.v.classList.toggle('plus', plRecent > 0);
    row.planets.v.classList.toggle('minus', plRecent < 0);
    const atk = pr.role === 'attack';
    // naše rasa: pád pod práh = jméno 10 s červeně bliká (jen při přechodu nad -> pod, ne po načtení stránky)
    const isBelow = !atk && p.power < p.threshold;
    const stale = pr.at && dAge(pr.at) >= 10_000; // údaje starší než 10 s: žádný alarm ani efekty
    const alarm = isBelow && p.watched && !stale; // červený řádek a svítící Dohodit jen u hlídaného hráče s čerstvými daty
    const bk = `${pr.id}|${p.name}`;
    const was = belowSeen.get(bk);
    if (p.watched && !stale && was === false && isBelow) { blinkUntil.set(bk, Date.now() + BLINK_MS); dropFx(row); } // pád pod práh
    else if (p.watched && !stale && was === true && !isBelow && !atk) riseFx(row); // návrat nad práh
    belowSeen.set(bk, isBelow);
    const blinking = alarm && (blinkUntil.get(bk) ?? 0) > Date.now();
    row.nm.classList.toggle('blink', blinking);
    row.tr.classList.toggle('below', alarm);
    row.tr.classList.toggle('flash', blinking);
    row.power.classList.toggle('below', alarm); // červeně a 🆘 jen u hlídaného hráče; vypnuté hlídání = bez upozornění
    const isCrit = alarm && p.critical > 0 && p.power < p.critical;
    row.power.classList.toggle('crit', isCrit);
    row.hb.hidden = atk; // dohodit jen hráčům naší rasy
    // zelená tečka před jménem = hráč je online (stejně jako ve hře)
    row.on.classList.toggle('yes', p.online === true);
    // barva jména podle hodnosti jako ve hře (naše i cizí rasy): vůdce žlutě, zástupce bíle, ministři zeleně
    const rk = ['vudce', 'zastupce', 'ministr', 'obcan'].includes(p.rank) ? p.rank : '';
    if (row.nm.dataset.rank !== rk) { row.nm.dataset.rank = rk; row.nm.title = { vudce: 'Vůdce', zastupce: 'Zástupce', ministr: 'Ministr' }[rk] ?? ''; }
    row.on.title = p.online ? 'Online' : '';
    // sloupec Útok (jen cizí rasa): všech 8 druhů útoku jako ve hře; svítí = jde zahájit. D otevře okno útoku v aplikaci.
    const atkKey = atk ? JSON.stringify([p.attacks, p.hracId, p.attackable, p.utokId]) : '';
    if (row.atks.dataset.k !== atkKey) {
      row.atks.dataset.k = atkKey;
      const list = p.attacks ?? (p.attackable == null ? [] : [{ t: 'D', id: p.utokId ?? 1, ok: p.attackable }]); // starší skript bez druhů útoku: jen D
      row.atks.innerHTML = atk ? list.map((a) => {
        const href = p.hracId ? ` href="https://www.stargate-game.cz/utok.php?page=0&hrac_id=${p.hracId}&utok_id=${a.id}#dominator=${a.t}" target="_blank" rel="noopener"` : '';
        const tip = !p.hracId ? `${ATK_NAMES[a.t] ?? a.t} útok – chybí ID hráče: aktualizuj skript Síla hráčů a obnov stránku rasy`
          : `${ATK_NAMES[a.t] ?? a.t} útok – otevře ho ve hře v nové kartě a vyplní jednotky a planetu (odeslání děláš ty)${a.ok ? '' : '. Ve hře je teď zhasnutý, hra ho nejspíš odmítne'}`;
        return `<a class="atk t-${a.t}${a.ok ? ' on' : ''}" data-t="${a.t}" data-id="${a.id}" data-ok="${a.ok ? 1 : 0}"${href} title="${esc(tip)}">${a.t}</a>`;
      }).join('') : '';
    }
    const tgt = atk && p.target, noatk = tgt && p.attackable === false;
    row.power.classList.toggle('target', tgt);
    row.power.classList.toggle('noatk', noatk);
    const tagTxt = tgt ? (noatk ? '🎯 nelze dobýt' : '🎯 k dobytí') : '';
    if (row.tag.textContent !== tagTxt) row.tag.textContent = tagTxt;
    row.tag.className = 'tg' + (noatk ? ' noatk' : '');
    row.tag.title = tgt ? `K dobytí ${ago(p.since)}${noatk ? ' – teď nelze dobýt (chybí D), zpráva přijde, až D bude' : ''}` : '';
    row.power.title = [
      recent ? `Změna síly ${signed(recent)} před ${Math.max(1, Math.round((S.serverTime - p.powerAt) / 1000))} s` : '',
      !atk && p.critical > 0 ? `Kritická hranice ${fmt(p.critical)}` : '',
      tgt ? `K dobytí: pod ${dots((pr.conquest ?? cfg.conquest).below)}, konec nad ${dots((pr.conquest ?? cfg.conquest).above)}` : '',
    ].filter(Boolean).join('\n');
    row.tr.classList.toggle('off', !p.watched);
    const own = p.ownThreshold != null;
    const thTxt = own ? short(p.ownThreshold) : '✎ ' + short(p.threshold); // jen číslo (např. 100 mil), vlastní práh žlutě, globální modře; vysvětlení je v bublině
    if (row.thv.textContent !== thTxt) row.thv.textContent = thTxt;
    row.thv.title = own ? `Vlastní práh ${dots(p.ownThreshold)} (výchozí rasy ${dots(p.threshold)}). Klikni pro úpravu, prázdné = výchozí` : `Práh ${dots(p.threshold)} (výchozí rasy). Klikni a nastav hráči vlastní`;
    row.thl.classList.toggle('own', own);
    row.input.placeholder = dots(p.threshold);
    if (!pending) { // ovládací prvky se synchronizují jen když se nic neukládá a uživatel v nich nepíše
      if (document.activeElement !== row.input && row.input.value !== dots(p.ownThreshold)) row.input.value = dots(p.ownThreshold);
      if (row.sw.checked !== p.watched) row.sw.checked = p.watched;
    }
  });
  for (const [key, row] of v.rows) if (!seen.has(key)) { row.tr.remove(); v.rows.delete(key); }
  if (moved && first) flipRows(v.rows, first);
  v.count.textContent = out.length === items.length ? `${items.length} hráčů` : `${out.length} z ${items.length}`;
  v.empty.hidden = out.length > 0;
  v.empty.textContent = v.isW && !items.length ? 'Zatím nic nehlídáš. V panelu rasy zvol „Celou rasu“ nebo zapni jednotlivé hráče.'
    : !items.length ? 'Čekám na data z okna s touto rasou.' : 'Nic neodpovídá filtru.';
}

function renderBoard() {
  // první spuštění: panely pro rasy, které se už hlídají
  if (panels === null) {
    if (!S.races.length) { $('boardEmpty').hidden = false; return renderBoardEmpty(); }
    panels = S.races.filter((r) => r.mode !== 'off').map((r) => r.id);
    saveUi();
  }
  panels = panels.filter((id, i) => panels.indexOf(id) === i);
  for (const id of panels) if (!view.has(id)) view.set(id, buildPanel(id));
  for (const [id, v] of view) if (!panels.includes(id)) { v.root.remove(); view.delete(id); }

  // sloupce: sbalené panely drží pohromadě s následujícím rozbaleným panelem, který se jim zařadí pod ně
  // (sbalíš Aschen a Bedrosian skočí pod něj; rozbalíš a Bedrosian se vrátí doprava)
  const groups = [];
  let cur = [];
  for (const id of panels) {
    cur.push(id);
    if (!lp(id).folded) { groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur); // sbalené panely na konci tvoří vlastní sloupec
  const sig = JSON.stringify(groups);
  if (sig !== boardSig) { // uzly se přesouvají jen při změně uspořádání, jinak by se každou vteřinu resetovalo rolování tabulek
    boardSig = sig;
    const frag = document.createDocumentFragment();
    for (const g of groups) {
      const col = document.createElement('div');
      col.className = 'bcol';
      for (const id of g) col.appendChild(view.get(id).root);
      frag.appendChild(col);
    }
    $('board').replaceChildren(frag);
  }
  for (const id of panels) updatePanel(id);
  renderBoardEmpty();
}
let boardSig = '';

function renderBoardEmpty() {
  const e = $('boardEmpty');
  e.hidden = !!(panels && panels.length);
  e.innerHTML = !S.races.length
    ? 'Zatím žádná data.<br>Otevři v prohlížeči stránku s hráči nějaké rasy (s nainstalovaným skriptem) a pak sem klikni na <b>＋ Přidat rasu</b>.'
    : 'Zatím tu není žádný panel.<br>Klikni na <b>＋ Přidat rasu</b> a vyber rasu, kterou máš otevřenou v prohlížeči.';
  $('boardHint').textContent = panels && panels.length ? 'Každá rasa má svůj panel. ＋ přidá další.' : '';
}

