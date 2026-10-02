/**
 * Příkazová řádka pro přenos nastavení mezi počítači (např. na flashce):
 *   node src/cli.js export    uloží nastavení do sg-settings.json (ve složce programu)
 *   node src/cli.js import    načte sg-settings.json do místní datové složky
 *
 * POZOR: sg-settings.json obsahuje token bota v čitelné podobě. Kdo má soubor, může psát jako bot,
 * takže ho nenechávej na sdíleném místě.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig, CONFIG_PATH, DATA_DIR } from './config.js';

const SETTINGS_PATH = fileURLToPath(new URL('../sg-settings.json', import.meta.url));

function doExport() {
  const cfg = loadConfig();
  writeFileSync(SETTINGS_PATH, JSON.stringify(cfg, null, 2));
  console.log('Uloženo nastavení: token bota, kanály (Telegram/Discord), prahy, rasy a výjimky hráčů.');
  console.log(`Soubor: ${SETTINGS_PATH}`);
  console.log('Pozor: obsahuje token bota v čitelné podobě, nenechávej ho na sdíleném místě.');
}

function doImport() {
  if (!existsSync(SETTINGS_PATH)) throw new Error('Soubor sg-settings.json nenalezen.');
  if (existsSync(CONFIG_PATH) && !process.argv.includes('--force')) {
    console.log(`Na tomto počítači už nastavení existuje (${CONFIG_PATH}), nepřepisuji.`);
    console.log('Chceš-li ho přepsat nastavením ze souboru, spusť: node src/cli.js import --force');
    return;
  }
  const raw = readFileSync(SETTINGS_PATH, 'utf8').replace(/^﻿/, '');
  const cfg = JSON.parse(raw);
  if (!cfg || typeof cfg !== 'object' || !cfg.token) throw new Error('Nastavení v souboru je neúplné.');
  saveConfig(cfg);
  console.log(`Nastavení načteno do ${DATA_DIR}`);
  console.log(`Kanály: Telegram ${cfg.telegram?.botToken ? '✓' : '✗'}, Discord ${cfg.discord?.webhookUrl ? '✓' : '✗'}`);
}

const commands = { export: doExport, import: doImport };
const cmd = process.argv[2];
if (!commands[cmd]) {
  console.error('Použití: node src/cli.js export | import');
  process.exit(2);
}
try {
  commands[cmd]();
} catch (e) {
  console.error(`\nChyba: ${e.message}`);
  process.exit(1);
}
