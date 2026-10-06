/* ---------- nástěnka: každá rasa = vlastní panel ---------- */
const loadJson = (k, d) => { try { return JSON.parse(store.get(k)) ?? d; } catch { return d; } };
let panels = loadJson('panels', null);   // pořadí panelů: ['20', '7', 'watched']
const pstate = loadJson('pstate', {});   // id -> { filter, below, sort }
const saveUi = () => { store.set('panels', JSON.stringify(panels)); store.set('pstate', JSON.stringify(pstate)); };
const ps = (id) => (pstate[id] ??= { filter: '', below: false, sort: 'game' });
const view = new Map();                  // id -> { root, rows:Map, ...odkazy na prvky }
const WATCHED = 'watched';
const modeLabel = { off: 'Nehlídat', all: 'Celou rasu', selected: 'Vybrané hráče' };
const plural = (n) => (n === 1 ? 'okno' : n > 1 && n < 5 ? 'okna' : 'oken');

function raceOf(id) { return S.races.find((r) => r.id === id); }

const ATK_NAMES = { D: 'Dobývací', P: 'Partyzánský', Z: 'Zhn', U: 'Univerzální', N: 'Orbitální', L: 'Loupežný', S: 'Špionážní', T: 'Otrokářský' };
const modeHint = { off: 'Nic se nehlídá', selected: 'Hlídají se jen hráči, které zapneš přepínačem vpravo', all: 'Hlídají se všichni hráči rasy' };
const modeBtn = [['off', '⏻', 'Nehlídat'], ['selected', '🎯', 'Vybraní'], ['all', '👥', 'Celá rasa']];
/** 100 000 000 -> "100 mil", 1 500 000 -> "1,5 mil" */
function short(n) {
  const t = (x) => String(Number(x.toFixed(1))).replace('.', ',');
  return n >= 1e9 ? `${t(n / 1e9)} mld` : n >= 1e6 ? `${t(n / 1e6)} mil` : n >= 1e3 ? `${t(n / 1e3)} tis` : String(n);
}

