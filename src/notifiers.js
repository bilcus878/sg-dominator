const fmt = (n) => Math.round(n).toLocaleString('cs-CZ').replace(/ /g, ' ');

/** Má se upozornění tohoto druhu poslat? (hlavní vypínač + vypínač druhu; neznámý druh = ano) */
export const notifyOn = (cfg, kind) => cfg.notify !== false && cfg.notifyTypes?.[kind] !== false;

export function formatAlert(a) {
  if (a.reason === 'op') {
    if (a.count == null) return a.repeat ? `❗🟠 OP je stále v: ${a.name}` : `🚨🟠 OP! Opuštěná planeta – ${a.name}`;
    return a.repeat ? `❗🟠 OP stále na mapě: ${a.count}\n${a.sectors}` : `🚨🟠 OP! Na mapě je ${a.count} OP\n${a.sectors}`;
  }
  const tag = a.race ? `[${a.race}] ` : '';
  // lov hráče (🎯 u jednotlivého hráče): objevilo se D / kritické (D + síla pod hranicí) / D zmizelo
  if (a.hunt === 'd-on') return `🎯 LOV: ${tag}${a.name} jde dobýt (D svítí) – síla ${dots(a.power)}`;
  if (a.hunt === 'crit') return `🆘 LOV: ${tag}${String(a.name).toUpperCase()} JDE DOBÝT – síla ${dots(a.power)}${a.below ? ` (pod ${dots(a.below)})` : ''}!`;
  if (a.hunt === 'd-off') return `⚪ LOV: ${tag}${a.name} už nejde dobýt (D zmizelo) – síla ${dots(a.power)}`;
  if (a.reason === 'target') return `🎯 K DOBYTÍ: ${tag}${a.name} – síla ${dots(a.power)}${a.planets != null ? ` (${dots(a.planets)} planet)` : ''}`;
  if (a.reason === 'released') return `✅ ${tag}${a.name} už není k dobytí – síla ${dots(a.power)}${a.since ? ` (cílem byl ${dur(Date.now() - a.since)})` : ''}`;
  return tag + formatBody(a);
}

const dots = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); // 8.200.000

const dur = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
};

function formatBody(a) {
  if (a.reason === 'down') return `⚠️ ${a.name} už ${dur(a.ageMs)} nedodává data – hlídání tam neběží (je okno otevřené a viditelné?)`;
  if (a.reason === 'up') return `✅ ${a.name} zase dodává data (výpadek ${dur(a.ageMs)})`;
  if (a.reason === 'critical') {
    return a.repeat
      ? `🆘❗ STÁLE KRITICKÉ: ${a.name} – síla ${fmt(a.power)} (kritická hranice ${fmt(a.critical)})`
      : `🆘 KRITICKÉ: ${a.name} – síla ${a.prev != null ? fmt(a.prev) + ' → ' : ''}${fmt(a.power)} (kritická hranice ${fmt(a.critical)})`;
  }
  if (a.reason === 'recovered') return `✅ ${a.name}: síla zpět nad prahem – ${fmt(a.power)}${a.belowMs != null ? ` (pod prahem ${dur(a.belowMs)})` : ''}`;
  if (a.repeat) return `❗ ${a.name} je stále pod prahem: síla ${fmt(a.power)} (práh ${fmt(a.threshold)})`;
  const delta = a.prev != null ? ` (${a.power - a.prev >= 0 ? '+' : '−'}${fmt(Math.abs(a.power - a.prev))})` : '';
  const why =
    a.reason === 'drop' ? `propad o ${a.dropPct.toFixed(1)} %` : `pod prahem ${fmt(a.threshold)}`;
  return `⚠️ ${a.name}: síla ${a.prev != null ? fmt(a.prev) + ' → ' : ''}${fmt(a.power)}${delta}\n${why}`;
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`.slice(0, 200));
}

/** Výsledek posledního odeslání po kanálech (discord, telegram, telegram-servis): { ok, at, error? }. Aplikace z něj ukáže, že zprávy nechodí (třeba neplatný token). */
export const sendStatus = {};
const noteSend = (channel, ok, error = '') => { sendStatus[channel] = ok ? { ok: true, at: Date.now() } : { ok: false, at: Date.now(), error: String(error).slice(0, 160) }; };

export async function sendText(cfg, text, log = console) {
  if (cfg.notify === false) return { sent: 0, total: 0 }; // hlavní vypínač upozornění
  const jobs = [];
  if (cfg.discord.enabled && cfg.discord.webhookUrl) {
    jobs.push(['discord', post(cfg.discord.webhookUrl, { content: text })]);
  }
  if (cfg.telegram.enabled && cfg.telegram.botToken && cfg.telegram.chatId) {
    jobs.push([
      'telegram',
      post(`https://api.telegram.org/bot${cfg.telegram.botToken}/sendMessage`, {
        chat_id: cfg.telegram.chatId,
        text,
      }),
    ]);
  }
  const results = await Promise.allSettled(jobs.map(([, p]) => p));
  results.forEach((r, i) => {
    noteSend(jobs[i][0], r.status === 'fulfilled', r.reason?.message);
    if (r.status === 'rejected') log.error(`[${jobs[i][0]}] odeslání selhalo: ${r.reason.message}`);
  });
  return { sent: results.filter((r) => r.status === 'fulfilled').length, total: jobs.length };
}

/**
 * Systémové zprávy (výpadek dat, bdělost, teleskop, stavění…) jen do servisního chatu Telegramu.
 * Bez vyplněného servisního chatu se nepošlou nikam (hlavní skupina je jen pro herní události).
 */
export async function sendService(cfg, text, log = console, { critical = false } = {}) {
  const chatId = cfg.telegram.serviceChatId;
  // hlavní vypínač a vypnuté systémové zprávy; kritická výstraha (ztráta hodnosti) jde i při vypnutých systémových zprávách, jen ne při hlavním ztlumení
  if (critical ? cfg.notify === false : !notifyOn(cfg, 'service')) return { sent: 0, total: 0 };
  if (!cfg.telegram.enabled || !cfg.telegram.botToken || !chatId) return { sent: 0, total: 0 };
  try {
    await post(`https://api.telegram.org/bot${cfg.telegram.botToken}/sendMessage`, { chat_id: chatId, text: `🛠 ${text}` });
    noteSend('telegram-servis', true);
    return { sent: 1, total: 1 };
  } catch (e) {
    noteSend('telegram-servis', false, e.message);
    log.error(`[telegram servis] odeslání selhalo: ${e.message}`);
    return { sent: 0, total: 1 };
  }
}

/** Vrátí skupiny/chaty, do kterých bot nedávno dostal zprávu (pro snadné zjištění chat ID). */
const seenChats = new Map(); // chaty objevené při dřívějším hledání (Telegram starší zprávy po přečtení zapomene)
export async function findTelegramChats(botToken, knownIds = []) {
  const tg = async (method, params = '') => {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}${params}`, { signal: AbortSignal.timeout(8000) });
    return res.json().catch(() => ({}));
  };
  const me = await tg('getMe');
  if (!me.ok) throw new Error(me.description || 'Telegram odmítl token');
  const data = await tg('getUpdates', '?offset=-100&limit=100'); // posledních 100 zpráv; bez offsetu by Telegram vracel nejstarší, a čerstvá zmínka bota by se mezi nimi nemusela vejít
  if (!data.ok) throw new Error(data.description || 'Telegram nevrátil zprávy');
  const chats = new Map(seenChats);
  const add = (c, extra = {}) => { if (c) chats.set(String(c.id), { id: String(c.id), title: c.title ?? [c.first_name, c.last_name].filter(Boolean).join(' '), type: c.type, ...extra }); };
  for (const u of data.result) add((u.message ?? u.channel_post ?? u.my_chat_member ?? u.edited_message ?? u.callback_query?.message)?.chat);
  for (const [id, c] of chats) seenChats.set(id, c);
  // už nastavené chaty (hlavní, servisní) se nabídnou vždy, i když v nich bot nic nového neviděl; Telegram o nich řekne název
  for (const id of knownIds.filter(Boolean)) {
    if (chats.has(String(id))) continue;
    const r = await tg('getChat', `?chat_id=${encodeURIComponent(id)}`);
    if (r.ok) add(r.result, { known: true });
  }
  // diagnostika, ať je vidět, proč bot nic nevidí: webhook blokuje getUpdates, čekající zprávy, režim soukromí a členství v nastavených chatech
  const wh = await tg('getWebhookInfo');
  const members = [];
  for (const id of knownIds.filter(Boolean)) {
    const m = await tg('getChatMember', `?chat_id=${encodeURIComponent(id)}&user_id=${me.result?.id}`);
    members.push({ id: String(id), status: m.ok ? m.result.status : `nelze zjistit (${m.description ?? '?'})` });
  }
  const diag = { updates: data.result.length, pending: wh.result?.pending_update_count ?? null, webhook: wh.result?.url || '', readsAll: me.result?.can_read_all_group_messages ?? null, members };
  return { chats: [...chats.values()], bot: me.result?.username ?? '', diag };
}
