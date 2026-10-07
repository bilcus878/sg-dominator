/**
 * Odeslání sdílených souborů (data přepočtů, profil) ostatním přes git: commit jen těchto souborů + pull --rebase + push.
 * Nikdy se nesahá na nic jiného v repozitáři (ostatní rozdělané změny zůstanou, jak jsou). Při jakékoli chybě se pull/rebase vrátí zpět
 * a vrátí se srozumitelná zpráva; nikdy se nic nevynucuje (žádný force push). Volá se z tlačítka v Nastavení a ze stop.cmd.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Spustí git; nikdy se neptá na heslo (GIT_TERMINAL_PROMPT=0), má časový limit. */
export function runGit(args, { cwd, timeout = 40_000 } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false;
    let p;
    try { p = spawn('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }, windowsHide: true }); }
    catch (e) { resolve({ code: -1, out: '', err: e.message }); return; }
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { try { p.kill(); } catch { /* nic */ } finish({ code: -2, out, err: err + ' (vypršel časový limit)' }); }, timeout);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => finish({ code: -1, out, err: e.code === 'ENOENT' ? 'git není nainstalovaný (nebo není v PATH)' : e.message }));
    p.on('close', (code) => finish({ code, out, err }));
  });
}

export const DATA_BRANCH = 'sdilena-data';

const oneLine = (s) => String(s).trim().split('\n').slice(-3).join(' ').slice(0, 300);

/**
 * @param {{root:string, files:string[], message:string, git?:Function}} o  root = složka se soubory (uvnitř repozitáře), files = názvy souborů v ní
 * @returns {Promise<{ok:boolean, error?:string, nothing?:boolean, committed?:boolean, pushed?:boolean, files?:number}>}
 */
export async function pushShared({ root, files, message, git = runGit }) {
  const g = (...a) => git(a, { cwd: root });
  const inside = await g('rev-parse', '--is-inside-work-tree');
  if (inside.code !== 0 || inside.out.trim() !== 'true') return { ok: false, error: inside.code === -1 ? inside.err : 'Složka programu není git repozitář.' };
  const present = files.filter((f) => f && existsSync(join(root, f)));
  if (!present.length) return { ok: true, nothing: true, files: 0 };
  let x = await g('add', '--', ...present);
  if (x.code !== 0) return { ok: false, error: `git add: ${oneLine(x.err || x.out)}` };
  x = await g('status', '--porcelain', '--', ...present);
  const changed = x.out.trim().length > 0;
  if (changed) {
    x = await g('commit', '-m', message, '--', ...present); // jen tyto soubory, i kdyby bylo v indexu něco dalšího
    if (x.code !== 0) return { ok: false, error: `git commit: ${oneLine(x.err || x.out)}` };
  }
  const up = await g('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'); // má větev protějšek na serveru? (nová větev ještě ne)
  if (up.code === 0) {
    x = await g('pull', '--rebase', '--autostash');
    if (x.code !== 0) {
      await g('rebase', '--abort');
      return { ok: false, committed: changed, error: `git pull selhal (nic se neodeslalo, změna je uložená lokálně): ${oneLine(x.err || x.out)}` };
    }
  }
  x = await g('push', '-u', 'origin', 'HEAD');
  if (x.code !== 0 && up.code !== 0) { // první push nové větve a mezitím ji na serveru založil někdo jiný: navázat na ni a zkusit znovu
    const br = (await g('rev-parse', '--abbrev-ref', 'HEAD')).out.trim();
    const f = await g('fetch', 'origin', br);
    if (f.code === 0) {
      const r = await g('rebase', `origin/${br}`);
      if (r.code !== 0) { await g('rebase', '--abort'); return { ok: false, committed: changed, error: `git rebase selhal: ${oneLine(r.err || r.out)}` }; }
      x = await g('push', '-u', 'origin', 'HEAD');
    }
  }
  if (x.code !== 0) return { ok: false, committed: changed, error: `git push selhal: ${oneLine(x.err || x.out)}` };
  return { ok: true, committed: changed, pushed: !/up-to-date/i.test(x.err + x.out), files: present.length };
}

/**
 * Připraví složku se sdílenými daty jako vlastní git repozitář na samostatné větvi (data jsou tak oddělená od kódu aplikace):
 * větev už na serveru je -> naklonuje se; není -> vznikne prázdná (orphan) větev, která se při prvním odeslání založí.
 * @returns {Promise<{ok:boolean, existed?:boolean, created?:boolean, error?:string}>}
 */
export async function ensureDataRepo({ mainRoot, dir, branch = DATA_BRANCH, git = runGit }) {
  const r = await ensureDataRepoInner({ mainRoot, dir, branch, git });
  if (r.ok) await copyIdentity({ mainRoot, dir, git });
  return r;
}

/**
 * Jméno a e-mail autora pro commity sdílených dat: když v jejich repozitáři chybí (a git je nemá ani globálně),
 * převezmou se z hlavního repozitáře kódu. Bez nich git commit selže („unable to auto-detect email address“).
 */
export async function copyIdentity({ mainRoot, dir, git = runGit }) {
  for (const key of ['user.name', 'user.email']) {
    const have = await git(['config', key], { cwd: dir });
    if (have.code === 0 && have.out.trim()) continue;
    const main = await git(['config', key], { cwd: mainRoot });
    if (main.code === 0 && main.out.trim()) await git(['config', key, main.out.trim()], { cwd: dir });
  }
}

async function ensureDataRepoInner({ mainRoot, dir, branch, git }) {
  if (existsSync(join(dir, '.git'))) return { ok: true, existed: true };
  const url = await git(['remote', 'get-url', 'origin'], { cwd: mainRoot });
  if (url.code !== 0) return { ok: false, error: 'Hlavní repozitář nemá vzdálený odkaz origin (git remote).' };
  const remote = url.out.trim();
  mkdirSync(dir, { recursive: true });
  const ls = await git(['ls-remote', '--heads', remote, branch], { cwd: mainRoot });
  if (ls.code !== 0) return { ok: false, error: `nelze zjistit větev na serveru: ${oneLine(ls.err || ls.out)}` };
  if (ls.out.trim()) {
    const c = await git(['clone', '--branch', branch, '--single-branch', remote, '.'], { cwd: dir, timeout: 90_000 });
    return c.code === 0 ? { ok: true, existed: false } : { ok: false, error: `git clone: ${oneLine(c.err || c.out)}` };
  }
  for (const a of [['init'], ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], ['remote', 'add', 'origin', remote]]) {
    const r = await git(a, { cwd: dir });
    if (r.code !== 0) return { ok: false, error: `git ${a[0]}: ${oneLine(r.err || r.out)}` };
  }
  return { ok: true, existed: false, created: true };
}

/** Stažení změn ostatních do složky se sdílenými daty (bez protějšku na serveru = nic ke stažení). */
export async function pullData({ dir, git = runGit }) {
  if (!existsSync(join(dir, '.git'))) return { ok: false, error: 'není git repozitář' };
  const g = (...a) => git(a, { cwd: dir });
  const up = await g('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
  if (up.code !== 0) return { ok: true, nothing: true };
  const x = await g('pull', '--rebase', '--autostash');
  if (x.code !== 0) { await g('rebase', '--abort'); return { ok: false, error: `git pull: ${oneLine(x.err || x.out)}` }; }
  return { ok: true, updated: !/up to date|up-to-date/i.test(x.out + x.err) };
}

/** Přenos souborů ze staré složky (profiles/ v repozitáři kódu) do nové, jen co tam ještě není. */
export function migrateLegacyFiles(fromDir, toDir) {
  if (!existsSync(fromDir)) return 0;
  let n = 0;
  mkdirSync(toDir, { recursive: true });
  for (const f of readdirSync(fromDir)) {
    if (!/\.json$/.test(f) || existsSync(join(toDir, f))) continue;
    copyFileSync(join(fromDir, f), join(toDir, f)); n++;
  }
  return n;
}
