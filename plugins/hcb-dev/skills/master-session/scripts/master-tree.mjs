#!/usr/bin/env node
// master-tree.mjs — may a master session's own tree move onto its base, and did it? Prints JSON.
//
// A master reads code on everyone's behalf, so its tree stands detached on the base and
// carries nothing of its own; the one write it ever takes is the switch to a newer tip.
// This measures whether that switch is safe and, with --move, makes it. It never
// fetches — `resolve-base.mjs` refreshes the ref it is handed — and never stashes,
// resets or cleans: a tree that is not safe to move is reported with what stands in it,
// and clearing that is the user's.
//
// Usage: node master-tree.mjs --ref <ref> [--contains <ref>] [--move] [--repo-dir <path>]
//
//   --ref       the commit to stand on: the base's remote-tracking ref, or the local
//               parent where the epic completes locally
//   --contains  a ref --ref must already hold — the remote copy, where --ref is a local
//               parent that must not lag it
//
// Exit 0 either way: `"read": true` with the verdict, or `"read": false` with a
// `reason`. Exit 2 only for a call this script cannot act on at all.

import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { dirOk, refNameOk, runner, writeAll } from '../../../scripts/lib/forge.mjs';

const USAGE = 'usage: node master-tree.mjs --ref <ref> [--contains <ref>] [--move]'
  + ' [--repo-dir <path>]\n';
const die = (m) => { writeAll(2, `master-tree: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { ref: null, contains: null, move: false, repoDir: null };
const FLAGS = { '--ref': 'ref', '--contains': 'contains', '--repo-dir': 'repoDir' };
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--move') { opts.move = true; continue; }
  const key = FLAGS[argv[i]];
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
if (opts.contains !== null && !refNameOk(opts.contains)) {
  die(`--contains '${opts.contains}' is not a ref this can read`);
}
// A directory, proved here: passed on as `cwd` it would come back as a call that failed
// with nothing on stderr, which reads as a checkout that would not answer.
if (opts.repoDir !== null && !dirOk(opts.repoDir)) die(`--repo-dir '${opts.repoDir}' is not a directory`);

const git = runner(opts.repoDir || process.cwd(), 'git');

const LIST = 20;
const answer = {
  read: false,
  // Only a linked worktree is a tree a master may move; `false` here means move nothing.
  linked: null,
  head: null, detached: null, branch: null,
  ref: { name: opts.ref, sha: null },
  contains: opts.contains === null ? null : { name: opts.contains, sha: null, held: null },
  // A sparse checkout holds part of the tree on disk: its files answer for the base only
  // through the base's own objects.
  sparse: null,
  // An operation git left half done — a rebase, a merge, a cherry-pick, a sequence of them, a
  // bisect — which a switch would refuse or carry, and which is the user's to finish.
  inProgress: [],
  // What `git status` lists, save a submodule whose checkout merely lags the commit the
  // index records: a switch moves that commit and leaves the checkout where it was, and
  // counting it would stop every move after the first.
  dirty: [], dirtyCount: 0,
  // Commits HEAD carries that neither the base, a remote nor another branch holds: work of
  // this tree's own, or a base rewritten under it. A switch away from them strands them.
  ownWork: [], ownWorkCount: 0,
  behind: null,
  atRef: null,
  blockers: [],
  movable: false,
  // Filters the repository configures, passed through for every read and write of the working
  // tree here: no project code runs in it, so a file under one lands in its stored form.
  filtersOff: [],
  // null: not asked, or blocked · `done`: on the base, clean · `already`: detached on it
  // already · `refused`: git would not switch and HEAD stands where it stood · `dirty`: on
  // the base, but the switch left changes behind · `unread`: where HEAD went could not be
  // read. `moveError` carries git's words wherever the switch did not come off clean.
  move: null, moveError: null,
  reason: null,
};
const finish = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (reason) => { answer.reason = reason; finish(); };
const why = (r) => (r.timedOut ? 'timed out' : r.line());
const listed = (field, lines) => {
  answer[`${field}Count`] = lines.length;
  answer[field] = lines.slice(0, LIST);
};

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
  const b = h.ok ? git(['symbolic-ref', '--quiet', '--short', 'HEAD']) : null;
  // 1 is git's "detached", said without a word; any other failure did not answer.
  if (!h.ok || (!b.ok && b.code !== 1)) {
    const what = !h.ok ? `HEAD names no commit (${why(h)})` : `whether HEAD is on a branch (${why(b)})`;
    if (strict) refuse(`could not read ${what}`);
    Object.assign(answer, { head: null, branch: null, detached: null, atRef: null });
    return what;
  }
  answer.head = h.out;
  answer.branch = b.ok ? b.out : null;
  answer.detached = !b.ok;
  answer.atRef = answer.head === answer.ref.sha;
  return null;
};

const mustCommit = (ref) => {
  const r = git(['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
  if (!r.ok || !r.out) refuse(`${ref} is not a commit this checkout knows — refresh it, or name another`);
  return r.out;
};
answer.ref.sha = mustCommit(opts.ref);
readHead(true);

if (!answer.linked) {
  answer.blockers.push('this is the main checkout — a master moves no tree but a linked worktree'
    + ' of its own, so here it reads through refs and moves nothing');
  answer.read = true;
  finish();
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

// --- the repository's filters, every one passed through for each read or write of the
// working tree below: a clean or smudge filter is project code, and none runs in this tree.
// 1 from `--get-regexp` is "none configured".
const f = git(['config', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$']);
if (!f.ok && f.code !== 1) refuse(`could not read which filters this repository configures (${why(f)})`);
answer.filtersOff = [...new Set(f.ok ? f.out.split('\n').filter(Boolean)
  .map((l) => l.split(/\s/)[0].replace(/^filter\./, '').replace(/\.(clean|smudge|process)$/, '')) : [])];
const unfiltered = answer.filtersOff.flatMap((n) => ['-c', `filter.${n}.smudge=cat`, '-c', `filter.${n}.clean=cat`,
  '-c', `filter.${n}.process=`, '-c', `filter.${n}.required=false`]);

// --- what stands in the tree. Porcelain v2: every entry opens with its kind, so nothing a
// trim takes off the ends is part of one, and a submodule entry says what changed in it.
// Untracked files and submodules named outright — a config hiding either hides what a
// switch would carry.
const readDirty = () => {
  const st = git([...unfiltered, 'status', '--porcelain=v2', '-z', '--untracked-files=normal', '--ignore-submodules=none']);
  if (!st.ok) return `the working tree's status (${why(st)})`;
  const tokens = st.out.split('\0');
  const out = [];
  // Fields before the path: 8 for an ordinary change, 9 for a rename or copy, 10 for an
  // unmerged one.
  const fields = { 1: 8, 2: 9, u: 10 };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === '' || t[0] === '#' || t[0] === '!') continue;
    if (t[0] === '?') { out.push(`?? ${t.slice(2)}`); continue; }
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
const unread = readDirty();
if (unread) refuse(`could not read ${unread}`);
if (answer.dirtyCount) {
  answer.blockers.push(`the tree carries ${answer.dirtyCount} uncommitted change(s) — a master's tree`
    + ' takes none, and clearing them is the user\'s');
}

// --- work of its own. `--remotes` after `--not` counts every published branch as held, and
// `--branches` every other local one: a host branch cut from the default while the base is an
// epic branch carries commits the base lacks, all held elsewhere — nothing a switch strands.
// The branch HEAD is on is left out of `--branches`, or its own commits would hold themselves.
const own = git(['log', '--no-show-signature', '--format=%H %s', 'HEAD', '--not', answer.ref.sha,
  '--remotes', ...(answer.branch ? [`--exclude=${answer.branch}`] : []), '--branches', '--']);
if (!own.ok) refuse(`could not list the commits HEAD carries beyond the base (${why(own)})`);
listed('ownWork', own.out.split('\n').filter(Boolean));
if (answer.ownWorkCount) {
  answer.blockers.push(`HEAD carries ${answer.ownWorkCount} commit(s) neither ${opts.ref}, a remote nor`
    + ' another branch holds — work of this tree\'s own, or a base rewritten under it; a switch would'
    + ' strand them');
}

const behind = git(['rev-list', '--count', `HEAD..${answer.ref.sha}`, '--']);
if (!behind.ok || !/^[0-9]+$/.test(behind.out)) refuse(`could not count what the base has that HEAD lacks (${why(behind)})`);
answer.behind = Number(behind.out);

answer.movable = answer.blockers.length === 0;

if (opts.move && answer.movable) {
  if (answer.atRef && answer.detached) {
    answer.move = 'already';
  } else {
    // By the commit read above, not by the name: a fetch between the two would put HEAD on a
    // tip nothing here measured. An ignored file the base tracks is refused rather than
    // overwritten, no hook runs, and no submodule is moved under its own work.
    const s = git(['-c', 'core.hooksPath=/dev/null', ...unfiltered, 'switch', '--detach', '--no-overwrite-ignore',
      '--no-recurse-submodules', '--quiet', answer.ref.sha]);
    // Git's whole message: its last line is "Aborting", and the reason sits above it.
    if (!s.ok) answer.moveError = s.timedOut ? 'timed out' : (s.err || 'no detail');
    // The tree is read again whatever the switch answered: an interrupted one may have
    // written half of what it meant to.
    const lost = readHead(false);
    const after = readDirty();
    if (lost || after) {
      answer.move = 'unread';
      answer.moveError = [answer.moveError, `after the switch, could not read ${lost || after}`]
        .filter(Boolean).join(' — ');
    } else if (!(answer.atRef && answer.detached)) {
      answer.move = 'refused';
      if (!answer.moveError) answer.moveError = `git answered the switch, yet HEAD stands on ${answer.head}`;
    } else {
      answer.behind = 0;
      answer.move = answer.dirtyCount ? 'dirty' : 'done';
      if (answer.dirtyCount && !answer.moveError) answer.moveError = 'the switch left changes in the tree';
    }
  }
}

answer.read = true;
finish();
