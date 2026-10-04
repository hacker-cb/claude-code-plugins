#!/usr/bin/env node
// batch-launch.mjs — can this master session start a batch session itself, and with what;
// then starting it, checking on it, starting it again, and closing it. Prints JSON.
//
// `probe` answers which launch modes answer from here — a terminal session in agterm,
// directly or through aimux — what the batch would run at, and, asked for limits, which
// aimux profile has room for it. It decides nothing about chips or a pasted order: those
// are the host's tools and the user's hands, and the agent knows its own tools.
// `launch` starts one batch in its own agterm session, beside this one: claude started at
// the repository's root with `--worktree`, so Claude Code makes the batch's worktree itself,
// the order as the session's first prompt, a session id chosen here.
// `check` says whether that session is alive and whether a subscription limit stopped it;
// `relaunch` resumes one `check` found gone; `close` ends one whose work was accepted.
//
// Usage: node batch-launch.mjs probe [<settings>] [--limits [--held <profile>=<n>,...]]
//        node batch-launch.mjs launch --batch <epic>/<id> --mode agterm|agterm-aimux
//             [<settings>] [--profile <name>] [--held ...] [--wait <s>] [--dry-run]  < the order
//        node batch-launch.mjs check --batch <epic>/<id> --session <uuid> [--agterm <id>]
//        node batch-launch.mjs relaunch --batch <epic>/<id> --session <uuid> --agterm <id> --title <title>
//             --mode agterm|agterm-aimux [<settings>] [--profile <name>] [--wait <s>]  < the nudge
//        node batch-launch.mjs close --batch <epic>/<id> --session <uuid> --agterm <id> [--dry-run]
//   <settings>: --model-config <v> --effort-config <v> --profiles <v> --ceiling-5h <v>
//               --ceiling-7d <v>  (the plugin's settings line), --model <m> --effort <e>
//               (the user's word)
//
// Exit 0 whenever an answer is printed, `"read": false` with a `reason` included. Exit 2
// only for a call this script cannot act on at all.

import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refNameOk, runner, text, within, worktrees, writeAll } from './lib/forge.mjs';
import { agterm, aimuxCore, aimuxRun, interpreterOn, loginEnv, loginShell, onPath, real, sleep } from './lib/launch-env.mjs';
import { configFile, mirrorTrust } from './lib/claude-trust.mjs';

const USAGE = `usage: node batch-launch.mjs probe|launch|check|relaunch|close <flags> — see the header\n`;
const die = (m) => { writeAll(2, `batch-launch: ${m}\n${USAGE}`); process.exit(2); };

// --- the call
const [sub, ...argv] = process.argv.slice(2);
const SETTINGS = ['--model-config', '--effort-config', '--profiles', '--ceiling-5h', '--ceiling-7d', '--model', '--effort'];
const FLAGS = {
  probe: { valued: [...SETTINGS, '--held'], boolean: ['--limits'] },
  launch: { valued: [...SETTINGS, '--held', '--batch', '--mode', '--profile', '--wait'], boolean: ['--dry-run'] },
  check: { valued: ['--batch', '--session', '--agterm'], boolean: [] },
  relaunch: { valued: [...SETTINGS, '--batch', '--session', '--agterm', '--title', '--mode', '--profile', '--wait'], boolean: [] },
  close: { valued: ['--batch', '--session', '--agterm'], boolean: ['--dry-run'] },
};
if (!FLAGS[sub]) die(sub ? `unknown subcommand '${sub}'` : 'a subcommand is required');
const VALUED = new Set(FLAGS[sub].valued);
const BOOLEAN = new Set(FLAGS[sub].boolean);
const opts = {};
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (BOOLEAN.has(a)) { opts[a] = true; continue; }
  if (!VALUED.has(a)) die(`unknown argument '${a}'`);
  // A flag in a value's place is a value left out, never a value: `--profiles --limits`
  // would otherwise switch the limits off.
  if (argv[i + 1] === undefined || VALUED.has(argv[i + 1]) || BOOLEAN.has(argv[i + 1])) die(`${a} needs a value`);
  opts[a] = argv[i += 1];
}
if (sub === 'probe' && opts['--held'] !== undefined && !opts['--limits']) die('--held is read only with --limits');
if (sub === 'launch' && opts['--held'] !== undefined && opts['--mode'] !== 'agterm-aimux') die('--held goes with --mode agterm-aimux');

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

// What travels on to `claude --model` as one quoted word: an alias, an id, a provider's
// `region.vendor.model:version`, a Vertex `model@date`, a Bedrock ARN.
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]*$/;
// aimux names a profile however the user did; what cannot pass is what this splits on —
// a comma, an `=` — what trimming would change, and what cannot travel as one quoted word.
// A leading `-` too: aimux would read the name as one of its own flags.
const profileOk = (p) => p !== '' && p === p.trim() && !p.startsWith('-') && !/[,='"\\\u0000-\u001f\u007f]/.test(p);

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
  const n = Number(s.value);
  const lo = Number.isFinite(s.spec.min) ? s.spec.min : 0;
  const hi = Number.isFinite(s.spec.max) ? s.spec.max : 100;
  if (!Number.isFinite(n) || n < lo || n > hi) die(`${key} '${s.value}' (${s.from}) is not a number from ${lo} to ${hi}`);
  return { value: n, from: s.from };
}
function profileList(config) {
  const s = setting('batch_profiles', undefined, config);
  const names = s.value === null ? [] : String(s.value).split(',').map((p) => p.trim()).filter(Boolean);
  const bad = names.find((p) => !profileOk(p));
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

// A map, never an object: a profile may be called `constructor`.
const held = new Map();
for (const pair of (opts['--held'] || '').split(',').map((x) => x.trim()).filter(Boolean)) {
  const m = /^(.+)=([0-9]+)$/.exec(pair);
  const total = m ? (held.get(m[1]) || 0) + Number(m[2]) : NaN;
  if (!m || !profileOk(m[1]) || !Number.isSafeInteger(total)) die(`--held '${pair}' is not <profile>=<count>`);
  held.set(m[1], total);
}

// --- what launch, check, relaunch and close are handed, checked before anything runs
// No `-` inside either part: the worktree joins the two with one, and `a-b/c` would meet `a/b-c` there.
const BATCH = /^([A-Za-z0-9][A-Za-z0-9._]*)\/([A-Za-z0-9][A-Za-z0-9._]*)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const call = { batch: null, slug: null, mode: null, session: null, agterm: null, title: null,
  text: null, wait: 90, profile: null };
if (sub !== 'probe') {
  const b = BATCH.exec(opts['--batch'] || '');
  if (!b) die('--batch is <epic>/<id>, each part letters, digits, `.` or `_`');
  call.batch = opts['--batch'];
  // The name the launch hands `--worktree`, and so the worktree's directory under
  // `.claude/worktrees/`: a batch's worktree leads with its batch's identifier.
  call.slug = `${b[1]}-${b[2]}`;
}
if (sub === 'launch' || sub === 'relaunch') {
  if (!['agterm', 'agterm-aimux'].includes(opts['--mode'])) die('--mode is agterm or agterm-aimux');
  call.mode = opts['--mode'];
  if (opts['--profile'] !== undefined) {
    if (call.mode !== 'agterm-aimux') die('--profile names an aimux profile, so it goes with --mode agterm-aimux');
    if (!profileOk(opts['--profile'])) die(`--profile '${opts['--profile']}' is not a profile name`);
    call.profile = opts['--profile'];
  }
  if (opts['--wait'] !== undefined) {
    const w = /^[0-9]{1,3}$/.test(opts['--wait']) ? Number(opts['--wait']) : NaN;
    if (!(w <= 600)) die('--wait is whole seconds, 0 to 600');
    call.wait = w;
  }
  let input = '';
  try { input = readFileSync(0, 'utf8'); } catch { input = ''; }
  if (input.trim() === '') die(`the ${sub === 'launch' ? 'order' : 'nudge'} comes on stdin, and none came`);
  // First after `--`, where nothing reads it as a flag — but `claude` would.
  if (input.startsWith('-')) die('the text on stdin starts with `-`, which claude would read as a flag');
  // A lone lowercase word is what claude and aimux read as a subcommand of theirs.
  if (/^\s*[a-z][a-z0-9-]*\s*$/.test(input)) die('the text on stdin is one bare word, which claude would read as a subcommand');
  call.text = input;
}
if (sub === 'launch') {
  // The title is the order's own: the first backticked text of its first line, which a
  // wave order opens with in any language. A title naming another batch is a mismatch.
  const m = /`([^`\n]+)`/.exec(call.text.split('\n')[0]);
  if (!m || !m[1].startsWith(`${call.batch} — `)) die(`the order's first line names no \`${call.batch} — <topic>\` title`);
  call.title = m[1];
}
if (sub === 'relaunch') {
  if (!(opts['--title'] || '').startsWith(`${call.batch} — `)) die(`--title is the batch's title, \`${call.batch} — <topic>\``);
  call.title = opts['--title'];
}
if (sub === 'check' || sub === 'relaunch' || sub === 'close') {
  if (!UUID.test(opts['--session'] || '')) die('--session is the session id the launch recorded');
  call.session = opts['--session'];
}
if (sub === 'relaunch' && call.mode === 'agterm-aimux' && !call.profile) {
  // A resume carries on under the profile the ledger recorded, or the one the master
  // names instead of it — never a pick made fresh, which knows nothing of why it stopped.
  die('relaunch --mode agterm-aimux names its --profile: the one recorded, or another');
}
if (sub === 'close' || sub === 'relaunch' || (sub === 'check' && opts['--agterm'] !== undefined)) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(opts['--agterm'] || '')) die('--agterm is the agterm session id the launch recorded');
  call.agterm = opts['--agterm'];
}
if (call.title && /[\u0000-\u001f\u007f]/.test(call.title)) die('the title carries a control character');

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
  const [avg1, avg5] = os.loadavg();
  let cores;
  try { cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length; } catch { cores = null; }
  answer.load = { avg1: Math.round(avg1 * 100) / 100, avg5: Math.round(avg5 * 100) / 100, cores,
    holds: cores ? avg5 > cores * LOAD_PER_CORE : null };
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

// --- agterm: this session in its tree
let agtermCli = null;
{
  const socket = process.env.AGTERM_SOCKET || null;
  const self = process.env.AGTERM_SESSION_ID || null;
  answer.agterm.socket = socket;
  answer.agterm.session = self;
  const cli = onPath('agtermctl', process.env.PATH) || (login && onPath('agtermctl', login.PATH));
  agtermCli = cli;
  if (!socket || !self) {
    answer.agterm.why = 'this session runs outside agterm — no agterm socket or session id in its environment';
  } else if (!cli) {
    answer.agterm.why = 'agtermctl is on neither this session\'s PATH nor the login shell\'s';
  } else {
    const ag = agterm(cli, socket);
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

// --- aimux
let core = null;
let config = null;
if (answer.aimux.path) {
  const a = await aimuxCore(answer.aimux.path);
  answer.aimux.version = a.version;
  if (!a.read) answer.aimux.why = a.reason;
  else {
    try { config = await a.core.loadConfig(); } catch (e) { answer.aimux.why = `aimux's config did not read (${text(e.message)})`; }
    if (config && (!config.profiles || typeof config.profiles !== 'object')) {
      answer.aimux.why = 'aimux answered a config with no profiles map';
      config = null;
    } else if (!config && !answer.aimux.why) answer.aimux.why = 'aimux is not set up — it has no config';
    if (config) {
      core = a.core;
      answer.aimux.core = true;
      // Which profile this session itself runs under: aimux leaves CLAUDE_CONFIG_DIR unset
      // for its source profile and points it at the profile's directory otherwise.
      const mine = process.env.CLAUDE_CONFIG_DIR ? real(process.env.CLAUDE_CONFIG_DIR, process.env.CLAUDE_CONFIG_DIR) : null;
      const others = [];
      for (const [name, p] of Object.entries(config.profiles)) {
        if (!p) continue;
        if ((p.cli ?? 'claude') !== 'claude') { others.push(name); continue; }
        let dir = null;
        try { dir = typeof p.path === 'string' && p.path !== '' ? core.expandHome(p.path) : null; } catch { dir = null; }
        const source = p.is_source === true;
        // The source profile runs where Claude Code keeps its configuration by default.
        if (dir === null && source) dir = join(os.homedir(), '.claude');
        // aimux reads a relative path from whatever directory it runs in — the batch's, not
        // this one — so such a profile has no directory this session can answer for.
        if (dir !== null && !isAbsolute(dir)) {
          answer.notes.push(`aimux gives '${name}' the relative path ${text(dir)}, which it would read from the batch's directory`);
          dir = null;
        }
        // This session runs under the source profile only where both stand in the default place.
        const home = join(os.homedir(), '.claude');
        const self = mine ? (dir !== null && real(dir, dir) === mine)
          : source && dir !== null && real(dir, dir) === real(home, home);
        if (self) answer.aimux.self = name;
        answer.aimux.profiles.push({ profile: name, source, configDir: dir, self,
          allowed: settings.profiles.value === null || settings.profiles.value.includes(name) });
      }
      for (const p of settings.profiles.value || []) {
        if (others.includes(p)) answer.notes.push(`batch_profiles names '${p}', which is not a Claude profile`);
        else if (!answer.aimux.profiles.some((q) => q.profile === p)) answer.notes.push(`batch_profiles names '${p}', which aimux does not know`);
      }
      for (const p of held.keys()) {
        if (!answer.aimux.profiles.some((q) => q.profile === p)) answer.notes.push(`--held names '${p}', which aimux does not know as a Claude profile`);
      }
      if (!answer.aimux.profiles.length) answer.aimux.why = 'aimux knows no Claude profile';
    }
  }
} else if (login) answer.aimux.why = 'aimux is not on the login shell\'s PATH';

// --- limits, warmed where the login only needs refreshing
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// aimux bounds its own request; this bounds aimux, whose promise is not this script's to trust.
const PROBE_MS = 8000;
async function readLimits(name, dir) {
  if (!dir) return { read: false, why: 'aimux gives this profile no directory this session can answer for' };
  let got;
  let timer;
  try {
    got = await Promise.race([core.fetchRateLimits(config.profiles[name], dir, { timeoutMs: PROBE_MS }),
      new Promise((_, no) => { timer = setTimeout(() => no(new Error(`no answer in ${2 * PROBE_MS / 1000} s`)), 2 * PROBE_MS); })]);
  } catch (e) {
    return { read: false, why: `the limits probe threw (${text(e.message)})` };
  } finally { clearTimeout(timer); }
  if (!got || typeof got !== 'object') return { read: false, why: 'the limits probe answered no shape aimux documents' };
  if (got.status && typeof got.status === 'object') {
    const five = pct(got.status.fiveHourPct);
    const week = pct(got.status.weeklyPct);
    if (five === null && week === null) return { read: false, why: 'no window was reported' };
    return { read: true, five, week };
  }
  // `auth` is a login that did not answer, the login's question, which `auth status`
  // answers. Nothing at all is aimux probing nothing: an API-key profile has no
  // subscription windows, and a subscription profile with no login asks the same question.
  if (got.error === 'auth') return { read: false, login: true, why: 'its login did not answer' };
  if (got.error === undefined) {
    let kind = null;
    try { kind = typeof core.classifyProfile === 'function' ? core.classifyProfile(config.profiles[name], dir) : null; } catch { kind = null; }
    if (kind === 'none') return { read: false, login: true, why: 'aimux found no login for it' };
    if (kind === 'api') return { read: false, api: true, why: 'an API-key profile — no subscription window applies to it' };
    return { read: false, why: 'aimux reports no limits for it' };
  }
  return { read: false, why: `the limits probe says '${text(String(got.error))}'` };
}

async function profileRow(q, warm) {
  const row = { profile: q.profile, allowed: q.allowed, fiveHourPct: null, weeklyPct: null, eligible: null,
    login: null, warmed: false, held: (held.get(q.profile) || 0) + (q.self ? 1 : 0), score: null, why: null };
  let lim = await readLimits(q.profile, q.configDir);
  if (!lim.read && lim.login && !warm) row.why = 'its login needs refreshing, which a preview does not do';
  else if (!lim.read && lim.login) {
    // Free first: `auth status` answers whether the profile is logged in at all.
    const st = await aimuxRun(answer.aimux.path, login, [q.profile, 'auth', 'status', '--json'], 60000, answer.ran);
    let doc = null;
    try { doc = JSON.parse(st.out); } catch { doc = null; }
    // Only a status that exited cleanly is believed: a failed one is the login unread.
    if (st.ok && doc && typeof doc.loggedIn === 'boolean') row.login = doc.loggedIn ? 'ok' : 'needed';
    if (row.login === 'ok') {
      // One request at the cheapest model, nothing kept: it exists only to make the CLI
      // refresh an expired login, which neither the limits probe nor `auth status` does.
      const w = await aimuxRun(answer.aimux.path, login, [q.profile, '-m', 'haiku', '--', '.', '-p',
        '--safe-mode', '--no-session-persistence', '--tools', ''], 120000, answer.ran);
      row.warmed = w.ok;
      lim = w.ok ? await readLimits(q.profile, q.configDir) : { read: false, why: `the warm-up ${w.why}` };
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
  } else if (lim.api) {
    // No window to stand at a ceiling: it takes a batch, ranked after every profile with room.
    row.eligible = true;
    row.why = lim.why;
  } else if (!row.why) row.why = row.login === 'needed' ? 'not logged in — the user logs in under this profile' : lim.why;
  return row;
}

// Reads the limits of the profiles `wanted` names — every allowed one where it names
// none — warming a login that only needs refreshing unless `warm` is off.
async function computeLimits(wanted, warm) {
  answer.limits = { read: false, reason: null, ceilings: { fiveHour: settings.ceiling5h, weekly: settings.ceiling7d },
    profiles: [], pick: { profile: null, why: null } };
  if (!core) { answer.limits.reason = answer.aimux.why || 'aimux could not be read'; return; }
  const read = answer.aimux.profiles.filter((q) => (wanted ? wanted.has(q.profile) : q.allowed));
  answer.limits.profiles = await Promise.all(read.map((q) => profileRow(q, warm)));
  answer.limits.read = true;
  // The most room per batch already on it; a profile with no window to measure comes
  // after every one with room; a tie goes to the profile carrying fewer, then to aimux's
  // own order, which a stable sort keeps. A profile whose limits did not read is never
  // picked.
  const ranked = answer.limits.profiles.filter((r) => r.allowed && r.eligible === true)
    .sort((a, b) => ((a.score === null) - (b.score === null)) || ((b.score ?? 0) - (a.score ?? 0)) || (a.held - b.held));
  answer.limits.pick = ranked.length ? { profile: ranked[0].profile, why: 'the most room per batch it carries' }
    : { profile: null, why: 'no allowed profile has read limits below its ceilings' };
}
if (sub === 'probe' && opts['--limits']) await computeLimits(null, true);

// --- the modes, best first; a mode answers where nothing stands against it
const terminal = answer.agterm.answers;
// What both terminal modes need: this session's own place in agterm, and claude on the
// login PATH — aimux starts claude from there too.
const claudeStarts = answer.claude ? interpreterOn(answer.claude, login && login.PATH) : null;
const runnable = !terminal ? answer.agterm.why
  : answer.claude === null ? (answer.shell.read ? 'claude is not on the login shell\'s PATH' : answer.shell.why)
    : claudeStarts && claudeStarts.found === false ? `claude's interpreter, ${claudeStarts.name}, is not on the login shell's PATH` : null;
const aimuxStarts = answer.aimux.path ? interpreterOn(answer.aimux.path, login && login.PATH) : null;
// What stands against the aimux way before any profile is chosen.
const aimuxBlock = !answer.aimux.core || !answer.aimux.profiles.length ? answer.aimux.why
  : aimuxStarts && aimuxStarts.found === false ? `aimux's interpreter, ${aimuxStarts.name}, is not on the login shell's PATH` : null;
function evaluateModes() {
  answer.modes = [];
  const mode = (name, why) => answer.modes.push({ mode: name, answers: why === null, why });
  mode('agterm-aimux', runnable
    ?? aimuxBlock
    ?? (!answer.aimux.profiles.some((p) => p.allowed) ? 'no aimux profile is allowed for batches'
      : answer.limits && answer.limits.pick.profile === null ? answer.limits.pick.why : null));
  // A plain claude started from here runs under this session's own profile — the launch
  // hands it this session's config directory — so where aimux names that profile, its word
  // on batches and its limits hold the plain mode as they hold the aimux one.
  const own = answer.aimux.profiles.find((p) => p.self);
  const ownRow = answer.limits && own ? answer.limits.profiles.find((r) => r.profile === own.profile) : null;
  // Limits asked for while aimux stands on the login PATH unread: this session's own profile
  // cannot be checked, and an unchecked profile takes no batch.
  const ownUnread = answer.limits && answer.aimux.path && !answer.aimux.core;
  mode('agterm', runnable
    ?? (ownUnread ? `this session's own profile, which a plain claude runs under, cannot be checked: ${answer.aimux.why}`
      : answer.limits && answer.aimux.core && !own ? 'this session runs under a configuration no aimux profile names, so its limits cannot be checked'
      : own && !own.allowed ? 'this session\'s own profile, which a plain claude runs under, is not allowed for batches'
      : ownRow && ownRow.eligible !== true ? `this session's own profile, which a plain claude runs under, ${ownRow.eligible === false ? 'stands at its ceiling' : `could not be read: ${ownRow.why}`}`
        : null));
  const first = answer.modes.find((m) => m.answers);
  answer.mode = first ? first.mode : null;
}
evaluateModes();

if (sub === 'probe') { answer.read = true; finish(); }


// --- launch, check, relaunch, close

const done = (obj) => { writeAll(1, `${JSON.stringify(obj, null, 2)}\n`); process.exit(0); };
// One shell word, whatever it holds.
const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
// What agterm's `--command` tokenizer and the quotes around the shell and the launch file
// would read as more than one path.
const commandSafe = (v) => typeof v === 'string' && v !== '' && !/['"$`\\\n\r]/.test(v);
const git = runner(process.cwd(), 'git');
// Absolute, since the batch starts in another directory than this session stands in.
const ownDir = () => (process.env.CLAUDE_CONFIG_DIR ? resolve(process.env.CLAUDE_CONFIG_DIR) : join(os.homedir(), '.claude'));
const defaultDir = () => join(os.homedir(), '.claude');
const sameDir = (a, b) => real(a, a) === real(b, b);
const configDirs = () => [...new Set([ownDir(), ...answer.aimux.profiles.map((p) => p.configDir).filter(Boolean)])];

// The repository's main tree, its worktrees, and the batch's own place among them.
function batchTree() {
  const listed = worktrees(git);
  if (listed.trees === null) return { why: `the worktree list did not read (${listed.error})` };
  const primary = listed.trees.find((t) => t.isPrimary);
  if (!primary) return { why: 'git listed no main working tree' };
  const wt = join(primary.path, '.claude', 'worktrees', call.slug);
  return { root: primary.path, wt, trees: listed.trees, known: listed.trees.find((t) => real(t.path, t.path) === real(wt, wt)) || null, why: null };
}

// Who stands in a worktree, from the one reader of the session registry this plugin has —
// asked of every registry a configuration here keeps, since a batch under another aimux
// profile registers under that profile's. `pids` are the live sessions it found there.
function occupancy(path) {
  const script = fileURLToPath(new URL('./worktree-owners.mjs', import.meta.url));
  const seen = new Set();
  const pids = new Set();
  let occupied = false;
  let unread = null;
  for (const dir of configDirs()) {
    const reg = real(join(dir, 'sessions'), join(dir, 'sessions'));
    if (seen.has(reg)) continue;
    seen.add(reg);
    // A configuration no session has ever run under keeps no registry, and has no session
    // to register; this session's own is read whatever stands there. A registry that cannot
    // be looked at is unread, not absent.
    if (dir !== ownDir()) {
      try { lstatSync(reg); } catch (e) {
        if (e.code === 'ENOENT') continue;
        unread = `the session registry under ${dir} could not be looked at (${e.code})`;
        continue;
      }
    }
    const r = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, CLAUDE_CONFIG_DIR: dir } });
    let doc = null;
    try { doc = JSON.parse(r.stdout || ''); } catch { doc = null; }
    if (!doc || doc.read !== true) { unread = (doc && doc.reason) || 'worktree-owners did not answer'; continue; }
    const w = (doc.worktrees || []).find((t) => real(t.path, t.path) === real(path, path));
    if (!w) continue;
    if (w.occupied === true) occupied = true;
    else if (w.occupied === null) unread = `the session registry under ${dir} did not read`;
    // A record whose liveness could not be told proves nobody is there.
    for (const s of w.sessions || []) if (s && s.live === true && Number.isInteger(s.pid)) pids.add(s.pid);
  }
  return { occupied: occupied ? true : unread ? null : false, pids, why: unread };
}

// The session a process carries: the id the launch chose, which no other process is
// handed. The arguments a process started with are what to match — the registry's own
// `sessionId` moves to a new conversation's on `/clear`, while the process stays the batch's.
const SESSION_FLAGS = ['--resume', '--session-id', '-r'];
// Word by word, where the arguments come apart — agterm hands them so: an order's text
// that merely mentions the id is one word, and carries nothing. The same spellings `word`
// matches in a `ps` line.
const carriesArgv = (argv, session) => argv.some((w, i) => SESSION_FLAGS.some((f) => (w === f && argv[i + 1] === session)
  || w === `${f}=${session}`));

// The processes whose arguments match `marks`, anywhere on the machine — resumed in another
// terminal, another directory, under another profile. `ps` joins a process's arguments
// with spaces, so a mark is matched in that line, and a prompt quoting one matches too.
function processes(marks) {
  const r = spawnSync('ps', ['axww', '-o', 'pid=,args='], { encoding: 'utf8', timeout: 10000, maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) return null;
  const pids = new Set();
  for (const line of (r.stdout || '').split('\n')) {
    const m = /^\s*([0-9]+)\s(.*)$/.exec(line);
    if (m && marks.some((k) => k.test(m[2]))) pids.add(Number(m[1]));
  }
  return pids;
}
// One flag and its value, as whole words of the line.
const word = (flag, value) => new RegExp(`(^|\\s)${flag}[= ]${value.replace(/[.]/g, '\\.')}(\\s|$)`);
const carriers = (session) => processes(SESSION_FLAGS.map((f) => word(f, session)));
const running = (session) => { const p = carriers(session); return p === null ? null : p.size > 0; };

// Whether the claude carrying the session stands in the worktree, by the registry entry of
// the process carrying it: `true`, `false`, or `null` with `why` where a reading failed or
// no process carries it.
function standsIn(session, wt) {
  const pids = carriers(session);
  if (pids === null) return { at: null, why: 'the process table did not read' };
  if (!pids.size) return { at: null, why: 'no process carries the session id' };
  const who = occupancy(wt);
  if ([...pids].some((p) => who.pids.has(p))) return { at: true, why: null };
  // Not among the registries read, where one did not read: unknown, never no.
  return who.why ? { at: null, why: who.why } : { at: false, why: null };
}

// A process's working directory: `/proc` where there is one, `lsof` asked of that one
// process otherwise. `null` where neither answered.
function cwdOf(pid) {
  try { return readlinkSync(`/proc/${pid}/cwd`); } catch { /* no /proc */ }
  const r = spawnSync('lsof', ['-a', '-b', '-w', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8', timeout: 10000 });
  const n = (r.stdout || '').split('\n').find((l) => l.startsWith('n'));
  return n ? n.slice(1) : null;
}

// Every copy of a session's transcript, wherever a configuration keeps its projects; each
// one's size and time, so that a resumed session writing to it shows. A copy is one file
// however many paths lead to it — aimux links every profile's `projects` to one shared
// directory, where the same file answers under each profile's path — so files and
// directories are told apart by where they resolve, never by how they are spelled.
function transcripts(session, dirs) {
  const copies = [];
  const files = new Set();
  const read = new Set();
  let unread = null;
  for (const dir of dirs) {
    if (!dir) continue;
    const root = join(dir, 'projects');
    const key = real(root, root);
    if (read.has(key)) continue;
    read.add(key);
    let projects;
    try { projects = readdirSync(root); } catch (e) {
      if (e.code !== 'ENOENT') unread = `${root} did not read (${e.code})`;
      continue;
    }
    for (const p of projects) {
      const f = join(root, p, `${session}.jsonl`);
      try {
        const st = statSync(f);
        const id = real(f, f);
        if (files.has(id)) continue;
        files.add(id);
        copies.push({ path: f, real: id, size: st.size, mtimeMs: st.mtimeMs, lastWrite: st.mtime.toISOString() });
      } catch (e) {
        if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') unread = `${f} did not read (${e.code})`;
      }
    }
  }
  return { copies, unread };
}
const shown = (c) => ({ path: c.path, size: c.size, lastWrite: c.lastWrite });

// The profile the batch goes on, and the configuration it runs under.
function placement(out) {
  if (call.mode !== 'agterm-aimux') {
    out.profile = { value: null, from: null, configDir: ownDir(), why: 'a plain claude runs under this session\'s own configuration' };
    return { prof: null, configDir: ownDir() };
  }
  const name = call.profile ?? (answer.limits && answer.limits.pick.profile);
  const prof = answer.aimux.profiles.find((p) => p.profile === name);
  if (!prof) return { why: name ? `aimux knows no Claude profile '${name}'` : answer.limits.pick.why };
  if (!prof.configDir) return { why: `aimux gives '${name}' no directory this session can answer for` };
  out.profile = { value: name, from: call.profile ? 'word' : 'spread', configDir: prof.configDir,
    why: call.profile ? null : answer.limits.pick.why };
  const row = answer.limits && answer.limits.profiles.find((r) => r.profile === name);
  if (call.profile && !(row && row.allowed && row.eligible === true)) {
    out.notes.push(`the batch goes on '${name}' by the user's word, though ${row ? (row.why || 'it is not allowed for batches') : 'its limits were not read'}`);
  }
  return { prof, configDir: prof.configDir };
}

// Reads what the way needs, then whether it answers. A profile the user named outranks the
// settings' list and the limits' pick; the aimux way still has to be able to run at all.
async function settleWay(dryRun) {
  // Nothing is read for a way that cannot run at all.
  if (runnable) return runnable;
  const self = answer.aimux.profiles.find((p) => p.self);
  if (call.mode === 'agterm-aimux') {
    if (aimuxBlock) return aimuxBlock;
    await computeLimits(call.profile ? new Set([call.profile]) : null, !dryRun);
  } else if (answer.aimux.path) await computeLimits(new Set(self ? [self.profile] : []), !dryRun);
  evaluateModes();
  if (call.mode === 'agterm-aimux' && call.profile) return null;
  const m = answer.modes.find((x) => x.mode === call.mode);
  return m.answers ? null : m.why;
}

function trust(out, prof, root, dryRun) {
  if (call.mode !== 'agterm-aimux' || prof.self) return true;
  // The file the batch's claude will read: aimux's source profile runs with no
  // CLAUDE_CONFIG_DIR where its directory is the default, and the launch sets one where not.
  out.trust = mirrorTrust({ from: configFile(process.env.CLAUDE_CONFIG_DIR ? ownDir() : null),
    into: configFile(prof.source && sameDir(prof.configDir, defaultDir()) ? null : prof.configDir), root, dryRun });
  const ok = ['held', 'shared', 'would-write'].includes(out.trust.state) || (out.trust.state === 'wrote' && out.trust.wrote === true);
  if (!ok) out.reason = `the profile does not trust the repository, and that trust was not carried over: ${out.trust.why || out.trust.state}`;
  return ok;
}

// The launch file: plain sh whatever the login shell is, every value one quoted word, the
// text first after `--` so a continuation aimux makes onto another profile drops it rather
// than sending it twice. A launch starts at the repository's root and has Claude Code make
// the worktree (`--worktree`); a resume starts inside the worktree it had, which Claude Code
// re-enters from there.
function launchFile(dir, at, place, session, resume, profile) {
  const textFile = join(dir, resume ? 'nudge.md' : 'order.md');
  writeFileSync(textFile, call.text, { mode: 0o600 });
  const lines = ['#!/bin/sh', `# ${call.title.replace(/[^\x20-\x7e]/g, '?')} — written by batch-launch.mjs`, `cd ${q(at)} || exit 1`];
  // The configuration it runs under, said rather than inherited from whatever agterm's own
  // environment carries: this session's for a plain claude; for aimux's source profile, its
  // directory where that is not the default, since aimux sets none for it.
  if (call.mode === 'agterm') {
    lines.push(process.env.CLAUDE_CONFIG_DIR ? `CLAUDE_CONFIG_DIR=${q(place.configDir)}; export CLAUDE_CONFIG_DIR` : 'unset CLAUDE_CONFIG_DIR');
  } else if (place.prof.source && !sameDir(place.configDir, defaultDir())) {
    lines.push(`CLAUDE_CONFIG_DIR=${q(place.configDir)}; export CLAUDE_CONFIG_DIR`);
  }
  const tail = [...(resume ? ['--resume', q(session)] : ['--worktree', q(call.slug), '--session-id', q(session)]),
    '--model', q(settings.model.value), '--effort', q(settings.effort.value), '-n', q(call.title)].join(' ');
  // The file removes its own directory once it has read the text, and nothing else removes
  // it while the session starts: a launch file gone before the shell reached it starts nothing.
  lines.push(`t=$(cat ${q(textFile)}) || exit 1`, `rm -rf ${q(dir)}`);
  const text = '"$t"';
  lines.push(call.mode === 'agterm-aimux'
    ? `exec ${q(answer.aimux.path)} run ${q(profile)} -- ${text} ${tail}`
    : `exec ${q(answer.claude)} ${text} ${tail}`);
  const file = join(dir, 'launch.sh');
  writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o700 });
  return file;
}

// Opens the session beside this one and waits for its transcript to be written: a session
// past every dialog that could hold it has written one, and a resumed one writes to the
// transcript it had.
function open(out, at, place, session, resume) {
  let dir = null;
  let file;
  try {
    dir = mkdtempSync(join(os.tmpdir(), 'hcb-batch-'));
    file = launchFile(dir, at, place, session, resume, out.profile.value);
  } catch (e) {
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* left */ } }
    out.reason = `the launch file could not be written (${e.code || e.message})`;
    return;
  }
  const shell = answer.shell.path;
  if (!commandSafe(shell) || !commandSafe(file)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* left */ }
    out.reason = 'the login shell or the launch file sits on a path agterm\'s command line cannot carry';
    return;
  }
  out.launchDir = dir;
  const ag = agterm(agtermCli, answer.agterm.socket);
  // The sessions standing where this one is opened, before it is: a lost answer is never
  // read off one of them.
  const placed = (s) => s.cwd !== null && sameDir(s.cwd, at);
  const prior = ag.filter(placed, answer.agterm.window);
  // The transcript as it stands just before the session opens — every configuration here,
  // since a resume under another profile writes wherever that one keeps its projects.
  const dirs = configDirs();
  const before = new Map(transcripts(session, dirs).copies.map((c) => [c.real, c]));
  const made = ag.call(['session', 'new', '--after', answer.agterm.session, '--no-select', '--wait',
    '--cwd', at, '--name', call.title, '--command', `'${shell}' -l -c 'exec /bin/sh "${file}"'`]);
  out.ran.push(`agtermctl session new --after ${answer.agterm.session} --no-select --wait --cwd ${at} --name <title> --command '<login shell>' -l -c 'exec /bin/sh "<launch file>"'`);
  if (!made.ok) {
    // An answer lost on the way is no session refused: the tree says whether one opened. It
    // is the one running this launch — the launch file in its arguments, the session id once
    // claude runs. While the login shell is still in its profile it carries neither, and may
    // show as a bare shell under any title its profile set: then it is the one session
    // standing where this one was opened that was not there before — under this launch's
    // title where several are. agterm's directory for a session is the one it was opened in,
    // never where its claude went. A reading in part settles nothing past the launch's own.
    const carried = (s) => s.argv.some((w) => w.includes(file)) || carriesArgv(s.argv, session);
    const older = new Set(prior.hits.map((e) => e.session.id));
    const look = ag.filter((s) => carried(s) || (placed(s) && !older.has(s.id)), answer.agterm.window);
    const strong = look.hits.filter((e) => carried(e.session));
    const fresh = prior.read && look.read ? look.hits.filter((e) => !carried(e.session)) : [];
    const titled = fresh.filter((e) => e.session.name === call.title);
    const hit = strong.length ? strong[0] : fresh.length === 1 ? fresh[0] : titled.length === 1 ? titled[0] : null;
    if (prior.read && look.read && !look.hits.length) {
      try { rmSync(dir, { recursive: true, force: true }); out.launchDir = null; } catch { /* left */ }
      out.reason = `agterm opened no session: ${made.why}`;
      return;
    }
    out.agterm = { session: hit ? hit.session.id : null, window: hit ? hit.window : null, wrote: null };
    out.started = null;
    out.reason = `agterm's answer did not read (${made.why}), and ${hit ? 'a session this launch opened stands in its tree'
      : fresh.length > 1 ? 'several new sessions stand where it was opened'
        : `the tree did not read whole: ${look.why || prior.why}`} — read it before anything else is launched`;
    return;
  }
  out.agterm = { session: text(made.result && made.result.id) || null, window: answer.agterm.window, wrote: Boolean(made.result && made.result.id) };
  out.started = null;
  const moved = (c) => { const b = before.get(c.real); return !b || b.size !== c.size || b.mtimeMs !== c.mtimeMs; };
  // Started takes both: a transcript written since, and the launch file read — its directory
  // gone — or, where it stayed, a process carrying the session.
  for (let i = 0; i <= call.wait; i += 1) {
    const t = transcripts(session, dirs).copies.find(moved);
    if (t && (!existsSync(dir) || running(session) === true)) { out.transcript = shown(t); out.started = true; break; }
    if (i < call.wait) sleep(1000);
  }
  if (out.started === true) {
    try { rmSync(dir, { recursive: true, force: true }); out.launchDir = null; } catch { /* left for the reader */ }
  } else out.reason = `no transcript written within ${call.wait} s — read the session's screen (agtermctl session text) for what holds it`;
}

const record = (out, wt) => ({ mode: call.mode, profile: out.profile.value, session: out.session,
  agterm: out.agterm && out.agterm.session, window: out.agterm && out.agterm.window, worktree: wt,
  model: settings.model.value, effort: settings.effort.value, at: new Date().toISOString() });

async function launch() {
  const out = { read: false, started: false, dryRun: Boolean(opts['--dry-run']), batch: call.batch, title: call.title,
    mode: call.mode, profile: null, model: settings.model, effort: settings.effort, session: null,
    worktree: null, trust: null, agterm: null, transcript: null, launchDir: null, record: null,
    load: answer.load, limits: null, ran: answer.ran, reason: null, notes: answer.notes };
  if (answer.load.holds) { out.reason = `the machine's load holds the launch: ${answer.load.avg5} over five minutes on ${answer.load.cores} cores`; done(out); }
  const tree = batchTree();
  if (tree.why) { out.reason = tree.why; done(out); }
  const { root, wt } = tree;
  out.worktree = { path: wt, confirmed: null };
  // Claude Code makes the worktree as the session starts, on the branch `worktree-<name>`,
  // cut with `-B` — over whatever branch of that name stands. What stands at the path or
  // under the name is a batch launched before, or what one left; so is a claude of this
  // repository still starting one. Each is checked and relaunched, never launched over.
  const branch = `worktree-${call.slug}`;
  if (!refNameOk(branch)) { out.reason = `${branch} is no name git takes for a branch: the batch's identifier cannot name its worktree`; done(out); }
  // Claude Code's own bound on a worktree's name.
  if (call.slug.length > 64) { out.reason = `${call.slug} is longer than the 64 characters Claude Code takes for a worktree's name`; done(out); }
  // Read again just before the session opens: the way can take a while to settle.
  const standing = () => {
    const over = ' — a batch launched before is checked and relaunched, never launched over';
    const listed = batchTree();
    if (listed.why) return listed.why;
    // The path itself, a link included: one pointing nowhere still stands there.
    let there;
    try { lstatSync(wt); there = true; } catch (e) {
      if (e.code !== 'ENOENT') return `${wt} could not be looked at (${e.code}), so whether something stands there is unknown`;
      there = false;
    }
    if (listed.known && (listed.known.prunable || !there)) return `git lists ${wt} as a worktree whose directory is gone — prune it first`;
    if (listed.known) return `${wt} stands already, a worktree${over}`;
    if (there) return `${wt} stands already, something git does not list as a worktree${over}`;
    const heads = git(['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`]);
    if (!heads.ok) return `whether a branch ${branch} stands did not read (${heads.line()})`;
    if (heads.out !== '') return `a branch ${branch} stands already, which --worktree would cut again over its commits${over}`;
    const starting = processes([word('--worktree', call.slug), word('-w', call.slug)]);
    if (starting === null) return 'the process table did not read, so whether a claude is making this worktree already is unknown';
    // Another repository's batch may carry the same name: a process counts where it stands
    // where this one's would — at the root it starts in, or in the worktree it makes — or
    // where its directory could not be read.
    const here = [...starting].filter((p) => { const d = cwdOf(p); return d === null || sameDir(d, root) || within(real(d, d), real(wt, wt)); });
    return here.length ? `a claude making ${wt} runs already (pid ${here.join(', ')})${over}` : null;
  };
  const stands = standing();
  if (stands) { out.reason = stands; done(out); }
  const refused = await settleWay(out.dryRun);
  out.limits = answer.limits;
  if (refused) { out.reason = `${call.mode} does not answer: ${refused}`; done(out); }
  const place = placement(out);
  if (place.why) { out.reason = place.why; done(out); }
  if (!trust(out, place.prof, root, out.dryRun)) done(out);
  out.session = randomUUID();
  if (out.dryRun) { out.read = true; done(out); }
  const still = standing();
  if (still) { out.reason = still; done(out); }
  open(out, root, place, out.session, false);
  if (out.started === true) {
    // Where the session's claude stands, by the registry: a `WorktreeCreate` hook can put the
    // worktree elsewhere, where `check`, `relaunch` and `close` do not follow it.
    out.worktree.confirmed = standsIn(out.session, wt).at;
    if (out.worktree.confirmed === false) out.reason = `the session's claude does not stand in ${wt}, the one place check, relaunch and close read the batch at — the user settles it before the batch is relied on`;
  }
  if (out.agterm) out.record = record(out, wt);
  out.read = true;
  done(out);
}

// What `inspect` fills in, before it has read anything.
const inspected = () => ({ live: null, running: null, worktree: null, transcript: null, stalled: null, agterm: null,
  relaunchable: false, leftover: false, reason: null });

function inspect(out) {
  const tree = batchTree();
  if (tree.why) { out.reason = tree.why; return null; }
  const { wt, known } = tree;
  out.root = tree.root;
  out.worktree = { path: wt, exists: existsSync(wt), registered: Boolean(known) && !known.prunable };
  const who = occupancy(wt);
  out.live = who.occupied;
  if (who.why) out.notes.push(who.why);
  out.running = running(call.session);
  const found = transcripts(call.session, configDirs());
  const t = found.copies.length ? found.copies[0] : null;
  // Not found where a projects directory would not read is unknown, not absent.
  out.transcript = t ? { found: true, ...shown(t) } : { found: found.unread ? null : false, path: null, size: null, lastWrite: null };
  if (found.unread) out.notes.push(found.unread);
  if (t && answer.aimux.core) {
    const hit = (() => { try { return core.sessionQuotaHit ? core.sessionQuotaHit(t.path) : undefined; } catch { return undefined; } })();
    out.stalled = hit === undefined ? 'unread' : hit === null ? null : { window: text(hit.rateLimitType) || null,
      resetsAt: Number.isFinite(hit.resetsAt) ? new Date(hit.resetsAt).toISOString() : null,
      at: Number.isFinite(hit.at) ? new Date(hit.at).toISOString() : null };
  } else out.stalled = t ? 'unread' : null;
  if (call.agterm) {
    if (!answer.agterm.answers) out.agterm = { read: false, why: answer.agterm.why };
    else {
      const f = agterm(agtermCli, answer.agterm.socket).find(call.agterm, answer.agterm.window);
      out.agterm = f.read ? { read: true, present: f.found, session: call.agterm, window: f.found ? f.window : null,
        cwd: f.found ? f.session.cwd : null, status: f.found ? f.session.status : null,
        // A bare shell agterm restored: its claude is gone, its place stays — for `close` to
        // clear before anything starts there again. `null` where agterm could not read what
        // runs there, which a pane held open after claude exited reads as too.
        idle: f.found ? (f.session.program ? false : f.session.shell ? true : null) : null } : { read: false, why: f.why };
    }
  }
  // Absence only where every reading answered: an unread registry or tree is not a
  // session gone, and resuming one still running puts two processes on one transcript.
  const gone = out.live === false && out.running === false && out.worktree.exists && out.worktree.registered
    && (!call.agterm || (out.agterm.read === true && out.agterm.present === false));
  out.relaunchable = gone && out.transcript.found === true;
  // A worktree nobody stands in, for a session that never wrote a word, as Claude Code made
  // it — clean, on its own branch, holding no commit no other branch has: what a start that
  // never reached its first prompt left. `null` where git did not answer.
  out.leftover = false;
  if (gone && out.transcript.found === false) {
    const g = runner(wt, 'git');
    const head = g(['symbolic-ref', '-q', 'HEAD']);
    const dirty = g(['status', '--porcelain']);
    // `--exclude` before `--branches` takes the name without `refs/heads/`.
    const own = g(['rev-list', '--count', 'HEAD', '--not', `--exclude=worktree-${call.slug}`, '--branches', '--remotes']);
    // A worktree nested inside it goes with it on removal, whatever stands in that one.
    const nested = tree.trees.some((t) => t.path !== known.path && within(real(t.path, t.path), real(wt, wt)));
    out.leftover = !dirty.ok || !own.ok || (!head.ok && head.code !== 1) ? null
      : head.out === `refs/heads/worktree-${call.slug}` && dirty.out === '' && own.out === '0' && !nested;
  }
  return wt;
}

async function check() {
  const out = { read: false, batch: call.batch, session: call.session, ...inspected(), notes: answer.notes };
  inspect(out);
  out.read = out.reason === null;
  done(out);
}

async function relaunch() {
  const out = { read: false, started: false, batch: call.batch, title: call.title, mode: call.mode, profile: null,
    model: settings.model, effort: settings.effort, session: call.session, check: null, trust: null, agterm: null,
    transcript: null, launchDir: null, record: null, ran: answer.ran, reason: null, notes: answer.notes };
  if (answer.load.holds) { out.reason = `the machine's load holds the start: ${answer.load.avg5} over five minutes on ${answer.load.cores} cores`; done(out); }
  const seen = { ...inspected(), notes: [] };
  const wt = inspect(seen);
  out.check = seen;
  if (!wt || !seen.relaunchable) { out.reason = seen.reason || 'check does not find it relaunchable — something may still hold it, or a reading did not answer'; done(out); }
  const refused = await settleWay(false);
  if (refused) { out.reason = `${call.mode} does not answer: ${refused}`; done(out); }
  const place = placement(out);
  if (place.why) { out.reason = place.why; done(out); }
  // `claude --resume` looks only where its own configuration keeps its projects: a profile
  // whose `projects` is not the directory holding the transcript would find no session.
  const copies = transcripts(call.session, configDirs()).copies;
  const sees = (dir) => { const p = real(join(dir, 'projects'), null); return p !== null && copies.some((c) => within(c.real, p)); };
  if (!sees(place.configDir)) {
    const holders = answer.aimux.profiles.filter((p) => p.configDir && sees(p.configDir)).map((p) => `'${p.profile}'`);
    out.reason = `${out.profile.value ? `'${out.profile.value}'` : 'this session\'s configuration'} cannot see the session's transcript — its projects directory is not the one holding it`
      + `${holders.length ? `; ${holders.join(', ')} can` : ''}. Resume where the transcript is, or share the projects directory across profiles (aimux migrate share-projects)`;
    done(out);
  }
  if (!trust(out, place.prof, seen.root, false)) done(out);
  open(out, wt, place, call.session, true);
  if (out.agterm) out.record = record(out, wt);
  out.read = true;
  done(out);
}

async function close() {
  const out = { read: false, closed: false, dryRun: Boolean(opts['--dry-run']), batch: call.batch, session: call.session,
    agterm: call.agterm, worktree: null, seen: null, ran: [], reason: null };
  if (!answer.agterm.answers) { out.reason = `agterm does not answer from here: ${answer.agterm.why}`; done(out); }
  const tree = batchTree();
  if (tree.why) { out.reason = tree.why; done(out); }
  const { wt, known } = tree;
  out.worktree = wt;
  const ag = agterm(agtermCli, answer.agterm.socket);
  const f = ag.find(call.agterm, answer.agterm.window);
  if (!f.read) { out.reason = `where the session stands is unread: ${f.why}`; done(out); }
  if (!f.found) { out.reason = 'agterm\'s tree holds no such session'; out.read = true; done(out); }
  // The arguments carry the order's text, and the name is whatever the session titled
  // itself: both are matched here and never printed.
  const { argv, name, ...seen } = f.session;
  out.seen = seen;
  // Closing somebody else's session is worse than leaving this one open. A bare shell —
  // agterm restored it, claude gone — carries no id, so its place says whose it is: the
  // batch's worktree, where a relaunch opens it, or the repository's root, where every
  // launch opens one — there under a name whose address is this batch's.
  const at = f.session.cwd ? real(f.session.cwd, f.session.cwd) : null;
  // The address leads a title, behind nothing but the status mark a host puts first.
  const address = new RegExp(`^[^\\p{L}\\p{N}]*${call.batch.replace(/[.]/g, '\\.')} — `, 'u');
  const rootShell = !f.session.program && f.session.shell && at !== null && sameDir(at, tree.root) && address.test(name || '');
  // A directory git no longer lists is no batch's: whatever stands in it is not this one.
  if (!known && !rootShell) { out.reason = 'git registers no worktree at the batch\'s path'; done(out); }
  if (f.session.asking) { out.reason = 'the session holds a question open for the user'; done(out); }
  if (f.session.status === 'blocked') { out.reason = 'the session is waiting on the user'; done(out); }
  if (f.session.split) { out.reason = 'the session holds a second pane, which closing it would close too'; done(out); }
  if (f.session.program) {
    // A program is the batch's where its arguments carry the batch's session id and the
    // claude carrying it stands in the batch's worktree — agterm's own directory for the
    // session is the one it was opened in, not where claude went.
    if (!carriesArgv(argv, call.session)) { out.reason = 'the session runs something that does not carry the batch\'s session id'; done(out); }
    const there = standsIn(call.session, wt);
    if (there.at !== true) {
      out.reason = there.at === false ? 'the batch\'s claude does not stand in the batch\'s worktree' : `where the batch's claude stands is unread: ${there.why}`;
      done(out);
    }
  } else if (!f.session.shell) {
    out.reason = 'agterm could not read what runs in the session — a pane held open after claude exited reads so too: closing it is the user\'s';
    done(out);
  } else if (!rootShell && !(at !== null && within(at, real(wt, wt)))) {
    out.reason = `the bare shell stands in ${f.session.cwd || 'no directory agterm names'} — neither the batch's worktree nor the repository's root under the batch's name`;
    done(out);
  }
  if (out.dryRun) { out.read = true; done(out); }
  const r = ag.call(['session', 'close', '--target', call.agterm, '--window', f.window]);
  out.ran.push(`agtermctl session close --target ${call.agterm} --window ${f.window}`);
  if (!r.ok) { out.reason = `agterm did not close it: ${r.why}`; done(out); }
  const after = ag.find(call.agterm, f.window);
  out.closed = after.read ? !after.found : null;
  out.read = true;
  done(out);
}

await ({ launch, check, relaunch, close })[sub]();
