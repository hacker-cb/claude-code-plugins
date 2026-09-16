#!/usr/bin/env node
// resolve-base.mjs — which remote to read from, which to push to, and whether a base is a
// CURRENT ref. Prints JSON.
//
// The ladder that picks WHICH base is the caller's: rungs 1 to 3 weigh a caller's word, an
// open request's base and where a repository's changes actually land, and the last of
// those is a judgement ("if one non-default base dominates"). What is mechanical is
// everything around it — ranking remotes, git's own push routing, and turning a name into
// a ref that is current rather than one the last fetch left behind.
//
// The rule all of it serves: **never guess a name.** `origin` is as hardcoded as `main`,
// and a guess that RESOLVES is not a guess that is RIGHT — it resolves to the wrong
// repository, and the run reports a plausible scope line over something else entirely.
//
// Usage: node resolve-base.mjs [--base <name>] [--forge gh|glab] [--repo <owner/name>]
//                              [--no-network] [--repo-dir <path>]
//
// Exit 0 either way. Exit 2 only for a call this script cannot act on at all.

import { writeAll, readable, refNameOk, repoOk, runner, text } from './lib/forge.mjs';

const USAGE = 'usage: node resolve-base.mjs [--base <name>] [--forge gh|glab]'
  + ' [--repo <owner/name>] [--no-network] [--repo-dir <path>]\n';
const die = (m) => { writeAll(2, `resolve-base: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { base: null, forge: null, repo: null, repoDir: null, network: true };
const VALUED = { '--base': 'base', '--forge': 'forge', '--repo': 'repo', '--repo-dir': 'repoDir' };
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--no-network') { opts.network = false; continue; }
  const key = VALUED[argv[i]];
  if (!key) die(`unknown argument '${argv[i]}'`);
  if (argv[i + 1] === undefined) die(`${argv[i]} needs a value`);
  opts[key] = argv[i + 1];
  i += 1;
}
if (opts.base !== null && !refNameOk(opts.base)) die(`--base '${opts.base}' is not a branch name`);
if (opts.forge !== null && !['gh', 'glab'].includes(opts.forge)) die(`--forge '${opts.forge}' is not gh or glab`);
if (opts.repo && !repoOk(opts.repo)) die(`--repo '${opts.repo}' is not owner/name`);

const cwd = opts.repoDir || process.cwd();
const git = runner(cwd, 'git');

const answer = {
  read: false,
  // Ranked for PROBING — try each until one carries the ref you want. Picking one
  // outright is the separate question `read` answers, and taking the head of this list
  // for it silently prefers whichever of `alice` and `bob` sorts first.
  remotes: { ranked: [], read: null, readReason: null, push: null, pushSource: null, pushReason: null },
  // What the forge says, where a forge was named. Read, never chosen: which rung wins is
  // the caller's, and rung 3 in particular is a judgement about what dominates.
  requestBase: { name: null, read: false, reason: null },
  landings: { counts: [], read: false, reason: null },
  // A name turned into a ref, and whether that ref is CURRENT. The ladder says which base;
  // it says nothing about when.
  base: { name: opts.base, ref: null, short: null, current: false, reason: null, sharesHistory: null },
  reason: null, notes: [],
};
const finish = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (reason) => { answer.reason = reason; finish(); };

if (!git(['rev-parse', '--git-dir']).ok) die('not inside a git checkout');

// --- the remotes
const list = git(['remote']);
if (!list.ok) refuse(`this checkout's remotes could not be read (${list.line()})`);
const all = list.out.split('\n').map((r) => r.trim()).filter(Boolean);
// Whole names, never prefixes: a remote called `origin2` is neither mistaken for the real
// one nor dropped off the tail of the ranking.
const PREFERRED = ['upstream', 'origin'];
answer.remotes.ranked = [
  ...PREFERRED.filter((r) => all.includes(r)),
  ...all.filter((r) => !PREFERRED.includes(r)),
].map(text);

const preferred = PREFERRED.find((r) => all.includes(r)) || null;
if (preferred) answer.remotes.read = preferred;
else if (all.length === 1) {
  answer.remotes.read = text(all[0]);
  answer.notes.push(`${all[0]} is the only remote, whatever it is called`);
} else if (all.length === 0) {
  answer.remotes.readReason = 'this checkout has no remote at all';
} else {
  // For a read that costs a wrong review; for a push it can publish a branch in somebody
  // else's repository. Neither is a cost to pay for an alphabetical tiebreak.
  answer.remotes.readReason = `${all.length} remotes and none preferred (${answer.remotes.ranked.join(', ')})`
    + ' — naming one is the caller\'s, never the first alphabetically';
}

// --- where a push goes, by GIT's own routing and never by `@{upstream}`, which in a fork
// points at the canonical repository.
const here = git(['symbolic-ref', '--short', '-q', 'HEAD']);
const branch = here.ok && here.out ? here.out : null;
const cfg = (k) => { const r = git(['config', '--get', k]); return r.ok && r.out ? r.out.split('\n')[0].trim() : null; };
const routes = [
  branch ? [`branch.${branch}.pushRemote`, cfg(`branch.${branch}.pushRemote`)] : null,
  ['remote.pushDefault', cfg('remote.pushDefault')],
  ['origin', all.includes('origin') ? 'origin' : null],
  ['the only remote', all.length === 1 ? all[0] : null],
].filter(Boolean);
for (const [source, value] of routes) {
  // A configured name that names no remote is not a route: it is a stale config, and
  // pushing to it fails at the far end where the report says it succeeded here.
  if (value && all.includes(value)) { answer.remotes.push = text(value); answer.remotes.pushSource = source; break; }
  if (value && !all.includes(value)) answer.notes.push(`${source} names ${text(value)}, which is not a remote here`);
}
if (answer.remotes.push === null) {
  answer.remotes.pushReason = all.length
    ? 'git routes a push nowhere here, and the higher stake of the two is not one to guess at'
    : 'this checkout has no remote at all';
}

// --- what the forge says, where one was named
if (opts.forge) {
  const cli = runner(cwd, opts.forge);
  const repoArgs = opts.repo ? ['--repo', opts.repo] : [];
  if (opts.forge === 'gh') {
    const v = cli(['pr', 'view', '--json', 'baseRefName', '-q', '.baseRefName', ...repoArgs]);
    // Exit status kept: no open request and a call that could not say print the same
    // nothing, and reading the second as the first drops a rung silently.
    if (v.ok) { answer.requestBase.read = true; answer.requestBase.name = v.out ? text(v.out.split('\n')[0]) : null; }
    else answer.requestBase.reason = `the open request's base could not be read (${v.line()})`;
    const m = cli(['pr', 'list', '--state', 'merged', '--limit', '10', '--json', 'baseRefName',
      '-q', '.[].baseRefName', ...repoArgs]);
    if (m.ok) {
      const counts = new Map();
      for (const n of m.out.split('\n').map((x) => x.trim()).filter(Boolean)) counts.set(n, (counts.get(n) || 0) + 1);
      answer.landings.counts = [...counts].map(([name, n]) => ({ name: text(name), n }))
        .sort((a, b) => b.n - a.n);
      answer.landings.read = true;
    } else answer.landings.reason = `where changes land could not be read (${m.line()})`;
  } else {
    const v = cli(['mr', 'view', '--output', 'json']);
    if (v.ok) {
      let mr = null;
      try { mr = JSON.parse(v.out); } catch { mr = null; }
      if (mr && typeof mr === 'object') {
        answer.requestBase.read = true;
        answer.requestBase.name = text(mr.target_branch) || null;
      } else answer.requestBase.reason = 'the open request came back in a shape this cannot read';
    } else answer.requestBase.reason = `the open request's base could not be read (${v.line()})`;
    const m = cli(['mr', 'list', '--merged', '--output', 'json']);
    if (m.ok) {
      let rows = null;
      try { rows = JSON.parse(m.out); } catch { rows = null; }
      if (Array.isArray(rows)) {
        const counts = new Map();
        for (const r of rows.slice(0, 10)) {
          const n = typeof r?.target_branch === 'string' ? r.target_branch : null;
          if (n) counts.set(n, (counts.get(n) || 0) + 1);
        }
        answer.landings.counts = [...counts].map(([name, n]) => ({ name: text(name), n }))
          .sort((a, b) => b.n - a.n);
        answer.landings.read = true;
      } else answer.landings.reason = 'where changes land came back in a shape this cannot read';
    } else answer.landings.reason = `where changes land could not be read (${m.line()})`;
  }
}

// --- a name turned into a ref that is current
if (opts.base !== null) {
  const remote = answer.remotes.read;
  if (!remote) {
    answer.base.reason = answer.remotes.readReason
      || 'no remote to read the base from, and a ref composed from an empty name is a ref to nothing';
  } else {
    const ref = `refs/remotes/${remote}/${opts.base}`;
    answer.base.ref = ref;
    answer.base.short = `${remote}/${opts.base}`;
    if (!opts.network) {
      answer.base.reason = 'the network was not asked, so whatever the last fetch left is'
        + ' all this ref says — its age is unknown, which is not the same as unchanged';
    } else {
      // The explicit refspec, never a bare name: where the remote's configured refspec
      // does not cover this branch, the bare form updates FETCH_HEAD alone and never
      // writes the ref every consumer actually reads.
      const f = git(['fetch', remote, `+refs/heads/${opts.base}:${ref}`], 120000);
      if (f.ok) answer.base.current = true;
      else {
        // Three outcomes and only one means current. A remote that did not answer leaves
        // the local ref standing and every consumer reading it without complaint, so a
        // run treating this as success reports a branch current with a base it never saw.
        answer.base.reason = `${remote} did not answer for ${opts.base} (${f.line()}), so the`
          + ' age of this ref is unknown — not unchanged';
      }
    }
    const have = git(['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
    if (!have.ok) {
      answer.base.reason = answer.base.reason
        || `${ref} is not in this checkout — a clone that fetched only feature branches`
          + ' carries no such ref until one is asked for by name';
      answer.base.ref = null;
      answer.base.short = null;
    } else if (branch !== null || git(['rev-parse', '--verify', '-q', 'HEAD^{commit}']).ok) {
      // An unrelated base is worse than none: every range against it is the whole history
      // of both sides, and the reviewer reads a diff nobody wrote.
      const mb = git(['merge-base', ref, 'HEAD']);
      answer.base.sharesHistory = mb.ok && mb.out !== '' ? true : false;
      if (answer.base.sharesHistory === false) {
        answer.notes.push(`${answer.base.short} shares no history with HEAD — every range`
          + ' against it is the whole of both sides');
      }
    }
  }
}

answer.read = true;
finish();
