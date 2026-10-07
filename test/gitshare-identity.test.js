import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyIdentity } from '../src/gitshare.js';

test('sdílená data: chybějící jméno a e-mail autora se převezmou z hlavního repozitáře (jinak commit selže)', async () => {
  const cfg = { main: { 'user.name': 'jkajzr', 'user.email': 'a@b.cz' }, data: {} };
  const git = async (args, { cwd }) => {
    const where = cwd === 'MAIN' ? cfg.main : cfg.data;
    if (args.length === 2) return where[args[1]] ? { code: 0, out: `${where[args[1]]}\n` } : { code: 1, out: '' };
    where[args[1]] = args[2]; return { code: 0, out: '' };
  };
  await copyIdentity({ mainRoot: 'MAIN', dir: 'DATA', git });
  assert.deepEqual(cfg.data, { 'user.name': 'jkajzr', 'user.email': 'a@b.cz' });
  cfg.data['user.name'] = 'Jiny'; // vlastní nastavení se nepřepisuje
  await copyIdentity({ mainRoot: 'MAIN', dir: 'DATA', git });
  assert.equal(cfg.data['user.name'], 'Jiny');
});
