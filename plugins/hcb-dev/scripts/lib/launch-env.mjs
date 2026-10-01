// launch-env.mjs — what a batch session launched from here would find around it: the
// user's login shell and the PATH it builds, the programs on that PATH, aimux's own
// reading of its subscriptions, and where a session stands in agterm's tree.
//
// It lives apart from batch-launch.mjs because every subcommand there reads the same
// environment, and the readings are the ones that went wrong by hand: a wrapper shell
// that was not the user's, a PATH copied from this session instead of built by a login,
// a workspace id taken from a variable that had gone stale.

import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runner, text, why } from './forge.mjs';

// Two spellings of one path are one place; `fallback` is what an unresolvable one reads as.
export const real = (p, fallback = null) => { try { return realpathSync(p); } catch { return fallback; } };

// --- the login shell

// `$SHELL` first: it is what the user's terminal starts, and the account's record can
// lag behind a `chsh` nobody logged out after. The account answers where it is unset.
export function loginShell() {
  let account = null;
  try { account = userInfo().shell || null; } catch { account = null; }
  const env = process.env.SHELL || null;
  return { path: env || account, from: env ? 'SHELL' : account ? 'account' : null, account };
}

// What a login shell started from nothing exports — the invocation a launched batch is
// started with, so what this finds is what the batch will. agterm starts a `--command`
// with the GUI's environment, where PATH holds the system directories alone, and the
// profile files are what bring Homebrew, nvm and the rest — so the reading starts from
// that minimum rather than from this session's environment, which already carries them.
const BASE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const MARK = '__HCB_LOGIN_ENV__';

export function loginEnv(shell, timeout = 30000) {
  if (!shell) return { read: false, env: null, reason: 'no login shell is known for this account' };
  const env = { PATH: BASE_PATH };
  for (const k of ['HOME', 'USER', 'LOGNAME', 'TERM', 'LANG', 'TMPDIR']) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  env.SHELL = shell;
  // The marker, not the whole output: a profile that prints a greeting, or a `fish`
  // that renders PATH as a list, would otherwise be read as the environment itself.
  const r = spawnSync(shell, ['-l', '-c', `printf '%s\\n' ${MARK}; exec /usr/bin/env -0`], {
    env, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error && r.error.code === 'ETIMEDOUT') return { read: false, env: null, reason: `the login shell did not finish in ${timeout / 1000} s` };
  if (r.error) return { read: false, env: null, reason: `the login shell did not run (${r.error.code || r.error.message})` };
  if (r.status !== 0) {
    const line = (r.stderr || '').trim().split(/\n/).pop() || 'no detail';
    const how = r.status === null ? `was killed by ${r.signal || 'a signal'}` : `exited ${r.status}`;
    return { read: false, env: null, reason: `the login shell ${how} (${text(line)})` };
  }
  const at = (r.stdout || '').indexOf(`${MARK}\n`);
  if (at < 0) return { read: false, env: null, reason: 'the login shell printed no environment' };
  const out = {};
  for (const pair of r.stdout.slice(at + MARK.length + 1).split('\0')) {
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  if (!out.PATH) return { read: false, env: null, reason: 'the login shell exported no PATH' };
  // Where the login stood, not where a program started from it will: carried on, they name
  // this session's directory to a process running somewhere else.
  for (const k of ['PWD', 'OLDPWD', 'SHLVL', '_']) delete out[k];
  return { read: true, env: out, reason: null };
}

// --- programs on a PATH

// Walked here rather than asked of the shell: `command -v` answers a function's name for
// a function, and aimux installs one under its own name. Absolute entries only — an empty
// or relative one names whatever directory a process stands in, which is no place a batch
// started elsewhere finds anything.
export function onPath(name, path) {
  for (const dir of (path || '').split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    const candidate = join(dir, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* not here */ }
  }
  return null;
}

// --- aimux

// Found by the executable rather than by the package's npm name: the `package.json`
// whose `bin` points at it is the package, and its `exports["./core"]` is the entry
// aimux publishes for this. A missing function, a throw, an import that fails — each is
// "aimux could not be read", never "aimux has no subscriptions".
const NEEDED = ['loadConfig', 'fetchRateLimits', 'expandHome'];

const binTargets = (pkg, root) => {
  const bin = typeof pkg.bin === 'string' ? { [pkg.name || '']: pkg.bin }
    : (pkg.bin && typeof pkg.bin === 'object' ? pkg.bin : {});
  return Object.values(bin).filter((v) => typeof v === 'string').map((v) => real(join(root, v)));
};
// An `exports` entry is a path, or conditions over paths, nested as deep as a package likes.
const pick = (e) => (typeof e === 'string' ? e
  : e && typeof e === 'object' && !Array.isArray(e) ? pick(e.import ?? e.node ?? e.default) : null);
const coreEntry = (pkg) => pick(pkg.exports && typeof pkg.exports === 'object' ? pkg.exports['./core'] : null);

// What the executable needs before it runs at all: the interpreter its `#!/usr/bin/env`
// line names, looked for on the PATH it will run with.
export function interpreterOn(bin, path) {
  let head = '';
  try { head = readFileSync(real(bin, bin), 'utf8').slice(0, 200).split('\n')[0]; } catch { return { read: false, name: null, found: null }; }
  const m = /^#!\s*\S*\/env\s+(?:-S\s+)?([^\s]+)/.exec(head);
  if (!m) return { read: true, name: null, found: true };
  return { read: true, name: m[1], found: onPath(m[1], path) !== null };
}

export async function aimuxCore(bin) {
  const answer = { read: false, version: null, core: null, reason: null };
  const target = bin ? real(bin) : null;
  if (!target) { answer.reason = 'no aimux executable'; return answer; }
  for (let dir = dirname(target), i = 0; i < 8; i += 1, dir = dirname(dir)) {
    let pkg;
    try { pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')); } catch { pkg = null; }
    if (pkg && binTargets(pkg, dir).includes(target)) {
      answer.version = typeof pkg.version === 'string' ? text(pkg.version) : null;
      const entry = coreEntry(pkg);
      if (!entry) { answer.reason = 'the aimux package publishes no ./core entry'; return answer; }
      let core;
      try { core = await import(pathToFileURL(resolve(dir, entry)).href); } catch (e) {
        answer.reason = `aimux's core did not load (${text(e.message)})`;
        return answer;
      }
      const missing = NEEDED.filter((f) => typeof core[f] !== 'function');
      if (missing.length) { answer.reason = `aimux's core lacks ${missing.join(', ')}`; return answer; }
      answer.core = core;
      answer.read = true;
      return answer;
    }
    if (dir === dirname(dir)) break;
  }
  answer.reason = 'no package.json above the aimux executable claims it';
  return answer;
}

// `aimux run <args>` as a batch would meet it: the executable itself, in the login
// shell's environment, so its shebang finds the login PATH's node and `claude`. In a
// directory of its own: aimux records the last profile run in each directory, and the
// directory this session stands in is the user's. Its own process group, because a
// timeout has to stop the `claude` aimux started as well as aimux.
// One fixed directory, so aimux's history gains a single entry for it rather than one per
// run; a directory of the same name somebody else made is not used.
function runDir() {
  const dir = join(tmpdir(), 'hcb-aimux-run');
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (e) { if (e.code !== 'EEXIST') return { dir: null, why: e.code || e.message }; }
  try {
    const st = lstatSync(dir);
    if (st.isDirectory() && !st.isSymbolicLink() && (typeof process.getuid !== 'function' || st.uid === process.getuid())) return { dir, temp: false };
  } catch { /* fall through */ }
  try { return { dir: mkdtempSync(join(tmpdir(), 'hcb-aimux-')), temp: true }; } catch (e) { return { dir: null, why: e.code || e.message }; }
}

export function aimuxRun(bin, env, args, timeout, ran) {
  if (ran) ran.push(`aimux run ${args.map((a) => (a === '' ? '""' : a)).join(' ')}`);
  return new Promise((done) => {
    const where = runDir();
    if (!where.dir) { done({ ok: false, code: null, out: '', why: `no directory to run it in (${where.why})` }); return; }
    const cwd = where.dir;
    const end = (r) => { if (where.temp) { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* left behind */ } } done(r); };
    let child;
    try {
      child = spawn(bin, ['run', ...args], { env, cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { end({ ok: false, code: null, out: '', why: `did not start (${e.code || e.message})` }); return; }
    let out = '';
    child.stdout.on('data', (d) => { if (out.length < 1024 * 1024) out += d; });
    child.stderr.resume();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }, timeout);
    child.on('error', (e) => { clearTimeout(timer); end({ ok: false, code: null, out, why: `did not start (${e.code || e.message})` }); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      end({ ok: code === 0 && !timedOut, code, out,
        why: timedOut ? 'timed out' : code === 0 ? null : signal ? `was killed by ${signal}` : `exited ${code}` });
    });
  });
}

// --- agterm

// `agtermctl` never reads `AGTERM_SOCKET` itself, so every call names it.
export function agterm(cli, socket) {
  const run = runner(process.cwd(), cli);
  const call = (args) => {
    const r = run([...args, '--json', '--socket', socket], 30000);
    if (!r.ok) return { ok: false, why: why(r) };
    let doc;
    try { doc = JSON.parse(r.out); } catch { return { ok: false, why: 'did not answer JSON' }; }
    if (!doc || doc.ok !== true) return { ok: false, why: text(doc && doc.error && (doc.error.message || doc.error)) || 'answered not ok' };
    return { ok: true, result: doc.result };
  };
  const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toUpperCase() === b.toUpperCase();
  return {
    call,
    version: () => {
      const r = call(['version']);
      return r.ok ? { ok: true, version: text(r.result && r.result.app && r.result.app.version) } : r;
    },
    // `tree` answers one window at a time, so a session is looked for in the window its
    // shell was told about first and in every other window after — that variable is
    // fixed at spawn and goes stale when the session is moved. Only the session asked
    // for is looked at; nothing else in the tree is read.
    find: (id, preferred) => {
      const list = call(['window', 'list']);
      if (!list.ok) return { read: false, why: `window list: ${list.why}` };
      const ids = (list.result && Array.isArray(list.result.windows) ? list.result.windows : [])
        .map((w) => w && w.id).filter((w) => typeof w === 'string');
      const order = [...ids.filter((w) => same(w, preferred)), ...ids.filter((w) => !same(w, preferred))];
      let unread = 0;
      for (const w of order) {
        const tree = call(['tree', '--window', w]);
        if (!tree.ok) { unread += 1; continue; }
        const spaces = tree.result && tree.result.tree && Array.isArray(tree.result.tree.workspaces)
          ? tree.result.tree.workspaces : [];
        for (const ws of spaces) {
          for (const s of Array.isArray(ws && ws.sessions) ? ws.sessions : []) {
            if (s && same(s.id, id)) {
              return { read: true, found: true, window: w, workspace: ws.id || null,
                session: { id: s.id, cwd: typeof s.cwd === 'string' ? s.cwd : null,
                  status: typeof s.status === 'string' ? s.status : null } };
            }
          }
        }
      }
      // A window whose tree did not answer may hold it: absent from what was read is
      // not absent.
      return unread ? { read: false, why: `${unread} window tree(s) did not answer` }
        : { read: true, found: false };
    },
  };
}
