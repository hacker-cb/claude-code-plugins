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
//   node review-round.mjs add     --round <id> --source <source> [--task <task>] [--file <json>]
//   node review-round.mjs merge   --round <id>
//   node review-round.mjs units   --round <id> [--file <json>]
//   node review-round.mjs queue   --round <id> [--budget <n>]
//   node review-round.mjs task    --round <id> --unit <unit>
//   node review-round.mjs verdict --round <id> --unit <unit> [--file <json>]
//   node review-round.mjs wait    --round <id> --for tasks|verdicts [--expect <list>] [--timeout-s <n>]
//   node review-round.mjs result  --round <id>
//
// The JSON `add`, `units` and `verdict` take arrives on stdin, or from `--file`.
// Exit: 0 answered; 1 a submission refused, the errors saying what to fix; 2 called
// wrong; 3 the round or the repository could not be read.

import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { writeAll } from './lib/forge.mjs';
import { schemaDir, validate } from './lib/schema.mjs';

const load = schemaDir(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas'));

const USAGE = 'usage: node review-round.mjs <init|add|merge|units|queue|task|verdict|wait|result> [flags]'
  + ' — see the header of this file\n';
const die = (m) => { writeAll(2, `review-round: ${m}\n${USAGE}`); process.exit(2); };
const answer = (obj, code = 0) => { writeAll(1, `${JSON.stringify(obj, null, 2)}\n`); process.exit(code); };
const cannot = (reason) => answer({ read: false, reason }, 3);
const refuse = (errors, extra = {}) => answer({ accepted: false, errors, ...extra }, 1);

const SPEC = {
  init: ['--mode', '--base', '--tree', '--rung', '--sources', '--language', '--narrow'],
  add: ['--round', '--source', '--task', '--file'],
  merge: ['--round'],
  units: ['--round', '--file'],
  queue: ['--round', '--budget'],
  task: ['--round', '--unit'],
  verdict: ['--round', '--unit', '--file'],
  wait: ['--round', '--for', '--expect', '--timeout-s'],
  result: ['--round'],
};
const [cmd, ...argv] = process.argv.slice(2);
if (!cmd || !SPEC[cmd]) die(cmd ? `unknown subcommand '${cmd}'` : 'a subcommand is required');
const opts = {};
for (let i = 0; i < argv.length; i += 1) {
  if (!SPEC[cmd].includes(argv[i])) die(`${cmd} takes no argument '${argv[i]}'`);
  if (argv[i + 1] === undefined) die(`${argv[i]} needs a value`);
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
const WAIT_CAP_S = 540; // under the Bash tool's 10-minute ceiling, so one window is one call

// A revision git is to read — a branch, a tag, a sha, `HEAD~1` — held only to never
// reading as an option; whether it names anything is git's to say where it is resolved.
const revOk = (v) => typeof v === 'string' && v !== '' && !v.startsWith('-') && !/[\u0000-\u001f\u007f]/.test(v);
const real = (p) => { try { return realpathSync(p); } catch { return null; } };
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
// Written beside the target and renamed over it: a reader of the store — `wait`, a second
// checker, `result` — sees the old file or the new one, never a truncated half.
const writeJson = (file, data) => {
  const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, file);
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
  if ((st.mode & 0o022) !== 0) cannot(`${root} is writable by others`);
}

// Raw output, not trimmed: a line count taken after a trim is short by the blank lines
// the trim ate, and an anchor on the last line of such a file would read as outside it.
const gitIn = (cwd) => (args, input) => {
  const r = spawnSync('git', args, {
    cwd,
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
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
  if (tree.ref) {
    const r = repo.git(['show', `${tree.ref}:${file}`]);
    return r.ok ? { text: r.out } : { missing: `${file} is not in ${tree.ref.slice(0, 7)}` };
  }
  const abs = path.join(repo.top, file);
  const resolved = real(abs);
  if (!resolved || !inside(resolved, repo.top)) return { missing: `${file} is not in the working tree` };
  if (!statSync(resolved).isFile()) return { missing: `${file} is not a file` };
  // A round reviews tracked files: an untracked or ignored one is outside every diff.
  if (req.mode === 'round' && repo.git(['--literal-pathspecs', 'ls-files', '-z', '--', file]).out === '') {
    return { missing: `${file} is not tracked — a round reviews tracked files only` };
  }
  return { text: readFileSync(resolved, 'utf8') };
}

function blobAt(repo, req, file, side) {
  if (!relOk(file)) return null;
  const tree = treeOf(req, side);
  if (tree.none) return null;
  if (tree.ref) {
    const r = repo.git(['rev-parse', '--verify', '-q', `${tree.ref}:${file}`]);
    return r.ok ? r.out.trim() : null;
  }
  const resolved = real(path.join(repo.top, file));
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
    const listed = repo.git(['diff', '--name-status', '-z', mergeBase]);
    const diff = repo.git(['diff', mergeBase]);
    const untracked = repo.git(['ls-files', '--others', '--exclude-standard', '-z']);
    if (!listed.ok || !diff.ok || !untracked.ok) cannot(`git could not diff ${mergeBase.slice(0, 7)} against the working tree`);
    const tokens = listed.out.split('\0').filter((t) => t !== '');
    const files = [];
    for (let i = 0; i < tokens.length;) {
      const status = tokens[i];
      const renamed = /^[RC]/.test(status);
      const from = renamed ? tokens[i + 1] : tokens[i + 1];
      const to = renamed ? tokens[i + 2] : tokens[i + 1];
      i += renamed ? 3 : 2;
      files.push({ path: to, from: renamed ? from : undefined, status: status[0] });
    }
    for (const f of files) {
      f.blob_head = f.status === 'D' ? null : blobAt(repo, { mode: 'round' }, f.path, 'head');
      const baseBlob = repo.git(['rev-parse', '--verify', '-q', `${mergeBase}:${f.from || f.path}`]);
      f.blob_base = f.status === 'A' || !baseBlob.ok ? null : baseBlob.out.trim();
    }
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

// ----------------------------------------------------------------------------------- add
function add() {
  const round = openRound();
  const source = opts['--source'];
  if (!source || !SOURCE_ID.test(source)) die('--source is required: lowercase letters, digits, ":" and "-"');
  const task = opts['--task'] || source.replace(/:/g, '-');
  if (!TASK_ID.test(task)) die(`--task '${task}' is not a task id: lowercase letters, digits and "-"`);
  // Grouping closes collection: a candidate arriving after `units` would sit in no group,
  // and the result reads groups — it would vanish without anybody having dropped it.
  if (existsSync(path.join(round.dir, 'units.json'))) {
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
  writeJson(path.join(round.dir, 'sources', `${task}.json`), {
    task, source, submitted_at: new Date().toISOString(), candidates: kept, rejected,
  });
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
  const value = submission();
  const { candidates } = merged(round);
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
      if (!byId.has(m)) errors.push({ at: `${at}/members`, message: `'${m}' is not a candidate of this round` });
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
      unit: `U${i + 1}`, lead: lead.id, members: u.members,
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
      unit: `U${built.length + 1}`, lead: c.id, members: [c.id], file: c.file, line: c.line, side: c.side,
      summary: c.summary, failure_scenario: c.failure_scenario, category: c.category, severity: c.severity,
      found_by: [c.source], carried: c.verdict ? [c.verdict] : [], unreachable: c.unreachable,
    });
  }
  writeJson(path.join(round.dir, 'units.json'), { units: built });
  // A new grouping renumbers the groups, so a queue and verdicts built on the old one
  // would attach to claims they never checked.
  rmSync(path.join(round.dir, 'queue.json'), { force: true });
  rmSync(path.join(round.dir, 'verdicts'), { recursive: true, force: true });
  answer({
    accepted: true,
    units: built.map((u) => ({ unit: u.unit, lead: u.lead, members: u.members, severity: u.severity, found_by: u.found_by, unreachable: u.unreachable })),
  });
}

// --------------------------------------------------------------------------------- queue
function queue() {
  const round = openRound();
  const f = path.join(round.dir, 'units.json');
  if (!existsSync(f)) cannot(`round ${round.id} has no units yet — run units first`);
  const all = readJson(f).units;
  const budget = opts['--budget'] === undefined ? Infinity : Number(opts['--budget']);
  if (!Number.isInteger(budget) && budget !== Infinity) die('--budget must be a whole number');
  if (budget < 0) die('--budget must not be negative');
  const repo = all.some((u) => u.carried.length) ? checkoutOf(round) : null;
  // A queue starts verification over: a verdict left from an earlier queue answered a
  // check this one has not asked for, and would count as done.
  rmSync(path.join(round.dir, 'verdicts'), { recursive: true, force: true });
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
  const q = { queue: order, reused, budget_cut: cut, unreachable, stop, reason };
  writeJson(path.join(round.dir, 'queue.json'), q);
  answer({ read: true, round: round.id, ...q });
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
  // The revision a verdict names is the one it read: the commit the round opened on,
  // marked `+wt` where anything it read on the working tree differs from that commit —
  // untracked, edited before the round opened, or edited since.
  let snapshot = round.req.snapshot;
  if (treeOf(round.req, 'head').worktree) {
    const at = round.req.head.sha;
    const moved = evidence.some((e) => e.side === 'head'
      && repo.git(['rev-parse', '--verify', '-q', `${at}:${e.path}`]).out.trim() !== e.blob);
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
    if (!expected.length) die('--for tasks needs --expect, the tasks launched');
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
  const pending = merged(round).candidates.length;
  // Candidates nobody grouped would leave an empty result that reads as a clean review.
  if (!existsSync(uf) && pending) cannot(`round ${round.id} holds ${pending} candidate(s) and no groups — run units first`);
  const all = existsSync(uf) ? readJson(uf).units : [];
  const q = existsSync(qf) ? readJson(qf) : null;
  const warnings = [...(req.warnings || [])];

  const coverage = [];
  if (req.mode === 'round') {
    const bySource = new Map();
    for (const f of sourceFiles(round.dir)) {
      const s = statusOf(round.dir, f.replace(/\.json$/, ''));
      if (!s) continue;
      const row = bySource.get(s.source) || { source: s.source, states: [], tasks: 0, candidates: 0, rejected: 0, notes: [] };
      row.states.push(s.state);
      row.tasks += 1;
      row.candidates += s.candidates;
      row.rejected += s.rejected;
      row.notes.push(...(s.notes || []));
      bySource.set(s.source, row);
    }
    // A source the round was opened for and that never submitted is a reviewer missing,
    // not a row to leave out: silence here would read as nothing to report.
    for (const source of req.sources || []) {
      if (!bySource.has(source)) {
        bySource.set(source, { source, states: ['unavailable'], tasks: 0, candidates: 0, rejected: 0, notes: ['no task of this source submitted anything'] });
      }
    }
    // A source is as covered as its least covered task.
    const worst = ['unavailable', 'partial', 'depth', 'nothing', 'covered', 'n/a'];
    for (const row of bySource.values()) {
      const state = worst.find((w) => row.states.includes(w));
      coverage.push({ source: row.source, state, tasks: row.tasks, candidates: row.candidates, rejected: row.rejected, notes: row.notes });
    }
  }

  const findings = [];
  const refuted = [];
  const drifted = new Set();
  const headBlob = new Map((req.files || []).map((f) => [f.path, f.blob_head]));
  let repo = null;
  // What the finders read of a file: its blob at init where the diff lists it, and
  // otherwise the merge base's — a tracked file the diff does not list stood as the merge
  // base has it. An untracked one was never theirs to read.
  const openedWith = (file) => {
    if (headBlob.has(file)) return headBlob.get(file);
    if ((req.untracked || []).includes(file)) return undefined;
    repo ||= checkoutOf(round);
    const r = repo.git(['rev-parse', '--verify', '-q', `${req.base.merge_base}:${file}`]);
    return r.ok ? r.out.trim() : undefined;
  };
  for (const u of all) {
    const row = {
      unit: u.unit, file: u.file, line: u.line, side: u.side, summary: u.summary,
      failure_scenario: u.failure_scenario, severity: u.severity, category: u.category, found_by: u.found_by,
    };
    const v = verdictOf(round.dir, u.unit);
    if (u.unreachable) { findings.push({ ...row, verified: 'not measured', reason: 'unreachable' }); continue; }
    if (!v) {
      let reason = 'none ran';
      if (q && (q.stop || q.budget_cut.includes(u.unit))) reason = 'budget';
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

({ init, add, merge, units, queue, task, verdict, wait, result })[cmd]();
