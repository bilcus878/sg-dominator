/**
 * Odeslání sdílených souborů (data přepočtů, profil) ostatním přes git: commit jen těchto souborů + pull --rebase + push.
 * Nikdy se nesahá na nic jiného v repozitáři (ostatní rozdělané změny zůstanou, jak jsou). Při jakékoli chybě se pull/rebase vrátí zpět
 * a vrátí se srozumitelná zpráva; nikdy se nic nevynucuje (žádný force push). Volá se z tlačítka v Nastavení a ze stop.cmd.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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
  x = await g('pull', '--rebase', '--autostash');
  if (x.code !== 0) {
    await g('rebase', '--abort');
    return { ok: false, committed: changed, error: `git pull selhal (nic se neodeslalo, změna je uložená lokálně): ${oneLine(x.err || x.out)}` };
  }
  x = await g('push');
  if (x.code !== 0) return { ok: false, committed: changed, error: `git push selhal: ${oneLine(x.err || x.out)}` };
  return { ok: true, committed: changed, pushed: !/up-to-date/i.test(x.err + x.out), files: present.length };
}
