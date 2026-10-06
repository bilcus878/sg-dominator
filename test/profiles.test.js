import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripSecrets, mergeProfileConfig, buildProfile, sameContent, readProfile, writeProfile, listProfiles, validName, cleanUi } from '../src/profiles.js';
import { DEFAULTS, normalizeConfig } from '../src/config.js';

const cfg = () => normalizeConfig({
  token: 'apptoken', port: 3940, myRace: '20',
  discord: { enabled: true, webhookUrl: 'https://discord/hook' },
  telegram: { enabled: true, botToken: '123:SECRET', chatId: '-1', serviceChatId: '-2' },
  login: { enabled: true, user: 'u', password: 'tajneheslo' },
  defaultThreshold: 123_000_000,
});

test('profil: tajné věci (tokeny, webhook, heslo, port) se do něj nikdy nedostanou', () => {
  const p = buildProfile('bilcus', cfg(), null, 1000, 'PC');
  const json = JSON.stringify(p);
  for (const secret of ['apptoken', 'https://discord/hook', '123:SECRET', 'tajneheslo']) assert.ok(!json.includes(secret), secret);
  assert.equal(p.config.telegram.chatId, '-1'); // ID chatů tajná nejsou
  assert.ok(!('port' in p.config) && !('login' in p.config) && !('token' in p.config));
});

test('profil: po načtení zůstanou na tomto počítači vlastní tajné věci a port', () => {
  const remote = stripSecrets({ ...cfg(), defaultThreshold: 555 });
  const local = cfg(); local.token = 'mujtoken'; local.port = 4000; local.telegram.botToken = 'moje:TOKEN'; local.login.password = 'moje';
  const merged = normalizeConfig(mergeProfileConfig(local, remote));
  assert.equal(merged.defaultThreshold, 555); // nastavení přišlo z profilu
  assert.equal(merged.token, 'mujtoken'); assert.equal(merged.port, 4000);
  assert.equal(merged.telegram.botToken, 'moje:TOKEN'); assert.equal(merged.login.password, 'moje');
});

test('profil: soubor se zapíše a přečte, výpis, shodný obsah se pozná, neplatná jména se odmítnou', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sgd-prof-'));
  try {
    assert.deepEqual(listProfiles(join(dir, 'neni')), []);
    const a = buildProfile('bilcus', cfg(), { panels: ['20'] }, 1000, 'PC');
    writeProfile(dir, a);
    assert.equal(readProfile(dir, 'bilcus').savedAt, 1000);
    assert.deepEqual(listProfiles(dir).map((p) => p.name), ['bilcus']);
    assert.ok(sameContent(a, buildProfile('bilcus', cfg(), { panels: ['20'] }, 9999, 'jiny')), 'čas a počítač obsah nemění');
    assert.ok(!sameContent(a, buildProfile('bilcus', cfg(), { panels: ['7'] }, 1000, 'PC')));
    assert.throws(() => writeProfile(dir, { ...a, name: '../x' }));
    assert.equal(readProfile(dir, '../x'), null);
    writeFileSync(join(dir, 'rozbity.json'), '{nesmysl');
    assert.deepEqual(listProfiles(dir).map((p) => p.name), ['bilcus'], 'poškozený soubor se přeskočí');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('profil: jména a vzhled z prohlížeče se ošetří', () => {
  assert.ok(validName('bilcus_87-a') && !validName('') && !validName('a b') && !validName('x'.repeat(33)));
  assert.deepEqual(cleanUi({ panels: ['1'], pstate: {}, cizi: { x: 1 } }), { panels: ['1'], pstate: {} });
  assert.equal(cleanUi(null), null);
  assert.equal(cleanUi({ panels: { x: 'a'.repeat(300_000) } }), null);
});
