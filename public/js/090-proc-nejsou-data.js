/* ---------- proč nejsou data: nápověda u štítku se stářím ---------- */
const whyPop = document.createElement('div'); whyPop.className = 'whypop'; whyPop.hidden = true; document.body.appendChild(whyPop);
function showWhy(id, anchor) {
  const r = raceOf(id); if (!r) return;
  const age = r.at ? dAge(r.at) : null;
  whyPop.innerHTML = `<h4>${age == null ? `Data rasy ${esc(r.name)} zatím nepřišla` : `Data rasy ${esc(r.name)} nepřišla ${esc(dSec(age))}`}</h4>
    Skript Síla hráčů ${r.script ? `se hlásí s verzí <b>${esc(r.script)}</b>` : 'se u této rasy ještě nehlásil'}; oken se stránkou rasy: <b>${r.sources}</b>.
    <ol><li>Je ve hře otevřená stránka <b>Vesmír → ${esc(r.name)}</b> a je vidět (ne minimalizovaná, ne v jiné záložce)? Chrome kartu na pozadí zpomalí.</li>
    <li>Je v Tampermonkey zapnutý skript <b>Síla hráčů</b> (verze 3.12.1 nebo novější)?</li>
    <li>Pomůže F5 na té stránce ve hře.</li></ol><button class="ghost" type="button">Zavřít</button>`;
  const b = anchor.getBoundingClientRect();
  whyPop.style.left = Math.max(8, Math.min(innerWidth - 372, b.left)) + 'px'; whyPop.style.top = (b.bottom + 8) + 'px';
  whyPop.hidden = false;
  whyPop.querySelector('button').onclick = () => { whyPop.hidden = true; };
}
document.addEventListener('click', (e) => { if (!whyPop.hidden && !e.target.closest('.whypop, .rage')) whyPop.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') whyPop.hidden = true; });

