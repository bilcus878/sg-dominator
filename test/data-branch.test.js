import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pushShared, ensureDataRepo, pullData, migrateLegacyFiles, DATA_BRANCH } from '../src/gitshare.js';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
let hasGit = true; try { git(process.cwd(), '--version'); } catch { hasGit = false; }
const skip = hasGit ? false : 'git není k dispozici';

/** Vzdálený repozitář s hlavní větví (kód) + dva „počítače“ (klony hlavního repozitáře). */
function setup() {
  const base = mkdtempSync(join(tmpdir(), 'sgd-branch-'));
  const remote = join(base, 'remote.git');
  git(base, 'init', '--bare', '-b', 'main', remote);
  const clone = (name) => { const d = join(base, name); git(base, 'clone', remote, d); git(d, 'config', 'user.email', `${name}@test`); git(d, 'config', 'user.name', name); git(d, 'config', 'commit.gpgsign', 'false'); return d; };
  const a = clone('a');
  writeFileSync(join(a, 'kod.txt'), 'v1'); git(a, 'add', '-A'); git(a, 'commit', '-m', 'kód'); git(a, 'push', '-u', 'origin', 'main');
  const b = clone('b');
  const identity = (dir) => { for (const [k, v] of [['user.email', 't@test'], ['user.name', 't'], ['commit.gpgsign', 'false']]) git(dir, 'config', k, v); };
  return { base, remote, a, b, identity };
}

test('větev sdílených dat: první počítač ji založí, druhý ji stáhne, data se přenáší oběma směry a hlavní větev (kód) zůstane čistá', { skip }, async () => {
  const t = setup();
  try {
    const dA = join(t.base, 'dataA'), dB = join(t.base, 'dataB');
    // počítač A: větev na serveru ještě není -> vznikne prázdná (orphan)
    const ra = await ensureDataRepo({ mainRoot: t.a, dir: dA });
    assert.deepEqual([ra.ok, ra.created], [true, true]);
    t.identity(dA);
    assert.equal((await ensureDataRepo({ mainRoot: t.a, dir: dA })).existed, true, 'podruhé už nic nedělá');
    writeFileSync(join(dA, 'data-A.json'), '{"a":1}\n');
    const pa = await pushShared({ root: dA, files: ['data-A.json'], message: 'Sdílená data (A)' });
    assert.deepEqual([pa.ok, pa.committed, pa.pushed], [true, true, true], pa.error);
    assert.match(git(t.a, 'ls-remote', '--heads', 'origin'), new RegExp(`refs/heads/${DATA_BRANCH}`));
    // počítač B: větev už existuje -> stáhne se včetně dat
    const rb = await ensureDataRepo({ mainRoot: t.b, dir: dB });
    assert.deepEqual([rb.ok, rb.created], [true, undefined], rb.error);
    t.identity(dB);
    assert.equal(readFileSync(join(dB, 'data-A.json'), 'utf8').trim(), '{"a":1}');
    writeFileSync(join(dB, 'data-B.json'), '{"b":2}\n');
    assert.equal((await pushShared({ root: dB, files: ['data-B.json'], message: 'Sdílená data (B)' })).ok, true);
    // A si stáhne novinky od B
    const pl = await pullData({ dir: dA });
    assert.deepEqual([pl.ok, pl.updated], [true, true]);
    assert.equal(readFileSync(join(dA, 'data-B.json'), 'utf8').trim(), '{"b":2}');
    // kód v hlavní větvi je beze změny: žádné datové commity ani soubory
    git(t.a, 'fetch', 'origin');
    assert.equal(git(t.a, 'log', 'origin/main', '--format=%s').trim(), 'kód');
    assert.ok(!git(t.a, 'ls-tree', '-r', '--name-only', 'origin/main').includes('data-'));
    assert.match(git(t.a, 'log', `origin/${DATA_BRANCH}`, '--format=%s'), /Sdílená data \(B\)/);
  } finally { rmSync(t.base, { recursive: true, force: true }); }
});

test('větev sdílených dat: dva počítače založí větev souběžně -> druhý se na ni napojí a nic se neztratí', { skip }, async () => {
  const t = setup();
  try {
    const dA = join(t.base, 'dataA'), dB = join(t.base, 'dataB');
    assert.equal((await ensureDataRepo({ mainRoot: t.a, dir: dA })).created, true);
    assert.equal((await ensureDataRepo({ mainRoot: t.b, dir: dB })).created, true); // oba vidí, že větev ještě není
    t.identity(dA); t.identity(dB);
    writeFileSync(join(dA, 'data-A.json'), '{"a":1}\n'); writeFileSync(join(dB, 'data-B.json'), '{"b":1}\n');
    assert.equal((await pushShared({ root: dA, files: ['data-A.json'], message: 'A' })).ok, true);
    const rb = await pushShared({ root: dB, files: ['data-B.json'], message: 'B' }); // B přijde druhý: větev mezitím vznikla
    assert.equal(rb.ok, true, rb.error);
    const verify = join(t.base, 'v'); git(t.base, 'clone', '--branch', DATA_BRANCH, t.remote, verify);
    assert.ok(existsSync(join(verify, 'data-A.json')) && existsSync(join(verify, 'data-B.json')), 'v větvi jsou data obou');
  } finally { rmSync(t.base, { recursive: true, force: true }); }
});

test('větev sdílených dat: bez vzdáleného origin se nic nezačne a vrátí se srozumitelná chyba; starý profiles/ se přenese bez přepsání', { skip }, async () => {
  const base = mkdtempSync(join(tmpdir(), 'sgd-noremote-'));
  try {
    const lone = join(base, 'lone'); mkdirSync(lone); git(lone, 'init');
    const r = await ensureDataRepo({ mainRoot: lone, dir: join(base, 'd') });
    assert.equal(r.ok, false); assert.match(r.error, /origin/);
    const from = join(base, 'old'), to = join(base, 'new');
    mkdirSync(from); mkdirSync(to);
    writeFileSync(join(from, 'jarmil.json'), 'stary'); writeFileSync(join(from, 'x.txt'), 'ne'); writeFileSync(join(from, 'data-PC.json'), 'data');
    writeFileSync(join(to, 'data-PC.json'), 'uz-tu');
    assert.equal(migrateLegacyFiles(from, to), 1);
    assert.equal(readFileSync(join(to, 'jarmil.json'), 'utf8'), 'stary');
    assert.equal(readFileSync(join(to, 'data-PC.json'), 'utf8'), 'uz-tu', 'existující se nepřepisuje');
    assert.equal(migrateLegacyFiles(join(base, 'neni'), to), 0);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
