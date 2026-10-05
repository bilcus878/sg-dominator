import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';

export function openDb(path = join(DATA_DIR, 'history.db')) {
  if (path !== ':memory:') mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(path);
  // WAL + synchronous=NORMAL: zápis nečeká na fsync disku (v journal režimu DELETE trval každý INSERT ~8 ms a ingest s 15 změnami blokoval server ~100–400 ms)
  try { db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;'); } catch { /* např. :memory: */ }
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
      const changed = players.filter(({ name, power }) => lastWritten.get(name) !== power);
      if (!changed.length) return;
      db.exec('BEGIN'); // všechny změny z jednoho příjmu v jedné transakci
      try {
        for (const { name, power } of changed) { insHist.run(ts, name, power); lastWritten.set(name, power); }
        db.exec('COMMIT');
      } catch (e) { try { db.exec('ROLLBACK'); } catch { /* nic */ } throw e; }
    },
    recordAlert: (ts, a) => insAlert.run(ts, a.name, a.power, a.prev, a.reason, a.race ?? null),
    clearAlerts: () => delAlerts.run(),
    recentAlerts: (n = 50) => lastAlerts.all(n),
    close: () => db.close(),
  };
}
