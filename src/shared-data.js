/**
 * Sdílená data o přepočtech hráčů mezi počítači (a lidmi) přes git.
 * Každý počítač píše JEN SVŮJ soubor profiles/data-<počítač>.json (proto nikdy nevzniká konflikt při pullu) a čte všechny ostatní.
 * Slučování je sjednocení: výsledek nezávisí na pořadí ani na tom, kolikrát se sloučí (komutativní a idempotentní), takže nic nehrozí
 * ani při souběžné práci, vypadlém pushi nebo dvojím načtení. Smazání (nový věk) se šíří „náhrobkem“ clearedAt: záznamy starší než
 * ten čas se zahodí všude, kam soubor dorazí.
 * Čistá logika; práci se soubory dělá volající (kromě malých pomocníků na konci).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SHARED_FORMAT = 1;
const SAME_EVENT_MS = 15 * 60_000; // ekonomické události do 15 min od sebe jsou jeden přepočet (stejná hodnota jako v econ.js)
export const HISTORY_RECALC = 7;
export const HISTORY_ECON = 12;
const KEEP_MS = 120 * 86_400_000; // starší záznamy se nesdílejí a zahazují (věk trvá nanejvýš pár měsíců)

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Vojenské přepočty: klíč „raceId|jméno“ -> { at, hour, history: [časy nejnovější první] }. Přepočty jsou vždy v celou hodinu,
 * takže stejný přepočet zachycený na dvou počítačích má stejný čas a sjednocení ho spojí.
 * @returns {boolean} změnilo se cílové nastavení?
 */
export function mergeRecalc(target, sources, { clearedAt = 0, now = Date.now() } = {}) {
  let changed = false;
  const keys = new Set(Object.keys(target));
  for (const s of sources) for (const k of Object.keys(s ?? {})) keys.add(k);
  for (const k of keys) {
    const times = new Set();
    for (const rec of [target[k], ...sources.map((s) => s?.[k])]) {
      if (!rec) continue;
      for (const t of rec.history?.length ? rec.history : [rec.at]) if (Number.isFinite(t) && t >= clearedAt && now - t < KEEP_MS) times.add(t);
    }
    const history = [...times].sort((a, b) => b - a).slice(0, HISTORY_RECALC);
    if (!history.length) { if (k in target) { delete target[k]; changed = true; } continue; }
    const next = { at: history[0], hour: new Date(history[0]).getHours(), history };
    if (!same(target[k], next)) { target[k] = next; changed = true; }
  }
  return changed;
}

/**
 * Ekonomické přepočty (odhad): klíč -> { events: [{ at, popGain, online, colon, planetsBefore }] nejnovější první }.
 * Dva počítače vidí tentýž přepočet s drobně jiným časem; události do 15 min od sebe se spojí (nejdřívější čas, větší nárůst/kolonizace,
 * online když to viděl kdokoli).
 */
export function mergeEcon(target, sources, { clearedAt = 0, now = Date.now() } = {}) {
  let changed = false;
  const keys = new Set(Object.keys(target));
  for (const s of sources) for (const k of Object.keys(s ?? {})) keys.add(k);
  for (const k of keys) {
    const all = [];
    for (const rec of [target[k], ...sources.map((s) => s?.[k])]) for (const e of rec?.events ?? []) if (Number.isFinite(e?.at) && e.at >= clearedAt && now - e.at < KEEP_MS) all.push(e);
    all.sort((a, b) => a.at - b.at);
    const out = [];
    for (const e of all) {
      const last = out[out.length - 1];
      if (last && e.at - last.at < SAME_EVENT_MS) {
        last.popGain = Math.max(last.popGain ?? 0, e.popGain ?? 0);
        last.online = !!(last.online || e.online);
        last.colon = Math.max(last.colon ?? 0, e.colon ?? 0);
        if (!Number.isFinite(last.planetsBefore) && Number.isFinite(e.planetsBefore)) last.planetsBefore = e.planetsBefore;
      } else out.push({ at: e.at, popGain: e.popGain ?? 0, online: !!e.online, colon: e.colon ?? 0, planetsBefore: Number.isFinite(e.planetsBefore) ? e.planetsBefore : null });
    }
    const events = out.reverse().slice(0, HISTORY_ECON);
    if (!events.length) { if (k in target) { delete target[k]; changed = true; } continue; }
    if (!same(target[k], { events })) { target[k] = { events }; changed = true; }
  }
  return changed;
}

/** Jméno souboru tohoto počítače (bez nebezpečných znaků). */
export const sharedFileName = (host) => `data-${String(host || 'pc').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32) || 'pc'}.json`;

export function buildShared(host, recalc, econ, clearedAt, now = Date.now()) {
  return { format: SHARED_FORMAT, host, savedAt: now, clearedAt: { military: clearedAt.military ?? 0, economic: clearedAt.economic ?? 0 }, recalc, econ };
}
/** Stejný obsah bez času uložení? (soubor se zbytečně nepřepisuje) */
export const sameShared = (a, b) => !!a && !!b && same([a.clearedAt, a.recalc, a.econ], [b.clearedAt, b.recalc, b.econ]);

/** Všechny soubory ve složce (vlastní i cizí); poškozené se přeskočí. */
export function readAllShared(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!/^data-.+\.json$/.test(f)) continue;
    try {
      const o = JSON.parse(readFileSync(join(dir, f), 'utf8').replace(/^﻿/, ''));
      if (o && o.format === SHARED_FORMAT && typeof o.recalc === 'object' && typeof o.econ === 'object') out.push({ ...o, file: f });
    } catch { /* poškozený soubor se přeskočí */ }
  }
  return out;
}
export function writeShared(dir, file, obj) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  writeFileSync(`${path}.tmp`, JSON.stringify(obj) + '\n'); // záměrně na jednom řádku: je to strojová data, ne něco k ručnímu čtení
  renameSync(`${path}.tmp`, path);
}
