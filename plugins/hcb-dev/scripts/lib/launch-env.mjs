// launch-env.mjs — what a batch session launched from here would find around it: the
// user's login shell and the PATH it builds, the programs on that PATH, aimux's own
// reading of its subscriptions, and where a session stands in agterm's tree.
//
// It lives apart from batch-launch.mjs because every subcommand there reads the same
// environment, and the readings are the ones that went wrong by hand: a wrapper shell
// that was not the user's, a PATH copied from this session instead of built by a login,
// a workspace id taken from a variable that had gone stale.

import { spawnSync } from 'node:child_process';
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runner, text } from './forge.mjs';

// --- the login shell

// `$SHELL` first: it is what the user's terminal starts, and the account's record can
// lag behind a `chsh` nobody logged out after. The account answers where it is unset.
export function loginShell() {
  let account = null;
  try { account = userInfo().shell || null; } catch { account = null; }
  const env = process.env.SHELL || null;
  return { path: env || account, from: env ? 'SHELL' : account ? 'account' : null, account };
}

// What a login shell started from nothing exports. agterm starts a `--command` with the
// GUI's environment, where PATH holds the system directories alone, and the profile
// files are what bring Homebrew, nvm and the rest — so the reading starts from that
// minimum rather than from this session's environment, which already carries them.
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
  if (r.error) return { read: false, env: null, reason: `the login shell did not run (${r.error.code || r.error.message})` };
  if (r.status !== 0) {
    const line = (r.stderr || '').trim().split(/\n/).pop() || 'no detail';
    return { read: false, env: null, reason: `the login shell exited ${r.status} (${text(line)})` };
  }
  const at = (r.stdout || '').indexOf(`${MARK}\n`);
  if (at < 0) return { read: false, env: null, reason: 'the login shell printed no environment' };
  const out = {};
  for (const pair of r.stdout.slice(at + MARK.length + 1).split('\0')) {
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  if (!out.PATH) return { read: false, env: null, reason: 'the login shell exported no PATH' };
  return { read: true, env: out, reason: null };
}

// --- programs on a PATH

const real = (p) => { try { return realpathSync(p); } catch { return null; } };

// Walked here rather than asked of the shell: `command -v` answers a function's name for
// a function, and aimux installs one under its own name.
export function onPath(name, path) {
  for (const dir of (path || '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(resolve(dir), name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* not here */ }
  }
  return null;
}

// --- aimux's own reading

// Found by the executable rather than by the package's npm name: the `package.json`
// whose `bin` points at it is the package, and its `exports["./core"]` is the entry
// aimux publishes for this. A missing function, a throw, an import that fails — each is
// "aimux could not be read", never "aimux has no subscriptions".
const NEEDED = ['loadConfig', 'fetchRateLimits', 'rateLimitProfiles', 'expandHome'];

const binTargets = (pkg, root) => {
  const bin = typeof pkg.bin === 'string' ? { [pkg.name || '']: pkg.bin }
    : (pkg.bin && typeof pkg.bin === 'object' ? pkg.bin : {});
  return Object.values(bin).filter((v) => typeof v === 'string').map((v) => real(join(root, v)));
};
const coreEntry = (pkg) => {
  const e = pkg.exports && typeof pkg.exports === 'object' ? pkg.exports['./core'] : null;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') return e.import || e.default || null;
  return null;
};

export async function aimuxCore(bin) {
  const answer = { read: false, root: null, version: null, entry: null, core: null, reason: null };
  const target = bin ? real(bin) : null;
  if (!target) { answer.reason = 'no aimux executable'; return answer; }
  answer.entry = target;
  for (let dir = dirname(target), i = 0; i < 8; i += 1, dir = dirname(dir)) {
    let pkg;
    try { pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')); } catch { pkg = null; }
    if (pkg && binTargets(pkg, dir).includes(target)) {
      answer.root = dir;
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

// --- agterm

// `agtermctl` never reads `AGTERM_SOCKET` itself, so every call names it.
export function agterm(socket) {
  const run = runner(process.cwd(), 'agtermctl');
  const call = (args) => {
    const r = run([...args, '--json', '--socket', socket], 30000);
    if (!r.ok) return { ok: false, why: r.timedOut ? 'timed out' : r.line() };
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
