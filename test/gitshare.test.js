import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pushShared } from '../src/gitshare.js';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
let hasGit = true; try { git(process.cwd(), '--version'); } catch { hasGit = false; }
const skip = hasGit ? false : 'git není k dispozici';

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'sgd-git-'));
  const remote = join(base, 'remote.git');
  git(base, 'init', '--bare', '-b', 'main', remote);
  const clone = (name) => { const d = join(base, name); git(base, 'clone', remote, d); git(d, 'config', 'user.email', `${name}@test`); git(d, 'config', 'user.name', name); git(d, 'config', 'commit.gpgsign', 'false'); return d; };
  const a = clone('a');
  writeFileSync(join(a, 'kod.txt'), 'v1'); mkdirSync(join(a, 'profiles')); writeFileSync(join(a, 'profiles', '.keep'), '');
  git(a, 'add', '-A'); git(a, 'commit', '-m', 'start'); git(a, 'push', '-u', 'origin', 'main');
  return { base, remote, a, b: clone('b'), clone };
}

test('odeslání sdílených souborů: commit jen těchto souborů (cizí rozdělané změny zůstanou), pull --rebase a push', { skip }, async () => {
  const t = setup();
  try {
    git(t.b, 'pull');
    writeFileSync(join(t.a, 'profiles', 'data-A.json'), '{"a":1}\n');
    writeFileSync(join(t.a, 'kod.txt'), 'rozdelana zmena'); // ta se NESMÍ commitnout
    const r = await pushShared({ root: join(t.a, 'profiles'), files: ['data-A.json', 'neexistuje.json'], message: 'Sdílená data (A)' });
    assert.deepEqual([r.ok, r.committed, r.pushed], [true, true, true]);
    assert.match(git(t.a, 'status', '--porcelain'), /kod\.txt/, 'rozdělaná změna zůstala nepotvrzená');
    assert.equal(readFileSync(join(t.a, 'kod.txt'), 'utf8').trim(), 'rozdelana zmena');
    git(t.b, 'pull');
    assert.equal(readFileSync(join(t.b, 'profiles', 'data-A.json'), 'utf8').trim(), '{"a":1}', 'druhý počítač si soubor stáhl');
    assert.match(git(t.b, 'log', '--format=%s', '-1'), /Sdílená data \(A\)/);
    // bez změny se nic dalšího neodesílá
    const again = await pushShared({ root: join(t.a, 'profiles'), files: ['data-A.json'], message: 'x' });
    assert.deepEqual([again.ok, again.committed, again.pushed], [true, false, false]);
  } finally { rmSync(t.base, { recursive: true, force: true }); }
});

test('odeslání sdílených souborů: když je na serveru něco nového, pull --rebase to vezme a push projde; nic se nevynucuje', { skip }, async () => {
  const t = setup();
  try {
    // druhý počítač mezitím pushl svůj soubor
    writeFileSync(join(t.b, 'profiles', 'data-B.json'), '{"b":1}\n');
    git(t.b, 'add', '-A'); git(t.b, 'commit', '-m', 'B data'); git(t.b, 'push');
    writeFileSync(join(t.a, 'profiles', 'data-A.json'), '{"a":2}\n');
    const r = await pushShared({ root: join(t.a, 'profiles'), files: ['data-A.json'], message: 'A data' });
    assert.equal(r.ok, true, r.error);
    const verify = join(t.base, 'v'); git(t.base, 'clone', t.remote, verify);
    assert.equal(readFileSync(join(verify, 'profiles', 'data-A.json'), 'utf8').trim(), '{"a":2}');
    assert.equal(readFileSync(join(verify, 'profiles', 'data-B.json'), 'utf8').trim(), '{"b":1}', 'cizí data zůstala');
  } finally { rmSync(t.base, { recursive: true, force: true }); }
});

test('odeslání sdílených souborů: mimo repozitář nebo bez souborů se nic nestane a vrátí se srozumitelná zpráva', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sgd-nogit-'));
  try {
    const noRepo = await pushShared({ root: dir, files: ['x.json'], message: 'x', git: async () => ({ code: 128, out: '', err: 'not a git repository' }) });
    assert.equal(noRepo.ok, false); assert.match(noRepo.error, /není git repozitář/);
    const noFiles = await pushShared({ root: dir, files: ['x.json'], message: 'x', git: async () => ({ code: 0, out: 'true\n', err: '' }) });
    assert.deepEqual([noFiles.ok, noFiles.nothing], [true, true]);
    const noGit = await pushShared({ root: dir, files: ['x.json'], message: 'x', git: async () => ({ code: -1, out: '', err: 'git není nainstalovaný (nebo není v PATH)' }) });
    assert.match(noGit.error, /nainstalovaný/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
