/**
 * Profily nastavení: každý člověk má v repozitáři soubor profiles/<jméno>.json s celým nastavením aplikace (prahy, rasy,
 * alerty, dohoz, útok, přihlášení, přepočty…) a vzhledem rozhraní. S commitem a pushem se nastavení přenese na druhý počítač.
 * Tajné věci (token aplikace, token Telegram bota, webhook Discordu, heslo do hry, port) se do profilu NIKDY nedávají:
 * zůstávají na každém počítači zvlášť. Čistá logika bez sítě; složku určuje volající.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PROFILE_FORMAT = 1;
export const UI_KEYS = ['panels', 'pstate', 'uicfg']; // vzhled rozhraní z prohlížeče (pořadí panelů, filtry, velikost…); rozložení oken je pro každou obrazovku jiné, proto se nepřenáší

export const validName = (n) => typeof n === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(n);
const clone = (o) => JSON.parse(JSON.stringify(o));

/** Nastavení bez tajných věcí a bez věcí vázaných na počítač (port). */
export function stripSecrets(cfg) {
  const c = clone(cfg);
  delete c.token; delete c.port; delete c.login;
  if (c.discord) delete c.discord.webhookUrl;
  if (c.telegram) delete c.telegram.botToken;
  return c;
}

/** Nastavení z profilu + tajné věci, které se na tomto počítači zachovají. */
export function mergeProfileConfig(local, profileCfg) {
  const p = clone(profileCfg);
  p.token = local.token; p.port = local.port; p.login = clone(local.login ?? {});
  p.discord = { ...(p.discord ?? {}), webhookUrl: local.discord?.webhookUrl ?? '' };
  p.telegram = { ...(p.telegram ?? {}), botToken: local.telegram?.botToken ?? '' };
  return p;
}

/** Jen povolené klíče a rozumná velikost (údaje přicházejí z prohlížeče). */
export function cleanUi(ui) {
  if (!ui || typeof ui !== 'object') return null;
  const out = {};
  for (const k of UI_KEYS) if (ui[k] !== undefined && ui[k] !== null && typeof ui[k] === 'object') out[k] = ui[k];
  return JSON.stringify(out).length > 200_000 ? null : out;
}

export function buildProfile(name, cfg, ui, now = Date.now(), host = '') {
  return { format: PROFILE_FORMAT, name, savedAt: now, savedBy: host, config: stripSecrets(cfg), ui: cleanUi(ui) };
}

/** Stejný obsah (bez času uložení)? Kvůli tomu, ať se soubor zbytečně nepřepisuje a necommituje. */
export const sameContent = (a, b) => !!a && !!b && JSON.stringify([a.config, a.ui ?? null]) === JSON.stringify([b.config, b.ui ?? null]);

export const profilePath = (dir, name) => join(dir, `${name}.json`);

export function readProfile(dir, name) {
  if (!validName(name)) return null;
  try {
    const p = JSON.parse(readFileSync(profilePath(dir, name), 'utf8').replace(/^﻿/, ''));
    return p && p.format === PROFILE_FORMAT && p.config && typeof p.config === 'object' && Number.isFinite(p.savedAt) ? p : null;
  } catch { return null; }
}

export function writeProfile(dir, profile) {
  if (!validName(profile.name)) throw new Error('Neplatné jméno profilu (písmena, číslice, _ a -, nejvýš 32 znaků)');
  mkdirSync(dir, { recursive: true });
  const path = profilePath(dir, profile.name);
  writeFileSync(`${path}.tmp`, JSON.stringify(profile, null, 2) + '\n');
  renameSync(`${path}.tmp`, path);
}

export function listProfiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readProfile(dir, f.slice(0, -5))).filter(Boolean)
    .map((p) => ({ name: p.name, savedAt: p.savedAt, savedBy: p.savedBy ?? '' })).sort((a, b) => a.name.localeCompare(b.name));
}
