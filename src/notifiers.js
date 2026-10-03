const fmt = (n) => Math.round(n).toLocaleString('cs-CZ').replace(/ /g, ' ');

export function formatAlert(a) {
  if (a.reason === 'op') {
    if (a.count == null) return a.repeat ? `❗🟠 OP je stále v: ${a.name}` : `🚨🟠 OP! Opuštěná planeta – ${a.name}`;
    return a.repeat ? `❗🟠 OP stále na mapě: ${a.count}\n${a.sectors}` : `🚨🟠 OP! Na mapě je ${a.count} OP\n${a.sectors}`;
  }
  const tag = a.race ? `[${a.race}] ` : '';
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

export async function sendText(cfg, text, log = console) {
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
    if (r.status === 'rejected') log.error(`[${jobs[i][0]}] odeslání selhalo: ${r.reason.message}`);
  });
  return { sent: results.filter((r) => r.status === 'fulfilled').length, total: jobs.length };
}

/**
 * Systémové zprávy (výpadek dat, bdělost, teleskop, stavění…) jen do servisního chatu Telegramu.
 * Bez vyplněného servisního chatu se nepošlou nikam (hlavní skupina je jen pro herní události).
 */
export async function sendService(cfg, text, log = console) {
  const chatId = cfg.telegram.serviceChatId;
  if (!cfg.telegram.enabled || !cfg.telegram.botToken || !chatId) return { sent: 0, total: 0 };
  try {
    await post(`https://api.telegram.org/bot${cfg.telegram.botToken}/sendMessage`, { chat_id: chatId, text: `🛠 ${text}` });
    return { sent: 1, total: 1 };
  } catch (e) {
    log.error(`[telegram servis] odeslání selhalo: ${e.message}`);
    return { sent: 0, total: 1 };
  }
}

/** Vrátí skupiny/chaty, do kterých bot nedávno dostal zprávu (pro snadné zjištění chat ID). */
export async function findTelegramChats(botToken) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`, { signal: AbortSignal.timeout(8000) });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || 'Telegram odmítl token');
  const chats = new Map();
  for (const u of data.result) {
    const c = (u.message ?? u.channel_post ?? u.my_chat_member ?? u.edited_message)?.chat;
    if (c) chats.set(String(c.id), { id: String(c.id), title: c.title ?? [c.first_name, c.last_name].filter(Boolean).join(' '), type: c.type });
  }
  return [...chats.values()];
}
