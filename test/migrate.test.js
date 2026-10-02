import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateLegacyData } from '../src/migrate.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'sgn-'));
const quiet = () => {};

test('přesune config, zálohy a databázi, originály smaže, log nechá', () => {
  const oldDir = tmp(), newDir = join(tmp(), 'new');
  writeFileSync(join(oldDir, 'config.json'), '{"a":1}');
  writeFileSync(join(oldDir, 'config.backup-before-races.json'), '{"b":2}');
  writeFileSync(join(oldDir, 'history.db'), 'DBDATA');
  writeFileSync(join(oldDir, 'server.log'), 'log');
  const r = migrateLegacyData(oldDir, newDir, quiet);
  assert.deepEqual(r.moved.sort(), ['config.backup-before-races.json', 'config.json', 'history.db']);
  assert.equal(readFileSync(join(newDir, 'config.json'), 'utf8'), '{"a":1}');
  assert.equal(readFileSync(join(newDir, 'history.db'), 'utf8'), 'DBDATA');
  assert.ok(!existsSync(join(oldDir, 'config.json')));
  assert.ok(!existsSync(join(oldDir, 'history.db')));
  assert.ok(existsSync(join(oldDir, 'server.log')));
  rmSync(oldDir, { recursive: true, force: true });
});

test('znovu nic nedělá a nová konfigurace se nikdy nepřepíše', () => {
  const oldDir = tmp(), newDir = tmp();
  writeFileSync(join(oldDir, 'config.json'), 'STARA');
  writeFileSync(join(newDir, 'config.json'), 'NOVA');
  const r = migrateLegacyData(oldDir, newDir, quiet);
  assert.equal(r.skipped, true);
  assert.equal(readFileSync(join(newDir, 'config.json'), 'utf8'), 'NOVA');
  assert.equal(readFileSync(join(oldDir, 'config.json'), 'utf8'), 'STARA');
});

test('bez staré konfigurace není co přesouvat', () => {
  assert.deepEqual(migrateLegacyData(tmp(), tmp(), quiet).moved, []);
});
