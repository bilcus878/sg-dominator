import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';

export function openDb(path = join(DATA_DIR, 'history.db')) {
  if (path !== ':memory:') mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS power_history (
      ts INTEGER NOT NULL, name TEXT NOT NULL, power INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hist ON power_history(name, ts);
    CREATE TABLE IF NOT EXISTS alerts (
      ts INTEGER NOT NULL, name TEXT NOT NULL, power INTEGER NOT NULL,
      prev INTEGER, reason TEXT NOT NULL
    );
  `);
  try { db.exec('ALTER TABLE alerts ADD COLUMN race TEXT'); } catch { /* sloupec už existuje */ }
  db.exec('DROP TABLE IF EXISTS losses'); // zrušená statistika útoků
  const insHist = db.prepare('INSERT INTO power_history (ts,name,power) VALUES (?,?,?)');
  const insAlert = db.prepare('INSERT INTO alerts (ts,name,power,prev,reason,race) VALUES (?,?,?,?,?,?)');
  const delAlerts = db.prepare('DELETE FROM alerts');
  const lastAlerts = db.prepare('SELECT * FROM alerts ORDER BY ts DESC LIMIT ?');
  return {
    /** Zapíše jen hráče, kterým se síla od posledního zápisu změnila. */
    recordChanges(ts, players, lastWritten) {
      for (const { name, power } of players) {
        if (lastWritten.get(name) !== power) {
          insHist.run(ts, name, power);
          lastWritten.set(name, power);
        }
      }
    },
    recordAlert: (ts, a) => insAlert.run(ts, a.name, a.power, a.prev, a.reason, a.race ?? null),
    clearAlerts: () => delAlerts.run(),
    recentAlerts: (n = 50) => lastAlerts.all(n),
    close: () => db.close(),
  };
}
