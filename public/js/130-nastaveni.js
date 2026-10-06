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
  { const ss = cfg.session ?? {}; $('sesReactMin').value = ss.reactMinSec ?? 1.5; $('sesReactMax').value = ss.reactMaxSec ?? 3; $('sesMaintMin').value = ss.maintMinSec ?? 8; $('sesMaintMax').value = ss.maintMaxSec ?? 70; }
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
