import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// config.json, jeho zálohy a databáze (včetně případných -journal souborů); logy se nepřesouvají
const isData = (name) => name === 'config.json' || /^config.*\.(json|bak)$/.test(name) || /^history\.db/.test(name);

/**
 * Jednorázově přesune data ze staré složky (ve složce projektu, kterou synchronizuje Dropbox)
 * do nové. Nejdřív všechno zkopíruje a ověří velikosti, teprve pak smaže originály, takže
 * se při chybě nic neztratí.
 */
export function migrateLegacyData(legacyDir, newDir, log = console.log) {
  if (!existsSync(join(legacyDir, 'config.json'))) return { moved: [] };
  if (existsSync(join(newDir, 'config.json'))) {
    log(`Pozor: ve staré složce ${legacyDir} zůstala konfigurace, ale nová už existuje. Staré soubory neměním, smaž je ručně.`);
    return { moved: [], skipped: true };
  }
  mkdirSync(newDir, { recursive: true });
  const moved = [];
  for (const name of readdirSync(legacyDir)) {
    const src = join(legacyDir, name);
    if (!isData(name) || !statSync(src).isFile()) continue;
    const dst = join(newDir, name);
    copyFileSync(src, dst);
    if (statSync(dst).size !== statSync(src).size) throw new Error(`Kopie ${name} se nezdařila (jiná velikost), nic nemažu.`);
    moved.push(name);
  }
  for (const name of moved) {
    try { unlinkSync(join(legacyDir, name)); } catch (e) { log(`Nepodařilo se smazat starý soubor ${name}: ${e.message}`); }
  }
  log(`Data přesunuta z ${legacyDir} do ${newDir}: ${moved.join(', ')}`);
  return { moved };
}
