/* ---------- zvukový poplach (jen v tomto prohlížeči) ---------- */
const SND_DEF = { on: true, vol: 80, types: { threshold: true, critical: true, drop: true, recovered: true, target: true, released: false, op: true, service: false } };
const snd = (() => { const c = loadJson('sndcfg', {}); return { on: c.on ?? SND_DEF.on, vol: c.vol ?? SND_DEF.vol, types: { ...SND_DEF.types, ...(c.types ?? {}) } }; })();
const saveSnd = () => store.set('sndcfg', JSON.stringify(snd));
const SND_PRIO = { critical: 6, threshold: 5, drop: 4, op: 4, target: 3, recovered: 2, released: 1, service: 1 };
const SND_TEXT = { threshold: 'pod prahem', critical: 'KRITICKÉ – pod kritickou hranicí', drop: 'prudký propad síly', recovered: 'zpět nad prahem', target: 'k dobytí', released: 'už není k dobytí', op: 'OP na mapě', service: 'systémová zpráva' };
let actx = null, alarm = null, alarmTimer = 0;
const sndKind = (reason) => (reason === 'down' || reason === 'up' ? 'service' : reason);
function ensureCtx() {
  try { actx ??= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch { /* bez zvuku */ }
  renderSnd();
  return actx;
}
document.addEventListener('pointerdown', ensureCtx, { capture: true });
document.addEventListener('keydown', ensureCtx, { capture: true });
function stopAlarm() {
  clearTimeout(alarmTimer);
  if (alarm) { try { alarm.master.gain.cancelScheduledValues(0); alarm.master.gain.setTargetAtTime(0, actx.currentTime, 0.03); for (const n of alarm.nodes) n.stop(actx.currentTime + 0.2); } catch { /* už dohrál */ } alarm = null; }
  $('alarmBar').hidden = true;
}
/** Zahraje poplach daného druhu: siréna (práh, kritické, propad), pípání (OP), zvonění (návrat), pingy (k dobytí…). Vrací false, když prohlížeč zvuk zatím nepovolil. */
function playAlarm(kind, text) {
  const c = ensureCtx();
  if (!c || c.state !== 'running') return false;
  stopAlarm();
  const master = c.createGain(); master.gain.value = (snd.vol / 100) ** 1.6; master.connect(c.destination);
  const nodes = [], t0 = c.currentTime + 0.05;
  const osc = (type, f, start, dur, g = 1, attack = 0.01) => {
    const o = c.createOscillator(), e = c.createGain();
    o.type = type; o.frequency.value = f; o.connect(e); e.connect(master);
    e.gain.setValueAtTime(0, t0 + start); e.gain.linearRampToValueAtTime(g, t0 + start + attack); e.gain.setValueAtTime(g, t0 + start + dur - 0.04); e.gain.linearRampToValueAtTime(0, t0 + start + dur);
    o.start(t0 + start); o.stop(t0 + start + dur + 0.05); nodes.push(o);
    return o;
  };
  let len;
  if (kind === 'critical' || kind === 'threshold' || kind === 'drop') {
    // siréna: frekvence kmitá nahoru a dolů, kritická je tvrdší, vyšší a hraje déle
    len = kind === 'critical' ? 14 : kind === 'drop' ? 6 : 9;
    const o = c.createOscillator(), e = c.createGain();
    o.type = kind === 'critical' ? 'sawtooth' : 'square'; o.connect(e); e.connect(master);
    const lo = kind === 'critical' ? 700 : 520, hi = kind === 'critical' ? 1500 : 980, half = kind === 'critical' ? 0.45 : 0.7;
    o.frequency.setValueAtTime(lo, t0);
    for (let t = 0, up = true; t < len; t += half, up = !up) o.frequency.linearRampToValueAtTime(up ? hi : lo, t0 + t + half);
    e.gain.setValueAtTime(0, t0); e.gain.linearRampToValueAtTime(0.5, t0 + 0.05); e.gain.setValueAtTime(0.5, t0 + len - 0.1); e.gain.linearRampToValueAtTime(0, t0 + len);
    o.start(t0); o.stop(t0 + len + 0.05); nodes.push(o);
  } else if (kind === 'op') {
    len = 8;
    for (let t = 0; t < len; t += 1.05) for (let k = 0; k < 3; k++) osc('square', 1180, t + k * 0.2, 0.12, 0.45);
  } else if (kind === 'recovered') {
    len = 1.6; osc('sine', 659, 0, 0.45, 0.7); osc('sine', 880, 0.22, 0.5, 0.7); osc('sine', 1318, 0.45, 0.9, 0.55);
  } else if (kind === 'target') {
    len = 1.8; for (let k = 0; k < 3; k++) osc('triangle', 880 + k * 220, k * 0.3, 0.25, 0.6);
  } else {
    len = 0.8; osc('sine', kind === 'released' ? 520 : 440, 0, 0.5, 0.5);
  }
  alarm = { master, nodes, prio: SND_PRIO[kind] ?? 0 };
  const loud = SND_PRIO[kind] >= 4;
  if (text && loud) { $('alarmTxt').textContent = text; $('alarmBar').className = 'alarmbar'; $('alarmBar').hidden = false; }
  else if (text && kind === 'recovered') { $('alarmTxt').textContent = text; $('alarmBar').className = 'alarmbar ok'; $('alarmBar').hidden = false; }
  alarmTimer = setTimeout(stopAlarm, len * 1000 + 150);
  return true;
}
$('alarmStop').onclick = stopAlarm;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && alarm) stopAlarm(); });

let lastAlertTs = null;
/** Nové alerty ze serveru (od posledního stavu): zahraje se ten nejdůležitější z nich. */
function checkAlarms() {
  const list = S.alerts ?? [];
  const maxTs = list.reduce((m, a) => Math.max(m, a.ts), 0);
  if (lastAlertTs === null) { lastAlertTs = maxTs; return; } // při otevření se staré alerty nehrají
  const fresh = list.filter((a) => a.ts > lastAlertTs);
  lastAlertTs = Math.max(lastAlertTs, maxTs);
  if (!fresh.length || !snd.on) return;
  const best = fresh.map((a) => ({ a, kind: sndKind(a.reason) })).filter((x) => snd.types[x.kind] && SND_PRIO[x.kind]).sort((x, y) => SND_PRIO[y.kind] - SND_PRIO[x.kind])[0];
  if (!best) return;
  if (alarm && alarm.prio >= SND_PRIO[best.kind]) return; // už hraje stejně důležitý nebo důležitější poplach
  playAlarm(best.kind, `${best.a.name}: ${SND_TEXT[best.kind] ?? best.a.reason}`);
}
function renderSnd() {
  const locked = !actx || actx.state !== 'running';
  $('sndLock').hidden = !(snd.on && locked);
  if (document.activeElement !== $('sndOn')) $('sndOn').checked = snd.on;
  if (document.activeElement !== $('sndVol')) $('sndVol').value = snd.vol;
  $('sndVolTxt').textContent = snd.vol + ' %';
  for (const cb of ntMenu.querySelectorAll('input[data-snd]')) if (document.activeElement !== cb) cb.checked = !!snd.types[cb.dataset.snd];
  ntMenu.classList.toggle('sndoff', !snd.on);
  renderBell();
}
/** Zvonek v hlavičce: zelená tečka = chat i zvuk zapnutý, žlutá = jen jedno nebo zvuk čeká na první kliknutí, červená = vše vypnuto. */
function renderBell() {
  const chat = cfg?.notify !== false, locked = snd.on && (!actx || actx.state !== 'running');
  const b = $('notifyCaret');
  b.classList.toggle('on', chat && snd.on && !locked); b.classList.toggle('part', (chat !== snd.on) || locked); b.classList.toggle('locked', locked);
  b.title = `Alerty: chat ${chat ? 'zapnut' : 'VYPNUT'}, zvuk ${snd.on ? (locked ? 'zapnut (čeká na první kliknutí na stránku)' : 'zapnut') : 'VYPNUT'}`;
}
$('sndVol').addEventListener('input', () => { snd.vol = Number($('sndVol').value); $('sndVolTxt').textContent = snd.vol + ' %'; if (alarm) alarm.master.gain.value = (snd.vol / 100) ** 1.6; });
$('sndVol').addEventListener('change', () => { saveSnd(); playAlarm('recovered'); });

const ntMenu = $('ntMenu');
const toggleNt = (open) => { ntMenu.hidden = !(open ?? ntMenu.hidden); $('notifyCaret').classList.toggle('open', !ntMenu.hidden); };
$('notifyCaret').onclick = (e) => { e.stopPropagation(); ensureCtx(); closeMenu(); viewMenu.hidden = true; toggleAl(false); toggleNt(); };
// jen jedna nabídka otevřená najednou (capture: stopPropagation u ostatních tlačítek by jinak zavírání přeskočilo)
document.addEventListener('click', (e) => { if (e.target.closest('#addPanel, #viewBtn') && !ntMenu.hidden) toggleNt(false); if (e.target.closest('#addPanel, #viewBtn') && !alMenu.hidden) toggleAl(false); if (e.target.closest('#addPanel') && !viewMenu.hidden) viewMenu.hidden = true; if (e.target.closest('#viewBtn')) closeMenu(); }, true);
ntMenu.addEventListener('change', (e) => { // zvuk: vypínače, hlasitost a druhy poplachů (chat řeší další posluchač níže)
  if (e.target.id === 'sndOn') snd.on = e.target.checked;
  else if (e.target.id === 'sndVol') snd.vol = Number(e.target.value);
  else if (e.target.dataset.snd) snd.types[e.target.dataset.snd] = e.target.checked;
  else return;
  saveSnd(); renderSnd();
});
ntMenu.addEventListener('click', (e) => { const t = e.target.closest('[data-test]'); if (t) playAlarm(t.dataset.test, `Zkouška: ${SND_TEXT[t.dataset.test]}`); });
renderSnd();
document.addEventListener('click', (e) => { if (!ntMenu.hidden && !e.target.closest('.ntwrap')) toggleNt(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ntMenu.hidden) toggleNt(false); });
ntMenu.addEventListener('change', (e) => {
  const k = e.target.dataset?.nt; if (!k) return;
  cfg.notifyTypes = { ...cfg.notifyTypes, [k]: e.target.checked };
  savePartial({ notifyTypes: { [k]: e.target.checked } });
});
$('notifyMaster').onchange = () => { cfg.notify = $('notifyMaster').checked; ntMenu.classList.toggle('chatoff', !cfg.notify); renderBell(); savePartial({ notify: $('notifyMaster').checked }); };

function render() {
  renderData(); renderBoard(); tickAges(); renderAlerts(); renderOp(); checkAlarms();
}
// živý stav: server ho posílá sám hned po příjmu dat (SSE); dotazování po vteřině jen jako záloha, když proud nejde
let lastPush = 0, renderQueued = false;
function scheduleRender() { // víc zpráv za sebou se vykreslí jednou, nejdřív v dalším snímku (v kartě na pozadí hned)
  if (renderQueued) return;
  renderQueued = true;
  const go = () => { renderQueued = false; render(); };
  if (document.hidden) go(); else requestAnimationFrame(go);
}
function startStream() {
  if (!window.EventSource) return;
  const es = new EventSource('/api/stream');
  es.onmessage = (e) => { try { S = JSON.parse(e.data); } catch { return; } fetchedAt = Date.now(); lastPush = fetchedAt; sseUp = true; scheduleRender(); };
  es.onerror = () => { sseUp = false; };
}
async function refresh() {
  try { S = await api('/api/state'); fetchedAt = Date.now(); render(); }
  catch { $('dstat').className = 'dstat bad'; $('dstat').dataset.h = ''; $('dstat').innerHTML = '<span class="dh">● server nedostupný</span>'; }
}

