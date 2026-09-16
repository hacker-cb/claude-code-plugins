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
// GitLab nests: `group/subgroup/project` is an ordinary project there and `glab --repo`
// takes it, while GitHub is always exactly two. Holding both to two makes `--repo`
// unusable on most self-managed installations.
const pathOk = (v) => typeof v === 'string' && v.split('/').length >= 2
  && v.split('/').every((seg) => readable(seg));
if (opts.repo && !(opts.forge === 'glab' ? pathOk(opts.repo) : repoOk(opts.repo))) {
  die(`--repo '${opts.repo}' is not ${opts.forge === 'glab' ? 'a project path' : 'owner/name'}`);
}

const cwd = opts.repoDir || process.cwd();
const git = runner(cwd, 'git');

// A branch NAME is an identifier: `text()` bounds prose a forge wrote, and bounding an
// identifier hands back a different branch that usually does not exist. Held to git's
// rules and kept exactly, or refused.
const name = (v) => (refNameOk(v) ? v : null);

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
  base: { name: opts.base, remote: null, ref: null, short: null, current: false,
    // Three outcomes from a refresh, and only one means current: `refreshed`, `silent`
    // (the age is unknown, which is not "no new commits"), and `gone` (the branch was
    // renamed or deleted since — re-resolve by the ladder rather than carry a name nobody
    // has). `null` where nothing was asked.
    outcome: null, reason: null, sharesHistory: null },
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
// Three CONFIGURED rungs, in git's own order: `remote.pushDefault` overrides
// `branch.<name>.remote` for every branch and is itself overridden by
// `branch.<name>.pushRemote` for one. The third is the rung `git push -u <remote> <branch>`
// writes, and leaving it out sends a fork's branch to the canonical repository.
const configured = [
  branch ? [`branch.${branch}.pushRemote`, cfg(`branch.${branch}.pushRemote`)] : null,
  ['remote.pushDefault', cfg('remote.pushDefault')],
  branch ? [`branch.${branch}.remote`, cfg(`branch.${branch}.remote`)] : null,
].filter(Boolean).find(([, v]) => v);
if (configured) {
  const [source, value] = configured;
  if (all.includes(value)) { answer.remotes.push = text(value); answer.remotes.pushSource = source; }
  else {
    // A configured route naming something that is not a remote here — a deleted remote, a
    // bare url — STOPS the routing. Falling past it to `origin` answers with the one
    // repository the configuration was written to avoid, and says nothing about it.
    answer.remotes.pushReason = `${source} names ${text(value)}, which is not a remote in`
      + ' this checkout — where a push is configured and the configuration does not'
      + ' resolve, the answer is not the next rung down';
  }
} else if (all.includes('origin')) { answer.remotes.push = 'origin'; answer.remotes.pushSource = 'origin'; }
else if (all.length === 1) { answer.remotes.push = text(all[0]); answer.remotes.pushSource = 'the only remote'; }
else {
  answer.remotes.pushReason = all.length
    ? 'git routes a push nowhere here, and the higher stake of the two is not one to guess at'
    : 'this checkout has no remote at all';
}

// --- what the forge says, where one was named
// `--no-network` means no network, not "no fetch": a forge read is the more expensive of
// the two, and an offline caller that gets one anyway hangs on the thing it opted out of.
if (opts.forge && !opts.network) {
  answer.requestBase.reason = 'the network was not asked';
  answer.landings.reason = 'the network was not asked';
}
if (opts.forge && opts.network) {
  const cli = runner(cwd, opts.forge);
  const repoArgs = opts.repo ? ['--repo', opts.repo] : [];
  if (opts.forge === 'gh') {
    // `pr list --head`, not `pr view`: with no open request `view` exits non-zero, which
    // is the COMMON case here — a review usually runs before the request exists — and it
    // prints the same failure a forge that could not answer does. The list form answers
    // `[]` and exit 0, so "there is none" stays an answer. It also takes `--repo` without
    // a positional, which `view` does not.
    const v = branch
      ? cli(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'baseRefName',
        '-q', '.[].baseRefName', ...repoArgs])
      : null;
    if (v === null) answer.requestBase.reason = 'HEAD is detached, so there is no branch to ask about';
    else if (v.ok) { answer.requestBase.read = true; answer.requestBase.name = v.out ? name(v.out.split('\n')[0]) : null; }
    else answer.requestBase.reason = `the open request's base could not be read (${v.line()})`;
    const m = cli(['pr', 'list', '--state', 'merged', '--limit', '10', '--json', 'baseRefName',
      '-q', '.[].baseRefName', ...repoArgs]);
    if (m.ok) {
      const counts = new Map();
      for (const n of m.out.split('\n').map((x) => x.trim()).filter(Boolean)) counts.set(n, (counts.get(n) || 0) + 1);
      answer.landings.counts = [...counts].map(([b, n]) => ({ name: name(b), n }))
        .sort((a, b2) => b2.n - a.n);
      answer.landings.read = true;
    } else answer.landings.reason = `where changes land could not be read (${m.line()})`;
  } else {
    // Mirrored command for command, and for the same reason: a list answers empty where a
    // view fails. `--repo` travels on both, or this reads the project the directory
    // resolves to rather than the one the caller named.
    const v = branch
      ? cli(['mr', 'list', '--source-branch', branch, '--output', 'json', ...repoArgs])
      : null;
    if (v === null) answer.requestBase.reason = 'HEAD is detached, so there is no branch to ask about';
    else if (v.ok) {
      let rows = null;
      try { rows = JSON.parse(v.out); } catch { rows = null; }
      if (Array.isArray(rows)) {
        answer.requestBase.read = true;
        answer.requestBase.name = rows.length ? name(rows[0]?.target_branch) : null;
      } else answer.requestBase.reason = 'the open request came back in a shape this cannot read';
    } else answer.requestBase.reason = `the open request's base could not be read (${v.line()})`;
    const m = cli(['mr', 'list', '--merged', '--output', 'json', ...repoArgs]);
    if (m.ok) {
      let rows = null;
      try { rows = JSON.parse(m.out); } catch { rows = null; }
      if (Array.isArray(rows)) {
        const counts = new Map();
        for (const r of rows.slice(0, 10)) {
          const n = typeof r?.target_branch === 'string' ? r.target_branch : null;
          if (n) counts.set(n, (counts.get(n) || 0) + 1);
        }
        answer.landings.counts = [...counts].map(([b, n]) => ({ name: name(b), n }))
          .sort((a, b2) => b2.n - a.n);
        answer.landings.read = true;
      } else answer.landings.reason = 'where changes land came back in a shape this cannot read';
    } else answer.landings.reason = `where changes land could not be read (${m.line()})`;
  }
}

// --- a name turned into a ref that is current
if (opts.base !== null) {
  // PROBED down the ranking, not asked of the one remote picked outright: a base lives on
  // whichever remote carries it, and in a fork checkout a stack's parent is often on
  // `origin` while `upstream` has never heard of it. Picking one outright is the separate
  // question `remotes.read` answers, and a run with no preferred remote can still probe.
  const probe = answer.remotes.ranked.length ? answer.remotes.ranked : [];
  if (!probe.length) {
    answer.base.reason = 'this checkout has no remote at all, and a ref composed from an'
      + ' empty name is a ref to nothing';
  } else if (!opts.network) {
    const remote = answer.remotes.read || probe[0];
    const ref = `refs/remotes/${remote}/${opts.base}`;
    if (git(['rev-parse', '--verify', '-q', `${ref}^{commit}`]).ok) {
      answer.base.remote = text(remote);
      answer.base.ref = ref;
      answer.base.short = `${remote}/${opts.base}`;
    }
    answer.base.reason = 'the network was not asked, so whatever the last fetch left is'
      + ' all this ref says — its age is unknown, which is not the same as unchanged';
  } else {
    const tried = [];
    for (const remote of probe) {
      const ref = `refs/remotes/${remote}/${opts.base}`;
      // `--end-of-options` first: a remote NAME comes out of this repository's own config,
      // where a line written by hand can begin with a dash and be read by git as an option
      // rather than as the remote to fetch from.
      // The explicit refspec, never a bare name: where the remote's configured refspec
      // does not cover this branch, the bare form updates FETCH_HEAD alone and never
      // writes the ref every consumer actually reads.
      const f = git(['fetch', '--end-of-options', remote, `+refs/heads/${opts.base}:${ref}`], 120000);
      if (f.ok) {
        answer.base.remote = text(remote);
        answer.base.ref = ref;
        answer.base.short = `${remote}/${opts.base}`;
        answer.base.current = true;
        answer.base.outcome = 'refreshed';
        break;
      }
      // A remote that ANSWERED and has no such branch is a different outcome from one that
      // did not answer: the first says re-resolve by the ladder, the second says the age
      // of whatever is here is unknown. Told apart by what git itself says.
      tried.push({ remote: text(remote), gone: /couldn't find remote ref|no such ref/i.test(f.err), why: f.line() });
    }
    if (answer.base.outcome === null) {
      const gone = tried.every((t) => t.gone);
      answer.base.outcome = gone ? 'gone' : 'silent';
      answer.base.reason = gone
        ? `no remote carries ${opts.base} any more — it was renamed or deleted, so re-resolve`
          + ' it by the ladder rather than carrying a name nobody has'
        : `${tried.map((t) => t.remote).join(', ')} did not answer for ${opts.base}`
          + ` (${tried[tried.length - 1].why}), so the age of anything here is unknown — not unchanged`;
      // Named anyway where a stale copy is standing, so a caller can say what it is
      // reading and how old that is, rather than being handed nothing.
      const fallback = answer.remotes.read || probe[0];
      const ref = `refs/remotes/${fallback}/${opts.base}`;
      if (!gone && git(['rev-parse', '--verify', '-q', `${ref}^{commit}`]).ok) {
        answer.base.remote = text(fallback);
        answer.base.ref = ref;
        answer.base.short = `${fallback}/${opts.base}`;
      }
    }
  }
  if (answer.base.ref !== null) {
    if (branch !== null || git(['rev-parse', '--verify', '-q', 'HEAD^{commit}']).ok) {
      // An unrelated base is worse than none: every range against it is the whole history
      // of both sides, and the reviewer reads a diff nobody wrote.
      const mb = git(['merge-base', answer.base.ref, 'HEAD']);
      answer.base.sharesHistory = mb.ok && mb.out !== '';
      if (answer.base.sharesHistory === false) {
        answer.notes.push(`${answer.base.short} shares no history with HEAD — every range`
          + ' against it is the whole of both sides');
      }
    }
  }
}

answer.read = true;
finish();
