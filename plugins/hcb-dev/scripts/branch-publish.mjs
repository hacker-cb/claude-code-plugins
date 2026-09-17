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

import { realpathSync } from 'node:fs';
import { dirOk, refNameOk, repoOk, runner, text, worktrees, writeAll } from './lib/forge.mjs';

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
// Git's own rules, not a url segment's: `git remote add` takes `team/upstream`,
// `upstream#2` and `up%2` — measured — and a url class refuses all three. The value
// reaches git as an argument and composes `refs/remotes/<remote>/<branch>`, so what has to
// hold is that it is a ref path and not an option.
if (opts.pushRemote && !refNameOk(opts.pushRemote)) die(`--push-remote '${opts.pushRemote}' is not a remote name git would take`);
if ((opts.base === null) !== (opts.baseRemote === null)) {
  die('--base and --base-remote name one tracking ref between them; pass both or neither');
}
if (opts.base !== null && !refNameOk(opts.base)) die(`--base '${opts.base}' is not a branch name`);
if (opts.baseRemote !== null && !refNameOk(opts.baseRemote)) die(`--base-remote '${opts.baseRemote}' is not a remote name git would take`);
if (opts.repo && !repoOk(opts.repo)) die(`--repo '${opts.repo}' is not owner/name`);

// A directory, proved here: passed on as `cwd` it would come back as a call that failed
// with nothing on stderr, which reads as a forge that would not answer.
if (opts.repoDir && !dirOk(opts.repoDir)) die(`--repo-dir '${opts.repoDir}' is not a directory`);
const cwd = opts.repoDir || process.cwd();
const git = runner(cwd, 'git');
const gh = runner(cwd);

// The tips a branch actually STOOD on. Commits merely reachable from them include
// everything it ever merged in, and a ref published from one of those was never this
// branch's — so the walk is over the reflog's own entries, not over their ancestry.
const reflogOf = (ref) => {
  const rl = git(['reflog', 'show', '--format=%H', ref]);
  return new Set(rl.ok ? rl.out.split('\n').filter(Boolean) : []);
};

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
  // Every call that CHANGED something, in the order it was made. The reads that prove each
  // one stay out: they are what this run asked, not what it did, and a run that touched
  // nothing says so with an empty list.
  ran: [],
  notes: [],
  reason: null,
};
const finish = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (reason) => { answer.reason = reason; finish(); };
const note = (m) => { answer.notes.push(m); };
// `git` for a question, `run` for an act — the split IS the contract of `ran` above, so a read
// sent through here stops being distinguishable from a change this run made.
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

// Read BEFORE the rename, because that is the state both questions are about: whether
// another worktree stands on the name about to move, and whose the names left behind are.
// A path answered by two git commands is not two places — `/tmp` is a symlink to
// `/private/tmp` on macOS — so the comparison is by resolved path, not by string.
const real = (p) => { try { return realpathSync(p); } catch { return p; } };
const heldElsewhere = new Map();
let worktreesUnread = null;
{
  const mine = git(['rev-parse', '--show-toplevel']);
  const wt = worktrees(git);
  if (wt.trees === null) worktreesUnread = wt.error;
  else if (!mine.ok) worktreesUnread = 'this checkout could not say where it is';
  else {
    const hereTree = real(mine.out);
    for (const t of wt.trees) {
      if (t.branch && real(t.path) !== hereTree) heldElsewhere.set(t.branch, t.path);
    }
  }
}

// The probe reaches a forge, and what it gates is DESTRUCTION: a rename that would strand
// a request's head ref, and a deletion that would close one outright. Where nothing is
// published nothing is deleted either, so a local normalization — `shipping-workflow`
// step 0, and every rename in a repository this CLI does not speak for — renames with no
// network call at all rather than failing closed forever on a `gh` that cannot answer.
const mayAsk = opts.publish;
// Which repository a hit's head must live in for anything here to reach it: the one
// `--push-remote` points at, and NEVER the one `gh` speaks for. In a fork checkout those
// are two different repositories — `gh` answers for the base, where the request lives,
// while the head ref a deletion here would remove is on the fork — so comparing against
// `gh`'s answer drops exactly the request whose head is about to come off and keeps the
// ones nothing here could touch. `--repo` is the same mistake by another route: it names
// the repository to ASK, not the one being pushed to.
//
// Only a url with a host answers this. A filesystem path is a remote too, and reading its
// trailing directories as `owner/name` would silently drop every hit — which is the
// reading that deletes. `null` means unknown, and unknown keeps every hit.
const repoOfUrl = (url) => {
  const m = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?(?:[^/@]*@)?[^/@:]+(?::[0-9]+)?[/:](.+)$/
    .exec(String(url).trim());
  if (!m) return null;
  const path = m[1].replace(/\.git\/*$/, '').replace(/^\/+|\/+$/g, '');
  return path.includes('/') ? path : null;
};
let here = null;
if (mayAsk) {
  // The url that RECEIVES pushes: a `pushurl` sends them somewhere the fetch url never
  // published to, and it is the receiving side a deletion lands on.
  const u = git(['remote', 'get-url', '--push', opts.pushRemote]);
  if (u.ok) here = repoOfUrl(u.out.split('\n').filter(Boolean)[0] || '');
}

// Does an open change request head this name? Three answers, and the third carries the
// weight: `gh` failing to say prints exactly what "nothing open" prints, and reading the
// second as the first renames or deletes the head ref of a live review.
const headedBy = (name) => {
  const r = gh(['pr', 'list', '--head', name, '--state', 'open', '--json', 'number,headRepository',
    ...(opts.repo ? ['--repo', opts.repo] : [])]);
  if (!r.ok) return null;
  let list;
  try { list = JSON.parse(r.out); } catch { return null; }
  if (!Array.isArray(list)) return null;
  const hits = list.map((p) => ({
    number: p && typeof p.number === 'number' ? p.number : null,
    where: text(p && p.headRepository && p.headRepository.nameWithOwner),
  })).filter((p) => p.number !== null);
  // A head that lives elsewhere is a ref this run's push remote cannot reach. Dropped only
  // where both sides are known — either unknown and the hit counts, which is the reading
  // that keeps a name rather than losing one.
  return here ? hits.filter((h) => h.where === null || h.where === here) : hits;
};
const say = (hits) => hits
  .map((h) => `#${h.number} in ${h.where || 'a repository this could not read'}`).join(', ');

// --- the name it ships under
//
// A caller upstream may have renamed already and threaded what it renamed away through as
// `old-name`. A request heading that name pins it: the rename closed nothing yet — only a
// local ref moved — so it is undone and the branch ships under the old name after all.
// `git worktree add -f` lets a second worktree stand on this branch, and a one-argument
// rename moves it for that session too — retargeting its HEAD without a word. Both renames
// below are that form, so both ask; a listing that could not be read is the same refusal,
// since unknown is not "nobody".
const standsElsewhere = () => (worktreesUnread !== null
  ? `this repository's worktrees could not be read (${worktreesUnread})`
  : (heldElsewhere.get(`refs/heads/${cur}`)
    ? `another worktree stands on ${cur} (${heldElsewhere.get(`refs/heads/${cur}`)})` : null));

let oldPinned = false;
if (mayAsk && opts.oldName && opts.oldName !== cur) {
  const heads = headedBy(opts.oldName);
  if (heads === null || heads.length) {
    const why = heads === null
      ? `the request state for ${opts.oldName} could not be read`
      : `a request heads ${opts.oldName} (${say(heads)})`;
    const standing = standsElsewhere();
    const back = standing ? null : run(['branch', '-m', opts.oldName]);
    if (back && back.ok) {
      note(`${why} — renamed back, and the branch ships under that name`);
      cur = opts.oldName; ships = opts.oldName; answer.restored = true;
    } else {
      // Either way the old name keeps whatever heads it and is not this run's to remove,
      // which is exactly what `oldPinned` says downstream.
      oldPinned = true;
      note(standing
        ? `${why}, and ${standing} — keeping ${cur}, since the rename back would move that`
          + ' session\'s HEAD too'
        : `${why}, and the rename back was refused (${back.line()}) — shipping as ${cur}`);
    }
  }
}
// The same probe on the name carried now, and for the same reason. Asked only where a
// rename is actually on the table: with the name already right there is nothing to pin.
if (mayAsk && cur !== ships) {
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
const standingHere = cur !== ships ? standsElsewhere() : null;
if (standingHere) {
  note(`${standingHere} — keeping the name, since the rename would move that`
    + ' session\'s HEAD too');
  ships = cur;
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
if (!mayAsk && cur !== ships) {
  note(`nothing is being published, so no forge was asked whether a request heads ${cur}`
    + ' — a rename alone strands no head ref, and every deletion asks for itself');
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
      // Not for the lease, which carries its own value below: for the two readings that
      // need the remote's tip as an OBJECT here — whether this branch already contains it,
      // and whether it ever stood on it. A tip that was never fetched answers neither, and
      // an `is-ancestor` that errored reads exactly like one that said no.
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
      let args = ['push', opts.pushRemote, '-u', spec];
      if (answer.publish.mode === 'leased') {
        // What is being overwritten has to be work this branch itself put there. A bare
        // `--force-with-lease` plus `--force-if-includes` is git's way of saying that, and
        // it is unusable here for two measured reasons: the bare lease resolves through
        // the remote's CONFIGURED fetch refspec, so a single-branch clone refuses the push
        // as `stale info` even with the tracking ref fetched by name; and pinning the lease
        // to a value — which does work there — turns `--force-if-includes` into a no-op,
        // so the guarantee silently leaves with it. The proof is made here instead, where
        // a test can hold it.
        const stoodOn = git(['merge-base', '--is-ancestor', remoteTip, shipRef]).ok
          || reflogOf(shipRef).has(remoteTip);
        if (!stoodOn) {
          answer.published = false;
          answer.publish.reason = `${opts.pushRemote} carries ${text(remoteTip)} on ${ships},`
            + ' which this branch never stood on — forcing over it would drop work that is'
            + ' not this branch\'s to drop';
          ready = false;
        }
        args = ['push', `--force-with-lease=${shipRef}:${remoteTip}`, opts.pushRemote, '-u', spec];
      }
      if (ready) {
        const p = run(args);
        answer.published = p.ok;
        if (!p.ok) answer.publish.reason = `the push was refused (${p.line()})`;
      }
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

// Nothing below is read where nothing can come of it: with the new name unpublished, the
// chain of reasons in the loop stops before any of these answers is looked at, and asking
// a remote a question whose answer is already unused is a round trip in a run that has
// already failed.
const mayRetire = candidates.length > 0 && answer.published === true;

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
const stood = mayRetire ? reflogOf(shipRef) : null;

for (const name of candidates) {
  const it = { name, tip: null, verdict: 'kept', reason: null };
  answer.stale.push(it);
  const ref = `refs/heads/${name}`;
  // In order, and each one that cannot run keeps the ref. The reasons differ and the
  // report needs which, so no two of them collapse into one refusal.
  if (oldPinned && name === opts.oldName) {
    it.reason = 'a request heads it and the rename back was refused — it is not this run\'s to remove';
  } else if (opts.base !== null && name === opts.base) {
    // Named outright, and not left to the proof below. That proof reads "holds nothing
    // past the base", and in a triangular checkout — pushing to a fork, basing on the
    // upstream — a fork's own base branch legitimately holds commits the upstream has
    // not, so the proof passes and the branch every other one is cut from comes off.
    it.reason = 'it is the base itself — whatever it holds past another remote\'s copy of'
      + ' the base, it is not a publication of this branch';
  } else if (!opts.publish) {
    it.reason = 'nothing was published, so no name is stale yet';
  } else if (answer.published !== true) {
    it.reason = `${ships} is not published, and removing this now would unpublish the branch`;
  } else if (!baseUsable) {
    it.reason = baseUnusable
      || 'no base was named, and what a ref holds cannot be judged against nothing';
  } else if (worktreesUnread !== null) {
    it.reason = `this repository's worktrees could not be read (${worktreesUnread}), so`
      + ' whether another session holds this name and would push it straight back is unknown';
  } else if (heldElsewhere.has(ref)) {
    it.reason = `another worktree holds it and can push it straight back: ${heldElsewhere.get(ref)}`;
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
        // Asked HERE, per name, and not inherited from whatever the rename decided. A
        // rename may not have happened at all — the restore path leaves the names it did
        // not touch unasked about — and a request can be opened on any of these between
        // one run and the next. Deleting a head ref closes the request it heads, so this
        // is the last thing between that and a review nobody meant to end.
        const heads = mayAsk ? headedBy(name) : null;
        if (heads === null) {
          it.reason = `whether a request heads ${name} could not be read — deleting a head`
            + ' ref closes the request it heads, and this one cannot be seen';
        } else if (heads.length) {
          it.reason = `a request heads it (${say(heads)}) — deleting this ref closes that`
            + ' request along with its review';
        } else {
          // Leased to the tip just read rather than to a tracking ref: nothing here
          // fetched this name, so what the remote said a moment ago is the only current
          // thing to lease against.
          const del = run(['push', `--force-with-lease=${ref}:${tip}`, opts.pushRemote, '--delete', ref]);
          if (del.ok) it.verdict = 'retired';
          else it.reason = `the delete was refused (${del.line()}) — a stale lease or a deletion rule`;
        }
      }
    }
  }
}

answer.read = true;
finish();
