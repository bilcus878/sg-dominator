const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString('cs-CZ');
/** Síla s tečkami po třech číslicích (100.000.000); prázdné pro null. */
const dots = (n) => (n === null || n === undefined || n === '' ? '' : String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
/** Zpět na číslo: bere jen číslice; prázdné = null. */
const undots = (t) => { const d = String(t).replace(/\D/g, ''); return d ? Number(d) : null; };
// políčka se silou (.num): při psaní se průběžně formátují s tečkami, kurzor zůstává za stejnou číslicí
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.classList?.contains('num')) return;
  const before = el.value.slice(0, el.selectionStart ?? el.value.length).replace(/\D/g, '').length;
  const out = dots(undots(el.value));
  if (out === el.value) return;
  el.value = out;
  let pos = 0;
  for (let seen = 0; pos < out.length && seen < before; pos++) if (/\d/.test(out[pos])) seen++;
  el.setSelectionRange(pos, pos);
}, true);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
let cfg = null;          // veřejná konfigurace (prahy, kanály…)
let S = { races: [], alerts: [], serverTime: 0, ratePerSec: 0 }; // živý stav

async function api(path, method = 'GET', body) {
  const r = await fetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || r.status);
  return data;
}
let toastTimer;
function toast(t, err = false) {
  const el = $('toast'); el.textContent = t; el.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.className = 'toast'), 2800);
}

