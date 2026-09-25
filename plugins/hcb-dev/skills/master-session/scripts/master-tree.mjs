#!/usr/bin/env node
// master-tree.mjs — may a master session's own tree move onto its base, and did it? Prints JSON.
//
// A master reads code on everyone's behalf, so its tree stands detached on the base and
// carries nothing of its own; the one write it ever takes is the switch to a newer tip.
// This measures whether that switch is safe and, with --move, makes it. It does not fetch
// the base — `resolve-base.mjs` refreshes the ref it is handed — and never stashes,
// resets or cleans: a tree that is not safe to move is reported with what stands in it,
// and clearing that is the user's. With --since it also names what the base took after
// that commit, which is how a master learns of a landing nobody reported.
//
// Usage: node master-tree.mjs --ref <ref> [--contains <ref>] [--since <commit>] [--move]
//          [--repo-dir <path>]
//
//   --ref       the commit to stand on: the base's remote-tracking ref, or the local
//               parent where the epic completes locally
//   --contains  a ref --ref must already hold — the remote copy, where --ref is a local
//               parent that must not lag it
//   --since     the base's commit the master has taken landings up to
//
// Exit 0 either way: `"read": true` with the verdict, or `"read": false` with a
// `reason`. Exit 2 only for a call this script cannot act on at all.

import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirOk, refNameOk, runner, writeAll } from '../../../scripts/lib/forge.mjs';

const OWNERS = fileURLToPath(new URL('../../../scripts/worktree-owners.mjs', import.meta.url));
const USAGE = 'usage: node master-tree.mjs --ref <ref> [--contains <ref>] [--since <commit>] [--move]'
  + ' [--repo-dir <path>]\n';
const die = (m) => { writeAll(2, `master-tree: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { ref: null, contains: null, since: null, move: false, repoDir: null };
const FLAGS = { '--ref': 'ref', '--contains': 'contains', '--since': 'since', '--repo-dir': 'repoDir' };
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--move') { opts.move = true; continue; }
  // Own keys only: `constructor` or `__proto__` would otherwise read as a flag.
  const key = Object.hasOwn(FLAGS, argv[i]) ? FLAGS[argv[i]] : null;
  if (!key) die(`unknown argument '${argv[i]}'`);
  if (argv[i + 1] === undefined) die(`${argv[i]} needs a value`);
  opts[key] = argv[i + 1];
  i += 1;
}
// Git's own rules, not a URL segment's: the base `resolve-base.mjs` accepted reaches here
// as a whole ref, and a branch named `epic/#42` is as legitimate as `main`. Nothing here
// goes near a URL or a shell — every value is one argv word.
if (!opts.ref) die('--ref is required — the commit the tree is to stand on');
if (!refNameOk(opts.ref)) die(`--ref '${opts.ref}' is not a ref this can read`);
for (const f of ['contains', 'since']) {
  if (opts[f] !== null && !refNameOk(opts[f])) die(`--${f} '${opts[f]}' is not a ref this can read`);
}
// A directory, proved here: passed on as `cwd` it would come back as a call that failed
// with nothing on stderr, which reads as a checkout that would not answer.
if (opts.repoDir !== null && !dirOk(opts.repoDir)) die(`--repo-dir '${opts.repoDir}' is not a directory`);

const cwd = opts.repoDir || process.cwd();
const git = runner(cwd, 'git');

const LIST = 20;
const answer = {
  read: false,
  // Only a linked worktree is a tree a master may move; `false` here means move nothing.
  linked: null,
  // Where HEAD stood when this run began; `head` is where it stands now.
  from: null,
  head: null, detached: null, branch: null,
  ref: { name: opts.ref, sha: null },
  contains: opts.contains === null ? null : { name: opts.contains, sha: null, held: null },
  // `held` false: the base no longer holds that commit — rewritten since. `reason` wherever
  // `landed` could not be told.
  since: opts.since === null ? null : { name: opts.since, sha: null, held: null, reason: null },
  // Live sessions other than this run standing in this worktree: a move changes files
  // under them.
  others: [],
  // A sparse checkout holds part of the tree on disk: its files answer for the base only
  // through the base's own objects.
  sparse: null,
  // Paths whose index flags keep a change out of `git status` (assume-unchanged,
  // skip-worktree): on disk they need not be the commit `head` names.
  hidden: [], hiddenCount: 0,
  // Every submodule path, and a former submodule's checkout a switch left behind: its files
  // on disk are not the base's, and are read through the submodule's own objects.
  submodules: [],
  // An operation git left half done — a rebase, a merge, a cherry-pick, a sequence of them, a
  // bisect — which a switch would refuse or carry, and which is the user's to finish.
  inProgress: [],
  // What `git status` lists, save a submodule whose checkout merely lags the commit the index
  // records, and the checkout of one the base removed: a switch leaves both, and counting them
  // would stop every move after the first.
  dirty: [], dirtyCount: 0,
  // Commits HEAD carries that neither the base, a remote nor another branch holds: work of
  // this tree's own, or a base rewritten under it. A switch away from them strands them.
  ownWork: [], ownWorkCount: 0,
  // What the base took after `since`: its first-parent commits, newest first. null where
  // --since was not given, or `since` says why it could not be told.
  landed: null, landedCount: null,
  atRef: null,
  blockers: [],
  movable: false,
  // null: not asked, or blocked · `done`: on the base, clean · `already`: detached on it
  // already · `dirty`: the switch left changes in the tree, HEAD standing where `head` says ·
  // `refused`: git would not switch, and HEAD stands where it stood · `unread`: what the
  // switch left could not be read. `moveError` carries git's words wherever the switch did
  // not come off clean.
  move: null, moveError: null,
  reason: null,
};
const finish = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (reason) => { answer.reason = reason; finish(); };
const why = (r) => (r.timedOut ? 'timed out' : r.line());
const listed = (field, lines, count = lines.length) => {
  answer[`${field}Count`] = count;
  answer[field] = lines.slice(0, LIST);
};
// A range of commits counted apart and listed only as far as the answer shows — either can
// run to thousands. Returns what git would not give, or null.
const span = (field, flags, range) => {
  const n = git(['rev-list', ...flags, '--count', ...range]);
  if (!n.ok || !/^[0-9]+$/.test(n.out)) return why(n);
  const l = n.out === '0' ? { ok: true, out: '' }
    : git(['log', '--no-show-signature', ...flags, `--max-count=${LIST}`, '--format=%H %s', ...range]);
  if (!l.ok) return why(l);
  listed(field, l.out.split('\n').filter(Boolean), Number(n.out));
  return null;
};

// Git takes these over the directory it runs in: set, they name a tree other than this
// session's, and the switch would land there.
const steered = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']
  .filter((n) => process.env[n]);
if (steered.length) {
  refuse(`${steered.join(', ')} set in this session's environment — git would answer about the tree`
    + ' that names, not the one this session stands in');
}

// --- which tree this is. Asked one at a time and in the absolute form: a path may carry a
// newline, and from a subdirectory of the main checkout git answers the common directory
// relative. Anything but an absolute path — a git too old to know the flag prints the flag
// itself back — is unread, never a second tree.
const dir = (flag) => {
  const r = git(['rev-parse', '--path-format=absolute', flag]);
  if (!r.ok || !isAbsolute(r.out)) refuse(`could not read this tree's ${flag.slice(2)} (${r.ok ? r.out : why(r)})`);
  try { return realpathSync(r.out); } catch (e) { return refuse(`could not resolve ${r.out} (${e.code})`); }
};
const gitDir = dir('--git-dir');
answer.linked = gitDir !== dir('--git-common-dir');

// --- where HEAD stands. `strict` refuses what it cannot read; after a switch it reports
// instead, since the tree has moved whatever the read says, and clears what it no longer knows.
const readHead = (strict) => {
  const h = git(['rev-parse', '--verify', '-q', 'HEAD^{commit}']);
  // The full name, cut here: `--short` answers `heads/<name>` where a tag shares the name,
  // and the `--exclude` below matches a branch's name without its `refs/heads/`.
  const b = h.ok ? git(['symbolic-ref', '--quiet', 'HEAD']) : null;
  // 1 is git's "detached", said without a word; any other failure did not answer.
  if (!h.ok || (!b.ok && b.code !== 1)) {
    const what = !h.ok ? `HEAD names no commit (${why(h)})` : `whether HEAD is on a branch (${why(b)})`;
    if (strict) refuse(`could not read ${what}`);
    Object.assign(answer, { head: null, branch: null, detached: null, atRef: null });
    return what;
  }
  answer.head = h.out;
  answer.branch = b.ok ? b.out.replace(/^refs\/heads\//, '') : null;
  answer.detached = !b.ok;
  answer.atRef = answer.head === answer.ref.sha;
  return null;
};
const onBase = () => answer.atRef && answer.detached;

const mustCommit = (ref) => {
  const r = git(['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
  if (!r.ok || !r.out) refuse(`${ref} is not a commit this checkout knows — refresh it, or name another`);
  return r.out;
};
answer.ref.sha = mustCommit(opts.ref);
readHead(true);
answer.from = answer.head;

// Before anything else is read: whether the base holds its remote copy is an answer the
// caller needs from the main checkout as much as from a tree it may move.
if (answer.contains) {
  answer.contains.sha = mustCommit(opts.contains);
  const a = git(['merge-base', '--is-ancestor', answer.contains.sha, answer.ref.sha]);
  if (a.ok) {
    answer.contains.held = true;
  } else if (a.code === 1) {
    answer.contains.held = false;
    answer.blockers.push(`${opts.ref} lacks commits ${opts.contains} carries — a local parent`
      + ' behind or apart from its remote copy is not the base yet');
  } else {
    refuse(`could not read whether ${opts.ref} holds ${opts.contains} (${why(a)})`);
  }
}

// --- what landed: asked of the base, not of this tree, so the main checkout answers it too.
// Each first-parent commit is a merge, a squash, or one of a rebased request's commits.
if (answer.since) {
  const sn = answer.since;
  const c = git(['rev-parse', '--verify', '-q', `${opts.since}^{commit}`]);
  if (!c.ok || !c.out) {
    sn.reason = `${opts.since} is not a commit this checkout knows`;
  } else {
    sn.sha = c.out;
    const a = git(['merge-base', '--is-ancestor', sn.sha, answer.ref.sha]);
    if (a.ok) sn.held = true;
    else if (a.code === 1) {
      sn.held = false;
      sn.reason = `${opts.ref} no longer holds ${opts.since} — the base was rewritten since, and what landed`
        + ' cannot be told from it';
    } else sn.reason = `could not read whether ${opts.ref} holds ${opts.since} (${why(a)})`;
    const lost = sn.held ? span('landed', ['--first-parent'], [`${sn.sha}..${answer.ref.sha}`, '--']) : null;
    if (lost) sn.reason = `could not list what the base took after ${opts.since} (${lost})`;
  }
}

if (!answer.linked) {
  answer.blockers.push('this is the main checkout — a master moves no tree but a linked worktree'
    + ' of its own, so here it reads through refs and moves nothing');
  answer.read = true;
  finish();
}

const top = dir('--show-toplevel');

// --- who else stands in this tree: the live-session registry, read by the script that owns
// it. A registry that could not be read leaves the question open, which stops a move as a
// second session does.
const o = spawnSync(process.execPath, [OWNERS, ...(opts.repoDir ? ['--repo-dir', opts.repoDir] : [])],
  { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
let owners = null;
try { owners = JSON.parse(o.stdout); } catch { owners = null; }
if (!owners || owners.read !== true || !Array.isArray(owners.worktrees)) {
  refuse(`could not read who stands in this worktree (${owners?.reason || (o.stderr || '').trim() || 'no answer'})`);
}
const mine = owners.worktrees.find((w) => w && w.isHere);
answer.others = (mine?.sessions || []).filter((s) => !s.isThisRun).map((s) => s.pid);
if (owners.probeFailed || !mine) {
  answer.blockers.push('the live-session registry could not be read — whether another session'
    + ' stands in this tree is unknown');
}
if (answer.others.length) {
  answer.blockers.push(`another session stands in this tree (pid ${answer.others.join(', ')}) — a move`
    + ' would change files under it');
}

const sp = git(['config', '--bool', 'core.sparseCheckout']);
// 1 is "not set"; any other failure did not answer.
if (!sp.ok && sp.code !== 1) refuse(`could not read whether this checkout is sparse (${why(sp)})`);
answer.sparse = sp.ok && sp.out === 'true';

for (const name of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD',
  'sequencer', 'BISECT_LOG']) {
  if (existsSync(join(gitDir, name))) answer.inProgress.push(name);
}
if (answer.inProgress.length) {
  answer.blockers.push(`an operation git left half done stands in the tree (${answer.inProgress.join(', ')})`
    + ' — finishing or aborting it is the user\'s');
}

// --- what the index says of the tree: each entry's tag and mode. A lowercase tag is
// assume-unchanged and `S` skip-worktree — either keeps a change out of `git status`; mode
// 160000 is a submodule. Read again after a switch, which changes both.
const readIndex = () => {
  const ls = git(['ls-files', '-s', '-v', '-z']);
  if (!ls.ok) return `the index (${why(ls)})`;
  const hidden = [];
  const subs = [];
  for (const e of ls.out.split('\0')) {
    const m = /^(\S) (\d+) \S+ \d+\t([\s\S]*)$/.exec(e);
    if (!m) continue;
    if (m[1] !== m[1].toUpperCase() || m[1] === 'S') hidden.push(m[3]);
    if (m[2] === '160000') subs.push(m[3]);
  }
  listed('hidden', hidden);
  answer.submodules = subs;
  return null;
};

// --- what stands in the tree. Porcelain v2: every entry opens with its kind, so nothing a
// trim takes off the ends is part of one, and a submodule entry says what changed in it.
// Untracked files and submodules named outright — a config hiding either hides what a
// switch would carry.
const readDirty = () => {
  const st = git(['status', '--porcelain=v2', '-z', '--untracked-files=normal', '--ignore-submodules=none']);
  if (!st.ok) return `the working tree's status (${why(st)})`;
  const tokens = st.out.split('\0');
  const out = [];
  // Fields before the path: 8 for an ordinary change, 9 for a rename or copy, 10 for an
  // unmerged one.
  const fields = { 1: 8, 2: 9, u: 10 };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === '' || t[0] === '#' || t[0] === '!') continue;
    if (t[0] === '?') {
      const path = t.slice(2);
      // A directory holding its own `.git` is the checkout of a submodule the base removed.
      if (path.endsWith('/') && existsSync(join(top, path, '.git'))) answer.submodules.push(path.slice(0, -1));
      else out.push(`?? ${path}`);
      continue;
    }
    const n = fields[t[0]];
    if (!n) return 'the working tree\'s status, which came back in a shape this cannot read';
    const parts = t.split(' ');
    const [, xy, sub] = parts;
    let entry = `${xy} ${parts.slice(n).join(' ')}`;
    // A rename or a copy carries its source as the next field, which is not an entry.
    if (t[0] === '2') { i += 1; entry += ` (from ${tokens[i] ?? 'an unnamed path'})`; }
    if (!(xy === '.M' && sub === 'SC..')) out.push(entry);
  }
  listed('dirty', out);
  return null;
};
const readTree = () => readIndex() || readDirty();
const unread = readTree();
if (unread) refuse(`could not read ${unread}`);
if (answer.dirtyCount) {
  answer.blockers.push(`the tree carries ${answer.dirtyCount} uncommitted change(s) — a master's tree`
    + ' takes none, and clearing them is the user\'s');
}

// --- work of its own. `--remotes` after `--not` counts every published branch as held, and
// `--branches` every other local one: a host branch cut from the default while the base is an
// epic branch carries commits the base lacks, all held elsewhere — nothing a switch strands.
// The branch HEAD is on is left out of `--branches`, or its own commits would hold themselves.
const own = span('ownWork', [], ['HEAD', '--not', answer.ref.sha, '--remotes',
  ...(answer.branch ? [`--exclude=${answer.branch}`] : []), '--branches', '--']);
if (own) refuse(`could not list the commits HEAD carries beyond the base (${own})`);
if (answer.ownWorkCount) {
  answer.blockers.push(`HEAD carries ${answer.ownWorkCount} commit(s) neither ${opts.ref}, a remote nor`
    + ' another branch holds — work of this tree\'s own, or a base rewritten under it; a switch would'
    + ' strand them');
}

answer.movable = answer.blockers.length === 0;

if (opts.move && answer.movable) {
  if (onBase()) {
    answer.move = 'already';
  } else {
    // By the commit read above, not by the name: a fetch between the two would put HEAD on a
    // tip nothing here measured. An ignored file the base tracks is refused rather than
    // overwritten, no hook runs, and no submodule is moved under its own work.
    const s = git(['-c', 'core.hooksPath=/dev/null', 'switch', '--detach', '--no-overwrite-ignore',
      '--no-recurse-submodules', '--quiet', answer.ref.sha], 600000);
    // Git's whole message: its last line is "Aborting", and the reason sits above it.
    const said = s.ok ? null : (s.timedOut ? 'timed out' : s.err || 'no detail');
    // The tree is read again whatever the switch answered: an interrupted one may have
    // written half of what it meant to — and one that failed may still have landed, in which
    // case `done` carries git's words beside it.
    const lost = readHead(false);
    const after = readTree();
    const [move, otherwise] = (lost || after) ? ['unread', `after the switch, could not read ${lost || after}`]
      : answer.dirtyCount ? ['dirty', 'the switch left changes in the tree']
        : !onBase() ? ['refused', `git answered the switch, yet HEAD stands on ${answer.head}`]
          : ['done', null];
    answer.move = move;
    // Unread keeps both: what git said, and what could not be read after it.
    answer.moveError = move === 'unread' ? [said, otherwise].filter(Boolean).join(' — ') : said || otherwise;
  }
}

answer.read = true;
finish();
