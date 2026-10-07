/* ---------- statistiky dohozů ---------- */
const stBox = $('statsBox');
const stFilter = (() => { try { return { source: '', outcome: '', hours: '24', slow: '', name: '', ...JSON.parse(store.get('statsFilter') ?? '{}') }; } catch { return { source: '', outcome: '', hours: '24', slow: '', name: '' }; } })();
let stData = null, stRev = -1, stFetching = false, stTimer = null;
const stOpen = new Set(); // rozbalené epizody (id)

const fmtSec = (ms) => (ms == null || !Number.isFinite(ms) ? '–' : (ms / 1000).toFixed(ms < 10_000 ? 2 : 1) + ' s');
const fmtClock = (t) => { if (!t) return '–'; const d = new Date(t); const today = new Date().toDateString() === d.toDateString(); return (today ? '' : d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' }) + ' ') + d.toLocaleTimeString('cs-CZ'); };
const slowCls = (ms) => (ms == null ? '' : ms >= 10_000 ? ' bad' : ms >= 5_000 ? ' warn' : '');
const SRC = { auto: ['🤖 Auto', 'auto'], manual: ['👆 Ručně', 'manual'], mixed: ['🔀 Smíšené', 'mixed'] };
const OUT = { done: ['Hotovo', 'ok'], stall: ['Nezabralo', 'bad'], fail: ['Selhalo', 'bad'], max: ['Strop kol', 'bad'], cancelled: ['Zrušeno', 'warn'], unknown: ['?', 'warn'] };
const srcOf = (e) => (e.mixed ? 'mixed' : e.source);

function stQuery() {
  const q = new URLSearchParams();
  for (const k of ['source', 'outcome', 'hours', 'slow', 'name']) if (stFilter[k]) q.set(k, stFilter[k]);
  return q.toString();
}
async function stLoad() {
  if (stFetching) return;
  stFetching = true;
  try { stData = await api('/api/stats' + (stQuery() ? '?' + stQuery() : '')); stRev = stData.rev; renderStats(); }
  catch (e) { $('stBody').innerHTML = '<tr><td colspan="8" class="muted">Statistiku se nepodařilo načíst: ' + esc(e.message) + '</td></tr>'; }
  finally { stFetching = false; }
}
/** Voláno při každé změně stavu: když se statistika změnila a je zobrazená, načte se znovu (nejvýš jednou za 400 ms). */
function statsCheck() {
  if (stBox.hidden || S.statsRev === undefined || S.statsRev === stRev) return;
  clearTimeout(stTimer); stTimer = setTimeout(stLoad, 400);
}

function stBuild() {
  stBox.innerHTML = `
    <div class="st-head">
      <h2>Statistiky dohozů</h2>
      <span class="muted" id="stCount"></span>
      <span style="flex:1"></span>
      <button class="ghost" id="stCsv" type="button">Export CSV</button>
    </div>
    <div class="st-filters" id="stFilters">
      <div class="seg" id="stSource" role="group" aria-label="Zdroj dohozu">
        <button type="button" data-v="">Vše</button><button type="button" data-v="auto">🤖 Auto</button><button type="button" data-v="manual">👆 Ručně</button><button type="button" data-v="mixed">🔀 Smíšené</button>
      </div>
      <label>Výsledek <select id="stOutcome"><option value="">všechny</option><option value="ok">úspěšné</option><option value="bad">neúspěšné</option></select></label>
      <label>Období <select id="stHours"><option value="1">1 hodina</option><option value="6">6 hodin</option><option value="24">24 hodin</option><option value="168">7 dní</option><option value="">vše</option></select></label>
      <label>1. dohoz <select id="stSlow"><option value="">jakkoli rychlý</option><option value="3">pomalejší než 3 s</option><option value="5">pomalejší než 5 s</option><option value="10">pomalejší než 10 s</option></select></label>
      <input type="search" id="stName" placeholder="Hráč…" autocomplete="off">
    </div>
    <div class="st-cards" id="stCards"></div>
    <div class="st-chart"><div class="muted st-charthead"><span>Čas do prvního dohozu (od pádu pod práh) – posledních 60 dohazování, nejstarší vlevo</span><span class="st-legend"><i class="lg auto"></i>auto <i class="lg manual"></i>ručně <i class="lg mixed"></i>smíšené <i class="lg badd"></i>neúspěšné</span></div><svg id="stChart" viewBox="0 0 600 90" preserveAspectRatio="none" role="img" aria-label="Graf času do prvního dohozu"></svg></div>
    <div class="st-tablewrap"><table class="st-table">
      <thead><tr><th>Pád pod práh</th><th>Hráč</th><th>Zdroj</th><th class="r">Pod prahem</th><th class="r">Do 1. dohozu</th><th class="r">Kol</th><th>Výsledek</th><th></th></tr></thead>
      <tbody id="stBody"></tbody>
    </table></div>
    <p class="muted st-note">Ukládá se posledních <span id="stKeep">200</span> dohazování (Nastavení → Data → Statistika dohozů). „Pod prahem“ = od prvního čtení pod prahem po první čtení nad ním; „do 1. dohozu“ = od pádu po odeslání jednotek skriptem; účinek = za jak dlouho se po odeslání zvedla síla v datech.</p>`;
  for (const b of $('stSource').children) b.onclick = () => { stFilter.source = b.dataset.v; stSaveFilter(); };
  $('stOutcome').onchange = () => { stFilter.outcome = $('stOutcome').value; stSaveFilter(); };
  $('stHours').onchange = () => { stFilter.hours = $('stHours').value; stSaveFilter(); };
  $('stSlow').onchange = () => { stFilter.slow = $('stSlow').value; stSaveFilter(); };
  let nt; $('stName').oninput = () => { clearTimeout(nt); nt = setTimeout(() => { stFilter.name = $('stName').value.trim(); stSaveFilter(); }, 250); };
  $('stCsv').onclick = stExport;
  stSyncFilterUi();
}
function stSaveFilter() { store.set('statsFilter', JSON.stringify(stFilter)); stSyncFilterUi(); stLoad(); }
function stSyncFilterUi() {
  for (const b of $('stSource').children) b.classList.toggle('on', b.dataset.v === stFilter.source);
  $('stOutcome').value = stFilter.outcome; $('stHours').value = stFilter.hours; $('stSlow').value = stFilter.slow;
  if (document.activeElement !== $('stName')) $('stName').value = stFilter.name;
}

function card(label, value, sub = '', cls = '') { return `<div class="st-card${cls}"><div class="v">${value}</div><div class="l">${label}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`; }
function renderStats() {
  if (!stData) return;
  const sm = stData.summary, all = [...stData.open, ...stData.episodes];
  const rounds = sm.auto + sm.manual;
  const pct = (n, t) => (t ? Math.round((n / t) * 100) : 0);
  $('stCount').textContent = stData.enabled ? `${stData.episodes.length} z ${stData.total} uložených` + (stData.open.length ? ` + ${stData.open.length} probíhá` : '') : 'statistika je vypnutá (Nastavení → Data)';
  $('stKeep').textContent = stData.keep;
  $('stCards').innerHTML =
    card('dohazování', sm.episodes, `${sm.ok} úspěšných${sm.bad ? `, <b class="bad">${sm.bad} neúspěšných</b>` : ''}`) +
    card('dohozů celkem', rounds, `<span class="chip auto">🤖 ${sm.auto} (${pct(sm.auto, rounds)} %)</span> <span class="chip manual">👆 ${sm.manual} (${pct(sm.manual, rounds)} %)</span>`) +
    card('hráč pod prahem', fmtSec(sm.belowMedian), 'medián · nejdéle ' + fmtSec(sm.belowMax)) +
    card('pád → 1. dohoz', fmtSec(sm.firstSendMedian), 'medián · nejdéle ' + fmtSec(sm.firstSendMax), slowCls(sm.firstSendMedian)) +
    card('zadání → odeslání', fmtSec(sm.sendMedian), 'jak dlouho skript vyplňuje a odesílá') +
    card('odeslání → síla naskočí', fmtSec(sm.effectMedian), 'medián účinku v datech') +
    card('obnovení stránky', sm.reloads, 'zastaralá stránka armády', sm.reloads ? ' warn' : '');
  renderStChart(stData.episodes);
  const body = $('stBody');
  if (!all.length) { body.innerHTML = '<tr><td colspan="8" class="muted" style="padding:18px">' + (stData.total ? 'Žádné dohazování neodpovídá filtru.' : 'Zatím nic. Statistika se plní, jakmile se dohazuje (tlačítkem Dohodit nebo automatem).') + '</td></tr>'; return; }
  body.innerHTML = all.map((e) => {
    const s = srcOf(e), [sl, sc] = SRC[s], [ol, oc] = e.open ? ['probíhá', 'warn'] : OUT[e.outcome] ?? OUT.unknown;
    const open = stOpen.has(e.id);
    const roundsHtml = open ? `<tr class="st-detail"><td colspan="8">${stRounds(e)}${e.note ? `<div class="muted" style="margin-top:6px">Poznámka: ${esc(e.note)}</div>` : ''}</td></tr>` : '';
    return `<tr class="st-row${open ? ' open' : ''}" data-id="${e.id}" tabindex="0">
      <td>${esc(fmtClock(e.fallAt ?? e.startedAt))}${e.fallAt == null ? ' <span class="muted" title="Hráč nebyl pod prahem (ruční dohoz); čas je zadání dohozu">*</span>' : ''}</td>
      <td class="nm">${esc(e.name)}</td>
      <td><span class="chip ${sc}">${sl}</span></td>
      <td class="r">${fmtSec(e.belowMs)}</td>
      <td class="r${slowCls(e.firstSendMs)}">${fmtSec(e.firstSendMs)}</td>
      <td class="r">${e.rounds.length}${e.rounds.some((r) => r.reloaded) ? ' <span title="Stránka armády se obnovila" class="warn">⟳</span>' : ''}</td>
      <td><span class="chip ${oc}">${ol}</span></td>
      <td class="exp">${open ? '▾' : '▸'}</td></tr>${roundsHtml}`;
  }).join('');
  for (const tr of body.querySelectorAll('.st-row')) {
    const toggle = () => { const id = Number(tr.dataset.id); stOpen.has(id) ? stOpen.delete(id) : stOpen.add(id); renderStats(); };
    tr.onclick = toggle; tr.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } };
  }
}

/** Podrobnosti jednoho dohazování: každé kolo zvlášť. */
function stRounds(e) {
  const t0 = e.fallAt ?? e.startedAt;
  const rows = e.rounds.map((r, i) => {
    const prev = i ? e.rounds[i - 1] : null;
    const [sl, sc] = SRC[r.source] ?? SRC.auto;
    const st = { pending: ['čeká', 'warn'], sent: ['odesláno', 'warn'], ok: ['zabralo', 'ok'], noeffect: ['bez účinku', 'bad'], failed: ['selhalo', 'bad'] }[r.status] ?? [r.status, ''];
    return `<tr><td>${r.n}</td><td><span class="chip ${sc}">${sl}</span></td><td class="r">${fmtSec(r.reqAt - t0)}</td><td class="r">${prev?.sentAt != null ? fmtSec(r.reqAt - prev.sentAt) : '–'}</td><td class="r">${fmtSec(r.sendMs)}</td><td class="r">${fmtSec(r.effectMs)}</td>
      <td class="r">${r.powerBefore != null ? fmt(r.powerBefore) : '–'} → ${r.powerAfter != null ? fmt(r.powerAfter) : '–'}</td><td class="r">${r.gain != null ? '+' + fmt(r.gain) : '–'}</td><td><span class="chip ${st[1]}">${st[0]}</span>${r.reloaded ? ' <span class="warn" title="Stránka armády se obnovila">⟳ obnovení</span>' : ''}${r.error ? ` <span class="bad">${esc(r.error)}</span>` : ''}</td></tr>`;
  }).join('');
  return `<table class="st-sub"><thead><tr><th>Kolo</th><th>Zdroj</th><th class="r">Zadáno po pádu</th><th class="r">Po předchozím odeslání</th><th class="r">Zadání → odeslání</th><th class="r">Odeslání → síla</th><th class="r">Síla</th><th class="r">Přírůstek</th><th>Stav</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** Sloupcový graf času do prvního dohozu (nejstarší vlevo, nejnovější vpravo). */
function renderStChart(list) {
  const svg = $('stChart');
  const items = list.slice(0, 60).reverse();
  if (!items.length) { svg.innerHTML = ''; return; }
  const W = 600, H = 90, pad = 4, n = items.length, bw = (W - pad * 2) / Math.max(n, 12);
  const max = Math.max(5000, ...items.map((e) => e.firstSendMs ?? 0));
  let out = '';
  for (const y of [5000, 10_000]) if (y < max) out += `<line x1="0" x2="${W}" y1="${H - 4 - (y / max) * (H - 10)}" y2="${H - 4 - (y / max) * (H - 10)}" class="grid"/><text x="${W - 2}" y="${H - 6 - (y / max) * (H - 10)}" class="gl" text-anchor="end">${y / 1000} s</text>`;
  items.forEach((e, i) => {
    const v = e.firstSendMs ?? 0, h = Math.max(1.5, (v / max) * (H - 10)), x = pad + i * bw;
    const bad = ['stall', 'fail', 'max'].includes(e.outcome);
    out += `<rect x="${x + 0.5}" y="${H - 4 - h}" width="${Math.max(2, bw - 1.5)}" height="${h}" rx="1.5" class="bar ${srcOf(e)}${bad ? ' badd' : ''}"><title>${esc(e.name)} · ${esc(fmtClock(e.fallAt ?? e.startedAt))} · do 1. dohozu ${fmtSec(e.firstSendMs)}</title></rect>`;
  });
  svg.innerHTML = out;
}

/** CSV (Excel): jeden řádek = jedno kolo dohozu, s údaji o dohazování. */
function stExport() {
  if (!stData) return;
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const s = (ms) => (ms == null ? '' : (ms / 1000).toFixed(3).replace('.', ','));
  const head = ['Pád pod práh', 'Hráč', 'Zdroj dohazování', 'Pod prahem (s)', 'Do 1. dohozu (s)', 'Výsledek', 'Kolo', 'Zdroj kola', 'Zadáno po pádu (s)', 'Zadání→odeslání (s)', 'Odeslání→síla (s)', 'Síla před', 'Síla po', 'Přírůstek', 'Stav kola', 'Obnovení stránky'];
  const lines = [head.map(q).join(';')];
  for (const e of [...stData.open, ...stData.episodes]) {
    const t0 = e.fallAt ?? e.startedAt;
    for (const r of e.rounds) lines.push([new Date(t0).toLocaleString('cs-CZ'), e.name, srcOf(e), s(e.belowMs), s(e.firstSendMs), e.open ? 'probíhá' : e.outcome, r.n, r.source, s(r.reqAt - t0), s(r.sendMs), s(r.effectMs), r.powerBefore ?? '', r.powerAfter ?? '', r.gain ?? '', r.status, r.reloaded ? 'ano' : ''].map(q).join(';'));
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = 'statistika-dohozu-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

stBuild();
