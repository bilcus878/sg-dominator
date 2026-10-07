/**
 * Hlídač výpadku dat ("dead man's switch"). Ticho z prohlížeče nesmí vypadat jako
 * "nikdo nikoho neútočí": když hlídaný zdroj (rasa, mapa) přestane dodávat data,
 * pošle se jedno hlášení, a když se vrátí, druhé.
 *
 * Čistá logika: zdroje a čas dodává volající.
 */
const SUSPEND_GAP_MS = 15_000; // delší pauza mezi kontrolami = proces spal (uspání PC)
const RECOVER_MS = 5_000; // zdroj je zase v pořádku, když poslední data nejsou starší než tohle

/**
 * Které rasy a zdroje se mají hlídat. Rasa se hlídá, jen když o ni jde: je to naše rasa (role defend), nebo je otevřená jako panel
 * v některém okně Dominatoru (okna to hlásí, viz openPanels). Rasa, kterou jsi jen jednou otevřel na webu hry a zavřel, se nehlídá,
 * jinak by po zavření karty přišlo hlášení „nedodává data“.
 * @param {{races:object, op:{enabled:boolean}}} cfg
 * @param {(id:string)=>boolean} panelOpen je rasa otevřená jako panel (čerstvé hlášení některého okna)
 * @param {(id:string)=>number} raceAt čas posledních dat rasy (0 = nikdy)
 */
export function watchItems(cfg, panelOpen, raceAt, opAt) {
  const items = [];
  for (const [id, r] of Object.entries(cfg.races ?? {})) {
    if (r.mode === 'off') continue;
    if (r.role === 'defend' || panelOpen(id)) items.push({ key: `race:${id}`, name: `Rasa ${r.name}`, at: raceAt(id) ?? 0 });
  }
  if (cfg.op?.enabled) items.push({ key: 'op', name: 'Mapa (OP)', at: opAt });
  return items;
}

export function createWatchdog() {
  const down = new Map(); // key -> čas posledních přijatých dat před výpadkem
  let lastTick = 0;
  let graceUntil = 0;

  /**
   * @param {{key:string, name:string, at:number}[]} items sledované zdroje; at = čas posledních dat (0 = nikdy)
   * @param {number} now
   * @param {{staleMs:number}} opts
   * @returns {{type:'down'|'up', key:string, name:string, ageMs:number}[]}
   */
  function check(items, now, { staleMs }) {
    const events = [];
    if (lastTick && now - lastTick > SUSPEND_GAP_MS) graceUntil = now + staleMs; // po probuzení dej oknům čas
    lastTick = now;

    const monitored = new Set();
    for (const it of items) {
      if (!it.at) continue; // zdroj zatím nikdy nedodal data, nemá smysl hlásit výpadek
      monitored.add(it.key);
      const age = now - it.at;
      if (!down.has(it.key)) {
        if (age > staleMs && now >= graceUntil) {
          down.set(it.key, it.at);
          events.push({ type: 'down', key: it.key, name: it.name, ageMs: age });
        }
      } else if (age < RECOVER_MS) {
        events.push({ type: 'up', key: it.key, name: it.name, ageMs: now - down.get(it.key) });
        down.delete(it.key);
      }
    }
    // zdroj, který už se nesleduje (vypnutý), tiše zapomeneme
    for (const key of [...down.keys()]) if (!monitored.has(key)) down.delete(key);
    return events;
  }

  return { check, isDown: (key) => down.has(key) };
}
