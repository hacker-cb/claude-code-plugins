#!/usr/bin/env node
// default-branch.mjs — which branch this repository treats as its default, and the
// remote that says so. Prints JSON on stdout.
//
// This is deliberately ONE question. "What should this change be diffed against" is a
// different one — it answers with the base of whatever request is open, which on a repo
// working in `dev` is not the default — and conflating them is how a cleanup deletes
// branches merged somewhere else, or a gate lets a merge into the default through.
//
// The rule it exists to hold: **never guess a name.** `master`, `main`, `dev`, `trunk` —
// every repo picks its own, and `origin` is the same kind of guess. A guess that
// *resolves* is not a guess that is *right*.
//
// Usage: node default-branch.mjs [--no-network] [--repo-dir <path>]
//
// Exit 0 either way: `"resolved": true` with the answer, or `"resolved": false` with a
// `reason`. The question being unanswerable is an answer — "the merge question cannot be
// answered" is not "nothing is merged", and a caller that cannot tell them apart deletes
// work. Exit 2 only for a call this script cannot act on at all.

import { spawnSync } from 'node:child_process';
import { writeSync } from 'node:fs';

const USAGE = 'usage: node default-branch.mjs [--no-network] [--repo-dir <path>]\n';
// `process.stdout.write` hands bytes to a pipe ASYNCHRONOUSLY, and `process.exit` drops
// whatever has not reached the OS — so an answer past the 64KB pipe buffer arrives
// truncated mid-token, as valid-looking JSON that will not parse. Writing from the
// write's own callback flushes it, but then the exit is asynchronous too: execution
// CONTINUES past the refusal that called it, and a script that has just said "this
// argument is unusable" goes on to use it. Both have to hold, so the write itself is
// made synchronous and the exit stays where it was.
const writeAll = (fd, text) => {
  const buf = Buffer.from(text, 'utf8');
  let off = 0;
  while (off < buf.length) {
    try {
      off += writeSync(fd, buf, off, buf.length - off);
    } catch (e) {
      // A non-blocking pipe whose reader is behind says EAGAIN rather than writing less;
      // retrying is the whole handling. Anything else — a closed reader, above all — is
      // not something to spin on.
      if (e.code !== 'EAGAIN') return;
    }
  }
};
const die = (m) => { writeAll(2, `default-branch: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
let network = true;
let repoDir = null;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--no-network') { network = false; continue; }
  if (argv[i] === '--repo-dir') {
    if (argv[i + 1] === undefined) die('--repo-dir needs a value');
    repoDir = argv[i + 1]; i += 1; continue;
  }
  die(`unknown argument '${argv[i]}'`);
}

const cwd = repoDir || process.cwd();
const run = (cmd, args, timeout = 60000) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};
const git = (...a) => run('git', a);

const answer = {
  // `confirmed` is the only source a caller may act on without saying it did not verify:
  // the remote itself named this branch. `local-pointer` is a checkout's own belief,
  // which a rename on the forge leaves standing and correct-looking.
  resolved: false, remote: null, name: null, ref: null, short: null,
  source: null, confirmed: false, reason: null, notes: [],
};
const finish = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (reason) => { answer.reason = reason; finish(); };

if (!git('rev-parse', '--git-dir').ok) die('not inside a git checkout');

const remotes = git('remote').out.split('\n').filter(Boolean);
if (remotes.length === 0) refuse('no remote: nothing here knows what the default is');

// Picking ONE remote is not probing in order: with remotes `alice` and `bob`, taking
// whichever sorts first is a guess wearing a ranking's clothes.
const remote = ['upstream', 'origin'].find((r) => remotes.includes(r))
  ?? (remotes.length === 1 ? remotes[0] : null);
if (!remote) refuse(`remotes ${remotes.join(', ')} and none preferred — ask which one`);
answer.remote = remote;

const qualified = (name) => `refs/remotes/${remote}/${name}`;
const haveRef = (ref) => git('rev-parse', '--verify', '-q', `${ref}^{commit}`).ok;

// The pointer, read WITHOUT dereferencing: after the forge renames its default this
// keeps printing the old name with status 0 forever, so the name it gives is a claim to
// verify rather than an answer. Full path, never `--short`, which shortens
// unpredictably when another ref shadows the name.
let claimedLocally = null;
const pointer = git('symbolic-ref', `refs/remotes/${remote}/HEAD`);
if (pointer.ok && pointer.out.startsWith(`refs/remotes/${remote}/`)) {
  const claimed = pointer.out.slice(`refs/remotes/${remote}/`.length);
  if (haveRef(qualified(claimed))) claimedLocally = claimed;
  else {
    answer.notes.push(`${remote}/HEAD points at ${claimed}, which no longer exists —`
      + ` \`git remote set-head ${remote} --auto\` retires the pointer`);
  }
}

// The remote is asked even when the pointer verified, and this is the whole safety
// margin. A pointer at a ref that still EXISTS is the case verification cannot catch:
// rename the default on the forge and, until someone prunes, the old pointer and the
// old branch both sit here looking healthy. A caller acting on that name compares
// against the wrong branch — and a cleanup deciding what is merged then reads the real
// default as an ordinary branch with nothing on it.
let name = null;
let remoteSaid = null;
if (network) {
  const symref = run('git', ['ls-remote', '--symref', remote, 'HEAD']);
  if (symref.ok) {
    for (const line of symref.out.split('\n')) {
      const m = line.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/);
      if (m) { remoteSaid = m[1]; break; }
    }
  } else if (symref.err) {
    answer.notes.push(`${remote} did not answer (${symref.err.split('\n')[0]})`);
  }
}

if (remoteSaid) {
  name = remoteSaid;
  answer.source = claimedLocally === remoteSaid ? 'confirmed' : 'remote-head';
  if (claimedLocally && claimedLocally !== remoteSaid) {
    answer.notes.push(`${remote}/HEAD still says ${claimedLocally}, but ${remote} says`
      + ` ${remoteSaid} — the default was renamed; \`git remote set-head ${remote} --auto\``
      + ' retires the stale pointer');
  }
} else if (claimedLocally) {
  // Unconfirmed: the name is the best this checkout has, and the caller is told so
  // rather than left to assume the remote agreed.
  name = claimedLocally;
  answer.source = 'local-pointer';
  answer.notes.push(network
    ? `${remote} could not confirm the default — ${name} is this checkout's pointer, unverified`
    : `--no-network: ${name} is this checkout's pointer, unconfirmed by the remote`);
}

if (!name) {
  refuse(network
    ? `${remote} has no usable HEAD pointer and did not answer for one`
    : `no verified ${remote}/HEAD locally, and --no-network forbids asking`);
}

answer.name = name;
answer.ref = qualified(name);
answer.short = `${remote}/${name}`;

// Refresh the tracking ref, whether or not it is already here. Its mere existence says
// nothing about its age: a `<remote>/<default>` a week old still resolves, and after a
// revert or a force-push on the default it names commits the branch no longer carries —
// which is how a cleanup reads a branch as merged into something that has moved out
// from under it. Absent, the fetch is also what materialises it: a caller handed a ref
// that is not there gets a fatal from every consumer, and that is the same shape as
// "nothing is merged" without being it.
if (network) {
  const had = haveRef(answer.ref);
  const f = run('git', ['fetch', remote, `+refs/heads/${name}:${answer.ref}`], 120000);
  if (!f.ok || !haveRef(answer.ref)) {
    refuse(`${answer.ref} could not be fetched (${f.err.split('\n')[0] || 'no detail'})`);
  }
  if (!had) answer.notes.push(`${answer.short} was not in this checkout; fetched it`);
} else if (!haveRef(answer.ref)) {
  refuse(`${answer.ref} is not in this checkout and --no-network forbids fetching it`);
} else {
  answer.notes.push(`--no-network: ${answer.short} is whatever the last fetch left`);
}

// Set last, and only here. Every refusal above returns with it false, so a caller
// gating on it can never be handed a name whose ref was never brought — which is the
// same defect, one field over, as gating on `resolved` and getting a stale pointer.
answer.confirmed = Boolean(remoteSaid);
answer.resolved = true;
finish();
