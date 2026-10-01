#!/usr/bin/env node
// batch-launch.mjs — can this master session start a batch session itself, and with what?
// Prints JSON.
//
// `probe` answers which launch modes answer from here — a terminal session in agterm,
// directly or through aimux — what the batch would run at, and, asked for limits, which
// aimux profile has room for it. It decides nothing about chips or a pasted order: those
// are the host's tools and the user's hands, and the agent knows its own tools.
//
// Usage: node batch-launch.mjs probe [<settings>] [--limits [--held <profile>=<n>,...]]
//   <settings>: --model-config <v> --effort-config <v> --profiles <v> --ceiling-5h <v>
//               --ceiling-7d <v>  (the plugin's settings line), --model <m> --effort <e>
//               (the user's word)
//
// Exit 0 whenever an answer is printed, `"read": false` with a `reason` included. Exit 2
// only for a call this script cannot act on at all.

import { readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { availableParallelism, cpus, loadavg } from 'node:os';
import { text, writeAll } from './lib/forge.mjs';
import { agterm, aimuxCore, loginEnv, loginShell, onPath } from './lib/launch-env.mjs';

const USAGE = 'usage: node batch-launch.mjs probe [<settings>] [--limits [--held <profile>=<n>,...]]\n';
const die = (m) => { writeAll(2, `batch-launch: ${m}\n${USAGE}`); process.exit(2); };

// --- the call
const [sub, ...argv] = process.argv.slice(2);
if (sub !== 'probe') die(sub ? `unknown subcommand '${sub}'` : 'a subcommand is required');
const VALUED = new Set(['--model-config', '--effort-config', '--profiles', '--ceiling-5h',
  '--ceiling-7d', '--model', '--effort', '--held']);
const BOOLEAN = new Set(['--limits']);
const opts = {};
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (BOOLEAN.has(a)) { opts[a] = true; continue; }
  if (!VALUED.has(a)) die(`unknown argument '${a}'`);
  if (argv[i + 1] === undefined) die(`${a} needs a value`);
  opts[a] = argv[i += 1];
}

// --- the settings
// The plugin's own manifest holds the defaults and the bounds, so this script carries no
// list of its own that could drift from what /config offers.
let manifest;
try {
  manifest = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
} catch (e) { die(`the plugin manifest did not read (${e.message})`); }
const declared = (manifest && manifest.userConfig) || {};

// A setting the user never saved reaches the skill as the placeholder itself — Claude Code
// substitutes `${user_config.KEY}` only once a value is saved, defaults notwithstanding —
// so that literal, and an empty value, both mean "not set".
const unset = (v) => v === undefined || v === '' || /^\$\{user_config\.[A-Za-z_][A-Za-z0-9_]*\}$/.test(v);

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._[\]-]*$/;
const PROFILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function setting(key, word, config) {
  const spec = declared[key] || {};
  const from = !unset(word) ? 'word' : !unset(config) ? 'config' : 'default';
  const raw = from === 'word' ? word : from === 'config' ? config : spec.default;
  return { value: raw === undefined ? null : raw, from, spec };
}
function choice(key, word, config, check) {
  const s = setting(key, word, config);
  if (s.value === null) return { value: null, from: s.from };
  if (Array.isArray(s.spec.options) && !s.spec.options.includes(s.value)) {
    die(`${key} '${s.value}' (${s.from}) is not one of ${s.spec.options.join(', ')}`);
  }
  if (check && !check.test(s.value)) die(`${key} '${s.value}' (${s.from}) is not a value this can pass on`);
  return { value: s.value, from: s.from };
}
function percent(key, config) {
  const s = setting(key, undefined, config);
  if (s.value === null) return { value: null, from: s.from };
  const n = typeof s.value === 'number' ? s.value : Number(s.value);
  const lo = Number.isFinite(s.spec.min) ? s.spec.min : 0;
  const hi = Number.isFinite(s.spec.max) ? s.spec.max : 100;
  if (!Number.isFinite(n) || n < lo || n > hi) die(`${key} '${s.value}' (${s.from}) is not a number from ${lo} to ${hi}`);
  return { value: n, from: s.from };
}
function profileList(config) {
  const s = setting('batch_profiles', undefined, config);
  const names = s.value === null ? [] : String(s.value).split(',').map((p) => p.trim()).filter(Boolean);
  const bad = names.find((p) => !PROFILE.test(p));
  if (bad) die(`batch_profiles names '${bad}', which is not a profile name`);
  return { value: names.length ? names : null, from: s.from };
}

const settings = {
  model: choice('batch_model', opts['--model'], opts['--model-config'], MODEL),
  effort: choice('batch_effort', opts['--effort'], opts['--effort-config']),
  profiles: profileList(opts['--profiles']),
  ceiling5h: percent('batch_ceiling_5h', opts['--ceiling-5h']),
  ceiling7d: percent('batch_ceiling_7d', opts['--ceiling-7d']),
};

const held = {};
if (opts['--held'] !== undefined) {
  for (const pair of opts['--held'].split(',').filter(Boolean)) {
    const m = /^([^=]+)=([0-9]+)$/.exec(pair.trim());
    if (!m || !PROFILE.test(m[1])) die(`--held '${pair}' is not <profile>=<count>`);
    held[m[1]] = Number(m[2]);
  }
}
if (opts['--held'] !== undefined && !opts['--limits']) die('--held is read only with --limits');

// --- the answer
const answer = {
  read: false,
  mode: null,
  modes: [],
  agterm: { answers: false, socket: null, version: null, session: null, window: null, workspace: null, why: null },
  shell: { path: null, from: null, account: null, read: false, why: null },
  claude: null,
  aimux: { path: null, version: null, core: false, why: null, self: null, profiles: [] },
  settings,
  load: null,
  limits: null,
  ran: [],
  reason: null,
  notes: [],
};
const finish = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };

// --- the machine's load
// A batch starting now competes with every session and build already running; the
// master holds the next launch while the five-minute load stands above this many
// runnable processes per core.
const LOAD_PER_CORE = 2.5;
{
  const [avg1, avg5] = loadavg();
  let cores;
  try { cores = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length; } catch { cores = null; }
  answer.load = { avg1: Math.round(avg1 * 100) / 100, avg5: Math.round(avg5 * 100) / 100, cores,
    holds: cores ? avg5 > cores * LOAD_PER_CORE : null };
}

// --- agterm: this session in its tree
{
  const socket = process.env.AGTERM_SOCKET || null;
  const self = process.env.AGTERM_SESSION_ID || null;
  answer.agterm.socket = socket;
  answer.agterm.session = self;
  if (!socket || !self) {
    answer.agterm.why = 'this session runs outside agterm — no agterm socket or session id in its environment';
  } else {
    const ag = agterm(socket);
    const v = ag.version();
    if (!v.ok) answer.agterm.why = `agtermctl version: ${v.why}`;
    else {
      answer.agterm.version = v.version;
      const found = ag.find(self, process.env.AGTERM_WINDOW_ID || null);
      if (!found.read) answer.agterm.why = `this session's place in the tree is unread: ${found.why}`;
      else if (!found.found) answer.agterm.why = 'agterm answers, but its tree does not hold this session';
      else {
        answer.agterm.answers = true;
        answer.agterm.window = found.window;
        answer.agterm.workspace = found.workspace;
      }
    }
  }
}

// --- the login shell, and what its PATH holds
let login = null;
{
  const sh = loginShell();
  Object.assign(answer.shell, { path: sh.path, from: sh.from, account: sh.account });
  const env = loginEnv(sh.path);
  answer.shell.read = env.read;
  answer.shell.why = env.reason;
  if (env.read) {
    login = env.env;
    answer.claude = onPath('claude', login.PATH);
    answer.aimux.path = onPath('aimux', login.PATH);
  }
}

// --- aimux
let core = null;
let config = null;
if (answer.aimux.path) {
  const a = await aimuxCore(answer.aimux.path);
  answer.aimux.version = a.version;
  if (!a.read) answer.aimux.why = a.reason;
  else {
    try { config = a.core.loadConfig(); } catch (e) { answer.aimux.why = `aimux's config did not read (${text(e.message)})`; }
    if (config && (!config.profiles || typeof config.profiles !== 'object')) {
      answer.aimux.why = 'aimux answered a config with no profiles map';
      config = null;
    } else if (!config && !answer.aimux.why) answer.aimux.why = 'aimux is not set up — it has no config';
    if (config) {
      core = a.core;
      answer.aimux.core = true;
      const realOf = (p) => { try { return realpathSync(p); } catch { return p; } };
      // Which profile this session itself runs under: aimux leaves CLAUDE_CONFIG_DIR unset
      // for its source profile and points it at the profile's directory otherwise.
      const mine = process.env.CLAUDE_CONFIG_DIR ? realOf(process.env.CLAUDE_CONFIG_DIR) : null;
      for (const [name, p] of Object.entries(config.profiles)) {
        if (!p || (p.cli ?? 'claude') !== 'claude') continue;
        const dir = typeof p.path === 'string' ? core.expandHome(p.path) : null;
        const source = p.is_source === true;
        const self = mine ? (dir !== null && realOf(dir) === mine) : source;
        if (self) answer.aimux.self = name;
        answer.aimux.profiles.push({ profile: name, source, configDir: dir, self,
          allowed: settings.profiles.value === null || settings.profiles.value.includes(name) });
      }
      for (const p of settings.profiles.value || []) {
        if (!answer.aimux.profiles.some((q) => q.profile === p)) answer.notes.push(`batch_profiles names '${p}', which aimux does not know`);
      }
      if (!answer.aimux.profiles.length) answer.aimux.why = 'aimux knows no Claude profile';
    }
  }
} else if (login) answer.aimux.why = 'aimux is not on the login shell\'s PATH';

// --- limits, warmed where the login only needs refreshing
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
async function readLimits(name, dir) {
  const p = config.profiles[name];
  let got;
  try { got = await core.fetchRateLimits(p, dir, { timeoutMs: 8000 }); } catch (e) {
    return { read: false, why: `the limits probe threw (${text(e.message)})` };
  }
  if (!got || typeof got !== 'object') return { read: false, why: 'the limits probe answered no shape aimux documents' };
  if (got.status && typeof got.status === 'object') {
    const five = pct(got.status.fiveHourPct);
    const week = pct(got.status.weeklyPct);
    if (five === null && week === null) return { read: false, why: 'no window was reported' };
    return { read: true, five, week };
  }
  if (got.error === 'auth') return { read: false, auth: true, why: 'its login did not answer' };
  return { read: false, why: got.error ? `the limits probe says '${text(String(got.error))}'` : 'the limits probe answered nothing' };
}
// aimux runs `claude` under the profile it is handed; the environment is the login
// shell's, which is the one the batch would start from, so `claude` resolves as it will.
function aimuxRun(args, timeout) {
  const r = spawnSync(process.execPath, [realpathSync(answer.aimux.path), 'run', ...args], {
    env: login, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { ok: r.status === 0, code: r.status, out: r.stdout || '', timedOut: Boolean(r.error && r.error.code === 'ETIMEDOUT') };
}

if (opts['--limits']) {
  answer.limits = { read: false, reason: null, ceilings: { fiveHour: settings.ceiling5h, weekly: settings.ceiling7d },
    profiles: [], pick: { profile: null, why: null } };
  if (!core) answer.limits.reason = answer.aimux.why || 'aimux could not be read';
  else {
    for (const q of answer.aimux.profiles.filter((x) => x.allowed)) {
      const row = { profile: q.profile, fiveHourPct: null, weeklyPct: null, eligible: null, login: null,
        warmed: false, held: (held[q.profile] || 0) + (q.self ? 1 : 0), score: null, why: null };
      let lim = await readLimits(q.profile, q.configDir);
      if (!lim.read && lim.auth) {
        // Free first: `auth status` answers whether the profile is logged in at all.
        const st = aimuxRun([q.profile, 'auth', 'status', '--json'], 60000);
        answer.ran.push(`aimux run ${q.profile} auth status --json`);
        let doc = null;
        try { doc = JSON.parse(st.out); } catch { doc = null; }
        if (!doc || typeof doc.loggedIn !== 'boolean') row.login = null;
        else row.login = doc.loggedIn ? 'ok' : 'needed';
        if (row.login === 'ok') {
          lim = await readLimits(q.profile, q.configDir);
          if (!lim.read && lim.auth) {
            // One request at the cheapest model, nothing kept: it exists only to make the
            // CLI refresh an expired login, which the limits probe cannot do itself.
            const w = aimuxRun([q.profile, '-m', 'haiku', '--', '.', '-p', '--safe-mode',
              '--no-session-persistence', '--tools', ''], 120000);
            answer.ran.push(`aimux run ${q.profile} -m haiku -- . -p --safe-mode --no-session-persistence --tools ""`);
            row.warmed = w.ok;
            if (!w.ok) row.why = w.timedOut ? 'the warm-up timed out' : `the warm-up exited ${w.code}`;
            lim = await readLimits(q.profile, q.configDir);
          }
        }
      }
      if (lim.read) {
        row.fiveHourPct = lim.five;
        row.weeklyPct = lim.week;
        const c5 = settings.ceiling5h.value;
        const c7 = settings.ceiling7d.value;
        const over = (lim.five !== null && lim.five >= c5) || (lim.week !== null && lim.week >= c7);
        row.eligible = !over;
        if (over) row.why = 'a window stands at or above its ceiling';
        else {
          const room = Math.min(...[lim.five === null ? null : c5 - lim.five, lim.week === null ? null : c7 - lim.week]
            .filter((v) => v !== null));
          row.score = Math.round((room / (row.held + 1)) * 100) / 100;
        }
      } else if (!row.why) {
        row.why = row.login === 'needed' ? 'not logged in — the user logs in under this profile' : lim.why;
      }
      answer.limits.profiles.push(row);
    }
    answer.limits.read = true;
    // The most room per batch already on it; a tie goes to the profile carrying fewer,
    // then to aimux's own order. A profile whose limits did not read is never picked.
    const ranked = answer.limits.profiles.filter((r) => r.eligible === true)
      .map((r, i) => ({ r, i })).sort((a, b) => (b.r.score - a.r.score) || (a.r.held - b.r.held) || (a.i - b.i));
    if (ranked.length) answer.limits.pick = { profile: ranked[0].r.profile, why: 'the most room per batch it carries' };
    else answer.limits.pick = { profile: null, why: 'no allowed profile has read limits below its ceilings' };
  }
}

// --- the modes, best first
const terminal = answer.agterm.answers;
answer.modes.push({ mode: 'agterm-aimux',
  answers: terminal && answer.aimux.core && answer.aimux.profiles.some((p) => p.allowed)
    && (!answer.limits || answer.limits.pick.profile !== null),
  why: !terminal ? answer.agterm.why
    : !answer.aimux.core ? answer.aimux.why
      : !answer.aimux.profiles.some((p) => p.allowed) ? 'no aimux profile is allowed for batches'
        : answer.limits && answer.limits.pick.profile === null ? answer.limits.pick.why : null });
answer.modes.push({ mode: 'agterm', answers: terminal && answer.claude !== null,
  why: !terminal ? answer.agterm.why
    : answer.claude === null ? (answer.shell.read ? 'claude is not on the login shell\'s PATH' : answer.shell.why) : null });
const first = answer.modes.find((m) => m.answers);
answer.mode = first ? first.mode : null;

answer.read = true;
finish();
