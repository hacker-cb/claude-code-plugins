#!/usr/bin/env node
// batch-launch.mjs — can this master session start a batch session itself, and with what;
// then starting it, checking on it, starting it again, and closing it. Prints JSON.
//
// `probe` answers whether a terminal session in agterm can be started from here, and what
// the batch would run at and under. It decides nothing about chips or a pasted order:
// those are the host's tools and the user's hands, and the agent knows its own tools.
// `launch` starts one batch in its own agterm session, beside this one: claude started at
// the repository's root with `--worktree`, so Claude Code makes the batch's worktree itself,
// the order as the session's first prompt, a session id chosen here — through a launcher
// and with environment variables where the call names them.
// `check` says whether that session is alive; `relaunch` resumes one `check` found gone;
// `close` ends one whose work was accepted.
//
// Usage: node batch-launch.mjs probe [<settings>] [<way>]
//        node batch-launch.mjs launch --batch <epic>/<id> --mode agterm
//             [<settings>] [<way>] [--wait <s>] [--dry-run]  < the order
//        node batch-launch.mjs check --batch <epic>/<id> --session <uuid> [--agterm <id>]
//        node batch-launch.mjs relaunch --batch <epic>/<id> --session <uuid> --agterm <id> --title <title>
//             --mode agterm [<settings>] [<way>] [--wait <s>]  < the nudge
//        node batch-launch.mjs close --batch <epic>/<id> --session <uuid> --agterm <id> [--dry-run]
//   <settings>: --model-config <v> --effort-config <v> --batches-max <v>  (the plugin's
//               settings line), --model <m> --effort <e>  (the user's word)
//   <way>:      --launcher '<command>'  a command that starts claude, claude's own arguments
//                                       after it
//               --env NAME=VALUE        exported before it starts, as often as needed;
//                                       CLAUDE_CONFIG_DIR is the configuration it runs under
//
// Exit 0 whenever an answer is printed, `"read": false` with a `reason` included. Exit 2
// only for a call this script cannot act on at all.

import { accessSync, constants, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refNameOk, runner, text, within, worktrees, writeAll } from './lib/forge.mjs';
import { agterm, interpreterOn, loginEnv, loginShell, onPath, real, sleep } from './lib/launch-env.mjs';
import { configFile, mirrorTrust } from './lib/claude-trust.mjs';

const USAGE = `usage: node batch-launch.mjs probe|launch|check|relaunch|close <flags> — see the header\n`;
const die = (m) => { writeAll(2, `batch-launch: ${m}\n${USAGE}`); process.exit(2); };

// --- the call
const [sub, ...argv] = process.argv.slice(2);
const SETTINGS = ['--model-config', '--effort-config', '--batches-max', '--model', '--effort'];
const WAY = ['--launcher', '--env'];
const FLAGS = {
  probe: { valued: [...SETTINGS, ...WAY], boolean: [] },
  launch: { valued: [...SETTINGS, ...WAY, '--batch', '--mode', '--wait'], boolean: ['--dry-run'] },
  check: { valued: ['--batch', '--session', '--agterm', '--env'], boolean: [] },
  relaunch: { valued: [...SETTINGS, ...WAY, '--batch', '--session', '--agterm', '--title', '--mode', '--wait'], boolean: [] },
  close: { valued: ['--batch', '--session', '--agterm', '--env'], boolean: ['--dry-run'] },
};
// Flags a call may repeat; each keeps every value, in order.
const REPEATED = new Set(['--env']);
if (!FLAGS[sub]) die(sub ? `unknown subcommand '${sub}'` : 'a subcommand is required');
const VALUED = new Set(FLAGS[sub].valued);
const BOOLEAN = new Set(FLAGS[sub].boolean);
const opts = {};
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (BOOLEAN.has(a)) { opts[a] = true; continue; }
  if (!VALUED.has(a)) die(`unknown argument '${a}'`);
  // A flag in a value's place is a value left out, never a value: `--launcher --dry-run`
  // would otherwise launch for real.
  if (argv[i + 1] === undefined || VALUED.has(argv[i + 1]) || BOOLEAN.has(argv[i + 1])) die(`${a} needs a value`);
  if (REPEATED.has(a)) (opts[a] ||= []).push(argv[i += 1]);
  else opts[a] = argv[i += 1];
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

// What travels on to `claude --model` as one quoted word: an alias, an id, a provider's
// `region.vendor.model:version`, a Vertex `model@date`, a Bedrock ARN.
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]*$/;

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
function whole(key, config) {
  const s = setting(key, undefined, config);
  if (s.value === null) return { value: null, from: s.from };
  const n = Number(s.value);
  const lo = Number.isFinite(s.spec.min) ? s.spec.min : 1;
  const hi = Number.isFinite(s.spec.max) ? s.spec.max : Infinity;
  if (!Number.isInteger(n) || n < lo || n > hi) die(`${key} '${s.value}' (${s.from}) is not a whole number from ${lo} to ${hi}`);
  return { value: n, from: s.from };
}
const settings = {
  model: choice('batch_model', opts['--model'], opts['--model-config'], MODEL),
  effort: choice('batch_effort', opts['--effort'], opts['--effort-config']),
  batchesMax: whole('batches_max', opts['--batches-max']),
};

// --- the way: a launcher in claude's place, and the environment it starts in
// Every launcher word travels as one quoted word, so what a quote, an expansion or a
// control character would do to it in sh never applies — those are refused outright.
const WORD_OK = (w) => w !== '' && !/['"$`\\\u0000-\u001f\u007f]/.test(w);
const way = { launcher: null, env: [], configDir: null };
if (opts['--launcher'] !== undefined) {
  const words = opts['--launcher'].trim().split(/\s+/).filter(Boolean);
  if (!words.length) die('--launcher names no command');
  const bad = words.find((w) => !WORD_OK(w));
  if (bad !== undefined) die(`--launcher word '${bad}' carries a quote, \`$\`, a backslash or a control character`);
  way.launcher = words;
}
// A Map, never an object: a later `NAME=` replaces an earlier one, and `constructor` is a name.
const envs = new Map();
for (const pair of opts['--env'] || []) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(pair);
  if (!m) die(`--env '${text(pair)}' is not NAME=VALUE`);
  if (/[\u0000-\u001f\u007f]/.test(m[2])) die(`--env ${m[1]} carries a control character`);
  envs.set(m[1], m[2]);
}
way.env = [...envs].map(([name, value]) => ({ name, value }));
// CLAUDE_CONFIG_DIR is the configuration the batch runs under, which check, relaunch and
// close read it back from; absolute, since the batch starts in another directory.
if (envs.has('CLAUDE_CONFIG_DIR')) {
  const d = envs.get('CLAUDE_CONFIG_DIR');
  if (!isAbsolute(d)) die(`--env CLAUDE_CONFIG_DIR '${text(d)}' is not an absolute path`);
  way.configDir = resolve(d);
}

// --- what launch, check, relaunch and close are handed, checked before anything runs
// No `-` inside either part: the worktree joins the two with one, and `a-b/c` would meet `a/b-c` there.
const BATCH = /^([A-Za-z0-9][A-Za-z0-9._]*)\/([A-Za-z0-9][A-Za-z0-9._]*)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const call = { batch: null, slug: null, mode: null, session: null, agterm: null, title: null,
  text: null, wait: 90 };
if (sub !== 'probe') {
  const b = BATCH.exec(opts['--batch'] || '');
  if (!b) die('--batch is <epic>/<id>, each part letters, digits, `.` or `_`');
  call.batch = opts['--batch'];
  // The name the launch hands `--worktree`, and so the worktree's directory under
  // `.claude/worktrees/`: a batch's worktree leads with its batch's identifier.
  call.slug = `${b[1]}-${b[2]}`;
}
if (sub === 'launch' || sub === 'relaunch') {
  if (opts['--mode'] !== 'agterm') die('--mode is agterm');
  call.mode = opts['--mode'];
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
  // A lone lowercase word is what claude, or a launcher before it, reads as a subcommand.
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
if (sub === 'close' || sub === 'relaunch' || (sub === 'check' && opts['--agterm'] !== undefined)) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(opts['--agterm'] || '')) die('--agterm is the agterm session id the launch recorded');
  call.agterm = opts['--agterm'];
}
if (call.title && /[\u0000-\u001f\u007f]/.test(call.title)) die('the title carries a control character');

// --- the answer
// Absolute, since the batch starts in another directory than this session stands in.
const ownDir = () => (process.env.CLAUDE_CONFIG_DIR ? resolve(process.env.CLAUDE_CONFIG_DIR) : join(os.homedir(), '.claude'));
const defaultDir = () => join(os.homedir(), '.claude');
const answer = {
  read: false,
  mode: null,
  modes: [],
  agterm: { answers: false, socket: null, version: null, session: null, window: null, workspace: null, why: null },
  shell: { path: null, from: null, account: null, read: false, why: null },
  claude: null,
  launcher: way.launcher ? { words: way.launcher, path: null, why: null } : null,
  // By name: the values travel once, in a launch's record, which a relaunch passes again.
  env: way.env.map((e) => e.name),
  configDir: way.configDir || ownDir(),
  settings,
  load: null,
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
  }
}

// --- the launcher: a path as given, a name where the login PATH finds it, and the
// interpreter its `#!` line names
if (answer.launcher) {
  const [head] = way.launcher;
  if (isAbsolute(head)) {
    let ok = false;
    try { ok = statSync(head).isFile(); accessSync(head, constants.X_OK); } catch { ok = false; }
    answer.launcher.path = ok ? head : null;
    if (!ok) answer.launcher.why = `the launcher ${head} is no executable file`;
  } else if (head.includes('/')) {
    answer.launcher.why = `the launcher ${head} is a relative path, which would be read from the batch's directory`;
  } else if (!login) {
    answer.launcher.why = answer.shell.why;
  } else {
    answer.launcher.path = onPath(head, login.PATH);
    if (!answer.launcher.path) answer.launcher.why = `the launcher ${head} is not on the login shell's PATH`;
  }
  if (answer.launcher.path) {
    const starts = interpreterOn(answer.launcher.path, login && login.PATH);
    if (starts.found === false) answer.launcher.why = `the launcher's interpreter, ${starts.name}, is not on the login shell's PATH`;
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

// --- the mode; it answers where nothing stands against it
// What it needs: this session's own place in agterm, and claude on the login PATH — a
// launcher starts claude from there too — and the launcher, where one is named.
const claudeStarts = answer.claude ? interpreterOn(answer.claude, login && login.PATH) : null;
const runnable = !answer.agterm.answers ? answer.agterm.why
  : answer.claude === null ? (answer.shell.read ? 'claude is not on the login shell\'s PATH' : answer.shell.why)
    : claudeStarts && claudeStarts.found === false ? `claude's interpreter, ${claudeStarts.name}, is not on the login shell's PATH`
      : answer.launcher && answer.launcher.why ? answer.launcher.why : null;
answer.modes = [{ mode: 'agterm', answers: runnable === null, why: runnable }];
answer.mode = runnable === null ? 'agterm' : null;



// --- launch, check, relaunch, close

const done = (obj) => { writeAll(1, `${JSON.stringify(obj, null, 2)}\n`); process.exit(0); };
// One shell word, whatever it holds.
const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
// What agterm's `--command` tokenizer and the quotes around the shell and the launch file
// would read as more than one path.
const commandSafe = (v) => typeof v === 'string' && v !== '' && !/['"$`\\\n\r]/.test(v);
const git = runner(process.cwd(), 'git');
const sameDir = (a, b) => real(a, a) === real(b, b);
// Every configuration a batch's session may stand under here: this session's own, the
// default, and the one the call names for the batch.
const configDirs = () => [...new Set([ownDir(), defaultDir(), answer.configDir])];

// The sessions running in the repository's worktrees now — a batch's, whichever way it was
// launched, or anyone's: each is a session beside this one — counted under every configuration
// here, the worktree this session stands in aside. `running` is null, with `why`, where a
// registry did not read: a count taken from part of them would let a launch past the limit.
function liveBatches() {
  const max = settings.batchesMax.value;
  const listed = worktrees(git);
  if (listed.trees === null) return { max, running: null, live: [], why: `the worktree list did not read (${listed.error})` };
  const primary = listed.trees.find((t) => t.isPrimary);
  if (!primary) return { max, running: null, live: [], why: 'git listed no main working tree' };
  const home = join(primary.path, '.claude', 'worktrees');
  const under = real(home, home);
  const top = git(['rev-parse', '--show-toplevel']);
  const self = top.ok ? real(top.out, top.out) : null;
  const seen = owners();
  const live = [];
  let why = null;
  for (const t of listed.trees) {
    const at = real(t.path, t.path);
    if (dirname(at) !== under || at === self) continue;
    const who = occupancy(t.path, seen);
    if (who.occupied === true) live.push(basename(at));
    else if (who.occupied === null) why = who.why || `whether a session stands in ${basename(at)} did not read`;
  }
  return { max, running: why ? null : live.length, live, why };
}

// Whether one more session has room now; null where it has, the reason where not.
function full(out) {
  out.batches = liveBatches();
  if (out.batches.running === null) return `how many sessions run in this repository's worktrees did not read: ${out.batches.why}`;
  if (out.batches.running < out.batches.max) return null;
  return `${out.batches.running} session(s) run in this repository's worktrees already (${out.batches.live.join(', ')}), and batches_max is ${out.batches.max}`;
}

if (sub === 'probe') { answer.batches = liveBatches(); answer.read = true; finish(); }

// The repository's main tree, its worktrees, and the batch's own place among them.
function batchTree() {
  const listed = worktrees(git);
  if (listed.trees === null) return { why: `the worktree list did not read (${listed.error})` };
  const primary = listed.trees.find((t) => t.isPrimary);
  if (!primary) return { why: 'git listed no main working tree' };
  const wt = join(primary.path, '.claude', 'worktrees', call.slug);
  return { root: primary.path, wt, trees: listed.trees, known: listed.trees.find((t) => real(t.path, t.path) === real(wt, wt)) || null, why: null };
}

// Who stands in each worktree of the repository, from the one reader of the session registry
// this plugin has — asked once of every registry a configuration here keeps, since a batch
// under another configuration registers under that one's. Keyed by a worktree's real path;
// `unread` is a registry that did not read, which leaves every worktree unknown.
function owners() {
  const script = fileURLToPath(new URL('./worktree-owners.mjs', import.meta.url));
  const seen = new Set();
  const byPath = new Map();
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
    for (const w of doc.worktrees || []) {
      const key = real(w.path, w.path);
      const e = byPath.get(key) || { occupied: false, unknown: null, pids: new Set() };
      if (w.occupied === true) e.occupied = true;
      else if (w.occupied === null) e.unknown = `the session registry under ${dir} did not read`;
      // A record whose liveness could not be told proves nobody is there.
      for (const r of w.sessions || []) if (r && r.live === true && Number.isInteger(r.pid)) e.pids.add(r.pid);
      byPath.set(key, e);
    }
  }
  return { byPath, unread };
}

// Who stands in one worktree, read off `owners()`. `pids` are the live sessions found there.
function occupancy(path, seen = owners()) {
  const e = seen.byPath.get(real(path, path));
  const why = seen.unread || e?.unknown || null;
  return { occupied: e?.occupied ? true : why ? null : false, pids: e?.pids ?? new Set(), why };
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
// terminal, another directory, under another configuration. `ps` joins a process's arguments
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
// however many paths lead to it — one configuration's `projects` may be a link to another's,
// where the same file answers under each configuration's path — so files and
// directories are told apart by where they resolve, never by how they are spelled. `via`
// is every configuration that reaches the copy, whichever link — the whole `projects`, one
// project's directory, the file itself — leads there: the ones whose claude can resume it.
function transcripts(session, dirs) {
  const roots = new Map();
  for (const dir of dirs) {
    if (!dir) continue;
    const root = join(dir, 'projects');
    const key = real(root, root);
    if (roots.has(key)) roots.get(key).under.push(dir);
    else roots.set(key, { root, under: [dir] });
  }
  const files = new Map();
  let unread = null;
  for (const { root, under } of roots.values()) {
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
        const had = files.get(id);
        if (had) { for (const d of under) had.via.add(d); continue; }
        files.set(id, { path: f, real: id, size: st.size, mtimeMs: st.mtimeMs, via: new Set(under) });
      } catch (e) {
        if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') unread = `${f} did not read (${e.code})`;
      }
    }
  }
  return { copies: [...files.values()], unread };
}
// The copy the session wrote last: copies kept apart, one per configuration, go stale where
// the session moved on under another.
const latest = (copies) => copies.reduce((a, c) => (a && a.mtimeMs >= c.mtimeMs ? a : c), null);
const shown = (c) => ({ path: c.path, size: c.size, lastWrite: new Date(c.mtimeMs).toISOString() });

// The configuration the batch runs under: the one the call names, this session's otherwise.
function placement(out) {
  out.configDir = answer.configDir;
  return { configDir: answer.configDir };
}

// The trust this session's configuration gives the repository, carried into the one the
// batch runs under where the call names another — by the file its claude will read: a
// CLAUDE_CONFIG_DIR the launch exports is read as given, the default where none is set.
function trust(out, root, dryRun) {
  if (!way.configDir) return true;
  out.trust = mirrorTrust({ from: configFile(process.env.CLAUDE_CONFIG_DIR ? ownDir() : null),
    into: configFile(way.configDir), root, dryRun });
  const ok = ['held', 'shared', 'would-write'].includes(out.trust.state) || (out.trust.state === 'wrote' && out.trust.wrote === true);
  if (!ok) out.reason = `the batch's configuration does not trust the repository, and that trust was not carried over: ${out.trust.why || out.trust.state}`;
  return ok;
}

// The launch file: plain sh whatever the login shell is, every value one quoted word, the
// text first after the command. A launch starts at the repository's root and has Claude
// Code make the worktree (`--worktree`); a resume starts inside the worktree it had, which
// Claude Code re-enters from there.
function launchFile(dir, at, place, session, resume) {
  const textFile = join(dir, resume ? 'nudge.md' : 'order.md');
  writeFileSync(textFile, call.text, { mode: 0o600 });
  const lines = ['#!/bin/sh', `# ${call.title.replace(/[^\x20-\x7e]/g, '?')} — written by batch-launch.mjs`, `cd ${q(at)} || exit 1`];
  // The configuration it runs under, said rather than inherited from whatever agterm's own
  // environment carries: the one the call names, this session's otherwise.
  lines.push(way.configDir || process.env.CLAUDE_CONFIG_DIR ? `CLAUDE_CONFIG_DIR=${q(place.configDir)}; export CLAUDE_CONFIG_DIR` : 'unset CLAUDE_CONFIG_DIR');
  for (const e of way.env) if (e.name !== 'CLAUDE_CONFIG_DIR') lines.push(`${e.name}=${q(e.value)}; export ${e.name}`);
  const tail = [...(resume ? ['--resume', q(session)] : ['--worktree', q(call.slug), '--session-id', q(session)]),
    '--model', q(settings.model.value), '--effort', q(settings.effort.value), '-n', q(call.title)].join(' ');
  // The file removes its own directory once it has read the text, and nothing else removes
  // it while the session starts: a launch file gone before the shell reached it starts nothing.
  lines.push(`t=$(cat ${q(textFile)}) || exit 1`, `rm -rf ${q(dir)}`);
  const command = way.launcher ? [answer.launcher.path, ...way.launcher.slice(1)] : [answer.claude];
  lines.push(`exec ${command.map(q).join(' ')} "$t" ${tail}`);
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
    file = launchFile(dir, at, place, session, resume);
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
  // since a resume under another configuration writes wherever that one keeps its projects.
  const dirs = configDirs();
  const snapshot = transcripts(session, dirs);
  const before = new Map(snapshot.copies.map((c) => [c.real, c]));
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
  // A copy the snapshot did not hold is new only where the snapshot read whole — or where the
  // session id is a launch's own, which nothing wrote before.
  const moved = (c) => {
    const b = before.get(c.real);
    return b ? b.size !== c.size || b.mtimeMs !== c.mtimeMs : !resume || !snapshot.unread;
  };
  // Started takes both: a transcript written since, and the launch file read — its directory
  // gone. Another process writing the same transcript proves nothing about this one.
  for (let i = 0; i <= call.wait; i += 1) {
    const t = transcripts(session, dirs).copies.find(moved);
    if (t && !existsSync(dir)) { out.transcript = shown(t); out.started = true; break; }
    if (i < call.wait) sleep(1000);
  }
  if (!existsSync(dir)) out.launchDir = null;
  if (out.started !== true) out.reason = `no transcript written within ${call.wait} s — read the session's screen (agtermctl session text) for what holds it`;
}

// The way travels as the flags a relaunch passes again: the launcher as one string, each
// variable as `NAME=VALUE`.
const record = (out, wt) => ({ mode: call.mode, launcher: way.launcher ? way.launcher.join(' ') : null,
  env: way.env.map((e) => `${e.name}=${e.value}`), configDir: out.configDir, session: out.session,
  agterm: out.agterm && out.agterm.session, window: out.agterm && out.agterm.window, worktree: wt,
  model: settings.model.value, effort: settings.effort.value, at: new Date().toISOString() });

async function launch() {
  const out = { read: false, started: false, dryRun: Boolean(opts['--dry-run']), batch: call.batch, title: call.title,
    mode: call.mode, launcher: answer.launcher, env: answer.env, configDir: null, model: settings.model,
    effort: settings.effort, session: null, worktree: null, trust: null, agterm: null, transcript: null,
    launchDir: null, record: null, load: answer.load, ran: [], reason: null, notes: answer.notes };
  if (answer.load.holds) { out.reason = `the machine's load holds the launch: ${answer.load.avg5} over five minutes on ${answer.load.cores} cores`; done(out); }
  // No more sessions in the repository's worktrees than batches_max, however each was started.
  const crowded = full(out);
  if (crowded) { out.reason = crowded; done(out); }
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
  if (runnable) { out.reason = `${call.mode} does not answer: ${runnable}`; done(out); }
  const place = placement(out);
  if (!trust(out, root, out.dryRun)) done(out);
  out.session = randomUUID();
  if (out.dryRun) { out.read = true; done(out); }
  const still = standing() || full(out);
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
const inspected = () => ({ live: null, running: null, worktree: null, transcript: null, agterm: null,
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
  // Where a projects directory would not read, the latest copy may be the one it holds: the
  // transcript is unknown, found or not.
  const t = found.unread ? null : latest(found.copies);
  out.transcript = t ? { found: true, ...shown(t) } : { found: found.unread ? null : false, path: null, size: null, lastWrite: null };
  // The configurations whose claude reaches that copy — the ones a relaunch can resume it under.
  out.transcript.under = t ? configDirs().filter((d) => t.via.has(d)) : null;
  if (found.unread) out.notes.push(found.unread);
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
  const out = { read: false, started: false, batch: call.batch, title: call.title, mode: call.mode,
    launcher: answer.launcher, env: answer.env, configDir: null, model: settings.model, effort: settings.effort,
    session: call.session, check: null, trust: null, agterm: null, transcript: null, launchDir: null, record: null,
    ran: [], reason: null, notes: answer.notes };
  if (answer.load.holds) { out.reason = `the machine's load holds the start: ${answer.load.avg5} over five minutes on ${answer.load.cores} cores`; done(out); }
  // A resumed session takes the room a new one would: the one it replaces is gone.
  const crowded = full(out);
  if (crowded) { out.reason = crowded; done(out); }
  const seen = { ...inspected(), notes: [] };
  const wt = inspect(seen);
  out.check = seen;
  if (!wt || !seen.relaunchable) { out.reason = seen.reason || 'check does not find it relaunchable — something may still hold it, or a reading did not answer'; done(out); }
  if (runnable) { out.reason = `${call.mode} does not answer: ${runnable}`; done(out); }
  const place = placement(out);
  // `claude --resume` looks only where its own configuration keeps its projects: one that
  // does not reach the copy the session wrote last would find no session, or a stale one.
  const found = transcripts(call.session, configDirs());
  const last = latest(found.copies);
  if (!(last && last.via.has(place.configDir))) {
    const who = way.configDir ? `the configuration ${way.configDir}` : 'this session\'s configuration';
    const holders = last ? configDirs().filter((d) => last.via.has(d)) : [];
    // A projects directory that did not read may be the one holding it: unknown, not unseen.
    out.reason = found.unread ? `whether ${who} reaches the session's transcript is unread: ${found.unread}`
      : `${who} cannot see the session's transcript — its projects directory is not the one holding it`
        + `${holders.length ? `; ${holders.join(', ')} can — relaunch with --env CLAUDE_CONFIG_DIR=<that one>` : ''}`;
    done(out);
  }
  if (!trust(out, seen.root, false)) done(out);
  const late = full(out);
  if (late) { out.reason = late; done(out); }
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
