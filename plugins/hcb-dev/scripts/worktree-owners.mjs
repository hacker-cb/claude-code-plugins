#!/usr/bin/env node
// worktree-owners.mjs — whose is each worktree of this repository right now? Prints JSON.
//
// It answers ONE question, and the narrow one: who is in a worktree, and who made it.
// Not what they are doing, not whether the work in it matters — and never the lease,
// which lives off any path this plugin can derive and disagrees with itself about the
// same directory. `claude-worktrees.md` owns why.
//
// Presence only. A live session proves a worktree is in use; its absence proves nothing,
// because the host leases worktrees to SESSIONS and a closed one keeps its lease.
//
// Usage: node worktree-owners.mjs [--repo-dir <path>]
//
// Exit 0 either way: `"read": true` with the worktrees, or `"read": false` with a
// `reason`. Exit 2 only for a call this script cannot act on at all.

import { readdirSync, readFileSync, statSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { writeAll, runner } from './lib/forge.mjs';

const USAGE = 'usage: node worktree-owners.mjs [--repo-dir <path>]\n';
const die = (m) => { writeAll(2, `worktree-owners: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
let repoDir = null;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] !== '--repo-dir') die(`unknown argument '${argv[i]}'`);
  if (argv[i + 1] === undefined) die('--repo-dir needs a value');
  repoDir = argv[i += 1];
}

const cwd = repoDir || process.cwd();
const git = runner(cwd, 'git');

const answer = {
  read: false,
  here: null,
  // `present: false` is "no registry to read" — which is not "nobody is working". Both
  // that and records with no readable cwd are `probeFailed`, and a failed probe makes
  // every worktree but this one unknown rather than free.
  registry: { path: null, present: false, records: 0, unreadable: 0, live: 0 },
  probeFailed: true,
  worktrees: [],
  // The two answers a caller acts on, as lists rather than a scan it repeats: what is
  // yours with nothing in the way, and what turns on the one thing this cannot know.
  removable: [], unsettled: [],
  reason: null, notes: [],
};
const finish = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (reason) => { answer.reason = reason; finish(); };

// Two spellings of one path are not two places: `/tmp` is a symlink to `/private/tmp` on
// macOS, and a session's `cwd` need not be spelled the way git spells its worktree.
const real = (p) => { try { return realpathSync(p); } catch { return p; } };
// The worktree is the ancestor, never the descendant: a session that stepped into a
// subdirectory is still working in it, and the reverse reading would put a session in
// every worktree above it.
const within = (child, parent) => child === parent || child.startsWith(parent + sep);

// --- the live-session registry
// `CLAUDE_CONFIG_DIR` is a real environment variable the user may set, and this reads
// Claude Code's own state, so it takes the expansion rather than a pinned `$HOME`.
const cfg = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || '', '.claude');
const sessionsDir = join(cfg, 'sessions');
answer.registry.path = sessionsDir;

// `process.kill(pid, 0)` and the shell's `kill -0` are not the same test. EPERM means the
// process EXISTS and is not ours to signal — a session run by another user — and the
// shell collapses that into failure, reading a live session as dead. That is the one
// direction this must never get wrong.
const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); return true; } catch (e) {
    if (e.code === 'ESRCH') return false;
    if (e.code === 'EPERM') return true;
    return null;
  }
};

const sessions = [];
let files = [];
try {
  files = readdirSync(sessionsDir).filter((n) => n.endsWith('.json'));
  answer.registry.present = true;
} catch { answer.registry.present = false; }

for (const name of files) {
  answer.registry.records += 1;
  let rec;
  try { rec = JSON.parse(readFileSync(join(sessionsDir, name), 'utf8')); } catch { rec = null; }
  if (!rec || typeof rec !== 'object' || Array.isArray(rec) || typeof rec.cwd !== 'string') {
    answer.registry.unreadable += 1;
    continue;
  }
  // The record carries its own `pid`; the filename carries it too. The field is the one
  // read, and the filename is the fallback — a layout that renames the file leaves the
  // record still saying who it is.
  const pid = Number.isInteger(rec.pid) ? rec.pid : Number.parseInt(name.slice(0, -5), 10);
  // An undocumented hint, so it may only narrow: a pid stamped with another domain is
  // not one this host can signal, and testing it would answer about a local stranger.
  const foreign = typeof rec.pidDomain === 'string' && rec.pidDomain !== process.platform;
  const live = foreign ? null : alive(pid);
  if (live === false) continue;
  if (live === null) answer.registry.unreadable += 1;
  else answer.registry.live += 1;
  sessions.push({ pid: Number.isInteger(pid) ? pid : null, cwd: rec.cwd, path: real(rec.cwd),
    live, kind: rec.kind ?? null, entrypoint: rec.entrypoint ?? null, name: rec.name ?? null });
}
// Separated deliberately: no registry at all, and a registry whose records would not
// read, are both "the probe failed" — while a registry that read cleanly and found
// nobody is an answer.
answer.probeFailed = !answer.registry.present
  || (answer.registry.records > 0 && answer.registry.live === 0 && answer.registry.unreadable > 0);

// --- the worktrees
if (!git(['rev-parse', '--git-dir']).ok) die('not inside a git checkout');
const here = git(['rev-parse', '--show-toplevel']);
if (!here.ok) refuse(`could not read this checkout's top level (${here.line()})`);
answer.here = here.out;
const hereReal = real(here.out);

const list = git(['worktree', 'list', '--porcelain']);
if (!list.ok) refuse(`could not list this repository's worktrees (${list.line()})`);

let wt = null;
const push = () => { if (wt) answer.worktrees.push(wt); };
for (const line of `${list.out}\n`.split('\n')) {
  if (line.startsWith('worktree ')) {
    push();
    wt = { path: line.slice('worktree '.length), branch: null, detached: false, bare: false,
      locked: false, lockReason: null, prunable: false, pruneReason: null,
      // The first entry `worktree list` prints is the main working tree, and
      // `worktree remove` refuses it outright: `fatal: '<path>' is a main working tree`.
      isPrimary: answer.worktrees.length === 0,
      isHere: false, sessions: [], occupied: null,
      hostMade: false, hostSignals: [], owner: null,
      mayRemove: false, callerDecides: false, blockers: [] };
  } else if (!wt) continue;
  else if (line.startsWith('branch ')) wt.branch = line.slice('branch '.length);
  else if (line === 'detached') wt.detached = true;
  else if (line === 'bare') wt.bare = true;
  else if (line === 'locked' || line.startsWith('locked ')) {
    wt.locked = true;
    wt.lockReason = line.length > 'locked '.length ? line.slice('locked '.length) : null;
  } else if (line === 'prunable' || line.startsWith('prunable ')) {
    wt.prunable = true;
    wt.pruneReason = line.length > 'prunable '.length ? line.slice('prunable '.length) : null;
  }
}
push();

// A session belongs to the INNERMOST worktree holding it, and only there. The host
// leases its worktrees from a directory inside the repository, so every one of them is
// also under the main working tree — and attributing by containment alone puts each of
// their sessions in the main tree too, which then reads as occupied by people who are
// nowhere near it.
const paths = answer.worktrees.map((w) => real(w.path));
const innermost = (s) => {
  let best = -1;
  for (let i = 0; i < paths.length; i += 1) {
    if (!within(s.path, paths[i])) continue;
    if (best < 0 || paths[i].length > paths[best].length) best = i;
  }
  return best;
};
const held = answer.worktrees.map(() => []);
for (const s of sessions) {
  const i = innermost(s);
  if (i >= 0) held[i].push(s);
  // A live session somewhere else entirely says nothing about this repository.
}

answer.worktrees.forEach((w, i) => {
  const path = paths[i];
  w.isHere = path === hereReal;
  w.sessions = held[i].map((s) => ({ pid: s.pid, cwd: s.cwd, kind: s.kind,
    entrypoint: s.entrypoint, name: s.name, live: s.live }));
  w.occupied = answer.probeFailed ? null : w.sessions.length > 0;

  // Two hints at what the host cut, both undocumented and both allowed only to widen
  // what stays: the directory it leases from, and the branch namespace it names.
  if (path.includes(`${sep}.claude${sep}worktrees${sep}`)) {
    w.hostSignals.push('it sits in the host\'s worktree directory');
  }
  if (typeof w.branch === 'string' && /^refs\/heads\/claude\//.test(w.branch)) {
    w.hostSignals.push('its branch is in the host\'s namespace');
  }
  w.hostMade = w.hostSignals.length > 0;

  if (w.isPrimary) w.blockers.push('it is the main working tree — `worktree remove` refuses it');
  if (w.locked) w.blockers.push(`it is locked${w.lockReason ? `: ${w.lockReason}` : ''}`);
  if (w.occupied === null) {
    w.blockers.push('the live-session registry could not be read, so who is in it is unknown');
  } else if (w.sessions.length && !w.isHere) {
    w.blockers.push(`a live session is in it: ${w.sessions.map((s) => s.pid).join(', ')}`);
  } else if (w.sessions.length > 1 && w.isHere) {
    // One of them is the caller and this cannot tell which — so more than one is a
    // second client on the same directory, whose tree the removal would take too.
    w.blockers.push(`${w.sessions.length} live sessions are in it, and one of them is you`);
  }
  if (w.hostMade && !w.isHere) {
    w.blockers.push('the host made it, and the lease that says whose it is cannot be read'
      + ' from here — the host sweeps its own pool');
  }

  w.owner = w.occupied === null ? 'unknown'
    : w.isHere ? 'you'
      : w.sessions.length ? 'another session'
        : w.hostMade ? 'the host'
          : null;
  // One rule, and the same one the retirement uses: something of yours, and nothing in
  // the way. `null` above is the one case this cannot settle — a worktree nobody is in
  // and the host did not make — so it is handed over as a flag rather than as silence.
  w.mayRemove = w.owner === 'you' && w.blockers.length === 0;
  w.callerDecides = w.owner === null && w.blockers.length === 0;
});

answer.removable = answer.worktrees.filter((w) => w.mayRemove).map((w) => w.path);
answer.unsettled = answer.worktrees.filter((w) => w.callerDecides).map((w) => w.path);

answer.read = true;
finish();
