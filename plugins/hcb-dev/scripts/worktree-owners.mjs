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

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { writeAll, runner, text, worktrees } from './lib/forge.mjs';

const USAGE = 'usage: node worktree-owners.mjs [--repo-dir <path>]\n';
const die = (m) => { writeAll(2, `worktree-owners: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
let repoDir = null;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] !== '--repo-dir') die(`unknown argument '${argv[i]}'`);
  if (argv[i + 1] === undefined) die('--repo-dir needs a value');
  repoDir = argv[i += 1];
}

// Two questions, and `--repo-dir` answers only the first: WHICH repository to scan, and
// WHERE the caller stands. A sweep runs against the whole repository from its main
// worktree, so taking the second from the first made the main tree the one you are in —
// and that is the one `worktree remove` refuses, so nothing was ever yours.
const cwd = repoDir || process.cwd();
const git = runner(cwd, 'git');
const self = runner(process.cwd(), 'git');

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

// Which registry record IS this run. Inferring it from directories cannot work: a
// session that started in the repository root and stepped into somebody else's worktree
// takes THEIR record for its own and hands their tree back as removable. The process
// chain says it outright — the session that spawned this is an ancestor of it, measured:
// the chain above a script run from this plugin carries the session's own pid. Where the
// chain cannot be walked nothing is claimed, which blocks rather than frees.
const parentOf = (pid) => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // `comm` can hold spaces and parentheses, so the fields are read after the LAST `)`.
    const after = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
    const ppid = Number.parseInt(after[1], 10);
    if (Number.isInteger(ppid) && ppid > 0) return ppid;
  } catch { /* not Linux, or not readable — ask ps */ }
  const r = spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)],
    { encoding: 'utf8', timeout: 10000 });
  if (r.status !== 0) return null;
  const ppid = Number.parseInt((r.stdout || '').trim(), 10);
  return Number.isInteger(ppid) && ppid > 0 ? ppid : null;
};
const ancestry = new Set([process.pid]);
for (let pid = process.pid, i = 0; i < 24; i += 1) {
  const next = parentOf(pid);
  if (next === null || ancestry.has(next)) break;
  ancestry.add(next);
  if (next <= 1) break;
  pid = next;
}

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
  // `kind`, `entrypoint` and `name` are NOT carried out. They answer no question this
  // script was asked, and a session's `name` is text Claude Code derived from that
  // session's own conversation — so a session that read something hostile can put a
  // sentence of the attacker's choosing into this answer, which another session reads
  // beside the paths it is about to delete. What is echoed is bounded and says what it
  // is: a pid this validated, and the directory the record claims.
  sessions.push({ pid: Number.isInteger(pid) ? pid : null, cwd: text(rec.cwd),
    path: real(rec.cwd), live,
    // Measured: it is epoch milliseconds, a NUMBER, not the ISO string its name
    // suggests. A string is carried too, quoted like any other borrowed text.
    startedAt: Number.isFinite(rec.startedAt) ? rec.startedAt : text(rec.startedAt) });
}
// Separated deliberately: no registry at all, and a registry whose records would not
// read, are both "the probe failed" — while a registry that read cleanly and found
// nobody is an answer.
answer.probeFailed = !answer.registry.present || answer.registry.unreadable > 0;

// --- the worktrees
if (!git(['rev-parse', '--git-dir']).ok) die('not inside a git checkout');
// From the CALLER's directory, not the scanned repository's. Unreadable is a refusal
// rather than an answer — not knowing where this run stands is not the same as
// standing nowhere, and the second hands every worktree back as somebody else's.
const here = self(['rev-parse', '--show-toplevel']);
if (!here.ok) refuse(`could not read where this run stands (${here.line()})`);
answer.here = here.out;
const hereReal = real(here.out);

const listed = worktrees(git);
if (listed.trees === null) refuse(`could not list this repository's worktrees (${listed.error})`);
answer.worktrees = listed.trees.map((w) => ({ ...w,
  isHere: false, sessions: [], occupied: null,
  hostMade: false, hostSignals: [], owner: null,
  mayRemove: false, callerDecides: false, blockers: [] }));

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
  w.sessions = held[i].map((s) => ({ pid: s.pid, cwd: s.cwd, startedAt: s.startedAt,
    live: s.live,
    // This run's own session, named by the process chain rather than inferred from a
    // directory two sessions can share.
    isThisRun: Number.isInteger(s.pid) && ancestry.has(s.pid) }));
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
  // Independent, not a chain: more than one of these holds at once, and an `else` files
  // the report under whichever was reached first.
  if (w.occupied === null) {
    w.blockers.push(w.isHere
      ? 'the live-session registry could not be read, so whether a second client is in'
        + ' this worktree too is unknown — you are standing in it either way'
      : 'the live-session registry could not be read, so who is in it is unknown');
  }
  if (w.sessions.length && !w.isHere) {
    w.blockers.push(`a live session is in it: ${w.sessions.map((s) => s.pid).join(', ')}`);
  }
  if (w.isHere) {
    // Standing in it does not make every session in it yours: a second client on the
    // same directory, or one this host cannot even verify, is somebody whose tree the
    // removal would take as well. Only the record this run IS gets a pass.
    const others = w.sessions.filter((s) => !s.isThisRun);
    if (others.length) {
      w.blockers.push('a live session is in it that is not this run:'
        + ` ${others.map((s) => s.pid).join(', ')}`);
    }
  }
  if (w.hostMade && !w.isHere && !w.prunable) {
    // `prunable` and still the host's are not the same case: git says the registration
    // has nothing behind it any more, so pruning it destroys no work and needs no lease.
    w.blockers.push('the host made it, and the lease that says whose it is cannot be read'
      + ' from here — the host sweeps its own pool');
  }

  w.owner = w.isHere ? 'you'
    : w.occupied === null ? 'unknown'
      : w.sessions.length ? 'another session'
        : w.hostMade ? 'the host'
          : null;
});

// Removing a worktree is recursive, so occupancy does not stop at the entry that holds
// it: a worktree nested inside this one goes with it, live session and all. Attribution
// stays innermost — that is who is where — and the VERDICT looks down.
answer.worktrees.forEach((w, i) => {
  const inside = answer.worktrees.filter((o, j) => j !== i && within(paths[j], paths[i])
    && (o.sessions.length > 0 || o.blockers.length > 0));
  if (inside.length) {
    w.blockers.push('a worktree inside it is not this run\'s to take:'
      + ` ${inside.map((o) => o.path).join(', ')}`);
  }
});

// Both verdicts here, after every blocker is in — including the one the pass above adds.
// One rule: something of yours, and nothing in the way. `owner: null` is the single case
// this cannot settle — a worktree nobody is in and the host did not make — so it is
// handed over as a flag rather than as silence.
answer.worktrees.forEach((w) => {
  w.mayRemove = w.owner === 'you' && w.blockers.length === 0;
  w.callerDecides = w.owner === null && w.blockers.length === 0;
});

answer.removable = answer.worktrees.filter((w) => w.mayRemove).map((w) => w.path);
answer.unsettled = answer.worktrees.filter((w) => w.callerDecides).map((w) => w.path);

answer.read = true;
finish();
