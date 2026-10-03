import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAttackJobs } from '../src/attackjob.js';

const info = { hracId: 1239165, utokId: 1, name: 'Zyrilliax', type: 'D', power: 981844741, lit: true };
const filled = [{ name: 'Bedrosian', value: 5000, sent: 5000, available: 18822832 }];

function ready(jobs, id, t = 1000) {
  jobs.report(id, { phase: 'loaded', target: 'Zyrilliax (Aschen)', planetsTotal: 613 }, t);
  jobs.report(id, { phase: 'planet', planet: 'H4S-5067', planetsTotal: 613 }, t);
  jobs.report(id, { phase: 'units', filled }, t);
  jobs.report(id, { phase: 'ready', target: 'Zyrilliax (Aschen)', planet: 'H4S-5067', planetsTotal: 613, filled, problems: [] }, t);
}

test('průběh: otevřeno -> načteno -> planeta -> jednotky -> připraveno, kroky se odškrtávají', () => {
  const j = createAttackJobs();
  const id = j.start(info, 0);
  let s = j.snapshot(1);
  assert.equal(s.status, 'opening');
  assert.deepEqual(s.steps.map((x) => x.done), [true, false, false, false, false]);
  j.report(id, { phase: 'loaded', target: 'Zyrilliax (Aschen)', planetsTotal: 613 }, 100);
  assert.equal(j.snapshot(101).status, 'filling');
  ready(j, id);
  s = j.snapshot(1500);
  assert.equal(s.status, 'ready');
  assert.deepEqual(s.steps.map((x) => x.done), [true, true, true, true, true]);
  assert.equal(s.summary.planet, 'H4S-5067');
  assert.equal(s.summary.filled[0].value, 5000);
});

test('odeslat jde až když je připraveno; příkaz se skriptu vydá jen jednou', () => {
  const j = createAttackJobs();
  const id = j.start(info, 0);
  assert.equal(j.command('submit', 5).ok, false); // ještě nepřipraveno
  ready(j, id);
  assert.equal(j.command('submit', 2000).ok, true);
  assert.equal(j.snapshot(2001).status, 'submitting');
  assert.deepEqual(j.poll(id, 2002), { ok: true, cmd: 'submit' });
  assert.deepEqual(j.poll(id, 2003), { ok: true, cmd: null });
  j.report(id, { phase: 'sent', result: 'Útok odeslán' }, 3000);
  const s = j.snapshot(3001);
  assert.equal(s.status, 'sent');
  assert.equal(s.final, true);
  assert.equal(s.result.text, 'Útok odeslán');
});

test('přelosování planety: stav zpět na filling, po novém ready zase připraveno', () => {
  const j = createAttackJobs();
  const id = j.start(info, 0);
  ready(j, id);
  assert.equal(j.command('reroll', 1500).ok, true);
  assert.equal(j.snapshot(1501).status, 'filling');
  assert.equal(j.poll(id, 1502).cmd, 'reroll');
  j.report(id, { phase: 'ready', target: 't', planet: 'A1A-0001', filled, problems: [] }, 1600);
  assert.equal(j.snapshot(1601).summary.planet, 'A1A-0001');
  assert.equal(j.snapshot(1601).status, 'ready');
});

test('zrušení: skript dostane cancel a práce je ukončená', () => {
  const j = createAttackJobs();
  const id = j.start(info, 0);
  ready(j, id);
  assert.equal(j.command('cancel', 1500).ok, true);
  assert.equal(j.snapshot(1501).status, 'cancelled');
  assert.deepEqual(j.poll(id, 1502), { ok: true, cmd: 'cancel' });
  assert.equal(j.poll(id, 1503).ok, false);
});

test('karta se neozvala do 25 s = vyprší s vysvětlením; zmizela po ready = ztracena', () => {
  const j = createAttackJobs();
  j.start(info, 0);
  assert.equal(j.snapshot(24_000).status, 'opening');
  const s = j.snapshot(26_000);
  assert.equal(s.status, 'expired');
  assert.match(s.error, /Útok \(D\)/);
  const id2 = j.start(info, 100_000);
  ready(j, id2, 101_000);
  assert.equal(j.snapshot(150_000).status, 'ready');
  assert.equal(j.snapshot(200_000).status, 'lost');
});

test('nová práce ruší předchozí; hlášení ke staré práci se ignoruje', () => {
  const j = createAttackJobs();
  const a = j.start(info, 0);
  const b = j.start({ ...info, name: 'Zved' }, 10);
  assert.notEqual(a, b);
  assert.equal(j.report(a, { phase: 'loaded' }, 20), false);
  assert.equal(j.poll(a, 20).ok, false);
  assert.equal(j.snapshot(30).name, 'Zved');
});

test('selhání: důvod a problémy se uloží, po konečném stavu už další hlášení neprojdou', () => {
  const j = createAttackJobs();
  const id = j.start(info, 0);
  j.report(id, { phase: 'loaded', target: 't' }, 10);
  j.report(id, { phase: 'failed', error: 'žádná jednotka k poslání', problems: ['Max nic nevyplnilo'] }, 20);
  const s = j.snapshot(21);
  assert.equal(s.status, 'failed');
  assert.equal(s.error, 'žádná jednotka k poslání');
  assert.deepEqual(s.summary.problems, ['Max nic nevyplnilo']);
  assert.equal(j.report(id, { phase: 'ready' }, 30), false);
});

test('vstupy z prohlížeče se zkrátí a očistí', () => {
  const j = createAttackJobs();
  const id = j.start({ ...info, name: 'x'.repeat(500) }, 0);
  j.report(id, { phase: 'ready', planet: 'p'.repeat(500), filled: [{ name: 'A', value: '12', sent: 12 }, { name: 'B', value: 'max', sent: 99 }], problems: [1, 'b'.repeat(999)] }, 5);
  const s = j.snapshot(6);
  assert.equal(s.name.length, 64);
  assert.equal(s.summary.planet.length, 40);
  assert.deepEqual(s.summary.filled.map((f) => f.value), [12, 'max']);
  assert.equal(s.summary.problems[1].length, 160);
});
