#!/usr/bin/env node
// branch-publish.mjs — the name this branch ships under, put on the remote, and the
// names it used to carry taken off it. Prints JSON.
//
// Three things happen here and the ORDER of them is the whole hazard. The rename is
// refused wherever a change request pins a name, because deleting a head ref closes the
// request it heads. The publish is unconditional — every step downstream assumes an
// upstream and none of them creates one. And a stale name is retired only after the new
// one is up: a refused push followed by a delete unpublishes the branch outright.
//
// What it does NOT do: rebase, merge, or move HEAD. The branch arrives where it is going
// to land, and taking the base is the caller's own step.
//
// Usage: node branch-publish.mjs --new <name> [--old-name <name>]
//          [--publish --push-remote <name>] [--base <name> --base-remote <name>]
//          [--repo <owner/name>] [--repo-dir <path>]
//
// Exit 0 either way: `"published": true` is the one thing a caller carries forward, and
// `"ships"` the name it carries it under. Exit 2 only for a call this cannot act on.

import { writeAll, readable, refNameOk, repoOk, runner, text, worktrees } from './lib/forge.mjs';

const USAGE = 'usage: node branch-publish.mjs --new <name> [--old-name <name>]'
  + ' [--publish --push-remote <name>] [--base <name> --base-remote <name>]'
  + ' [--repo <owner/name>] [--repo-dir <path>]\n';
const die = (m) => { writeAll(2, `branch-publish: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { new: null, oldName: null, pushRemote: null, base: null, baseRemote: null,
  repo: null, repoDir: null, publish: false };
const VALUED = { '--new': 'new', '--old-name': 'oldName', '--push-remote': 'pushRemote',
  '--base': 'base', '--base-remote': 'baseRemote', '--repo': 'repo', '--repo-dir': 'repoDir' };
const BARE = { '--publish': 'publish' };
for (let i = 0; i < argv.length; i += 1) {
  if (BARE[argv[i]]) { opts[BARE[argv[i]]] = true; continue; }
  const key = VALUED[argv[i]];
  if (!key) die(`unknown argument '${argv[i]}'`);
  if (argv[i + 1] === undefined) die(`${argv[i]} needs a value`);
  opts[key] = argv[i + 1];
  i += 1;
}
// Every name here reaches git as an argument and `gh` as a query value, never a shell and
// never a url path — so GIT's own rules are the ones that decide, and holding a branch to
// a url-segment class would refuse the `#` and `%` git accepts.
if (!opts.new) die('--new is required — the name this branch ships under');
if (!refNameOk(opts.new)) die(`--new '${opts.new}' is not a branch name git would take`);
if (opts.oldName !== null && !refNameOk(opts.oldName)) {
  die(`--old-name '${opts.oldName}' is not a branch name git would take`);
}
// Asked for, not inferred from a remote being present: a caller that forgot the flag
// would otherwise get a silent no-op where this step's whole point is that the push
// always happens.
if (opts.publish && !opts.pushRemote) die('--publish needs --push-remote');
if (opts.pushRemote && !readable(opts.pushRemote)) die(`--push-remote '${opts.pushRemote}' is not a remote name`);
if ((opts.base === null) !== (opts.baseRemote === null)) {
  die('--base and --base-remote name one tracking ref between them; pass both or neither');
}
if (opts.base !== null && !refNameOk(opts.base)) die(`--base '${opts.base}' is not a branch name`);
if (opts.baseRemote !== null && !readable(opts.baseRemote)) die(`--base-remote '${opts.baseRemote}' is not a remote name`);
if (opts.repo && !repoOk(opts.repo)) die(`--repo '${opts.repo}' is not owner/name`);

const cwd = opts.repoDir || process.cwd();
const git = runner(cwd, 'git');
const gh = runner(cwd);

const answer = {
  read: false,
  // Where the branch was when this started and where it ends up. They differ only when a
  // rename actually happened, which is what every deletion below is gated on.
  branch: { at: null, ships: null },
  renamed: false,
  // The rename UNDONE: a request heading the name a caller renamed away pins that name,
  // and the branch ships under it after all.
  restored: false,
  publish: { asked: opts.publish, mode: null, reason: null },
  // Three states, and `null` is "not asked" rather than "no". A caller reading a false
  // here as a refused push would stop on a run that never tried.
  published: null,
  // One entry per name this branch used to carry. `retired` is a deletion this run made,
  // `absent` is a name that was not there, `kept` is every refusal — with its reason.
  stale: [],
  ran: [],
  notes: [],
  reason: null,
};
const finish = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (reason) => { answer.reason = reason; finish(); };
const note = (m) => { answer.notes.push(m); };
const run = (args, timeout = 120000) => {
  const r = git(args, timeout);
  answer.ran.push(['git', ...args].join(' '));
  return r;
};

if (!git(['rev-parse', '--git-dir']).ok) die('not inside a git checkout');

// --- where we stand
const head = git(['symbolic-ref', '--short', '-q', 'HEAD']);
if (!head.ok || !head.out) {
  refuse('HEAD is detached — there is no branch here to rename or publish');
}
const entry = head.out;
answer.branch.at = entry;
let cur = entry;
let ships = opts.new;

// Does an open change request head this name? Three answers, and the third carries the
// weight: `gh` failing to say prints exactly what "nothing open" prints, and reading the
// second as the first renames a branch whose head-ref deletion closes a live review.
const headedBy = (name) => {
  const r = gh(['pr', 'list', '--head', name, '--state', 'open', '--json', 'number,headRepository',
    ...(opts.repo ? ['--repo', opts.repo] : [])]);
  if (!r.ok) return null;
  let list;
  try { list = JSON.parse(r.out); } catch { return null; }
  if (!Array.isArray(list)) return null;
  // `--head` filters by branch NAME, which is not unique across forks: a contributor's
  // own branch of this name is a different ref and nothing here could reach it. That only
  // ever makes this keep a name it could have changed, so the repository each head lives
  // in is reported rather than acted on.
  return list.map((p) => ({
    number: p && typeof p.number === 'number' ? p.number : null,
    where: text(p && p.headRepository && p.headRepository.nameWithOwner) || 'a repository this could not read',
  })).filter((p) => p.number !== null);
};
const say = (hits) => hits.map((h) => `#${h.number} in ${h.where}`).join(', ');

// --- the name it ships under
//
// A caller upstream may have renamed already and threaded what it renamed away through as
// `old-name`. A request heading that name pins it: the rename closed nothing yet — only a
// local ref moved — so it is undone and the branch ships under the old name after all.
let oldPinned = false;
if (opts.oldName && opts.oldName !== cur) {
  const heads = headedBy(opts.oldName);
  if (heads === null || heads.length) {
    const why = heads === null
      ? `the request state for ${opts.oldName} could not be read`
      : `a request heads ${opts.oldName} (${say(heads)})`;
    const back = run(['branch', '-m', opts.oldName]);
    if (back.ok) {
      note(`${why} — renamed back, and the branch ships under that name`);
      cur = opts.oldName; ships = opts.oldName; answer.restored = true;
    } else {
      oldPinned = true;
      note(`${why}, and the rename back was refused (${back.line()}) — shipping as ${cur}`);
    }
  }
}
// The same probe on the name carried now, and for the same reason. Asked only where a
// rename is actually on the table: with the name already right there is nothing to pin.
if (cur !== ships) {
  const heads = headedBy(cur);
  if (heads === null) {
    note(`the request state for ${cur} could not be read — keeping that name, since a`
      + ' rename here could close a request this cannot see');
    ships = cur;
  } else if (heads.length) {
    note(`a request is already open on ${cur} (${say(heads)}) — keeping that name, since`
      + ' renaming would close it');
    ships = cur;
  }
}
if (cur !== ships) {
  // Never `-M`: the force form overwrites an existing branch of that name, which is
  // someone else's work and goes silently.
  const mv = run(['branch', '-m', ships]);
  if (mv.ok) answer.renamed = true;
  else {
    // Publishing still happens, under the name that IS there. Carrying on with a name the
    // rename never produced would push a ref that does not exist and report the failure
    // as the push's.
    note(`the rename to ${ships} was refused (${mv.line()}) — shipping as ${cur}`);
    ships = cur;
  }
}
answer.branch.ships = ships;
const shipRef = `refs/heads/${ships}`;

// --- the publication, which is what everything downstream stands on
if (opts.publish) {
  // Three answers again: a ref line is a branch that is there, exit 0 with nothing is one
  // that is not, and a call that did not answer is NEITHER — publishing blind on the
  // third is how a force lands where a first push was meant.
  const ls = git(['ls-remote', '--heads', opts.pushRemote, shipRef]);
  if (!ls.ok) {
    answer.published = false;
    answer.publish.reason = `${opts.pushRemote} could not be read (${ls.line()})`;
  } else {
    const remoteTip = ls.out ? ls.out.split(/\s/)[0] : '';
    const tracking = `refs/remotes/${opts.pushRemote}/${ships}`;
    let ready = true;
    if (remoteTip) {
      // A lease compares against the tracking ref, so it needs one that exists and is
      // current. A stale one leases against a tip that moved and the force overwrites it.
      const f = run(['fetch', opts.pushRemote, `+${shipRef}:${tracking}`]);
      if (!f.ok) {
        ready = false;
        answer.published = false;
        answer.publish.reason = `the tracking ref for ${ships} could not be refreshed`
          + ` (${f.line()}), so its age is unknown and a lease would rest on nothing`;
      }
    }
    if (ready) {
      // Full refnames on both sides: a bare name is ambiguous where a tag shares it, and
      // `gh`-style short forms reach that tag instead of the branch.
      const spec = `${shipRef}:${shipRef}`;
      if (!remoteTip) answer.publish.mode = 'first';
      else if (git(['merge-base', '--is-ancestor', tracking, shipRef]).ok) answer.publish.mode = 'fast-forward';
      else answer.publish.mode = 'leased';
      // `--force-if-includes` alongside a lease with no expected value: the bare lease
      // also passes someone else's commit that arrived since the fetch, and overwrites it.
      const args = answer.publish.mode === 'leased'
        ? ['push', '--force-with-lease', '--force-if-includes', opts.pushRemote, '-u', spec]
        : ['push', opts.pushRemote, '-u', spec];
      const p = run(args);
      answer.published = p.ok;
      if (!p.ok) answer.publish.reason = `the push was refused (${p.line()})`;
    }
  }
}

// --- the names it used to carry
//
// Every one of them is judged the same way. The old local name and the one a caller
// threaded in are the same kind of thing — a name this branch shipped under before and
// does not now — and the asymmetry of deleting one blind while proving the other was
// the defect this replaces.
const candidates = [];
for (const name of [entry, opts.oldName]) {
  if (!name || name === ships) continue;
  if (!candidates.includes(name)) candidates.push(name);
}

// `null` is the answer that matters: a listing that could not be read says nothing about
// who holds these names, and reading it as "nobody" unpublishes a ref another session is
// standing on and would push straight back.
// Nothing below is read where nothing can come of it: with the new name unpublished, the
// chain of reasons in the loop stops before any of these three answers is looked at, and
// asking a remote a question whose answer is already unused is a round trip in a run that
// has already failed.
const mayRetire = candidates.length > 0 && answer.published === true;
let held = mayRetire ? new Map() : null;
let heldUnread = null;
if (mayRetire) {
  const wt = worktrees(git);
  if (wt.trees === null) { held = null; heldUnread = wt.error; }
  else for (const t of wt.trees) if (t.branch) held.set(t.branch, t.path);
}

const tracking = opts.base !== null ? `refs/remotes/${opts.baseRemote}/${opts.base}` : null;
// Refreshed and verified once, here rather than in a caller's shell, because a STALE base
// is the reading that costs: a tracking ref left behind holds less than the base does, so
// a ref already merged into it still looks like it holds something past it, and the
// deletion goes ahead on a proof that is out of date. Existence alone cannot tell the two
// apart — which is why the fetch is a condition of the proof and not a step before it.
let baseUnusable = null;
if (mayRetire && tracking !== null) {
  const f = run(['fetch', opts.baseRemote, `+refs/heads/${opts.base}:${tracking}`]);
  if (!f.ok) baseUnusable = `${opts.base} could not be refreshed from ${opts.baseRemote}`
    + ` (${f.line()}), and a base of unknown age proves nothing about what a ref holds past it`;
  else if (!git(['rev-parse', '--verify', '-q', `${tracking}^{commit}`]).ok) {
    baseUnusable = `${tracking} is not a ref this checkout carries, so what the old ref`
      + ' holds past the base is unknown';
  }
}
const baseUsable = tracking !== null && baseUnusable === null;
// Read once for the same reason. A reflog walk lists the tips this branch actually stood
// on, which is the question — commits merely REACHABLE from them include everything it
// ever merged in, and a name published from one of those was never this branch's.
let stood = null;
if (mayRetire) {
  const rl = git(['reflog', 'show', '--format=%H', shipRef]);
  if (rl.ok) stood = new Set(rl.out.split('\n').filter(Boolean));
}

for (const name of candidates) {
  const it = { name, tip: null, verdict: 'kept', reason: null };
  answer.stale.push(it);
  const ref = `refs/heads/${name}`;
  // In order, and each one that cannot run keeps the ref. The reasons differ and the
  // report needs which, so no two of them collapse into one refusal.
  if (oldPinned && name === opts.oldName) {
    it.reason = 'a request heads it and the rename back was refused — it is not this run\'s to remove';
  } else if (!opts.publish) {
    it.reason = 'nothing was published, so no name is stale yet';
  } else if (answer.published !== true) {
    it.reason = `${ships} is not published, and removing this now would unpublish the branch`;
  } else if (!baseUsable) {
    it.reason = baseUnusable
      || 'no base was named, and what a ref holds cannot be judged against nothing';
  } else if (held === null) {
    it.reason = `this repository's worktrees could not be read (${heldUnread}), so whether`
      + ' another session holds this name and would push it straight back is unknown';
  } else if (held.has(ref)) {
    it.reason = `another worktree holds it and can push it straight back: ${held.get(ref)}`;
  } else {
    const ls = git(['ls-remote', '--heads', opts.pushRemote, ref]);
    if (!ls.ok) {
      it.reason = `${opts.pushRemote} did not answer for ${ref} (${ls.line()}) — report it as possibly standing`;
    } else if (!ls.out) {
      it.verdict = 'absent';
      it.reason = `not on ${opts.pushRemote} — there is nothing to retire`;
    } else {
      const tip = ls.out.split(/\s/)[0];
      it.tip = text(tip);
      if (!git(['rev-parse', '--verify', '-q', `${tip}^{commit}`]).ok) {
        it.reason = `it is at ${it.tip}, which is not an object this checkout carries —`
          + ' whose commit that is cannot be read from here';
      } else if (!(git(['merge-base', '--is-ancestor', tip, 'HEAD']).ok
                   || (stood !== null && stood.has(tip)))) {
        it.reason = `it is at ${it.tip}, which this branch never stood on — someone's work`;
      } else if (git(['merge-base', '--is-ancestor', tip, tracking]).ok) {
        it.reason = `it holds nothing past ${opts.base} — not this branch's publication`;
      } else {
        // Leased to the tip just read rather than to a tracking ref: nothing here fetched
        // this name, so the only current thing to lease against is what the remote said a
        // moment ago.
        const del = run(['push', `--force-with-lease=${ref}:${tip}`, opts.pushRemote, '--delete', ref]);
        if (del.ok) it.verdict = 'retired';
        else it.reason = `the delete was refused (${del.line()}) — a stale lease or a deletion rule`;
      }
    }
  }
}

answer.read = true;
finish();
