/* ---------- nastavení ---------- */
function updateCritHint() {
  const pct = Number($('criticalPct').value), th = undots($('threshold').value) ?? 0;
  $('critHint').textContent = !pct
    ? 'Vypnuto. Kritické pásmo je druhá, přísnější hranice: hráč, kterému klesne síla pod ni, dostane výraznou zprávu 🆘 KRITICKÉ.'
    : `Např. při hranici ${fmt(th || 0)} je kritické pod ${fmt(Math.round(((th || 0) * pct) / 100))}. Hráč s vlastním prahem má kritickou hranici úměrnou jeho prahu. 0 = vypnuto.`;
}
document.addEventListener('input', (e) => { if (e.target.id === 'criticalPct' || e.target.id === 'threshold') updateCritHint(); });
function fillMyRace() {
  const sel = $('myRace');
  const races = [...(S.races ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  sel.innerHTML = `<option value="">– nevybrána –</option>` + races.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}${r.at ? '' : ' (zatím bez dat)'}</option>`).join('');
  sel.value = cfg.myRace ?? '';
}
function fillForm() {
  fillMyRace();
  $('threshold').value = dots(cfg.threshold); $('cooldownSec').value = cfg.cooldownSec; $('minDrop').value = dots(cfg.minDrop);
  $('conqBelow').value = dots(cfg.conquest.below); $('conqAbove').value = dots(cfg.conquest.above);
  $('criticalPct').value = cfg.criticalPct; $('criticalCooldownSec').value = cfg.criticalCooldownSec; updateCritHint();
  $('wdEnabled').checked = cfg.watchdog.enabled; $('wdStale').value = cfg.watchdog.staleSec;
  $('notifyRecovery').checked = cfg.notifyRecovery; $('repeatWhileBelow').checked = cfg.repeatWhileBelow;
  $('opRepeatSec').value = cfg.op.repeatSec; $('opEnabled2').checked = cfg.op.enabled;
  const vg = cfg.op.vigilance ?? { enabled: true, minSec: 5, maxSec: 10 };
  fillSession(cfg.session ?? {});
  fillLogin(cfg.login ?? {});
  fillRecalc(cfg.recalc ?? {});
  $('opVigEnabled').checked = vg.enabled; $('opVigMin').value = vg.minSec; $('opVigMax').value = vg.maxSec;
  $('opVigSkip').checked = vg.skipEnabled ?? true; $('opSkipMin').value = vg.skipMin ?? 5; $('opSkipMax').value = vg.skipMax ?? 10;
  $('opDownMin').value = vg.downMin ?? 3; $('opDownMax').value = vg.downMax ?? 15;
  const te = cfg.op.telescope ?? { auto: true, reactMinSec: 10, reactMaxSec: 40 };
  $('opTeleAuto').checked = te.auto; $('opReactMin').value = te.reactMinSec; $('opReactMax').value = te.reactMaxSec;
  $('opRestEnabled').checked = te.restEnabled ?? true; $('opRestChance').value = te.restChance ?? 80; $('opRestStopMin').value = te.restStopMin ?? 20; $('opRestStopMax').value = te.restStopMax ?? 90; $('opRestResumeMin').value = te.restResumeMin ?? 165; $('opRestResumeMax').value = te.restResumeMax ?? 230; $('dropPct').value = cfg.dropPct; $('dropWindowSec').value = cfg.dropWindowSec;
  $('dEnabled').checked = cfg.discord.enabled; $('dUrl').value = '';
  $('dUrl').placeholder = cfg.discord.configured ? '•••••••• uloženo (nech prázdné)' : 'https://discord.com/api/webhooks/…';
  $('dSaved').textContent = cfg.discord.configured ? '✓ nastaveno' : '';
  $('tEnabled').checked = cfg.telegram.enabled; $('tToken').value = '';
  $('tToken').placeholder = cfg.telegram.configured ? '•••••••• uloženo (nech prázdné)' : '123456:ABC…';
  $('tChat').value = cfg.telegram.chatId; $('tService').value = cfg.telegram.serviceChatId ?? ''; $('tSaved').textContent = cfg.telegram.configured ? '✓ nastaveno' : '';
  renderAtk(cfg.attack ?? { units: [], types: {}, randomPlanet: true });
  renderArmy(cfg.army);
  $('dirtyNote').textContent = '';
}
const openDrawer = () => { fillForm(); document.body.classList.add('open'); };
const closeDrawer = () => document.body.classList.remove('open');
$('openSettings').onclick = openDrawer; $('closeSettings').onclick = closeDrawer; $('cancel').onclick = closeDrawer; $('scrim').onclick = closeDrawer;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

/** Záložka Přihlášení: pole <-> cfg.session (id -> klíč; Min/Max dvojice jsou vždy od–do) */
const SES_NUM = { sesReactMin: 'reactMinSec', sesReactMax: 'reactMaxSec', sesMaintMin: 'maintMinSec', sesMaintMax: 'maintMaxSec', sesProbeMin: 'probeMinSec', sesProbeMax: 'probeMaxSec', sesFormMin: 'formMinSec', sesFormMax: 'formMaxSec', sesRetry1Min: 'retryFirstMinSec', sesRetry1Max: 'retryFirstMaxSec', sesRetryNMin: 'retryNextMinSec', sesRetryNMax: 'retryNextMaxSec', sesReloadMin: 'reloadMinSec', sesReloadMax: 'reloadMaxSec', sesAttempts: 'maxAttempts', sesTabWait: 'tabWaitMin' };
const SES_BOOL = { sesEnabled: 'enabled', sesCloseTab: 'closeTab', sesReloadOthers: 'reloadOthers' };
const SES_TXT = { sesMaintStart: 'maintStart', sesMaintEnd: 'maintEnd' };
const SES_NOTIFY = { sesNExpired: 'expired', sesNMaintenance: 'maintenance', sesNOk: 'ok', sesNRetry: 'retry', sesNFailed: 'failed', sesNNeedsUser: 'needs-user' };
function fillSession(ss) {
  for (const [id, k] of Object.entries(SES_NUM)) $(id).value = ss[k] ?? '';
  for (const [id, k] of Object.entries(SES_BOOL)) $(id).checked = ss[k] !== false;
  for (const [id, k] of Object.entries(SES_TXT)) $(id).value = ss[k] ?? '';
  for (const [id, k] of Object.entries(SES_NOTIFY)) $(id).checked = ss.notify?.[k] !== false;
  syncSessionEnabled();
}
function collectSession() {
  const s = { notify: {} };
  for (const [id, k] of Object.entries(SES_NUM)) s[k] = $(id).value;
  for (const [id, k] of Object.entries(SES_BOOL)) s[k] = $(id).checked;
  for (const [id, k] of Object.entries(SES_TXT)) s[k] = $(id).value;
  for (const [id, k] of Object.entries(SES_NOTIFY)) s.notify[k] = $(id).checked;
  return s;
}
/** Vypnuté automatické přihlášení: ostatní nastavení se zešedne, ať je vidět, že teď nic nedělají. */
function syncSessionEnabled() { $('pane-login').classList.toggle('off', !$('sesEnabled').checked); }
$('sesEnabled').onchange = syncSessionEnabled;
const SES_EV = { expired: ['🔑', 'odhlášeno'], maintenance: ['🛠', 'údržba'], ok: ['✅', 'přihlášeno'], retry: ['🔁', 'další pokus'], failed: ['⚠️', 'nepovedlo se'], 'needs-user': ['⚠️', 'přihlas se ručně'] };
function renderSessionStatus() {
  const el = $('sesStatus'); if (!el) return;
  const log = S?.sessionLog ?? [];
  el.innerHTML = log.length
    ? 'Poslední události: ' + log.slice(0, 4).map((e) => { const [ic, t] = SES_EV[e.event] ?? ['•', e.event]; return '<div>' + ic + ' ' + new Date(e.at).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' – ' + t + (e.text ? ': ' + e.text.replace(/</g, '&lt;') : '') + '</div>'; }).join('')
    : 'Od spuštění aplikace se skript ještě neodhlásil ani nepřihlašoval.';
}

/** Přihlašovací údaje: heslo se do pole nikdy nevrací, ukáže se jen, jestli je uložené */
function fillLogin(l) {
  $('loginUse').checked = !!l.enabled; $('loginUser').value = l.user ?? ''; $('loginPass').value = '';
  $('loginPassState').textContent = l.hasPassword ? '✓ uloženo' : '(neuloženo)';
}
function collectLogin() { return { enabled: $('loginUse').checked, user: $('loginUser').value, password: $('loginPass').value }; }
$('loginClear').onclick = async () => {
  if (!confirm('Smazat uložené heslo z aplikace?')) return;
  try { cfg = await api('/api/config', 'PUT', { login: { clearPassword: true, enabled: false } }); fillLogin(cfg.login); toast('Heslo smazáno'); } catch (e) { toast(e.message, true); }
};

/** Přepočty hráčů (Nastavení → Data) */
function fillRecalc(r) {
  $('rcShared').checked = r.shared !== false; $('rcPushOnStop').checked = r.pushOnStop !== false; $('rcPullOnStart').checked = r.pullOnStart !== false;
  $('rcMil').checked = r.military !== false; $('rcEco').checked = r.economic !== false;
  $('rcShowMil').checked = r.showMilitary !== false; $('rcShowEco').checked = r.showEconomic !== false;
  $('rcMinGrowth').value = r.econMinGrowthPct ?? 0.1; $('rcHideDays').value = r.hideOlderDays ?? 0;
  renderRecalcStats();
}
function collectRecalc() {
  return { shared: $('rcShared').checked, pushOnStop: $('rcPushOnStop').checked, pullOnStart: $('rcPullOnStart').checked, military: $('rcMil').checked, economic: $('rcEco').checked, showMilitary: $('rcShowMil').checked, showEconomic: $('rcShowEco').checked, econMinGrowthPct: $('rcMinGrowth').value, hideOlderDays: $('rcHideDays').value };
}
function renderRecalcStats() {
  const el = $('rcStats'); if (!el) return;
  const st = S?.recalcStats;
  el.textContent = st ? `Zachyceno: vojenské ⟳ u ${st.military} hráčů, ekonomické 💰 u ${st.economic} hráčů.` : '';
  const sh = S?.shared, ss = $('rcSharedStatus');
  if (ss) ss.textContent = !sh ? '' : sh.error ? 'Sdílení selhalo: ' + sh.error : !sh.on ? 'Sdílení je vypnuté.' : `Sdílení: ${sh.files} ${sh.files === 1 ? 'soubor' : sh.files < 5 ? 'soubory' : 'souborů'} (tento počítač + ${Math.max(0, sh.files - 1)} další), naposledy sloučeno ${sh.mergedAt ? new Date(sh.mergedAt).toLocaleTimeString('cs-CZ') : '–'}, od spuštění přijato ${sh.received} nových záznamů.`;
}
$('rcPush').onclick = async () => {
  const b = $('rcPush'), note = $('rcPushNote'); b.disabled = true; note.textContent = 'Odesílám…';
  try {
    const r = await api('/api/share/push', 'POST', {});
    note.textContent = r.ok ? (r.nothing ? 'Není co odeslat (zapni sdílení a chvíli počkej na první data).' : r.committed ? (r.pushed ? 'Odesláno ostatním ✓' : 'Uloženo (commit), na GitHubu už to bylo.') : 'Nic nového k odeslání.') : 'Nepovedlo se: ' + r.error;
    toast(r.ok ? 'Odesláno' : 'Odeslání selhalo', !r.ok);
  } catch (e) { note.textContent = e.message; toast(e.message, true); } finally { b.disabled = false; }
};
$('rcSync').onclick = async () => { try { await api('/api/recalc/sync', 'POST', {}); toast('Sloučeno'); refresh(); } catch (e) { toast(e.message, true); } };
for (const [id, kind, label] of [['rcClearMil', 'military', 'vojenské'], ['rcClearEco', 'economic', 'ekonomické']]) {
  $(id).onclick = async () => {
    if (!confirm('Vymazat všechny zachycené ' + label + ' přepočty? Začnou se sbírat znovu.' + ($('rcShared').checked ? '\n\nSdílení je zapnuté: mazání se přenese i na ostatní počítače, až si stáhnou tvůj push.' : ''))) return;
    try { await api('/api/recalc/' + kind, 'DELETE'); toast('Vymazáno'); refresh(); } catch (e) { toast(e.message, true); }
  };
}

/** Profil nastavení (Nastavení → Data) */
const fmtT = (t) => (t ? new Date(t).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
let profInfo = null;
function renderProfile(p) {
  profInfo = p ?? S?.profile ?? profInfo;
  const v = profInfo; if (!v || !$('profStatus')) return;
  if (v.profiles && document.activeElement !== $('profName')) {
    const sel = $('profName'), want = v.name ?? '';
    sel.innerHTML = '<option value="">(žádný – nic se neukládá)</option>' + v.profiles.map((x) => '<option value="' + esc(x.name) + '">' + esc(x.label ?? x.name) + (x.savedAt ? ' – uloženo ' + fmtT(x.savedAt) : '') + '</option>').join('');
    sel.value = want;
  }
  if (v.autoSave !== undefined) { if (document.activeElement !== $('profAutoSave')) $('profAutoSave').checked = v.autoSave; if (document.activeElement !== $('profAutoLoad')) $('profAutoLoad').checked = v.autoLoad; }
  $('profStatus').textContent = !v.name ? 'Profil není vybraný: vyber ho v nabídce a ulož.'
    : `Profil „${(v.profiles?.find((x) => x.name === v.name)?.label) ?? v.name}“: tento počítač je synchronizovaný k ${fmtT(v.syncedAt)}; v souboru je verze z ${fmtT(v.fileAt)}.`;
  const w = $('profWarn'); w.hidden = !v.conflict; w.textContent = v.conflict ? 'V profilu je novější nastavení z jiného počítače. Klikni „Načíst z profilu“, nebo ho přepiš tlačítkem „Uložit do profilu teď“.' : '';
}
async function profPut(body) { try { renderProfile(await api('/api/profile', 'PUT', body)); } catch (e) { toast(e.message, true); } }
$('profName').onchange = () => profPut({ name: $('profName').value.trim() });
$('profAutoSave').onchange = () => profPut({ autoSave: $('profAutoSave').checked });
$('profAutoLoad').onchange = () => profPut({ autoLoad: $('profAutoLoad').checked });
$('profSave').onclick = async () => {
  try {
    await profPut({ name: $('profName').value.trim() });
    let r = await api('/api/profile/save', 'POST', {});
    if (r.conflict && confirm('V profilu je novější nastavení z jiného počítače. Přepsat ho nastavením z tohoto počítače?')) r = await api('/api/profile/save', 'POST', { force: true });
    renderProfile(r); toast(r.ok ? 'Uloženo do profilu' : (r.conflict ? 'Profil nepřepsán' : (r.error ?? 'Nešlo uložit')), !r.ok);
  } catch (e) { toast(e.message, true); }
};
$('profLoad').onclick = async () => {
  try {
    await profPut({ name: $('profName').value.trim() });
    if (!confirm('Načíst nastavení z profilu? Přepíše aktuální nastavení na tomto počítači (token bota, webhook, heslo a port zůstanou).')) return;
    const r = await api('/api/profile/load', 'POST', {});
    cfg = r.config; renderProfile(r); fillForm(); renderChips(); toast('Načteno z profilu'); refresh();
  } catch (e) { toast(e.message, true); }
};
document.querySelector('[data-tab="data"]').addEventListener('click', async () => { try { renderProfile(await api('/api/profile')); } catch { /* bez serveru nic */ } });

/** Zavření aplikace z rozhraní (jako stop.cmd). */
$('closeApp').onclick = async () => {
  if (!confirm('Zavřít aplikaci?' + (cfg?.recalc?.pushOnStop !== false && cfg?.recalc?.shared !== false ? '\n\nNejdřív se odešlou sdílená data a profil ostatním (git push), pak se zastaví hlídač i server.' : '') + '\n\nDokud ji znovu nespustíš (start.cmd), nebudou fungovat alerty ani dohoz.')) return;
  const b = $('closeApp'), note = $('closeAppNote'); b.disabled = true; note.textContent = 'Odesílám data a zastavuji…';
  try {
    const r = await api('/api/shutdown', 'POST', {});
    const share = r.share?.skipped ? '' : r.share?.ok ? (r.share.committed ? ' Data odeslána ostatním.' : ' Nic nového k odeslání.') : ' Odeslání dat se nepovedlo: ' + (r.share?.error ?? '?');
    document.body.innerHTML = '<div style="max-width:560px;margin:18vh auto;padding:0 20px;font:16px system-ui;color:#e7ecf3;text-align:center"><h2>Aplikace je zastavena</h2><p>' + esc(share.trim() || 'Můžeš zavřít tuto kartu.') + '</p><p style="color:#8a94a6">Znovu ji spustíš přes start.cmd.</p></div>';
  } catch (e) { note.textContent = 'Nepovedlo se: ' + e.message; b.disabled = false; }
};
