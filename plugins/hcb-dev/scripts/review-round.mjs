#!/usr/bin/env node
// review-round.mjs — the one writer of a review round's work directory. Prints JSON.
//
// A round is where finders, an engine and a verifier meet without handing what they
// found through anybody's words: each submits its answer here, the script checks it
// against schemas/*.json and stores it, and the next step reads the store. A findings
// pass uses the same directory with candidates and a verifier but no finders
// (`--mode pass`). Nothing here judges a finding — grouping is the caller's decision,
// a verdict is the verifier's; this script holds them to their shapes and keeps them.
//
// Usage:
//   node review-round.mjs init --mode round --base <ref> [--rung medium|high]
//                              [--sources <list>] [--language <tag>] [--narrow <text>]
//                              [--codex-model <slug>] [--codex-effort <level>]
//   node review-round.mjs init --mode pass [--tree worktree|<ref>] [--language <tag>]
//   node review-round.mjs plan    --round <id> [--depth]
//   node review-round.mjs brief   --round <id> --task <task>
//   node review-round.mjs diff    --round <id> [--file <path>]
//   node review-round.mjs add     --round <id> --source <source> [--task <task>] [--file <json>]
//   node review-round.mjs codex   --round <id> [--timeout-s <n>]
//   node review-round.mjs status  --round <id> --task <task> [--state partial|unavailable]
//                                 [--model <model>] [--note <text>]
//   node review-round.mjs merge   --round <id> [--task <task>]
//   node review-round.mjs units   --round <id> [--append] [--file <json>]
//   node review-round.mjs queue   --round <id> [--append] [--budget <n>]
//   node review-round.mjs task    --round <id> --unit <unit>
//   node review-round.mjs verdict --round <id> --unit <unit> [--file <json>]
//   node review-round.mjs wait    --round <id> --for tasks|verdicts [--expect <list>] [--timeout-s <n>]
//                                 (verdicts: the groups the latest queue call queued, unless named)
//   node review-round.mjs result  --round <id>
//
// The JSON `add`, `units` and `verdict` take arrives on stdin, or from `--file`. `diff`
// prints the change itself, as git wrote it; everything else prints JSON.
// Exit: 0 answered; 1 a submission refused, the errors saying what to fix; 2 called
// wrong; 3 the round or the repository could not be read.

import {
  closeSync, existsSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync,
  readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { text, writeAll } from './lib/forge.mjs';
import { schemaDir, validate } from './lib/schema.mjs';

const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = schemaDir(path.join(PLUGIN, 'schemas'));

const USAGE = 'usage: node review-round.mjs <init|plan|brief|diff|add|codex|status|merge|units|queue|task|verdict|wait|result> [flags]'
  + ' — see the header of this file\n';
const die = (m) => { writeAll(2, `review-round: ${m}\n${USAGE}`); process.exit(2); };
const answer = (obj, code = 0) => { writeAll(1, `${JSON.stringify(obj, null, 2)}\n`); process.exit(code); };
const cannot = (reason) => answer({ read: false, reason }, 3);
const refuse = (errors, extra = {}) => answer({ accepted: false, errors, ...extra }, 1);

const SPEC = {
  init: ['--mode', '--base', '--tree', '--rung', '--sources', '--language', '--narrow', '--codex-model', '--codex-effort'],
  plan: ['--round', '--depth'],
  brief: ['--round', '--task'],
  diff: ['--round', '--file'],
  add: ['--round', '--source', '--task', '--file'],
  codex: ['--round', '--timeout-s'],
  status: ['--round', '--task', '--state', '--model', '--note'],
  merge: ['--round', '--task'],
  units: ['--round', '--file', '--append'],
  queue: ['--round', '--budget', '--append'],
  task: ['--round', '--unit'],
  verdict: ['--round', '--unit', '--file'],
  wait: ['--round', '--for', '--expect', '--timeout-s'],
  result: ['--round'],
};
const [cmd, ...argv] = process.argv.slice(2);
if (!cmd || !SPEC[cmd]) die(cmd ? `unknown subcommand '${cmd}'` : 'a subcommand is required');
// A switch is answered by being there, and takes no value.
const SWITCHES = new Set(['--depth', '--append']);
const opts = {};
for (let i = 0; i < argv.length; i += 1) {
  if (!SPEC[cmd].includes(argv[i])) die(`${cmd} takes no argument '${argv[i]}'`);
  if (SWITCHES.has(argv[i])) { opts[argv[i]] = true; continue; }
  if (argv[i + 1] === undefined) die(`${argv[i]} needs a value`);
  // An empty one would fall back — to the working tree, to no budget, to English — and
  // the fallback answers as though it had been asked for.
  if (argv[i + 1] === '') die(`${argv[i]} was given an empty value — give it one, or drop the flag`);
  opts[argv[i]] = argv[i + 1];
  i += 1;
}

// Short ids, never paths, travel between the session and the agents: a model copying a
// long temp path shortens it, and a shortened path is a relative one that lands inside
// whatever directory the agent stands in — the repository under review.
const ROUND_ID = /^r-[0-9a-f]{8}$/;
const TASK_ID = /^[a-z][a-z0-9-]{0,39}$/;
const SOURCE_ID = /^[a-z][a-z0-9:-]{0,39}$/;
const UNIT_ID = /^U[1-9][0-9]{0,4}$/;
const RANK = { Critical: 0, Important: 1, Minor: 2 };
// Coverage states, the worst first: a source is as covered as its least covered task.
const STATE_ORDER = ['unavailable', 'partial', 'depth', 'nothing', 'covered', 'n/a'];
const worse = (a, b) => (STATE_ORDER.indexOf(a) <= STATE_ORDER.indexOf(b) ? a : b);
const SOURCES = load('review-angles.json').$defs.task.properties.source.enum;
const ROUND_DAYS = 7; // a round's store outlives its report by a week, then goes
const WAIT_CAP_S = 540; // under the Bash tool's 10-minute ceiling, so one window is one call
// The Codex pass: how long its catalog may take, how long a pass asked to stop has before it
// is killed, how long past both its lock still holds, and how much of the diff travels in its
// prompt — a share of the model's window, or a fixed budget where the catalog gives none.
const CATALOG_MS = 60_000;
const TERM_GRACE_MS = 10_000;
const LOCK_GRACE_MS = 60_000;
const INLINE_SHARE = 0.25;
const INLINE_KB = 256;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

// A revision git is to read — a branch, a tag, a sha, `HEAD~1` — held only to never
// reading as an option; whether it names anything is git's to say where it is resolved.
const revOk = (v) => typeof v === 'string' && v !== '' && !v.startsWith('-') && !/[\u0000-\u001f\u007f]/.test(v);
const real = (p) => { try { return realpathSync(p); } catch { return null; } };
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
// Written beside the target and renamed over it: a reader of the store — `wait`, a second
// checker, `result` — sees the old file or the new one, never a truncated half.
const tmpBeside = (file, data) => {
  const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  return tmp;
};
const writeJson = (file, data) => renameSync(tmpBeside(file, data), file);
// The same write, except that it claims a name nobody holds: `link` fails where the
// target exists, so two writers racing for one name cannot both believe they took it.
const claimJson = (file, data) => {
  const tmp = tmpBeside(file, data);
  try {
    linkSync(tmp, file);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    return false;
  } finally {
    unlinkSync(tmp);
  }
  return true;
};
const roundsRoot = () => {
  const base = real(process.env.TMPDIR || tmpdir());
  return base && path.join(base, 'hcb-review');
};
// A shared temp directory lets anyone create this path first — a link to somewhere of
// theirs, or a directory everybody can write — and a round's diff is the whole change
// under review. Only a real directory of this user's, closed to others, holds rounds.
function checkRoot(root) {
  let st;
  try { st = lstatSync(root); } catch (e) { cannot(`the rounds directory ${root} cannot be read: ${e.code || e.message}`); }
  if (st.isSymbolicLink() || !st.isDirectory()) cannot(`${root} is not a directory of its own — it may be a link someone else put there`);
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) cannot(`${root} belongs to another user`);
  if ((st.mode & 0o077) !== 0) cannot(`${root} is open to others — a round's diff, its candidates and its evidence are in there`);
}

// Raw output, not trimmed: a line count taken after a trim is short by the blank lines
// the trim ate, and an anchor on the last line of such a file would read as outside it.
const gitIn = (cwd) => (args, input) => {
  const r = spawnSync('git', args, {
    cwd,
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // A clean filter of the checkout's own — git-lfs, a normalizer — runs inside
    // `hash-object`, and one that hangs would hold the whole round with it.
    timeout: 120_000,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C', GIT_OPTIONAL_LOCKS: '0' },
  });
  return { ok: r.status === 0, code: r.status, out: r.stdout || '', err: (r.stderr || '').trim() };
};

// The checkout under review, and the directories nothing of a round may live in.
function repository() {
  const here = gitIn(process.cwd());
  const top = here(['rev-parse', '--show-toplevel']);
  if (!top.ok) cannot('not inside a git working tree — there is no tree to review');
  const dir = real(top.out.trim());
  const git = gitIn(dir);
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const own = git(['rev-parse', '--absolute-git-dir']);
  if (!common.ok || !own.ok) cannot(`the git directories of ${dir} could not be resolved`);
  return { top: dir, git, guarded: [dir, real(common.out.trim()), real(own.out.trim())].filter(Boolean) };
}

function openRound() {
  const id = opts['--round'];
  if (!id) die('--round is required');
  if (!ROUND_ID.test(id)) die(`--round '${id}' is not a round id — pass the id init printed, never a path`);
  const root = roundsRoot();
  const dir = root && path.join(root, id);
  if (!dir || !existsSync(path.join(dir, 'request.json'))) {
    cannot(`there is no round '${id}' under ${root} — pass the id init printed`);
  }
  checkRoot(root);
  return { id, dir, req: readJson(path.join(dir, 'request.json')) };
}

// A round belongs to the checkout that opened it: its blobs and anchors describe that
// tree, and read against another one they would describe a change nobody made.
function checkoutOf(round) {
  const repo = repository();
  if (repo.top !== round.req.top) {
    cannot(`round ${round.id} was opened for ${round.req.top}, and this runs in ${repo.top}`);
  }
  return repo;
}

function submission() {
  let raw;
  try {
    raw = opts['--file'] ? readFileSync(opts['--file'], 'utf8') : readFileSync(0, 'utf8');
  } catch (e) {
    refuse([{ at: '', message: `the submission could not be read: ${e.message}` }]);
  }
  if (!raw.trim()) refuse([{ at: '', message: 'the submission is empty — pass the JSON on stdin or with --file' }]);
  try {
    return JSON.parse(raw);
  } catch (e) {
    return refuse([{ at: '', message: `the submission is not JSON: ${e.message}` }]);
  }
}

const relOk = (p) => typeof p === 'string' && p !== '' && !path.isAbsolute(p)
  && !p.includes('\0') && !p.split(/[\\/]/).includes('..');
// A path git's line-based batches read as itself: they split on newlines, unquote a line
// opening with `"` and strip a trailing CR. Any other path is asked about alone.
const batchable = (p) => !/^"|\n|\r$/.test(p);
const lineCount = (text) => {
  if (text === '') return 0;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
};

// A path as git quotes it where it carries a tab, a quote, a backslash or a control
// character: C escapes, octal for raw bytes.
const unquote = (s) => {
  if (!s.startsWith('"') || !s.endsWith('"')) return s;
  const bytes = [];
  const named = { n: 10, t: 9, '"': 34, '\\': 92, a: 7, b: 8, f: 12, r: 13, v: 11 };
  // By code point: a character outside the BMP is two UTF-16 units, and encoding each
  // alone would turn it into two replacement characters.
  const chars = [...s.slice(1, -1)];
  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] !== '\\') { bytes.push(...Buffer.from(chars[i], 'utf8')); continue; }
    const n = chars[i + 1];
    if (Object.hasOwn(named, n)) { bytes.push(named[n]); i += 1; } else if (/[0-7]/.test(n)) {
      bytes.push(parseInt(chars.slice(i + 1, i + 4).join(''), 8)); i += 3;
    } else bytes.push(92);
  }
  return Buffer.from(bytes).toString('utf8');
};

// The change split per file, each chunk with the path it lands at, the one it left
// where it moved, and its line counts. The paths are read from the lines git writes for
// them — `---`/`+++`, `rename`/`copy` — and from the header only where neither exists
// (a binary or mode-only change), where the two halves of `a/P b/P` are the same path.
function diffChunks(text) {
  // Line starts by hand: `^` under the `m` flag also matches after a lone \r, U+2028 and
  // U+2029, which a changed line may carry in its content.
  const starts = [];
  for (let at = 0; at !== -1 && at < text.length; at = text.indexOf('\n', at) + 1 || -1) {
    if (text.startsWith('diff --git ', at)) starts.push(at);
  }
  return starts.map((at, i) => {
    const body = text.slice(at, i + 1 < starts.length ? starts[i + 1] : text.length);
    let a; let b; let added = 0; let removed = 0; let hunk = false;
    // Git ends a `---`/`+++` line with a TAB where an unquoted path holds a space.
    const side = (token, prefix) => {
      const t = unquote(token.replace(/\t$/, ''));
      if (t === '/dev/null') return null;
      return t.startsWith(prefix) ? t.slice(prefix.length) : t;
    };
    for (const line of body.split('\n')) {
      if (line.startsWith('@@')) { hunk = true; continue; }
      if (hunk) {
        if (line.startsWith('+')) added += 1;
        else if (line.startsWith('-')) removed += 1;
        continue;
      }
      if (line.startsWith('--- ')) a = side(line.slice(4), 'a/');
      else if (line.startsWith('+++ ')) b = side(line.slice(4), 'b/');
      else if (/^(rename|copy) from /.test(line)) a = unquote(line.replace(/^(rename|copy) from /, ''));
      else if (/^(rename|copy) to /.test(line)) b = unquote(line.replace(/^(rename|copy) to /, ''));
    }
    if (a === undefined && b === undefined) {
      const head = body.slice(0, body.indexOf('\n')).slice('diff --git '.length);
      const half = (head.length - 1) / 2;
      const left = head.slice(0, half);
      const right = head.slice(half + 1);
      const pa = side(left, 'a/');
      const pb = side(right, 'b/');
      if (pa === pb) { a = pa; b = pb; }
    }
    const to = b ?? a ?? null;
    return { path: to, from: a && b && a !== b ? a : null, added, removed, text: body };
  });
}

// Many objects in one git process: `<rev>:<path>` per line in, the blob id of each out.
// A path carrying a newline cannot travel on that protocol, and is left unanswered.
function blobsAt(repo, rev, paths) {
  const out = new Map();
  const wanted = [...new Set(paths)].filter((p) => relOk(p));
  const plain = wanted.filter(batchable);
  if (plain.length) {
    const r = repo.git(['cat-file', '--batch-check=%(objectname) %(objecttype)'], `${plain.map((p) => `${rev}:${p}`).join('\n')}\n`);
    const lines = r.out.split('\n');
    plain.forEach((p, i) => {
      // An answer is `<oid> <type>` exactly; a missing one repeats its question, whose
      // path may hold any word — `blob` among them.
      const m = /^([0-9a-f]{40,64}) blob$/.exec(lines[i] || '');
      if (m) out.set(p, m[1]);
    });
  }
  for (const p of wanted.filter((x) => !batchable(x))) {
    const r = repo.git(['rev-parse', '--verify', '-q', `${rev}:${p}`]);
    const oid = r.out.trim();
    if (r.ok && repo.git(['cat-file', '-t', oid]).out.trim() === 'blob') out.set(p, oid);
  }
  return out;
}

// The angle catalog ships with the plugin and is read on every plan and brief; a
// malformed one is a broken plugin, said as such rather than planned around.
function catalog() {
  const file = path.join(PLUGIN, 'data', 'review-angles.json');
  let c;
  try { c = readJson(file); } catch (e) { cannot(`the angle catalog ${file} cannot be read: ${e.message}`); }
  const bad = validate(load, 'review-angles.json', null, c).map((e) => `${e.at || '/'} ${e.message}`);
  if (!bad.length) {
    // What the schema cannot say: a task's id is a task id, and every task a rung names exists.
    for (const id of Object.keys(c.tasks)) if (!TASK_ID.test(id)) bad.push(`task id '${id}'`);
    for (const [name, r] of Object.entries(c.rungs)) {
      for (const id of [...r.tasks, ...(r.sweep ? [r.sweep] : [])]) if (!Object.hasOwn(c.tasks, id)) bad.push(`${name}: no task '${id}'`);
      // A rung runs one Codex pass at most, and says how: its level, its limit, its watchdog.
      const passes = r.tasks.filter((id) => c.tasks[id]?.kind === 'codex');
      if (passes.length > 1) bad.push(`${name}: more than one codex task`);
      if (passes.length && !r.codex) bad.push(`${name}: a codex task and no codex settings`);
      if (r.sweep && c.tasks[r.sweep] && c.tasks[r.sweep].kind !== 'sweep') bad.push(`${name}: sweep '${r.sweep}' is not of kind sweep`);
    }
  }
  if (bad.length) cannot(`the angle catalog ${file} is malformed: ${bad.join('; ')}`);
  return c;
}
// The sources whose one task is the Codex pass: in a round, only the pass hands in for them.
const passSources = () => new Set(Object.values(catalog().tasks).filter((t) => t.kind === 'codex').map((t) => t.source));

const planFile = (round) => path.join(round.dir, 'plan.json');
const planOf = (round) => (existsSync(planFile(round)) ? readJson(planFile(round)) : null);
const plannedTasks = (plan) => (plan ? [...plan.tasks, ...(plan.sweep ? [plan.sweep] : [])] : []);

// Which tree a side names. In a round, `head` is the working tree the diff was taken
// from and `base` the merge base; in a pass there is one tree, the one the caller named.
function treeOf(req, side) {
  if (req.mode === 'round') return side === 'base' ? { ref: req.base.merge_base } : { worktree: true };
  if (side === 'base') return { none: 'a pass reads one tree, and a base-side coordinate has no tree in it' };
  return req.tree.kind === 'ref' ? { ref: req.tree.sha } : { worktree: true };
}

function readAt(repo, req, file, side) {
  if (!relOk(file)) return { missing: `'${file}' is not a path relative to the repository root` };
  const tree = treeOf(req, side);
  if (tree.none) return { missing: tree.none };
  // `cat-file blob`, never `show`: a path in a tree can name a directory, and `show`
  // would print its listing as though it were the file's lines.
  if (tree.ref) {
    const r = repo.git(['cat-file', 'blob', `${tree.ref}:${file}`]);
    return r.ok ? { text: r.out } : { missing: `${file} is not a file in ${tree.ref.slice(0, 7)}` };
  }
  const abs = path.join(repo.top, file);
  // A symlink is one line of link text to git, and the file it points at is another file
  // with lines of its own: an anchor read through it would be counted against those.
  let link = null;
  try { link = lstatSync(abs).isSymbolicLink(); } catch { link = null; }
  const resolved = link ? real(path.dirname(abs)) : real(abs);
  if (!resolved || !inside(resolved, repo.top)) return { missing: `${file} is not in the working tree` };
  if (!link && !statSync(resolved).isFile()) return { missing: `${file} is not a file` };
  // A round reviews tracked files: an untracked or ignored one is outside every diff.
  if (req.mode === 'round' && repo.git(['--literal-pathspecs', 'ls-files', '-z', '--', file]).out === '') {
    return { missing: `${file} is not tracked — a round reviews tracked files only` };
  }
  return { text: link ? readlinkSync(abs) : readFileSync(resolved, 'utf8') };
}

// One process per call answers each (side, path) once: a file several verdicts read is
// hashed once, not once per verdict.
const blobMemo = new Map();
function blobAt(repo, req, file, side) {
  const key = `${side}\0${file}`;
  if (!blobMemo.has(key)) blobMemo.set(key, blobOf(repo, req, file, side));
  return blobMemo.get(key);
}
function blobOf(repo, req, file, side) {
  if (!relOk(file)) return null;
  const tree = treeOf(req, side);
  if (tree.none) return null;
  if (tree.ref) return blobsAt(repo, tree.ref, [file]).get(file) ?? null;
  const abs = path.join(repo.top, file);
  // What git keeps for a symlink is the link's own text, and it keeps it for one that
  // dangles or points outside as readily — so the link is read before anything resolves
  // it, and it is the directory holding it that has to be inside the repository.
  let link = null;
  try { link = lstatSync(abs).isSymbolicLink(); } catch { link = null; }
  if (link) {
    const parent = real(path.dirname(abs));
    if (!parent || !inside(parent, repo.top)) return null;
    const r = repo.git(['hash-object', '--stdin'], readlinkSync(abs));
    return r.ok ? r.out.trim() : null;
  }
  const resolved = real(abs);
  if (!resolved || !inside(resolved, repo.top)) return null;
  const r = repo.git(['hash-object', '--', file]);
  return r.ok ? r.out.trim() : null;
}

const sourceFiles = (dir) => (existsSync(path.join(dir, 'sources'))
  ? readdirSync(path.join(dir, 'sources')).filter((f) => f.endsWith('.json') && !f.endsWith('.status.json')).sort()
  : []);
const statusOf = (dir, task) => {
  const f = path.join(dir, 'sources', `${task}.status.json`);
  return existsSync(f) ? readJson(f) : null;
};
// Every task's status, the ones `status` recorded for a task that never handed in among them.
const statuses = (dir) => (existsSync(path.join(dir, 'sources'))
  ? readdirSync(path.join(dir, 'sources')).filter((f) => f.endsWith('.status.json')).sort()
    .map((f) => readJson(path.join(dir, 'sources', f)))
  : []);
const verdictOf = (dir, unit) => {
  const f = path.join(dir, 'verdicts', `${unit}.json`);
  return existsSync(f) ? readJson(f) : null;
};

// ---------------------------------------------------------------------------------- init
function init() {
  const mode = opts['--mode'];
  if (mode !== 'round' && mode !== 'pass') die("--mode must be 'round' or 'pass'");
  if (mode === 'round' && !opts['--base']) die('--mode round needs --base, the ref the change is measured from');
  if (mode === 'round' && opts['--tree']) die('--tree belongs to --mode pass; a round reads the working tree');
  if (mode === 'pass' && (opts['--base'] || opts['--rung'] || opts['--sources'])) {
    die('--base, --rung and --sources belong to --mode round');
  }
  if (opts['--base'] && !revOk(opts['--base'])) die(`--base '${opts['--base']}' reads as an option, or carries a control character`);
  const rung = mode === 'round' ? (opts['--rung'] || 'medium') : null;
  if (rung && rung !== 'medium' && rung !== 'high') die("--rung must be 'medium' or 'high'");
  const sources = mode === 'round' ? (opts['--sources'] || '').split(',').filter(Boolean) : [];
  for (const s of sources) if (!SOURCES.includes(s)) die(`--sources: '${s}' is not one of ${SOURCES.join(', ')}`);
  const codexModel = opts['--codex-model'];
  const codexEffort = opts['--codex-effort'];
  const passes = passSources();
  if ((codexModel !== undefined || codexEffort !== undefined) && !sources.some((x) => passes.has(x))) {
    die('--codex-model and --codex-effort belong to a round with codex among its --sources');
  }
  if (codexModel !== undefined && !MODEL_ID.test(codexModel)) die(`--codex-model '${codexModel}' is not a model name`);
  if (codexEffort !== undefined && !/^[a-z]{1,20}$/.test(codexEffort)) die(`--codex-effort '${codexEffort}' is not a level`);
  const language = opts['--language'] || 'en';
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language)) die(`--language '${language}' is not a language tag`);
  const narrow = opts['--narrow'] ?? null;
  if (narrow !== null && [...narrow].length > 500) die('--narrow is prose of a sentence or two, not a document');
  const treeArg = mode === 'pass' ? (opts['--tree'] || 'worktree') : null;
  if (treeArg && treeArg !== 'worktree' && !revOk(treeArg)) die(`--tree '${treeArg}' reads as an option, or carries a control character`);

  const repo = repository();
  const root = roundsRoot();
  if (!root) cannot('the temp directory does not resolve to a directory');
  for (const g of repo.guarded) {
    if (inside(root, g)) cannot(`TMPDIR is inside the repository under review (${g}) — a round kept there becomes part of the change it reviews`);
  }
  try {
    mkdirSync(root, { mode: 0o700 });
  } catch (e) {
    if (e.code !== 'EEXIST') cannot(`the rounds directory ${root} could not be created: ${e.code || e.message}`);
  }
  checkRoot(root);
  // A round's store holds a whole change and what was said of it; a week after it opened,
  // nothing reads it again, and it goes.
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || !ROUND_ID.test(e.name)) continue;
    let opened = null;
    try { opened = statSync(path.join(root, e.name, 'request.json')).mtimeMs; } catch { opened = null; }
    // A round that will not go stays: pruning never stops the next one from opening.
    if (opened !== null && Date.now() - opened > ROUND_DAYS * 86_400_000) {
      try { rmSync(path.join(root, e.name), { recursive: true, force: true }); } catch { /* left for a later init */ }
    }
  }
  const head = repo.git(['rev-parse', '--verify', '-q', 'HEAD^{commit}']);
  if (!head.ok) cannot('HEAD does not name a commit');
  const headSha = head.out.trim();
  // A round counts tracked changes only: an untracked file is outside every diff, and is
  // named below. A pass reads the working tree as it stands, untracked files included.
  const status = repo.git(['status', '--porcelain', `--untracked-files=${mode === 'pass' ? 'normal' : 'no'}`]);
  if (!status.ok) cannot(`git could not read the status of ${repo.top}: ${status.err}`);
  const dirty = status.out.trim() !== '';
  const snapshot = `${headSha.slice(0, 7)}${dirty ? '+wt' : ''}`;
  const id = `r-${randomBytes(4).toString('hex')}`;
  const dir = path.join(root, id);
  const warnings = [];
  const notes = [];
  let request;

  if (mode === 'round') {
    const mb = repo.git(['merge-base', opts['--base'], headSha]);
    if (!mb.ok) {
      cannot(mb.code === 1
        ? `${opts['--base']} shares no history with HEAD — it is not a base for this branch`
        : `${opts['--base']} is not a ref this checkout knows — refresh it or name another base`);
    }
    const mergeBase = mb.out.trim();
    // One listing carries every file's base-side blob; the head side is the working tree,
    // hashed in one more process. Colour, an external diff tool and quoted non-ASCII paths
    // are the user's configuration, and none of them may reach the text a finder reads.
    const listed = repo.git(['diff', '--raw', '-z', '--no-abbrev', mergeBase]);
    const diff = repo.git(['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--no-textconv',
      '--submodule=short', '--src-prefix=a/', '--dst-prefix=b/', mergeBase]);
    const untracked = repo.git(['ls-files', '--others', '--exclude-standard', '-z']);
    if (!listed.ok || !diff.ok || !untracked.ok) cannot(`git could not diff ${mergeBase.slice(0, 7)} against the working tree`);
    const tokens = listed.out.split('\0');
    const files = [];
    for (let i = 0; i < tokens.length && tokens[i].startsWith(':');) {
      const [, , srcBlob, , status] = tokens[i].slice(1).split(' ');
      const moved = /^[RC]/.test(status);
      const from = tokens[i + 1];
      const to = moved ? tokens[i + 2] : tokens[i + 1];
      i += moved ? 3 : 2;
      files.push({ path: to, from: moved ? from : undefined, status: status[0], blob_base: status[0] === 'A' ? null : srcBlob });
    }
    const heads = new Map();
    const regular = [];
    for (const f of files.filter((x) => x.status !== 'D')) {
      let st = null;
      try { st = lstatSync(path.join(repo.top, f.path)); } catch { st = null; }
      if (st?.isFile() && batchable(f.path)) regular.push(f.path);
      else if (st?.isFile() || st?.isSymbolicLink()) heads.set(f.path, blobAt(repo, { mode: 'round' }, f.path, 'head'));
    }
    const h = regular.length ? repo.git(['hash-object', '--stdin-paths'], `${regular.join('\n')}\n`) : null;
    // One file git could not hash fails the batch; each is then hashed alone, as it was.
    if (h?.ok) h.out.split('\n').slice(0, regular.length).forEach((oid, k) => heads.set(regular[k], oid));
    else for (const f of regular) heads.set(f, blobAt(repo, { mode: 'round' }, f, 'head'));
    const counts = new Map();
    for (const k of diffChunks(diff.out)) {
      const c = counts.get(k.path) || { added: 0, removed: 0 };
      counts.set(k.path, { added: c.added + k.added, removed: c.removed + k.removed });
    }
    for (const f of files) {
      f.blob_head = heads.get(f.path) ?? null;
      f.added = counts.get(f.path)?.added ?? null;
      f.removed = counts.get(f.path)?.removed ?? null;
    }
    const strays = untracked.out.split('\0').filter((t) => t !== '');
    if (strays.length) {
      warnings.push(`coverage-warning: ${strays.length} untracked path(s) are NOT reviewed — a diff does not show them; \`git add -N <path>\` puts one under review`);
    }
    if (mergeBase === headSha && !dirty) {
      warnings.push('coverage-warning: HEAD is at or behind the base and the working tree is clean — there is nothing to review');
    } else if (!files.length) {
      warnings.push('coverage-warning: the change touches no tracked file — there is nothing to review');
    } else if (mergeBase === headSha) {
      notes.push('HEAD is at the base: the change is the uncommitted edits alone');
    }
    mkdirSync(path.join(dir, 'sources'), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(dir, 'change.diff'), diff.out);
    request = {
      version: 1, round: id, mode, created_at: new Date().toISOString(), top: repo.top,
      base: { ref: opts['--base'], merge_base: mergeBase }, head: { sha: headSha, dirty },
      snapshot, rung, sources, language, narrow, files, untracked: strays, warnings, notes,
      ...(codexModel || codexEffort ? { codex: { model: codexModel ?? null, effort: codexEffort ?? null } } : {}),
    };
  } else {
    let tree = { kind: 'worktree', ref: null, sha: null };
    let passSnapshot = snapshot;
    if (treeArg !== 'worktree') {
      const r = repo.git(['rev-parse', '--verify', '-q', `${treeArg}^{commit}`]);
      if (!r.ok) cannot(`${treeArg} is not a commit this checkout knows — refresh it or name another tree`);
      tree = { kind: 'ref', ref: treeArg, sha: r.out.trim() };
      passSnapshot = tree.sha.slice(0, 7);
    }
    mkdirSync(path.join(dir, 'sources'), { recursive: true, mode: 0o700 });
    request = {
      version: 1, round: id, mode, created_at: new Date().toISOString(), top: repo.top,
      tree, head: { sha: headSha, dirty }, snapshot: passSnapshot, language, warnings, notes,
    };
  }
  writeJson(path.join(dir, 'request.json'), request);
  answer({
    read: true,
    round: id,
    mode,
    snapshot: request.snapshot,
    scope: mode === 'round' ? `${opts['--base']}, ${request.files.length} files` : `tree ${treeArg}`,
    files: mode === 'round' ? request.files.length : undefined,
    untracked: mode === 'round' ? request.untracked : undefined,
    warnings,
    notes,
  });
}

// ---------------------------------------------------------------------------------- plan
// The round's tasks, from the catalog: the rung's tasks of every source the round was
// opened for, and the sweep where the rung has one. Written once; asked again it answers
// the same plan, since a conductor that lost its context reads it back from here.
function plan() {
  const round = openRound();
  if (round.req.mode !== 'round') die('plan belongs to --mode round — a pass has no finders');
  const depth = opts['--depth'] === true;
  const prior = planOf(round);
  if (prior) {
    if (depth && !prior.depth) {
      refuse([{ at: '', message: `round ${round.id} is already planned for agents — say --depth on the first plan` }]);
    }
    answer({ read: true, round: round.id, ...prior });
  }
  const c = catalog();
  const rung = c.rungs[round.req.rung];
  const wanted = round.req.sources || [];
  if (!wanted.length) cannot(`round ${round.id} names no sources — open it with --sources`);
  const entry = (id) => ({
    task: id, source: c.tasks[id].source, kind: c.tasks[id].kind, category: c.tasks[id].category,
    limit: c.tasks[id].kind === 'codex' ? rung.codex.limit : rung.limit,
  });
  const tasks = rung.tasks.filter((id) => wanted.includes(c.tasks[id].source)).map(entry);
  // Without agents there are no checks, and the sweep only exists to follow them.
  const sweep = rung.sweep && !depth && wanted.includes(c.tasks[rung.sweep].source) ? entry(rung.sweep) : null;
  const notes = wanted.filter((src) => !tasks.some((t) => t.source === src))
    .map((src) => `the catalog holds no ${round.req.rung} task for source '${src}' — its coverage row reads unavailable`);
  const p = { rung: round.req.rung, depth, budget: rung.budget, tasks, sweep, notes, planned_at: new Date().toISOString() };
  writeJson(planFile(round), p);
  answer({ read: true, round: round.id, ...p });
}

// The rule files a repository writes for itself that can govern the changed paths: the
// CLAUDE.md at its root and in every directory above a changed file, and every file under
// .claude/rules — which paths each of those covers is its own header's to say.
function ruleFiles(repo, files) {
  const found = new Set();
  const within = (rel) => {
    const r = real(path.join(repo.top, rel));
    return r && inside(r, repo.top) ? r : null;
  };
  const keep = (rel) => {
    const r = within(rel);
    if (r && statSync(r).isFile()) found.add(rel);
  };
  // A link is followed where it stays inside the repository; a directory reached twice is
  // walked once.
  const seen = new Set();
  const walk = (rel) => {
    const r = within(rel);
    if (!r || seen.has(r) || !statSync(r).isDirectory()) return;
    seen.add(r);
    for (const name of readdirSync(r)) {
      const child = `${rel}/${name}`;
      const cr = within(child);
      if (!cr) continue;
      if (statSync(cr).isDirectory()) walk(child);
      else if (name.endsWith('.md')) keep(child);
    }
  };
  const dirs = new Set(['.']);
  // The directories a file lands in and, for a move, the ones it left: a rule there may
  // govern removing it as much as one here governs adding it.
  for (const f of files) {
    for (const at of [f.path, f.from].filter(Boolean)) {
      for (let dir = path.posix.dirname(at); dir !== '.' && dir !== '/'; dir = path.posix.dirname(dir)) dirs.add(dir);
    }
  }
  for (const dir of dirs) {
    const at = dir === '.' ? '' : `${dir}/`;
    keep(`${at}CLAUDE.md`);
    keep(`${at}.claude/CLAUDE.md`);
    walk(`${at}.claude/rules`);
  }
  // Tracked ones only, as the round's change is: a rule file nobody added is somebody's
  // own, and is handed to no finder and no engine. Each is asked of git by the path it
  // really has — a directory link walked to it is not in the index — spelled as the disk
  // spells it; the answer is matched in one Unicode form, git's on macOS being composed.
  const spelled = (abs) => { try { return realpathSync.native(abs); } catch { return null; } };
  const top = spelled(repo.top);
  const at = new Map([...found].map((rel) => {
    const r = spelled(path.join(repo.top, rel));
    return [rel, r && top ? path.relative(top, r) : null];
  }));
  const asked = [...new Set([...at.values()].filter(Boolean))];
  if (!asked.length) return [];
  const tracked = repo.git(['--literal-pathspecs', 'ls-files', '-z', '--', ...asked]);
  if (!tracked.ok) throw new Error(`git could not list the tracked rule files: ${tracked.err}`);
  const known = new Set(tracked.out.split('\0').filter(Boolean).map((f) => f.normalize('NFC')));
  return [...found].filter((rel) => known.has(at.get(rel)?.normalize('NFC'))).sort();
}

// What the first pass already holds, for the sweep to leave alone.
function listed(round) {
  const uf = path.join(round.dir, 'units.json');
  if (!existsSync(uf)) return [];
  return readJson(uf).units.map((u) => {
    const v = verdictOf(round.dir, u.unit);
    return { file: u.file, line: u.line, summary: u.summary, verified: v ? v.verdict : 'not measured' };
  });
}

// --------------------------------------------------------------------------------- brief
// All a finder is handed: its angle in the catalog's words, how many candidates it may
// hand in, the ground the change covers and how to read each side of it, and the one
// command that takes its answer. Never a path into the store: the round's id and the
// script's own subcommands reach all of it.
function brief() {
  const round = openRound();
  const p = planOf(round);
  if (!p) cannot(`round ${round.id} has no plan yet — run plan first`);
  const id = opts['--task'];
  if (!id || !TASK_ID.test(id)) die('--task is required: a task of the plan');
  const t = plannedTasks(p).find((x) => x.task === id);
  if (!t) cannot(`${id} is not a task of round ${round.id}'s plan`);
  if (t.kind === 'codex') die(`${id} is the Codex pass — the codex subcommand runs it; a brief is a finder's`);
  const spec = catalog().tasks[id];
  const { req } = round;
  const out = {
    round: round.id,
    task: id,
    source: t.source,
    language: req.language,
    angle: spec.text,
    category: t.category,
    limit: t.limit,
    scope: {
      base: req.base.ref,
      merge_base: req.base.merge_base,
      snapshot: req.snapshot,
      narrow: req.narrow,
      files: req.files.map((f) => ({
        path: f.path, from: f.from ?? null, status: f.status, added: f.added ?? null, removed: f.removed ?? null,
      })),
    },
    read: {
      diff: `review-round.mjs diff --round ${round.id}, or with --file <path> for one file of it`,
      head: 'the working tree as it stands — read the files directly',
      base: `git show ${req.base.merge_base}:<path> — the code as it was before the change`,
    },
    submit: `review-round.mjs add --round ${round.id} --source ${t.source} --task ${id}`,
  };
  if (spec.reads === 'rules') out.rules = ruleFiles(checkoutOf(round), req.files);
  if (spec.reads === 'listed') out.listed = listed(round);
  answer(out);
}

// ---------------------------------------------------------------------------------- diff
// The change as it stood when the round opened, whole or one file of it — read from the
// store rather than from git, so every finder reads the same change however long it takes.
function diff() {
  const round = openRound();
  if (round.req.mode !== 'round') die('diff belongs to --mode round — a pass has no change to show');
  const text = readFileSync(path.join(round.dir, 'change.diff'), 'utf8');
  const file = opts['--file'];
  if (file === undefined) { writeAll(1, text); process.exit(0); }
  // Every chunk of the path: a file turned into a link, or back, is a deletion and a creation.
  const chunks = diffChunks(text).filter((k) => k.path === file || k.from === file);
  if (!chunks.length) cannot(`${file} is not a file of round ${round.id}'s change`);
  writeAll(1, chunks.map((k) => k.text).join(''));
  process.exit(0);
}

// -------------------------------------------------------------------------------- status
// What the conductor records of a task whose agent did not answer as it should — never
// handed in, ran out of turns, could not run — and the model it ran on where that was not
// the one its definition names. Only a loss is recorded: a state never better than the
// one the store holds, so a finder that failed cannot be written up as one that covered.
function status() {
  const round = openRound();
  const id = opts['--task'];
  if (!id || !TASK_ID.test(id)) die('--task is required: a task id');
  const state = opts['--state'];
  if (state !== undefined && !['partial', 'unavailable'].includes(state)) die('--state records a loss: partial or unavailable');
  const model = opts['--model'];
  if (model !== undefined && !MODEL_ID.test(model)) die(`--model '${model}' is not a model name`);
  if (state === undefined && model === undefined) die('status records a --state, a --model, or both');
  const note = opts['--note'];
  if (note !== undefined && [...note].length > 500) die('--note is a sentence or two, not a document');
  const prior = statusOf(round.dir, id);
  const planned = plannedTasks(planOf(round)).find((x) => x.task === id);
  if (!prior && !planned) cannot(`${id} is neither planned nor submitted in round ${round.id}`);
  // A model alone is a fact about an answer: before one, it would record a loss nobody meant.
  if (!prior && state === undefined) cannot(`${id} has not answered yet — record its model once it has`);
  const at = new Date().toISOString();
  const base = prior || { task: id, source: planned.source, state: 'unavailable', candidates: 0, rejected: 0, notes: [] };
  const next = {
    ...base,
    state: state === undefined ? base.state : (prior ? worse(prior.state, state) : state),
    notes: [...(base.notes || []), ...(note ? [note] : [])],
    at,
  };
  if (model !== undefined) next.model = model;
  writeJson(path.join(round.dir, 'sources', `${id}.status.json`), next);
  answer({ accepted: true, task: id, source: next.source, state: next.state, model: next.model });
}

// ----------------------------------------------------------------------------------- add
function add() {
  const round = openRound();
  const source = opts['--source'];
  if (!source || !SOURCE_ID.test(source)) die('--source is required: lowercase letters, digits, ":" and "-"');
  const task = opts['--task'] || source.replace(/:/g, '-');
  if (!TASK_ID.test(task)) die(`--task '${task}' is not a task id: lowercase letters, digits and "-"`);
  const planned = admits(round, task, source);
  // In a round only the Codex pass hands in for Codex: anything else under its source
  // would be read as Codex's review of the change.
  if (round.req.mode === 'round' && passSources().has(source)) {
    refuse([{ at: '', message: `source '${source}' is the Codex pass — it hands in through the codex subcommand, never through add` }], { task });
  }
  const value = submission();
  answer({ accepted: true, task, source, ...store(round, task, source, value, planned) });
}

// Whether the round still takes an answer from this task, and the plan's entry for it.
function admits(round, task, source) {
  const p = planOf(round);
  const planned = plannedTasks(p).find((x) => x.task === task);
  if (planned && planned.source !== source) {
    refuse([{ at: '', message: `task '${task}' belongs to source '${planned.source}' in this round's plan, not to '${source}'` }], { task });
  }
  // A source the plan gave tasks hands in under those tasks: another name would escape the
  // limit its rung bought.
  if (!planned && plannedTasks(p).some((x) => x.source === source)) {
    refuse([{ at: '', message: `source '${source}' hands in under its planned tasks (${plannedTasks(p).filter((x) => x.source === source).map((x) => x.task).join(', ')}), not '${task}'` }], { task });
  }
  // Grouping closes collection: a candidate arriving after `units` would sit in no group,
  // and the result reads groups — it would vanish without anybody having dropped it. The
  // sweep is the one task that comes after the checks, and its groups are appended.
  if (existsSync(path.join(round.dir, 'units.json')) && !(p?.sweep && p.sweep.task === task)) {
    refuse([{ at: '', message: `round ${round.id} is already grouped — this submission came too late to be stored` }], { task });
  }
  // A task whose loss the conductor recorded, and a round whose result is built, are
  // closed: an answer arriving now would sit where no group and no result reads it.
  const recorded = statusOf(round.dir, task);
  if (recorded && !existsSync(path.join(round.dir, 'sources', `${task}.json`))) {
    refuse([{ at: '', message: `task '${task}' was recorded as ${recorded.state} — this submission came too late to be stored` }], { task });
  }
  if (existsSync(path.join(round.dir, 'result.json'))) {
    refuse([{ at: '', message: `round ${round.id} has its result — this submission came too late to be stored` }], { task });
  }
  // One task, one submission: a second under the same name would replace the first, and
  // the candidates it carried would leave the round without anybody having dropped them.
  if (existsSync(path.join(round.dir, 'sources', `${task}.json`))) {
    refuse([{ at: '', message: `task '${task}' already holds a submission — hand this carrier in under a --task of its own` }], { task });
  }
  return planned;
}

// A task's answer, checked and kept: the schema, the plan's limit, every anchor against the
// tree the round reads, then the submission and the task's status — both claimed, never
// written over. `extra` rides into the status: the model and level an engine ran at, the
// notes it earned on the way in, and each way it says it covered less than the change.
function store(round, task, source, value, planned, extra = {}, repo = checkoutOf(round)) {
  const errors = validate(load, 'candidates.json', null, value);
  if (errors.length) refuse(errors, { task });
  if (planned && value.candidates.length > planned.limit) {
    refuse([{ at: '/candidates', message: `holds ${value.candidates.length}, and task '${task}' takes at most ${planned.limit} — hand in the ${planned.limit} most severe` }], { task });
  }
  const kept = [];
  const rejected = [];
  const unreachable = [];
  // A path written from the checkout's root, or with a `./` in it, is the same file under
  // its plain relative name, whoever wrote it. And a finding a planned task hands in carries
  // no verdict of its own finder's: only a check that never saw its argument stands.
  const named = (c) => {
    const file = path.isAbsolute(c.file) && inside(c.file, repo.top) ? path.relative(repo.top, c.file) : path.posix.normalize(c.file);
    const { verdict, ...rest } = c;
    return { ...(planned ? rest : c), file: relOk(file) ? file : c.file };
  };
  value.candidates.map(named).forEach((c, i) => {
    const at = readAt(repo, round.req, c.file, c.side);
    const reason = at.missing
      || (c.line > lineCount(at.text) ? `${c.file} has ${lineCount(at.text)} line(s) on the ${c.side} side, and the anchor is line ${c.line}` : null);
    // In a round a coordinate the snapshot does not carry is a claim about some other
    // tree, and it leaves. In a pass it is only a tree this session cannot read: the
    // finding stays, marked, and is neither verified nor refuted here.
    if (reason && round.req.mode === 'round') { rejected.push({ index: i, file: c.file, line: c.line, reason }); return; }
    const stored = { id: `${task}.${kept.length + 1}`, source, ...c };
    if (reason) { stored.unreachable = reason; unreachable.push({ id: stored.id, reason }); }
    kept.push(stored);
  });
  const notes = [...(extra.notes || [])];
  let state = 'covered';
  if (round.req.mode === 'round' && rejected.length && !kept.length) {
    state = 'partial';
    notes.push('every anchor this source gave misses the snapshot — it reviewed something other than this change');
  } else if (rejected.length) {
    notes.push(`run-warning: ${rejected.length} candidate(s) anchored outside the snapshot were dropped`);
  }
  if (extra.less?.length) {
    state = 'partial';
    notes.push(...extra.less);
  }
  const claimed = claimJson(path.join(round.dir, 'sources', `${task}.json`), {
    task, source, submitted_at: new Date().toISOString(), candidates: kept, rejected,
  });
  if (!claimed) {
    refuse([{ at: '', message: `task '${task}' already holds a submission — hand this carrier in under a --task of its own` }], { task });
  }
  // Claimed, not written over: a loss the conductor recorded while this ran stands.
  claimJson(path.join(round.dir, 'sources', `${task}.status.json`), {
    task, source, state, candidates: kept.length, rejected: rejected.length, notes,
    ...(extra.model ? { model: extra.model } : {}), ...(extra.effort ? { effort: extra.effort } : {}),
    at: new Date().toISOString(),
  });
  return { stored: kept.length, rejected, unreachable, state, notes };
}

// --------------------------------------------------------------------------------- codex
// Codex as one source of a round. Its model and that model's ladder come from Codex's own
// catalog, never from memory; the level from the rung, unless the round was opened with a
// model or a level of its own. The change travels on stdin with all the pass needs — a
// path to it, the probe showed, lets a low level answer without reading anything — and the
// answer comes back in a strict schema derived from the candidates' own. A watchdog ends the
// process whatever happens, and the task gets a status either way; what Codex hands in meets
// the same checks a finder's does, one candidate at a time.
function codexSchema(limit) {
  const cand = load('candidates.json').$defs.candidate;
  const fields = Object.keys(cand.properties).filter((k) => k !== 'verdict');
  // Types and enums only: a string's length is said in the prompt and checked per
  // candidate on the way in, where one that runs long costs that candidate alone.
  const plain = (spec) => (spec.enum ? { type: spec.type, enum: spec.enum } : { type: spec.type });
  return {
    type: 'object',
    additionalProperties: false,
    required: ['candidates', 'read_all', 'unread'],
    properties: {
      candidates: {
        type: 'array',
        maxItems: limit,
        items: {
          type: 'object',
          additionalProperties: false,
          required: fields,
          properties: Object.fromEntries(fields.map((k) => [k, plain(cand.properties[k])])),
        },
      },
      read_all: { type: 'boolean' },
      unread: { type: 'string' },
    },
  };
}

function codexPrompt(round, text, limit, rules, inline) {
  const { req } = round;
  const mb = req.base.merge_base;
  const cand = load('candidates.json').$defs.candidate.properties;
  // The diff travels whole where it fits the budget; past it, a file is named for Codex to
  // read from the round itself — the same frozen diff, renames and all — so a change larger
  // than a model's context is still reviewed.
  const shown = [];
  const named = [];
  let used = 0;
  for (const k of diffChunks(readFileSync(path.join(round.dir, 'change.diff'), 'utf8'))) {
    const size = Buffer.byteLength(k.text);
    if (used + size <= inline) { shown.push(k.text); used += size; } else named.push(k.path);
  }
  // Quoted for the shell the command runs in: a path is whatever a filesystem allows.
  const sq = (v) => `'${v.replaceAll("'", `'\\''`)}'`;
  const reader = `node ${sq(fileURLToPath(import.meta.url))} diff --round ${round.id} --file <path>`;
  return [
    text.replaceAll('<merge base>', mb),
    '',
    `The change: from ${req.base.ref} (merge base ${mb}) to the working tree as it stands — ${req.files.length} file(s).`,
    req.narrow ? `The caller narrowed the review: ${req.narrow}` : null,
    rules.length ? `The repository's own rules for these paths: ${rules.join(', ')}.` : null,
    '',
    `Hand in at most ${limit} candidates, the most severe first, as the output schema describes:`,
    `- file: the path from the repository root, at most ${cand.file.maxLength} characters; line: the line the defect is at, counted from 1 — in the file as it is now for side "head", at the merge base for side "base", a line the change removed, under the path it had there;`,
    `- summary: the defect in one sentence, at most ${cand.summary.maxLength} characters; failure_scenario: the input or state and what then goes wrong, or for a cleanup its concrete cost, at most ${cand.failure_scenario.maxLength} characters — both written in the language tagged ${req.language};`,
    '- severity: Critical for security, data loss or corruption, a crash, broken core behaviour; Important for a real logic bug, a wrong result in a plausible case, a leak, a missing error path on a likely path, a broken contract; Minor for anything lighter, cleanup included;',
    `- category: ${cand.category.enum.join(', ')}.`,
    'With nothing to report, hand in an empty list.',
    'read_all: true when you read all you needed; false where something was out of reach — a command refused, a file you could not open — and then unread says what, in a sentence. unread is an empty string when read_all is true.',
    '',
    named.length ? `The diff below leaves out ${named.length} file(s) for its size — read each with \`${reader}\`, the path quoted as it is here: ${named.map(sq).join(', ')}.` : null,
    shown.length ? 'The diff:' : null,
    shown.length ? shown.join('') : null,
  ].filter((l) => l !== null).join('\n');
}

// The pass itself, off the event loop's back: a process that outlives its watchdog is asked
// to stop first — a CLI's own wrapper passes that on to the engine behind it — and killed
// only where it still stands.
function runPass(args, { cwd, input, timeout, fd }) {
  return new Promise((resolve) => {
    const child = spawn('codex', args, { cwd, stdio: ['pipe', fd, fd] });
    let timedOut = false;
    let hard = null;
    const soft = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      hard = setTimeout(() => child.kill('SIGKILL'), TERM_GRACE_MS);
    }, timeout);
    const done = (r) => { clearTimeout(soft); clearTimeout(hard); resolve({ ...r, timedOut }); };
    child.on('error', (error) => done({ error, status: null, signal: null }));
    child.on('close', (status, signal) => done({ status, signal }));
    // A CLI that exits before reading its prompt closes the pipe under the write.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function codex() {
  const round = openRound();
  if (round.req.mode !== 'round') die('codex belongs to --mode round — a pass has no change to hand it');
  const limitS = opts['--timeout-s'];
  // Zero would be no watchdog at all, and past a day a timer overflows into firing at once.
  if (limitS !== undefined && (!/^[1-9][0-9]*$/.test(limitS) || Number(limitS) > 86_400)) {
    die('--timeout-s must be a whole number of seconds, from 1 to 86400');
  }
  const p = planOf(round);
  const planned = plannedTasks(p).find((x) => x.kind === 'codex');
  if (!planned) cannot(`round ${round.id}'s plan holds no codex task — open the round with codex among its --sources`);
  const { task, source } = planned;
  admits(round, task, source);
  const repo = checkoutOf(round);
  const c = catalog();
  const settings = c.rungs[round.req.rung].codex;
  const asked = round.req.codex || {};
  // The watchdog of the rung, or of the rung whose own level the round was opened with,
  // whichever is longer: a heavier level named on a lighter rung takes its time with it.
  const minutes = Math.max(settings.minutes, ...Object.values(c.rungs)
    .filter((r) => r.codex && r.codex.effort === (asked.effort ?? settings.effort)).map((r) => r.codex.minutes));
  const ms = (limitS !== undefined ? Number(limitS) : minutes * 60) * 1000;
  // One pass per round: a conductor resuming the round finds the pass still running and
  // waits for its task rather than paying for a second. A holder whose process is gone, or
  // whose watchdog would have ended it by now, holds nothing.
  const lock = path.join(round.dir, 'codex.lock');
  const claim = () => claimJson(lock, {
    pid: process.pid, until: new Date(Date.now() + CATALOG_MS + ms + TERM_GRACE_MS + LOCK_GRACE_MS).toISOString(),
  });
  if (!claim()) {
    let held = null;
    try { held = readJson(lock); } catch { held = null; }
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
    const running = { read: true, task, source, running: true, pid: held?.pid };
    if (held && Number.isInteger(held.pid) && held.pid > 0 && Date.parse(held.until) > Date.now() && alive(held.pid)) answer(running);
    rmSync(lock, { force: true });
    if (!claim()) answer(running);
  }
  // Under the lock, the round is asked again: a pass that ended while this waited for it
  // has answered, and a second would be paid for nothing.
  admits(round, task, source);
  // Released by its holder alone: a lock another call took over is that call's.
  process.on('exit', () => {
    try { if (readJson(lock).pid === process.pid) rmSync(lock, { force: true }); } catch { /* gone already */ }
  });
  // A loss the round records, never a crash: the conductor reads the store, not this answer.
  const lose = (why, extra = {}) => {
    claimJson(path.join(round.dir, 'sources', `${task}.status.json`), {
      task, source, state: 'unavailable', candidates: 0, rejected: 0, notes: [why], ...extra, at: new Date().toISOString(),
    });
    answer({ read: true, task, source, state: 'unavailable', notes: [why], ...extra });
  };
  // What a run printed, as a note carries it: its last lines, with nothing that ends a line.
  const tail = (printed, n) => printed.trim().split('\n').slice(-n).join(' ').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(-600);

  // Whatever stops the pass once it holds the task ends as the task's loss — never as a
  // silence the conductor would wait out its hour on.
  try {
    // A caller who named the model and the level has said what to run; the catalog is
    // read for whatever is left to choose, and for the model's window where it knows it.
    let models = null;
    if (!(asked.model && asked.effort)) {
      const cat = spawnSync('codex', ['debug', 'models'], {
        cwd: repo.top, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: CATALOG_MS, killSignal: 'SIGKILL',
      });
      if (cat.error?.code === 'ENOENT') lose('the codex CLI is not on PATH');
      try { models = JSON.parse(cat.stdout || '').models; } catch { models = null; }
      if (!Array.isArray(models)) models = null;
      const why = cat.error ? cat.error.message : `exit ${cat.status}`;
      if (!models && !asked.model) lose(`the model catalog is unreadable (${why}): ${tail(`${cat.stdout || ''}\n${cat.stderr || ''}`, 3)}`);
    }
    // The round's own model where it was opened with one; otherwise the first listed,
    // `priority` ascending from the newest frontier model.
    const model = asked.model ?? [...models].filter((m) => m.visibility === 'list').sort((a, b) => a.priority - b.priority)[0]?.slug;
    if (!model) lose('the codex catalog lists no model to review with');
    const entry = models?.find((m) => m.slug === model) ?? null;
    const ladder = entry ? (entry.supported_reasoning_levels || []).map((l) => l.effort) : null;
    if (ladder && !ladder.length) lose(`${model} has no reasoning ladder in the codex catalog`, { model, effort: null });
    if (asked.effort && ladder && !ladder.includes(asked.effort)) {
      lose(`${asked.effort}, the level the round was opened with, is not one ${model} offers — it has: ${ladder.join(' ')}`, { model, effort: asked.effort });
    }
    // The round's level, else the rung's — the model's highest where its ladder stops short.
    const effort = asked.effort ?? (!ladder || ladder.includes(settings.effort) ? settings.effort : ladder[ladder.length - 1]);

    const out = path.join(round.dir, 'codex.answer.json');
    const schema = path.join(round.dir, 'codex.schema.json');
    const log = path.join(round.dir, 'codex.log');
    rmSync(out, { force: true });
    writeJson(schema, codexSchema(planned.limit));
    // A share of the model's window where the catalog gives one, at four bytes a token.
    const inline = Number.isInteger(entry?.context_window) ? entry.context_window * 4 * INLINE_SHARE : INLINE_KB * 1024;
    const prompt = codexPrompt(round, c.tasks[task].text, planned.limit, ruleFiles(repo, round.req.files), inline);
    // Read-only and sessionless, on the model and level named here; the rest of the user's
    // own Codex config — its provider, its auth — stands. `-` takes the prompt from stdin,
    // which is also what stops the CLI waiting on a terminal that is not there. What it
    // prints goes to the round's log, never through this process's memory.
    const fd = openSync(log, 'w');
    let r;
    try {
      r = await runPass(['exec', '-s', 'read-only', '--ephemeral', '-C', repo.top, '-m', model,
        '-c', `model_reasoning_effort=${effort}`, '--output-schema', schema, '-o', out, '-'], { cwd: repo.top, input: prompt, timeout: ms, fd });
    } finally {
      closeSync(fd);
    }
    // The log's last lines, read from its end: a long run's log is not read whole.
    const said = () => {
      const at = openSync(log, 'r');
      try {
        const size = fstatSync(at).size;
        const buf = Buffer.alloc(Math.min(size, 64 * 1024));
        readSync(at, buf, 0, buf.length, size - buf.length);
        return tail(buf.toString('utf8'), 5);
      } finally {
        closeSync(at);
      }
    };
    const span = ms < 120_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;
    let value = null;
    try { value = readJson(out); } catch { value = null; }
    // An answer written before the watchdog fired is an answer; none, and the watchdog or
    // the log's last lines say why — a spent quota leaves the same empty shape as a crash.
    if (!value && r.timedOut) lose(`no answer within ${span} — the watchdog ended it`, { model, effort });
    const how = [`exit ${r.status}`, r.signal ? `signal ${r.signal}` : null, r.error ? r.error.message : null].filter(Boolean).join(', ');
    if (!value) lose(`codex gave no answer (${how}): ${said()}`, { model, effort });
    if (typeof value !== 'object' || !Array.isArray(value.candidates)) lose('codex answered outside the schema: no list of candidates', { model, effort });

    // Each candidate meets the candidates' own schema on its own, and carries no verdict:
    // what Codex says of its own finding is never a check that stands.
    const notes = r.timedOut ? [`run-warning: the watchdog ended codex after ${span}, once its answer was written`] : [];
    const less = [];
    const fits = [];
    const misfits = [];
    value.candidates.forEach((cand, i) => {
      if (cand && typeof cand === 'object') delete cand.verdict;
      const errs = validate(load, 'candidates.json', '/$defs/candidate', cand);
      if (errs.length) misfits.push(`#${i + 1}${errs[0].at} ${errs[0].message}`);
      else fits.push(cand);
    });
    if (misfits.length) {
      const dropped = `${misfits.length} candidate(s) outside the candidate schema were dropped: ${misfits.slice(0, 3).join('; ')}`;
      if (fits.length) notes.push(`run-warning: ${dropped}`);
      else less.push(`every candidate it gave was unusable — ${dropped}`);
    }
    // The most severe first, then the limit's worth: the order they came in is no promise.
    fits.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
    if (fits.length > planned.limit) {
      notes.push(`run-warning: ${fits.length - planned.limit} candidate(s) past the limit of ${planned.limit} were dropped, the least severe`);
    }
    // Its own word on what it read, as a flag: anything but a true is less than the change.
    // The words beside it go to the note, bounded like any text another process wrote.
    if (value.read_all === false) less.push(`it read less than the change: ${text(value.unread) || 'it said so, and not what'}`);
    else if (value.read_all !== true) less.push('it did not say whether it read all it needed');
    // The round may have moved on while the pass ran — grouped, closed, its loss recorded.
    admits(round, task, source);
    const kept = { candidates: fits.slice(0, planned.limit) };
    answer({ accepted: true, task, source, model, effort, watchdog_s: ms / 1000, ...store(round, task, source, kept, planned, { model, effort, notes, less }, repo) });
  } catch (e) {
    lose(`the pass could not run: ${e.message}`);
  }
}

// --------------------------------------------------------------------------------- merge
function merged(round) {
  const candidates = [];
  const rejected = [];
  for (const f of sourceFiles(round.dir)) {
    const s = readJson(path.join(round.dir, 'sources', f));
    candidates.push(...s.candidates);
    rejected.push(...s.rejected.map((r) => ({ task: s.task, ...r })));
  }
  return { candidates, rejected };
}

function merge() {
  const round = openRound();
  const only = opts['--task'];
  if (only !== undefined && !TASK_ID.test(only)) die(`--task '${only}' is not a task id`);
  const { candidates, rejected } = merged(round);
  const of = (x) => only === undefined || x.id?.startsWith(`${only}.`) || x.task === only;
  answer({
    read: true,
    round: round.id,
    grouped: existsSync(path.join(round.dir, 'units.json')),
    queued: existsSync(path.join(round.dir, 'queue.json')),
    candidates: candidates.filter(of),
    rejected: rejected.filter(of),
    tasks: statuses(round.dir).filter(of),
  });
}

// --------------------------------------------------------------------------------- units
// The caller's grouping, held to one rule: every candidate it was handed is in exactly
// one group. A candidate left out of every group would leave the round without anybody
// having decided it should.
function units() {
  const round = openRound();
  // `--append` groups only what arrived after the first grouping — the sweep's — and
  // numbers the new groups after the old ones, so a queue and verdicts built on those
  // still attach to the claims they checked.
  const append = opts['--append'] === true;
  const uf = path.join(round.dir, 'units.json');
  if (append && !existsSync(uf)) cannot(`round ${round.id} has no groups to add to — run units without --append first`);
  const prior = append ? readJson(uf).units : [];
  const taken = new Set(prior.flatMap((u) => u.members));
  const value = submission();
  const candidates = merged(round).candidates.filter((c) => !taken.has(c.id));
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const reachable = candidates.filter((c) => !c.unreachable).map((c) => c.id);
  const errors = [];
  if (!value || typeof value !== 'object' || !Array.isArray(value.units)) {
    refuse([{ at: '/units', message: 'must be an array of {"members": [...], "lead": "..."}' }]);
  }
  const seen = new Map();
  value.units.forEach((u, i) => {
    const at = `/units/${i}`;
    if (!u || typeof u !== 'object' || Array.isArray(u)) { errors.push({ at, message: 'must be an object' }); return; }
    const extra = Object.keys(u).filter((k) => k !== 'members' && k !== 'lead');
    if (extra.length) errors.push({ at, message: `has fields this does not take: ${extra.join(', ')}` });
    if (!Array.isArray(u.members) || !u.members.length) { errors.push({ at: `${at}/members`, message: 'must list at least one candidate id' }); return; }
    for (const m of u.members) {
      if (taken.has(m)) errors.push({ at: `${at}/members`, message: `'${m}' is already grouped by an earlier units call` });
      else if (!byId.has(m)) errors.push({ at: `${at}/members`, message: `'${m}' is not a candidate of this round` });
      else if (byId.get(m).unreachable) errors.push({ at: `${at}/members`, message: `'${m}' is unreachable and stands alone; leave it out` });
      else if (seen.has(m)) errors.push({ at: `${at}/members`, message: `'${m}' is already in unit ${seen.get(m) + 1}` });
      else seen.set(m, i);
    }
    if (!u.members.includes(u.lead)) errors.push({ at: `${at}/lead`, message: 'must be one of the members' });
  });
  for (const id of reachable) if (!seen.has(id)) errors.push({ at: '/units', message: `'${id}' is not in any unit — every candidate belongs to exactly one` });
  if (errors.length) refuse(errors);

  const built = value.units.map((u, i) => {
    const lead = byId.get(u.lead);
    const members = u.members.map((m) => byId.get(m));
    // Only the lead's own verdict can stand for the group: the group is checked by the
    // lead's claim, and another member's verdict answered a different one.
    const carried = lead.verdict ? [lead.verdict] : [];
    return {
      unit: `U${prior.length + i + 1}`, lead: lead.id, members: u.members,
      file: lead.file, line: lead.line, side: lead.side,
      summary: lead.summary, failure_scenario: lead.failure_scenario, category: lead.category,
      // The most severe any member was rated: two reviewers seeing one defect at two
      // weights have not settled on the lighter one.
      severity: members.map((m) => m.severity).sort((a, b) => RANK[a] - RANK[b])[0],
      found_by: [...new Set(members.map((m) => m.source))],
      carried,
    };
  });
  // A candidate no tree here can read stays a row of its own, never folded into a group.
  for (const c of candidates.filter((x) => x.unreachable)) {
    built.push({
      unit: `U${prior.length + built.length + 1}`, lead: c.id, members: [c.id], file: c.file, line: c.line, side: c.side,
      summary: c.summary, failure_scenario: c.failure_scenario, category: c.category, severity: c.severity,
      found_by: [c.source], carried: c.verdict ? [c.verdict] : [], unreachable: c.unreachable,
    });
  }
  writeJson(uf, { units: [...prior, ...built] });
  // A new grouping renumbers the groups, so a queue and verdicts built on the old one
  // would attach to claims they never checked.
  if (!append) {
    rmSync(path.join(round.dir, 'queue.json'), { force: true });
    rmSync(path.join(round.dir, 'verdicts'), { recursive: true, force: true });
  }
  answer({
    accepted: true,
    appended: append,
    units: built.map((u) => ({ unit: u.unit, lead: u.lead, members: u.members, severity: u.severity, found_by: u.found_by, unreachable: u.unreachable })),
  });
}

// --------------------------------------------------------------------------------- queue
function queue() {
  const round = openRound();
  const f = path.join(round.dir, 'units.json');
  if (!existsSync(f)) cannot(`round ${round.id} has no units yet — run units first`);
  const qf = path.join(round.dir, 'queue.json');
  // `--append` queues the groups an earlier queue never saw, and keeps what it recorded.
  const append = opts['--append'] === true;
  if (append && !existsSync(qf)) cannot(`round ${round.id} has no queue to add to — run queue without --append first`);
  const prior = append ? readJson(qf) : { queue: [], reused: [], budget_cut: [], unreachable: [] };
  // Digits or no flag at all: `Number` reads `Infinity` and `1e3` as numbers, and the
  // sentinel for "no budget" is the flag's absence rather than a word a caller can pass.
  if (opts['--budget'] !== undefined && !/^[0-9]+$/.test(opts['--budget'])) die('--budget must be a whole number');
  // A round's budget is its rung's, from the plan, where the caller names none — less
  // whatever an earlier queue of the round already spent.
  const p = planOf(round);
  let budget = Infinity;
  if (opts['--budget'] !== undefined) budget = Number(opts['--budget']);
  else if (p) budget = Math.max(0, p.budget - prior.queue.length);
  // A round run without agents checks nothing: its queue only lets carried verdicts stand.
  if (p?.depth) budget = 0;
  const seen = new Set([...prior.queue, ...prior.reused, ...prior.budget_cut, ...prior.unreachable]);
  const all = readJson(f).units.filter((u) => !seen.has(u.unit));
  const repo = all.some((u) => u.carried.length) ? checkoutOf(round) : null;
  // A queue starts verification over: a verdict left from an earlier queue answered a
  // check this one has not asked for, and would count as done.
  if (!append) rmSync(path.join(round.dir, 'verdicts'), { recursive: true, force: true });
  mkdirSync(path.join(round.dir, 'verdicts'), { recursive: true, mode: 0o700 });

  const reused = [];
  const open = [];
  const unreachable = [];
  for (const u of all) {
    if (u.unreachable) { unreachable.push(u.unit); continue; }
    // A carried verdict stands while every file it read is byte-for-byte what it read —
    // and only where the finding's own file is among them, since a verdict that never
    // read it cannot tell that file changed, a fix included. `refuted` never stands: it
    // released work, and a change to anything it read may have put the defect back.
    const standing = u.carried.find((v) => (v.verdict === 'confirmed' || v.verdict === 'unproven')
      && v.evidence.some((e) => e.path === u.file && e.side === u.side)
      && v.evidence.every((e) => blobAt(repo, round.req, e.path, e.side) === e.blob));
    if (standing) {
      writeJson(path.join(round.dir, 'verdicts', `${u.unit}.json`), { ...standing, unit: u.unit, reused: true });
      reused.push(u.unit);
    } else open.push(u);
  }
  open.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const critical = open.filter((u) => u.severity === 'Critical');
  let order = open.map((u) => u.unit);
  let cut = [];
  let stop = false;
  let reason = null;
  if (p?.depth) {
    cut = order;
    order = [];
  } else if (append) {
    // What the budget cuts from an appended queue is never a Critical: the budget was
    // spent on groups the first queue ranked without knowing it existed.
    // `open` is ranked, so the Critical groups lead it; each is charged to the budget.
    const room = Math.max(0, budget - critical.length);
    cut = order.slice(critical.length + room);
    order = order.slice(0, critical.length + room);
  } else if (critical.length > budget) {
    // Every Critical is checked before a budget applies at all; where they alone do not
    // fit, none of them is ruled unverified — the caller stops and says so.
    stop = true;
    reason = `${critical.length} Critical group(s) do not fit a budget of ${budget}`;
    cut = order;
    order = [];
  } else if (order.length > budget) {
    cut = order.slice(budget);
    order = order.slice(0, budget);
  }
  // What each call stopped on is its answer's; the file keeps what later calls read.
  const q = {
    queue: [...prior.queue, ...order],
    reused: [...prior.reused, ...reused],
    budget_cut: [...prior.budget_cut, ...cut],
    unreachable: [...prior.unreachable, ...unreachable],
    latest: order,
  };
  writeJson(qf, q);
  // The answer names what this call queued; the file holds the whole queue.
  answer({ read: true, round: round.id, queue: order, reused, budget_cut: cut, unreachable, stop, reason, budget: Number.isFinite(budget) ? budget : null });
}

// ---------------------------------------------------------------------------------- task
// What a verifier is handed, and all it is handed: the claim, where, and what would show
// it. Who found it, how sure they were and how severe they called it stay out — a check
// that reads the argument grades the argument.
function queued(round, unit) {
  if (!unit || !UNIT_ID.test(unit)) die('--unit is required: a group id such as U3');
  const qf = path.join(round.dir, 'queue.json');
  if (!existsSync(qf)) cannot(`round ${round.id} has no queue yet — run queue first`);
  const q = readJson(qf);
  if (!q.queue.includes(unit)) cannot(`${unit} is not queued for verification in round ${round.id}`);
  return readJson(path.join(round.dir, 'units.json')).units.find((u) => u.unit === unit);
}

function task() {
  const round = openRound();
  const u = queued(round, opts['--unit']);
  const tree = treeOf(round.req, u.side);
  const readWith = tree.ref
    ? `git show ${tree.ref}:<path> — this ${round.req.mode === 'round' ? 'base-side code is read at the merge base' : 'pass reads that commit'}, not the working tree`
    : 'the working tree as it stands — read files directly';
  answer({
    round: round.id,
    unit: u.unit,
    claim: u.summary,
    coordinate: { file: u.file, line: u.line, side: u.side },
    show: u.failure_scenario,
    category: u.category,
    read_with: readWith,
    language: round.req.language,
    submit: `review-round.mjs verdict --round ${round.id} --unit ${u.unit}`,
  });
}

// ------------------------------------------------------------------------------- verdict
function verdict() {
  const round = openRound();
  const u = queued(round, opts['--unit']);
  const value = submission();
  const errors = validate(load, 'verdict.json', null, value);
  if (errors.length) refuse(errors, { unit: u.unit });
  const repo = checkoutOf(round);
  const evidence = [];
  const missing = [];
  value.evidence.forEach((e, i) => {
    const side = e.side || 'head';
    const blob = blobAt(repo, round.req, e.path, side);
    if (!blob) missing.push({ at: `/evidence/${i}/path`, message: `${e.path} is not on the ${side} side of this ${round.req.mode} — quote what you actually read` });
    else evidence.push({ path: e.path, side, lines: e.lines, quote: e.quote, blob });
  });
  if (missing.length) refuse(missing, { unit: u.unit });
  // The claim's own coordinate is what the verdict answers: one that never read it says
  // nothing about the claim, and could never stand in a later pass either.
  if (!evidence.some((e) => e.path === u.file && e.side === u.side)) {
    refuse([{ at: '/evidence', message: `never reads ${u.file} on the ${u.side} side — the claim's own coordinate goes in the evidence, first` }], { unit: u.unit });
  }
  // The revision a verdict names is the one it read: the commit the round opened on,
  // marked `+wt` where anything it read on the working tree differs from that commit —
  // untracked, edited before the round opened, or edited since.
  let snapshot = round.req.snapshot;
  const onHead = evidence.filter((e) => e.side === 'head');
  if (!onHead.length && round.req.mode === 'round') {
    // Read at the merge base and nowhere else: that commit is the revision it read.
    snapshot = round.req.base.merge_base.slice(0, 7);
  } else if (treeOf(round.req, 'head').worktree) {
    const at = round.req.head.sha;
    const committed = blobsAt(repo, at, onHead.map((e) => e.path));
    const moved = onHead.some((e) => committed.get(e.path) !== e.blob);
    snapshot = `${at.slice(0, 7)}${moved ? '+wt' : ''}`;
  }
  const stored = { unit: u.unit, verdict: value.verdict, snapshot, evidence };
  if (value.settle) stored.settle = value.settle;
  if (value.refuted_because) stored.refuted_because = value.refuted_because;
  const check = validate(load, 'verdict.json', '/$defs/stored', stored);
  if (check.length) cannot(`the stored verdict does not fit its own schema: ${JSON.stringify(check)}`);
  writeJson(path.join(round.dir, 'verdicts', `${u.unit}.json`), stored);
  answer({ accepted: true, unit: u.unit, verdict: value.verdict });
}

// ---------------------------------------------------------------------------------- wait
// One blocking call instead of a loop in the caller's hands: the caller would otherwise
// poll, and a harness refuses `sleep` chains while a model left to wait on its own
// reaches for exactly those. It answers when nothing is pending or the window is up,
// and "still pending" is an answer, not an error.
function wait() {
  const round = openRound();
  const what = opts['--for'];
  if (what !== 'tasks' && what !== 'verdicts') die("--for must be 'tasks' or 'verdicts'");
  const limit = opts['--timeout-s'] === undefined ? WAIT_CAP_S : Number(opts['--timeout-s']);
  if (!Number.isInteger(limit) || limit < 0 || limit > WAIT_CAP_S) die(`--timeout-s must be a whole number from 0 to ${WAIT_CAP_S}`);
  let expected;
  if (what === 'tasks') {
    expected = (opts['--expect'] || '').split(',').filter(Boolean);
    // The plan's tasks where none are named — the sweep aside, launched on its own later.
    if (!expected.length) expected = (planOf(round)?.tasks || []).map((t) => t.task);
    if (!expected.length) die('--for tasks needs --expect, the tasks launched, or a plan');
    for (const t of expected) if (!TASK_ID.test(t)) die(`--expect: '${t}' is not a task id`);
  } else {
    const qf = path.join(round.dir, 'queue.json');
    if (!existsSync(qf)) cannot(`round ${round.id} has no queue yet — run queue first`);
    // The groups the latest queue call queued: a group an earlier call queued, whose check
    // never answered, would hold every later wait to its ceiling.
    const q = readJson(qf);
    expected = (opts['--expect'] || '').split(',').filter(Boolean);
    for (const u of expected) if (!UNIT_ID.test(u)) die(`--expect: '${u}' is not a group id`);
    if (!expected.length) expected = q.latest ?? q.queue;
  }
  // Presence alone answers: a file lands whole (writeJson renames it into place), so
  // nothing here needs to parse what another process is writing.
  const pending = () => expected.filter((x) => !existsSync(what === 'tasks'
    ? path.join(round.dir, 'sources', `${x}.status.json`)
    : path.join(round.dir, 'verdicts', `${x}.json`)));
  const t0 = Date.now();
  // How long since the plan: the ceiling on a round's waiting counts from its launch,
  // and a model has no clock of its own to count it by.
  const planned = Date.parse(planOf(round)?.planned_at ?? '');
  const tick = () => {
    const left = pending();
    const waited = Math.round((Date.now() - t0) / 1000);
    if (!left.length || Date.now() - t0 >= limit * 1000) {
      answer({
        read: true, round: round.id, for: what, complete: left.length === 0, pending: left, waited_s: waited,
        since_plan_s: Number.isNaN(planned) ? null : Math.round((Date.now() - planned) / 1000),
      });
    }
    setTimeout(tick, 1000);
  };
  tick();
}

// -------------------------------------------------------------------------------- result
function result() {
  const round = openRound();
  const { req } = round;
  const uf = path.join(round.dir, 'units.json');
  const qf = path.join(round.dir, 'queue.json');
  const candidates = merged(round).candidates;
  // Candidates nobody grouped would leave an empty result that reads as a clean review.
  if (!existsSync(uf) && candidates.length) cannot(`round ${round.id} holds ${candidates.length} candidate(s) and no groups — run units first`);
  const all = existsSync(uf) ? readJson(uf).units : [];
  // A submission accepted while `units` ran belongs to no group, and the result reads
  // groups: it would leave the round with nobody having dropped it.
  const grouped = new Set(all.flatMap((u) => u.members));
  const ungrouped = candidates.filter((c) => !grouped.has(c.id)).map((c) => c.id);
  if (ungrouped.length) {
    cannot(`round ${round.id} holds candidate(s) no group does (${ungrouped.join(', ')}) — they arrived while units ran; group again`);
  }
  const q = existsSync(qf) ? readJson(qf) : null;
  const warnings = [...(req.warnings || [])];

  const p = planOf(round);
  const coverage = [];
  if (req.mode === 'round') {
    const bySource = new Map();
    const rowOf = (source) => {
      if (!bySource.has(source)) bySource.set(source, { source, state: null, tasks: 0, candidates: 0, rejected: 0, notes: [], missing: [], models: [] });
      return bySource.get(source);
    };
    // Counts come from what each task handed in, states from its status: a loss recorded
    // beside a submission changes how covered the task is, not what it found.
    const handed = new Map(sourceFiles(round.dir).map((f) => {
      const sub = readJson(path.join(round.dir, 'sources', f));
      return [sub.task, sub];
    }));
    const answers = statuses(round.dir);
    // The Codex pass states one model and level for its row; a finder names its task where
    // it was launched again on another model.
    const passes = new Set(plannedTasks(p).filter((t) => t.kind === 'codex').map((t) => t.task));
    for (const s of answers) {
      // A carrier the caller handed in — its noticed candidates — is no reviewer, and takes
      // no row: its findings are in the result, its coverage is nobody's.
      if (!(req.sources || []).includes(s.source)) continue;
      const row = rowOf(s.source);
      row.state = row.state === null ? s.state : worse(row.state, s.state);
      row.tasks += 1;
      row.candidates += handed.get(s.task)?.candidates.length ?? 0;
      row.rejected += handed.get(s.task)?.rejected.length ?? 0;
      row.notes.push(...(s.notes || []));
      if (passes.has(s.task)) { row.model = s.model ?? null; row.effort = s.effort ?? null; } else if (s.model) row.models.push(`${s.task}: ${s.model}`);
    }
    // A task the plan launched that never answered, and a source the round was opened
    // for that nothing answered for, are reviewers missing — never rows left out, since
    // silence would read as nothing to report.
    const answered = new Set(answers.map((s) => s.task));
    for (const t of plannedTasks(p)) if (!answered.has(t.task)) rowOf(t.source).missing.push(t.task);
    for (const source of req.sources || []) rowOf(source);
    // A source is as covered as its least covered task; one whose finders the conductor
    // ran itself, with no agents to hand them to, is no better than depth. A codex task is
    // a process, not an agent, and runs the same either way.
    const finders = new Set(plannedTasks(p).filter((t) => t.kind !== 'codex').map((t) => t.source));
    for (const row of bySource.values()) {
      let state = row.state ?? 'unavailable';
      if (!row.tasks && !row.missing.length) row.notes.push('no task of this source submitted anything');
      if (row.missing.length) {
        row.notes.push(`planned task(s) with no answer: ${row.missing.join(', ')}`);
        state = worse(state, 'partial');
      }
      if (p?.depth && finders.has(row.source)) state = worse(state, 'depth');
      const line = { source: row.source, state, tasks: row.tasks, candidates: row.candidates, rejected: row.rejected, notes: row.notes };
      const model = row.model ?? (row.models.length ? row.models.join(', ') : null);
      if (model) line.model = model;
      if (row.effort) line.effort = row.effort;
      coverage.push(line);
    }
  }

  const findings = [];
  const refuted = [];
  const drifted = new Set();
  const headBlob = new Map((req.files || []).map((f) => [f.path, f.blob_head]));
  const verdicts = new Map(all.map((u) => [u.unit, verdictOf(round.dir, u.unit)]));
  // What each verdict read on the working tree, where the round's drift is judged: the
  // files a fresh check read, the ones a reused verdict read having been judged when it stood.
  const onHead = new Map([...verdicts].map(([unit, v]) => [unit,
    req.mode === 'round' && v && !v.reused ? v.evidence.filter((e) => e.side === 'head') : []]));
  // What the finders read of a file: its blob at init where the diff lists it, and
  // otherwise the merge base's — a tracked file the diff does not list stood as the merge
  // base has it. An untracked one was never theirs to read.
  const elsewhere = [...onHead.values()].flat().map((e) => e.path)
    .filter((f) => !headBlob.has(f) && !(req.untracked || []).includes(f));
  const atBase = elsewhere.length ? blobsAt(checkoutOf(round), req.base.merge_base, elsewhere) : new Map();
  const openedWith = (file) => (headBlob.has(file) ? headBlob.get(file) : atBase.get(file));
  for (const u of all) {
    const row = {
      unit: u.unit, file: u.file, line: u.line, side: u.side, summary: u.summary,
      failure_scenario: u.failure_scenario, severity: u.severity, category: u.category, found_by: u.found_by,
    };
    const v = verdicts.get(u.unit);
    if (u.unreachable) { findings.push({ ...row, verified: 'not measured', reason: 'unreachable' }); continue; }
    if (!v) {
      // A group the budget cut is named in `budget_cut` by the call that cut it; one queued
      // and never answered is the check's failure, whatever a later call's budget did.
      let reason = 'none ran';
      if (p?.depth) reason = 'depth';
      else if (q && q.budget_cut.includes(u.unit)) reason = 'budget';
      else if (q && q.queue.includes(u.unit)) reason = 'failed';
      findings.push({ ...row, verified: 'not measured', reason });
      continue;
    }
    for (const e of onHead.get(u.unit)) {
      const was = openedWith(e.path);
      if (was !== undefined && was !== e.blob) drifted.add(e.path);
    }
    if (v.verdict === 'refuted') {
      refuted.push({ unit: u.unit, file: u.file, line: u.line, summary: u.summary, refuted_because: v.refuted_because, snapshot: v.snapshot });
      continue;
    }
    const f = { ...row, verified: v.verdict, snapshot: v.snapshot, evidence: v.evidence };
    if (v.settle) f.settle = v.settle;
    if (v.reused) f.reused = true;
    findings.push(f);
  }
  if (drifted.size) {
    warnings.push(`coverage-warning: the working tree changed while the round ran (${[...drifted].join(', ')}) — verdicts read a tree the finders did not`);
  }
  findings.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const out = {
    round: round.id, mode: req.mode, snapshot: req.snapshot,
    base: req.mode === 'round' ? req.base.ref : null,
    tree: req.mode === 'pass' ? (req.tree.ref || 'worktree') : null,
    files: req.mode === 'round' ? req.files.length : 0,
    rung: req.rung || null, language: req.language,
    coverage, findings, refuted, warnings,
  };
  const check = validate(load, 'result.json', null, out);
  if (check.length) cannot(`the result does not fit its schema: ${JSON.stringify(check)}`);
  writeJson(path.join(round.dir, 'result.json'), out);
  answer(out);
}

// Exit 1 says a submission was refused and invites sending it again; a store file that
// cannot be read is not that, so whatever escapes leaves as exit 3 with an answer.
process.on('uncaughtException', (e) => cannot(`${cmd} could not be answered: ${e.message}`));
({ init, plan, brief, diff, add, codex, status, merge, units, queue, task, verdict, wait, result })[cmd]();
