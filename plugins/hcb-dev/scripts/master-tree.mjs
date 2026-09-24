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

import { realpathSync } from 'node:fs';
import { dirOk, refOk, runner, writeAll } from './lib/forge.mjs';

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
if (!opts.ref) die('--ref is required — the commit the tree is to stand on');
if (!refOk(opts.ref)) die(`--ref '${opts.ref}' is not a ref this can read`);
if (opts.contains !== null && !refOk(opts.contains)) {
  die(`--contains '${opts.contains}' is not a ref this can read`);
}
// A directory, proved here: passed on as `cwd` it would come back as a call that failed
// with nothing on stderr, which reads as a checkout that would not answer.
if (opts.repoDir !== null && !dirOk(opts.repoDir)) die(`--repo-dir '${opts.repoDir}' is not a directory`);

const git = runner(opts.repoDir || process.cwd(), 'git');
if (!git(['rev-parse', '--git-dir']).ok) die('not inside a git checkout');

const LIST = 20;
const answer = {
  read: false,
  // Only a linked worktree is a tree a master may move: the main checkout is the user's
  // and every other session's, and `false` here means move nothing, anywhere.
  linked: null,
  head: null, detached: null, branch: null,
  ref: { name: opts.ref, sha: null },
  contains: opts.contains === null ? null : { name: opts.contains, sha: null, held: null },
  // What `git status` lists, submodules aside: a switch moves a submodule's recorded commit
  // and leaves its checkout where it was, which then lists as modified — every move would
  // read as dirt at the next one. Nothing a master writes lives in a submodule.
  dirty: [], dirtyCount: 0,
  // Commits HEAD carries that neither the base nor any remote holds: work of this tree's
  // own, or a base rewritten under it. A switch away from them strands them.
  ownWork: [], ownWorkCount: 0,
  behind: null,
  atRef: null,
  blockers: [],
  movable: false,
  // null: not asked, or blocked · `done`: switched · `already`: detached on it already ·
  // `refused`: git would not switch, and `moveError` says why
  move: null, moveError: null,
  reason: null,
};
const finish = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (reason) => { answer.reason = reason; finish(); };
const why = (r) => (r.timedOut ? 'timed out' : r.line());
// A path answered by two git commands is not two spellings of two places: `/tmp` is a
// symlink to `/private/tmp` on macOS.
const samePath = (a, b) => {
  if (a === b) return true;
  try { return realpathSync(a) === realpathSync(b); } catch { return false; }
};
const count = (r, what) => {
  if (!r.ok || !/^[0-9]+$/.test(r.out)) refuse(`could not count ${what} (${why(r)})`);
  return Number(r.out);
};

// --- which tree this is. Absolute, both: asked from a subdirectory of the main checkout,
// git answers the git directory absolute and the common one relative, and two spellings
// of one directory compare as two trees — the main checkout read as a worktree of its own.
const dirs = git(['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']);
if (!dirs.ok) refuse(`could not read where this tree's git directory is (${why(dirs)})`);
const [gitDir, commonDir] = dirs.out.split('\n');
if (!gitDir || !commonDir) refuse('git named fewer than two directories for the git and common dirs');
answer.linked = !samePath(gitDir, commonDir);

// --- where HEAD stands
const readHead = () => {
  const h = git(['rev-parse', '--verify', '-q', 'HEAD^{commit}']);
  if (!h.ok) refuse(`HEAD names no commit (${why(h)})`);
  answer.head = h.out;
  const b = git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  // 1 is git's "detached", said without a word; any other failure did not answer.
  if (b.ok) { answer.branch = b.out; answer.detached = false; }
  else if (b.code === 1) { answer.branch = null; answer.detached = true; }
  else refuse(`could not read whether HEAD is on a branch (${why(b)})`);
};
readHead();

const commit = (ref) => {
  const r = git(['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
  return r.ok && r.out ? r.out : null;
};
answer.ref.sha = commit(opts.ref);
if (!answer.ref.sha) refuse(`${opts.ref} is not a commit this checkout knows — refresh it, or name another`);

if (answer.contains) {
  answer.contains.sha = commit(opts.contains);
  if (!answer.contains.sha) {
    refuse(`${opts.contains} is not a commit this checkout knows — refresh it, or name another`);
  }
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

// --- what stands in the tree
const st = git(['status', '--porcelain=v1', '-z', '--ignore-submodules=all']);
if (!st.ok) refuse(`could not read the working tree's status (${why(st)})`);
const tokens = st.out.split('\0').filter((t) => t !== '');
// The runner trims what it read, which takes the leading space of a first entry whose index
// side is clean (` M path`): every entry is `XY`, a space, the path — so it is put back.
if (tokens.length && tokens[0][2] !== ' ') tokens[0] = ` ${tokens[0]}`;
const dirty = [];
for (let i = 0; i < tokens.length; i += 1) {
  const t = tokens[i];
  // A rename or a copy carries its source as the next field, which is not an entry.
  if ('RC'.includes(t[0]) || 'RC'.includes(t[1])) {
    dirty.push(`${t} (from ${tokens[i + 1] ?? 'an unnamed path'})`);
    i += 1;
  } else {
    dirty.push(t);
  }
}
answer.dirtyCount = dirty.length;
answer.dirty = dirty.slice(0, LIST);
if (dirty.length) {
  answer.blockers.push(`the tree carries ${dirty.length} uncommitted change(s) — a master's tree`
    + ' takes none, and clearing them is the user\'s');
}

// --- work of its own. `--remotes` after `--not` counts every published branch as held: a
// host branch cut from the default while the base is an epic branch carries commits the
// base lacks, all of them published — nothing a switch would strand.
const own = ['HEAD', '--not', answer.ref.sha, '--remotes'];
answer.ownWorkCount = count(git(['rev-list', '--count', ...own]), 'the commits HEAD carries beyond the base');
if (answer.ownWorkCount > 0) {
  const l = git(['log', `-n${LIST}`, '--format=%H %s', ...own]);
  if (!l.ok) refuse(`could not list the commits HEAD carries beyond the base (${why(l)})`);
  answer.ownWork = l.out.split('\n').filter(Boolean);
  answer.blockers.push(`HEAD carries ${answer.ownWorkCount} commit(s) neither ${opts.ref} nor any`
    + ' remote holds — work of this tree\'s own, or a base rewritten under it; a switch would strand them');
}

answer.behind = count(git(['rev-list', '--count', `HEAD..${answer.ref.sha}`]), 'the commits the base has that HEAD lacks');
answer.atRef = answer.head === answer.ref.sha;

if (!answer.linked) {
  answer.blockers.unshift('this is the main checkout — a master moves no tree but a linked worktree'
    + ' of its own, so here it reads through refs and moves nothing');
}
// Once every blocker is in: a verdict computed earlier stands beside a blocker added after it.
answer.movable = answer.blockers.length === 0;

if (opts.move && answer.movable) {
  if (answer.atRef && answer.detached) {
    answer.move = 'already';
  } else {
    // By the commit read above, not by the name: a fetch between the two would otherwise
    // put HEAD on a tip nothing here measured.
    const s = git(['switch', '--detach', '--quiet', answer.ref.sha]);
    if (!s.ok) {
      answer.move = 'refused';
      answer.moveError = why(s);
    } else {
      readHead();
      answer.atRef = answer.head === answer.ref.sha;
      if (answer.atRef && answer.detached) {
        answer.move = 'done';
        answer.behind = 0;
      } else {
        answer.move = 'refused';
        answer.moveError = `git answered the switch, yet HEAD stands on ${answer.head}`;
      }
    }
  }
}

answer.read = true;
finish();
