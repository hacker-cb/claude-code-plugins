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
//   node review-round.mjs init --mode pass [--tree worktree|<ref>] [--language <tag>]
//   node review-round.mjs plan    --round <id> [--depth]
//   node review-round.mjs brief   --round <id> --task <task>
//   node review-round.mjs diff    --round <id> [--file <path>]
//   node review-round.mjs add     --round <id> --source <source> [--task <task>] [--file <json>]
//   node review-round.mjs status  --round <id> --task <task> --state <state> [--note <text>]
//   node review-round.mjs merge   --round <id>
//   node review-round.mjs units   --round <id> [--append] [--file <json>]
//   node review-round.mjs queue   --round <id> [--append] [--budget <n>]
//   node review-round.mjs task    --round <id> --unit <unit>
//   node review-round.mjs verdict --round <id> --unit <unit> [--file <json>]
//   node review-round.mjs wait    --round <id> --for tasks|verdicts [--expect <list>] [--timeout-s <n>]
//   node review-round.mjs result  --round <id>
//
// The JSON `add`, `units` and `verdict` take arrives on stdin, or from `--file`. `diff`
// prints the change itself, as git wrote it; everything else prints JSON.
// Exit: 0 answered; 1 a submission refused, the errors saying what to fix; 2 called
// wrong; 3 the round or the repository could not be read.

import {
  existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync,
  realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { writeAll } from './lib/forge.mjs';
import { schemaDir, validate } from './lib/schema.mjs';

const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = schemaDir(path.join(PLUGIN, 'schemas'));

const USAGE = 'usage: node review-round.mjs <init|plan|brief|diff|add|status|merge|units|queue|task|verdict|wait|result> [flags]'
  + ' — see the header of this file\n';
const die = (m) => { writeAll(2, `review-round: ${m}\n${USAGE}`); process.exit(2); };
const answer = (obj, code = 0) => { writeAll(1, `${JSON.stringify(obj, null, 2)}\n`); process.exit(code); };
const cannot = (reason) => answer({ read: false, reason }, 3);
const refuse = (errors, extra = {}) => answer({ accepted: false, errors, ...extra }, 1);

const SPEC = {
  init: ['--mode', '--base', '--tree', '--rung', '--sources', '--language', '--narrow'],
  plan: ['--round', '--depth'],
  brief: ['--round', '--task'],
  diff: ['--round', '--file'],
  add: ['--round', '--source', '--task', '--file'],
  status: ['--round', '--task', '--state', '--note'],
  merge: ['--round'],
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
const STATES = ['covered', 'partial', 'depth', 'unavailable', 'nothing', 'n/a'];
const SOURCES = ['claude', 'security', 'codex'];
const WAIT_CAP_S = 540; // under the Bash tool's 10-minute ceiling, so one window is one call

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
  for (let i = 1; i < s.length - 1; i += 1) {
    if (s[i] !== '\\') { bytes.push(...Buffer.from(s[i], 'utf8')); continue; }
    const n = s[i + 1];
    if (Object.hasOwn(named, n)) { bytes.push(named[n]); i += 1; } else if (/[0-7]/.test(n)) {
      bytes.push(parseInt(s.slice(i + 1, i + 4), 8)); i += 3;
    } else bytes.push(92);
  }
  return Buffer.from(bytes).toString('utf8');
};

// The change split per file, each chunk with the path it lands at, the one it left
// where it moved, and its line counts. The paths are read from the lines git writes for
// them — `---`/`+++`, `rename`/`copy` — and from the header only where neither exists
// (a binary or mode-only change), where the two halves of `a/P b/P` are the same path.
function diffChunks(text) {
  const starts = [];
  const re = /^diff --git /gm;
  for (let m = re.exec(text); m; m = re.exec(text)) starts.push(m.index);
  return starts.map((at, i) => {
    const body = text.slice(at, i + 1 < starts.length ? starts[i + 1] : text.length);
    let a; let b; let added = 0; let removed = 0; let hunk = false;
    const side = (token, prefix) => {
      const t = unquote(token);
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
  const plain = [...new Set(paths)].filter((p) => relOk(p) && !p.includes('\n'));
  if (!plain.length) return out;
  const r = repo.git(['cat-file', '--batch-check=%(objectname) %(objecttype)'], `${plain.map((p) => `${rev}:${p}`).join('\n')}\n`);
  const lines = r.out.split('\n');
  plain.forEach((p, i) => {
    const [oid, type] = (lines[i] || '').split(' ');
    if (type === 'blob') out.set(p, oid);
  });
  return out;
}

// The angle catalog ships with the plugin and is read on every plan and brief; a
// malformed one is a broken plugin, said as such rather than planned around.
function catalog() {
  const file = path.join(PLUGIN, 'data', 'review-angles.json');
  let c;
  try { c = readJson(file); } catch (e) { cannot(`the angle catalog ${file} cannot be read: ${e.message}`); }
  const categories = load('candidates.json').$defs.candidate.properties.category.enum;
  const bad = [];
  for (const [id, t] of Object.entries(c.tasks || {})) {
    if (!TASK_ID.test(id)) bad.push(`task id '${id}'`);
    if (!SOURCES.includes(t.source)) bad.push(`${id}: source '${t.source}'`);
    if (!['finder', 'sweep', 'codex'].includes(t.kind)) bad.push(`${id}: kind '${t.kind}'`);
    if (!categories.includes(t.category)) bad.push(`${id}: category '${t.category}'`);
    if (typeof t.text !== 'string' || !t.text.trim()) bad.push(`${id}: no text`);
  }
  for (const [name, r] of Object.entries(c.rungs || {})) {
    for (const id of [...(r.tasks || []), ...(r.sweep ? [r.sweep] : [])]) if (!c.tasks?.[id]) bad.push(`${name}: no task '${id}'`);
    if (!Number.isInteger(r.limit) || r.limit < 1 || !Number.isInteger(r.budget) || r.budget < 1) bad.push(`${name}: limit and budget`);
  }
  if (!c.rungs?.medium || !c.rungs?.high) bad.push('the medium and high rungs');
  if (bad.length) cannot(`the angle catalog ${file} is malformed: ${bad.join('; ')}`);
  return c;
}

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
  if (tree.ref) {
    const r = repo.git(['rev-parse', '--verify', '-q', `${tree.ref}:${file}`]);
    if (!r.ok) return null;
    const oid = r.out.trim();
    return repo.git(['cat-file', '-t', oid]).out.trim() === 'blob' ? oid : null;
  }
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
  for (const s of sources) if (!['claude', 'security', 'codex'].includes(s)) die(`--sources: '${s}' is not claude, security or codex`);
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
    const diff = repo.git(['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', mergeBase]);
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
      if (st?.isSymbolicLink()) heads.set(f.path, blobAt(repo, { mode: 'round' }, f.path, 'head'));
      else if (st?.isFile() && !f.path.includes('\n')) regular.push(f.path);
      else if (st?.isFile()) heads.set(f.path, blobAt(repo, { mode: 'round' }, f.path, 'head'));
    }
    if (regular.length) {
      const h = repo.git(['hash-object', '--stdin-paths'], `${regular.join('\n')}\n`);
      if (!h.ok) cannot(`git could not hash the working tree's files: ${h.err}`);
      h.out.split('\n').slice(0, regular.length).forEach((oid, k) => heads.set(regular[k], oid));
    }
    for (const f of files) f.blob_head = heads.get(f.path) ?? null;
    const strays = untracked.out.split('\0').filter((t) => t !== '');
    if (strays.length) {
      warnings.push(`coverage-warning: ${strays.length} untracked path(s) are NOT reviewed — a diff does not show them; \`git add -N <path>\` puts one under review`);
    }
    if (mergeBase === headSha && !dirty) {
      warnings.push('coverage-warning: HEAD is at or behind the base and the working tree is clean — there is nothing to review');
    } else if (mergeBase === headSha) {
      notes.push('HEAD is at the base: the change is the uncommitted edits alone');
    }
    mkdirSync(path.join(dir, 'sources'), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(dir, 'change.diff'), diff.out);
    request = {
      version: 1, round: id, mode, created_at: new Date().toISOString(), top: repo.top,
      base: { ref: opts['--base'], merge_base: mergeBase }, head: { sha: headSha, dirty },
      snapshot, rung, sources, language, narrow, files, untracked: strays, warnings, notes,
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
  const entry = (id) => ({ task: id, source: c.tasks[id].source, kind: c.tasks[id].kind, category: c.tasks[id].category, limit: rung.limit });
  const tasks = rung.tasks.filter((id) => wanted.includes(c.tasks[id].source)).map(entry);
  // Without agents there are no checks, and the sweep only exists to follow them.
  const sweep = rung.sweep && !depth && wanted.includes(c.tasks[rung.sweep].source) ? entry(rung.sweep) : null;
  const notes = wanted.filter((src) => !tasks.some((t) => t.source === src))
    .map((src) => `the catalog holds no ${round.req.rung} task for source '${src}' — its coverage row reads unavailable`);
  const p = { rung: round.req.rung, depth, budget: rung.budget, tasks, sweep, notes };
  writeJson(planFile(round), p);
  answer({ read: true, round: round.id, ...p });
}

// The rule files a repository writes for itself that can govern the changed paths: the
// CLAUDE.md at its root and in every directory above a changed file, and every file under
// .claude/rules — which paths each of those covers is its own header's to say.
function ruleFiles(repo, files) {
  const found = new Set();
  const keep = (rel) => {
    const r = real(path.join(repo.top, rel));
    if (r && inside(r, repo.top) && statSync(r).isFile()) found.add(rel);
  };
  keep('CLAUDE.md');
  for (const f of files) {
    for (let dir = path.posix.dirname(f.path); dir !== '.' && dir !== '/'; dir = path.posix.dirname(dir)) keep(`${dir}/CLAUDE.md`);
  }
  const walk = (rel) => {
    let entries = [];
    try { entries = readdirSync(path.join(repo.top, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) walk(`${rel}/${e.name}`);
      else if (e.isFile() && e.name.endsWith('.md')) found.add(`${rel}/${e.name}`);
    }
  };
  walk('.claude/rules');
  return [...found].sort();
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
  const spec = catalog().tasks[id];
  const { req } = round;
  const counts = new Map(diffChunks(readFileSync(path.join(round.dir, 'change.diff'), 'utf8')).map((k) => [k.path, k]));
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
        path: f.path, from: f.from ?? null, status: f.status,
        added: counts.get(f.path)?.added ?? null, removed: counts.get(f.path)?.removed ?? null,
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
  const chunk = diffChunks(text).find((k) => k.path === file || k.from === file);
  if (!chunk) cannot(`${file} is not a file of round ${round.id}'s change`);
  writeAll(1, chunk.text);
  process.exit(0);
}

// -------------------------------------------------------------------------------- status
// What the conductor records for a task whose agent did not answer as it should — never
// submitted, ran out of turns, could not run. A task that submitted keeps its counts and
// takes the state given; one that never did gets a row of its own.
function status() {
  const round = openRound();
  const id = opts['--task'];
  if (!id || !TASK_ID.test(id)) die('--task is required: a task id');
  const state = opts['--state'];
  if (!STATES.includes(state)) die(`--state must be one of: ${STATES.join(', ')}`);
  const note = opts['--note'];
  if (note !== undefined && [...note].length > 500) die('--note is a sentence or two, not a document');
  const f = path.join(round.dir, 'sources', `${id}.status.json`);
  const prior = existsSync(f) ? readJson(f) : null;
  const planned = plannedTasks(planOf(round)).find((x) => x.task === id);
  if (!prior && !planned) cannot(`${id} is neither planned nor submitted in round ${round.id}`);
  const at = new Date().toISOString();
  const next = prior
    ? { ...prior, state, notes: [...(prior.notes || []), ...(note ? [note] : [])], at }
    : { task: id, source: planned.source, state, candidates: 0, rejected: 0, notes: note ? [note] : [], at };
  writeJson(f, next);
  answer({ accepted: true, task: id, source: next.source, state });
}

// ----------------------------------------------------------------------------------- add
function add() {
  const round = openRound();
  const source = opts['--source'];
  if (!source || !SOURCE_ID.test(source)) die('--source is required: lowercase letters, digits, ":" and "-"');
  const task = opts['--task'] || source.replace(/:/g, '-');
  if (!TASK_ID.test(task)) die(`--task '${task}' is not a task id: lowercase letters, digits and "-"`);
  const p = planOf(round);
  const planned = plannedTasks(p).find((x) => x.task === task);
  if (planned && planned.source !== source) {
    refuse([{ at: '', message: `task '${task}' belongs to source '${planned.source}' in this round's plan, not to '${source}'` }], { task });
  }
  // Grouping closes collection: a candidate arriving after `units` would sit in no group,
  // and the result reads groups — it would vanish without anybody having dropped it. The
  // sweep is the one task that comes after the checks, and its groups are appended.
  if (existsSync(path.join(round.dir, 'units.json')) && !(p?.sweep && p.sweep.task === task)) {
    refuse([{ at: '', message: `round ${round.id} is already grouped — this submission came too late to be stored` }], { task });
  }
  // One task, one submission: a second under the same name would replace the first, and
  // the candidates it carried would leave the round without anybody having dropped them.
  if (existsSync(path.join(round.dir, 'sources', `${task}.json`))) {
    refuse([{ at: '', message: `task '${task}' already holds a submission — hand this carrier in under a --task of its own` }], { task });
  }
  const value = submission();
  const errors = validate(load, 'candidates.json', null, value);
  if (errors.length) refuse(errors, { task });
  if (planned && value.candidates.length > planned.limit) {
    refuse([{ at: '/candidates', message: `holds ${value.candidates.length}, and task '${task}' takes at most ${planned.limit} — hand in the ${planned.limit} most severe` }], { task });
  }
  const repo = checkoutOf(round);
  const kept = [];
  const rejected = [];
  const unreachable = [];
  value.candidates.forEach((c, i) => {
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
  const notes = [];
  let state = 'covered';
  if (round.req.mode === 'round' && rejected.length && !kept.length) {
    state = 'partial';
    notes.push('every anchor this source gave misses the snapshot — it reviewed something other than this change');
  } else if (rejected.length) {
    notes.push(`run-warning: ${rejected.length} candidate(s) anchored outside the snapshot were dropped`);
  }
  const claimed = claimJson(path.join(round.dir, 'sources', `${task}.json`), {
    task, source, submitted_at: new Date().toISOString(), candidates: kept, rejected,
  });
  if (!claimed) {
    refuse([{ at: '', message: `task '${task}' already holds a submission — hand this carrier in under a --task of its own` }], { task });
  }
  writeJson(path.join(round.dir, 'sources', `${task}.status.json`), {
    task, source, state, candidates: kept.length, rejected: rejected.length, notes, at: new Date().toISOString(),
  });
  answer({ accepted: true, task, source, stored: kept.length, rejected, unreachable, state, notes });
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
  const { candidates, rejected } = merged(round);
  const tasks = sourceFiles(round.dir).map((f) => statusOf(round.dir, f.replace(/\.json$/, ''))).filter(Boolean);
  answer({ read: true, round: round.id, candidates, rejected, tasks });
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
  const prior = append ? readJson(qf) : null;
  // Digits or no flag at all: `Number` reads `Infinity` and `1e3` as numbers, and the
  // sentinel for "no budget" is the flag's absence rather than a word a caller can pass.
  if (opts['--budget'] !== undefined && !/^[0-9]+$/.test(opts['--budget'])) die('--budget must be a whole number');
  // A round's budget is its rung's, from the plan, where the caller names none — less
  // whatever an earlier queue of the round already spent.
  const p = planOf(round);
  let budget = Infinity;
  if (opts['--budget'] !== undefined) budget = Number(opts['--budget']);
  else if (p) budget = Math.max(0, p.budget - (prior ? prior.queue.length : 0));
  const seen = new Set(prior ? [...prior.queue, ...prior.reused, ...prior.budget_cut, ...prior.unreachable] : []);
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
  if (critical.length > budget) {
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
  const q = prior
    ? {
      queue: [...prior.queue, ...order],
      reused: [...prior.reused, ...reused],
      budget_cut: [...prior.budget_cut, ...cut],
      unreachable: [...prior.unreachable, ...unreachable],
      stop: prior.stop || stop,
      reason: [prior.reason, reason].filter(Boolean).join('; ') || null,
    }
    : { queue: order, reused, budget_cut: cut, unreachable, stop, reason };
  writeJson(qf, q);
  // The answer names what this call queued; the file holds the whole queue.
  answer({ read: true, round: round.id, ...q, queue: order, reused, budget_cut: cut, unreachable, budget: Number.isFinite(budget) ? budget : null });
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
    expected = readJson(qf).queue;
  }
  // Presence alone answers: a file lands whole (writeJson renames it into place), so
  // nothing here needs to parse what another process is writing.
  const pending = () => expected.filter((x) => !existsSync(what === 'tasks'
    ? path.join(round.dir, 'sources', `${x}.status.json`)
    : path.join(round.dir, 'verdicts', `${x}.json`)));
  const t0 = Date.now();
  const tick = () => {
    const left = pending();
    const waited = Math.round((Date.now() - t0) / 1000);
    if (!left.length || Date.now() - t0 >= limit * 1000) {
      answer({ read: true, round: round.id, for: what, complete: left.length === 0, pending: left, waited_s: waited });
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
      if (!bySource.has(source)) bySource.set(source, { source, states: [], tasks: 0, candidates: 0, rejected: 0, notes: [], missing: [] });
      return bySource.get(source);
    };
    const sdir = path.join(round.dir, 'sources');
    const statuses = existsSync(sdir)
      ? readdirSync(sdir).filter((f) => f.endsWith('.status.json')).sort().map((f) => readJson(path.join(sdir, f)))
      : [];
    for (const s of statuses) {
      const row = rowOf(s.source);
      row.states.push(s.state);
      row.tasks += 1;
      row.candidates += s.candidates;
      row.rejected += s.rejected;
      row.notes.push(...(s.notes || []));
    }
    // A task the plan launched that never answered, and a source the round was opened
    // for that nothing answered for, are reviewers missing — never rows left out, since
    // silence would read as nothing to report.
    const answered = new Set(statuses.map((s) => s.task));
    for (const t of plannedTasks(p)) if (!answered.has(t.task)) rowOf(t.source).missing.push(t.task);
    for (const source of req.sources || []) rowOf(source);
    // A source is as covered as its least covered task; one whose finders the conductor
    // ran itself, with no agents to hand them to, is no better than depth.
    const worst = ['unavailable', 'partial', 'depth', 'nothing', 'covered', 'n/a'];
    const worse = (a, b) => (worst.indexOf(a) <= worst.indexOf(b) ? a : b);
    const finders = new Set(plannedTasks(p).filter((t) => t.kind !== 'codex').map((t) => t.source));
    for (const row of bySource.values()) {
      let state = row.tasks ? worst.find((w) => row.states.includes(w)) : 'unavailable';
      if (!row.tasks && !row.missing.length) row.notes.push('no task of this source submitted anything');
      if (row.missing.length) {
        row.notes.push(`planned task(s) with no answer: ${row.missing.join(', ')}`);
        state = worse(state, 'partial');
      }
      if (p?.depth && finders.has(row.source)) state = worse(state, 'depth');
      coverage.push({ source: row.source, state, tasks: row.tasks, candidates: row.candidates, rejected: row.rejected, notes: row.notes });
    }
  }

  const findings = [];
  const refuted = [];
  const drifted = new Set();
  const headBlob = new Map((req.files || []).map((f) => [f.path, f.blob_head]));
  // What the finders read of a file: its blob at init where the diff lists it, and
  // otherwise the merge base's — a tracked file the diff does not list stood as the merge
  // base has it. An untracked one was never theirs to read.
  const elsewhere = req.mode !== 'round' ? [] : all.flatMap((u) => {
    const v = verdictOf(round.dir, u.unit);
    return v && !v.reused ? v.evidence.filter((e) => e.side === 'head').map((e) => e.path) : [];
  }).filter((f) => !headBlob.has(f) && !(req.untracked || []).includes(f));
  const atBase = elsewhere.length ? blobsAt(checkoutOf(round), req.base.merge_base, elsewhere) : new Map();
  const openedWith = (file) => (headBlob.has(file) ? headBlob.get(file) : atBase.get(file));
  for (const u of all) {
    const row = {
      unit: u.unit, file: u.file, line: u.line, side: u.side, summary: u.summary,
      failure_scenario: u.failure_scenario, severity: u.severity, category: u.category, found_by: u.found_by,
    };
    const v = verdictOf(round.dir, u.unit);
    if (u.unreachable) { findings.push({ ...row, verified: 'not measured', reason: 'unreachable' }); continue; }
    if (!v) {
      let reason = 'none ran';
      if (p?.depth) reason = 'depth';
      else if (q && (q.stop || q.budget_cut.includes(u.unit))) reason = 'budget';
      else if (q && q.queue.includes(u.unit)) reason = 'failed';
      findings.push({ ...row, verified: 'not measured', reason });
      continue;
    }
    if (req.mode === 'round' && !v.reused) {
      for (const e of v.evidence) {
        if (e.side !== 'head') continue;
        const was = openedWith(e.path);
        if (was !== undefined && was !== e.blob) drifted.add(e.path);
      }
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
({ init, plan, brief, diff, add, status, merge, units, queue, task, verdict, wait, result })[cmd]();
