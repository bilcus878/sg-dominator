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
