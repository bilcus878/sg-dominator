/* ---------- skripty pro Tampermonkey ---------- */
(() => {
  const SCRIPTS = [
    ['Stavění', '/stavby.user.js', 'vyplňuje a staví na planetách'],
    ['Mapa', '/mapa.user.js', 'OP, tlačítko bdělosti, teleskop'],
    ['Síla hráčů', '/userscript.user.js', 'posílá sílu hráčů do hlídání'],
    ['Rasová armáda', '/armada.user.js', 'tlačítko Dohodit u našich hráčů'],
    ['Útok (D)', '/utok.user.js', 'vyplní dobývací útok po kliknutí na D'],
    ['Přihlášení', '/prihlaseni.user.js', 'po odhlášení ze hry se samo přihlásí a obnoví karty'],
    ['Nezaměstnaní', '/nezamestnani.user.js', 'doplní nezaměstnané na planety, kterým chybí lidé'],
  ];
  let loaded = false;
  async function loadScripts() {
    if (loaded) return;
    loaded = true;
    $('scriptList').innerHTML = SCRIPTS.map(([name, path, desc], i) => `<div class="chan" data-i="${i}">
      <div class="chan-head"><span>${esc(name)} <span class="muted" style="font-weight:400">– ${esc(desc)}</span></span><span class="muted sver">verze …</span></div>
      <a href="${path}" target="_blank" rel="noopener"><button type="button">Instalovat odkazem</button></a>
      <a href="/dl/${path.slice(1).replace('.user.js', '')}"><button type="button" class="ghost">Stáhnout soubor</button></a>
      <button type="button" class="ghost scopy">Zkopírovat kód</button><span class="saved smsg"></span>
      <textarea readonly hidden style="width:100%;height:160px;margin-top:8px;font:12px monospace"></textarea></div>`).join('');
    for (const [i, [, path]] of SCRIPTS.entries()) {
      const box = document.querySelector(`#scriptList [data-i="${i}"]`);
      const ta = box.querySelector('textarea'), msg = box.querySelector('.smsg');
      let code = '';
      try {
        code = await (await fetch(path, { cache: 'no-store' })).text();
        box.querySelector('.sver').textContent = 'verze ' + ((code.match(/@version\s+(\S+)/) || [])[1] ?? '?');
      } catch { box.querySelector('.sver').textContent = 'nelze načíst'; }
      ta.value = code;
      box.querySelector('.scopy').onclick = async () => {
        try { await navigator.clipboard.writeText(code); msg.textContent = 'Zkopírováno ✓'; }
        catch { ta.hidden = false; ta.select(); msg.textContent = 'Označ kód níže a zkopíruj (Ctrl+C)'; }
        setTimeout(() => (msg.textContent = ''), 4000);
      };
    }
  }
  document.querySelector('[data-tab="scripts"]').addEventListener('click', loadScripts);
})();

document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.id === 'pane-' + b.dataset.tab));
}));
$('drawer').addEventListener('input', () => ($('dirtyNote').textContent = 'neuložené změny'));

$('save').onclick = async () => {
  try {
    cfg = await api('/api/config', 'PUT', {
      threshold: undots($('threshold').value) ?? '', cooldownSec: $('cooldownSec').value, minDrop: undots($('minDrop').value) ?? '',
      conquest: { below: undots($('conqBelow').value) ?? '', above: undots($('conqAbove').value) ?? '' },
      criticalPct: $('criticalPct').value, criticalCooldownSec: $('criticalCooldownSec').value,
      watchdog: { enabled: $('wdEnabled').checked, staleSec: $('wdStale').value },
      notifyRecovery: $('notifyRecovery').checked, repeatWhileBelow: $('repeatWhileBelow').checked,
      op: { enabled: $('opEnabled2').checked, repeatSec: $('opRepeatSec').value, vigilance: { enabled: $('opVigEnabled').checked, minSec: $('opVigMin').value, maxSec: $('opVigMax').value, skipEnabled: $('opVigSkip').checked, skipMin: $('opSkipMin').value, skipMax: $('opSkipMax').value, downMin: $('opDownMin').value, downMax: $('opDownMax').value }, telescope: { auto: $('opTeleAuto').checked, reactMinSec: $('opReactMin').value, reactMaxSec: $('opReactMax').value, restEnabled: $('opRestEnabled').checked, restChance: $('opRestChance').value, restStopMin: $('opRestStopMin').value, restStopMax: $('opRestStopMax').value, restResumeMin: $('opRestResumeMin').value, restResumeMax: $('opRestResumeMax').value } },
      dropPct: $('dropPct').value, dropWindowSec: $('dropWindowSec').value,
      attack: readAtk(),
      myRace: $('myRace').value,
      army: readArmy(),
      session: collectSession(),
      login: collectLogin(),
      discord: { enabled: $('dEnabled').checked, webhookUrl: $('dUrl').value },
      telegram: { enabled: $('tEnabled').checked, botToken: $('tToken').value, chatId: $('tChat').value, serviceChatId: $('tService').value },
    });
    fillForm(); renderChips(); toast('Uloženo'); closeDrawer(); refresh();
  } catch (e) { toast('Uložení selhalo: ' + e.message, true); }
};
/** Stručný rozbor, proč bot (ne)vidí zprávy. */
function telegramDiag(d, bot) {
  const out = [`Telegram vrátil ${d.updates} zpráv${d.pending != null ? `, čeká jich ${d.pending}` : ''}.`];
  if (d.webhook) out.push('POZOR: bot má nastavený webhook, kvůli němu Telegram zprávy přes toto hledání nevydává.');
  if (d.readsAll === false) out.push('Bot má zapnutý režim soukromí: ve skupině vidí jen příkazy (/start@' + (bot || 'bot') + ') a zmínky.');
  for (const m of d.members ?? []) out.push(`Bot v chatu ${m.id}: ${m.status}`);
  return out.join(' ');
}
/** Najde skupiny, do kterých bot nedávno dostal zprávu. target: 'tChat' | 'tService' = nabídne jen toto pole; bez něj obě. */
async function findChats(target) {
  const box = $('chatList'); box.textContent = 'Hledám…';
  try {
    const { chats, bot, diag } = await api('/api/telegram/chats', 'POST', { botToken: $('tToken').value });
    box.innerHTML = chats.length ? '' : `<span class="muted">Bot ${bot ? '<b>@' + esc(bot) + '</b> ' : ''}zatím žádnou novou zprávu neviděl (Telegram je drží jen asi den). Přidej ho do skupiny a napiš tam <b>/start${bot ? '@' + esc(bot) : ''}</b>, nebo zmiň bota (@${esc(bot || 'jmeno_bota')} ahoj), a zkus to znovu.</span>`;
    for (const c of chats) {
      // každý nalezený chat jde nastavit jako hlavní skupina, nebo jako servisní chat
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;align-items:center;margin:0 0 6px';
      const t = document.createElement('span'); t.textContent = `${c.title || c.type} (${c.id})${c.known ? ' – už nastavený' : ''}`; t.style.flex = '1';
      const pick = (field, label) => { const b = document.createElement('button'); b.className = 'ghost'; b.textContent = label;
        b.onclick = () => { $(field).value = c.id; box.innerHTML = `<span class="muted">Vybráno ✓ (${label.replace('→ ', '')}) – teď ulož.</span>`; $('dirtyNote').textContent = 'neuložené změny'; };
        return b; };
      if (target) row.append(t, pick(target, 'Použít'));
      else row.append(t, pick('tChat', '→ hlavní'), pick('tService', '→ servisní'));
      box.appendChild(row);
    }
    if (diag) { const d = document.createElement('div'); d.className = 'muted'; d.style.cssText = 'font-size:12px;margin-top:6px'; d.textContent = telegramDiag(diag, bot); box.appendChild(d); }
  } catch (e) { box.innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`; }
}
$('findChats').onclick = () => findChats('tChat');
$('findServiceChats').onclick = () => findChats('tService');

$('clearRaces').onclick = async () => {
  if (!confirm('Vymazat všechny rasy a nastavení hlídání u ras a hráčů?\n\nVýchozí hranice, pravidla a kanály zůstanou. Rasy otevřené v prohlížeči se po chvíli načtou znovu jako vypnuté.')) return;
  try {
    cfg = await api('/api/races', 'DELETE');
    panels = []; for (const k of Object.keys(pstate)) delete pstate[k]; saveUi();
    renderChips(); toast('Rasy vymazány'); closeDrawer(); refresh();
  } catch (e) { toast('Vymazání selhalo: ' + e.message, true); }
};
$('testSvc').onclick = async () => {
  try {
    const r = await api('/api/test', 'POST', { target: 'service' });
    r.total === 0 ? toast('Servisní chat není nastavený (vyplň jeho ID a ulož)', true)
      : toast(r.sent ? 'Testovací zpráva odeslána do servisního chatu' : 'Do servisního chatu se nepodařilo odeslat (zkontroluj ID a že je v něm bot)', !r.sent);
  } catch (e) { toast(e.message, true); }
};
$('test').onclick = async () => {
  try {
    const r = await api('/api/test', 'POST', { target: 'main' });
    r.total === 0 ? toast('Žádný kanál není zapnutý a nastavený', true)
      : toast(`Odesláno ${r.sent}/${r.total}`, r.sent < r.total);
  } catch (e) { toast(e.message, true); }
};

(async () => { cfg = await api('/api/config'); renderChips(); refresh(); startStream(); setInterval(() => { if (Date.now() - lastPush > 2500) refresh(); }, 1000); })();

