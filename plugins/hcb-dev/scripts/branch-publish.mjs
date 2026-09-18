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
// A push that did not report success is answered by READING the remote, because its exit
// status is what the client saw and a client stopped on a budget saw nothing: measured, a
// receiving side that outlives it lands the ref seconds later, and a pre-push hook longer
// than the budget leaves a push that was never refused at all.
//
// Usage: node branch-publish.mjs --new <name> [--old-name <name>]
//          [--publish --push-remote <name>] [--base <name> --base-remote <name>]
//          [--push-timeout <seconds>] [--settle <seconds>]
//          [--repo <owner/name>] [--repo-dir <path>]
//
// Exit 0 either way: `"published": true` is the one thing a caller carries forward, and
// `"ships"` the name it carries it under. Exit 2 only for a call this cannot act on.

import { realpathSync } from 'node:fs';
import { dirOk, refNameOk, repoOk, runner, text, worktrees, writeAll } from './lib/forge.mjs';

const USAGE = 'usage: node branch-publish.mjs --new <name> [--old-name <name>]'
  + ' [--publish --push-remote <name>] [--base <name> --base-remote <name>]'
  + ' [--push-timeout <seconds>] [--settle <seconds>]'
  + ' [--repo <owner/name>] [--repo-dir <path>]\n';
const die = (m) => { writeAll(2, `branch-publish: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { new: null, oldName: null, pushRemote: null, base: null, baseRemote: null,
  repo: null, repoDir: null, publish: false, pushTimeout: null, settle: null };
const VALUED = { '--new': 'new', '--old-name': 'oldName', '--push-remote': 'pushRemote',
  '--base': 'base', '--base-remote': 'baseRemote', '--repo': 'repo', '--repo-dir': 'repoDir',
  '--push-timeout': 'pushTimeout', '--settle': 'settle' };
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
// Seconds, because both are budgets a caller sets from what a repository actually costs:
// how long its pre-push hook runs, and how long its remote takes to finish a push whose
// client is already gone.
const seconds = (flag, v, fallback, floor) => {
  if (v === null) return fallback;
  // A digit string of any length converts, and a long enough one converts to `Infinity`,
  // which passes a floor test and then throws out of `spawnSync` or polls forever.
  const n = Number(v);
  if (!/^[0-9]+$/.test(v) || !Number.isSafeInteger(n) || n < floor || n > 86400) {
    die(`${flag} '${v}' is not a number of seconds (${floor} to 86400)`);
  }
  return n;
};
const PUSH_TIMEOUT = seconds('--push-timeout', opts.pushTimeout, 120, 1);
const SETTLE = seconds('--settle', opts.settle, 30, 0);
// One read every couple of seconds rather than a tight loop: what is being waited on is a
// remote finishing work, and a ref appearing two seconds late costs nothing.
const SETTLE_STEP = 2000;
const SETTLE_READ = 15;
const settledAfter = SETTLE ? `${SETTLE}s later` : 'when read straight after';

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
  // What a READ of the remote showed, never what a call's exit status suggested: `true` the
  // remote carries this branch's tip under `ships` and this checkout tracks it, `false` a
  // read showed it does not, `null` nothing settled it — the remote would not answer, or a
  // push this run stopped waiting for may yet land. `asked` tells that last one from "not
  // asked", where `null` also stands.
  published: null,
  // One entry per name this branch used to carry. `retired` is a deletion this run made,
  // `absent` is a name that was not there, `kept` is every refusal — with its reason — and
  // `unknown` is a deletion whose outcome no read settled.
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
// Why a call did not answer. A process this run KILLED said nothing about whether it would
// have succeeded, so it is named by the wait rather than by whatever line it had got to.
const detail = (r, budget = 120) => (r.timedOut
  ? `no answer within ${budget}s${r.err ? `, last: ${r.line()}` : ''}`
  : r.line());

// Whether the remote ever gave a verdict. Exit 1 is git reporting one — a ref refused, a
// hook that said no — while 128 and a kill are the call ending without one, and that
// difference decides both what the answer may claim and whether the remote is asked again.
const unanswered = (r) => r.timedOut || r.code !== 1;

// Everything here is synchronous, and a poll returning to the event loop would mean
// rewriting the script around it.
const sleep = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

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
// Where every read and fetch below goes. `git ls-remote <name>` and `git fetch <name>` both
// go to the FETCH url — measured — so under a `pushurl` they answer about a repository this
// run never writes to. The name stays wherever the two urls agree, keeping every setting a
// remote carries by name; the push url itself stands in where they do not.
let endpoint = opts.pushRemote;
// How many urls a push goes to. Each gets every push and every deletion, and a read of one
// settles nothing about the others — so with several, an act that did not report success
// stays unsettled rather than opening the retirement on the one url that took it.
let pushUrls = 1;
if (mayAsk) {
  // The url that RECEIVES pushes: a `pushurl` sends them somewhere the fetch url never
  // published to, and it is the receiving side a deletion lands on.
  const u = git(['remote', 'get-url', '--push', '--all', opts.pushRemote]);
  if (u.ok) {
    const urls = u.out.split('\n').filter(Boolean);
    pushUrls = Math.max(urls.length, 1);
    // One repository or none: with several, a request whose head lives on any of them is
    // one a push here reaches, and naming the first would drop the rest as foreign.
    here = urls.length === 1 ? repoOfUrl(urls[0]) : null;
    // A fetch url that cannot be read is not one the push url agrees with.
    const f = git(['remote', 'get-url', opts.pushRemote]);
    if (urls.length === 1 && !(f.ok && f.out.split('\n')[0] === urls[0])) [endpoint] = urls;
  }
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

// What the remote carries for a ref, and the three answers it has. A ref line is a branch
// that is there, exit 0 with nothing is one that is not, and a call that did not answer is
// NEITHER — publishing blind on the third is how a force lands where a first push was meant,
// and reporting it as the second states what nothing measured.
const remoteAt = (ref, budget = 120) => {
  const r = git(['ls-remote', '--heads', '--', endpoint, ref], budget * 1000);
  return r.ok
    ? { read: true, tip: r.out ? r.out.split(/\s/)[0] : '', why: null }
    : { read: false, tip: null, why: detail(r, budget) };
};
// The same read, asked again until it shows what `done` wants or the budget is spent. One
// read answers for the instant it was taken: a receiving side that outlived the client keeps
// working, and the ref it is holding lands seconds after this run stopped waiting.
const settled = (ref, done, patient) => {
  const until = Date.now() + (patient ? SETTLE * 1000 : 0);
  for (;;) {
    // Each read inside the budget rather than on the default one, so the budget is what
    // bounds the wait; the floor is the one read that must happen however little is left.
    const at = remoteAt(ref, Math.max(Math.ceil((until - Date.now()) / 1000), SETTLE_READ));
    // A remote that would not answer is not one to keep asking: the budget is for a
    // receiving side still working, never for one nothing here can reach.
    if (!at.read || done(at.tip)) return at;
    const left = until - Date.now();
    if (left <= 0) return at;
    sleep(Math.min(SETTLE_STEP, left));
  }
};

// --- the publication, which is what everything downstream stands on
if (opts.publish) {
  const tracking = `refs/remotes/${opts.pushRemote}/${ships}`;
  const here = git(['rev-parse', '--verify', '-q', `${shipRef}^{commit}`]);
  const tip = here.ok && here.out ? here.out : null;
  // What `published: true` has to mean: the remote carries this tip, and this checkout
  // tracks it — every step downstream assumes an upstream and none of them creates one.
  // `push -u` writes both, a push that was killed wrote neither even where the ref itself
  // landed, so a publication settled by reading the remote writes what the push did not.
  const track = () => {
    const f = run(['fetch', endpoint, `+${shipRef}:${tracking}`]);
    if (!f.ok) return `its tracking ref could not be fetched (${detail(f)})`;
    // What the fetch BROUGHT, not that it ran: the remote can move between the read that
    // settled the publication and this, and an upstream left pointing at someone else's
    // commit would be reported as this branch's published tip.
    const at = git(['rev-parse', '--verify', '-q', `${tracking}^{commit}`]);
    if (!at.ok || at.out !== tip) {
      return `${tracking} came back at ${at.ok ? text(at.out) : 'nothing'} rather than`
        + ` ${text(tip)}, so the remote moved while this was being read`;
    }
    // Not `branch --set-upstream-to`, which resolves the tracking ref through the remote's
    // CONFIGURED fetch refspec and refuses in a single-branch clone. These two values are
    // what `push -u` itself writes, measured in both shapes of clone.
    const r = run(['config', `branch.${ships}.remote`, opts.pushRemote]);
    const m = run(['config', `branch.${ships}.merge`, shipRef]);
    if (!r.ok || !m.ok) return `its upstream could not be set (${detail(r.ok ? m : r)})`;
    return null;
  };
  const ls = remoteAt(shipRef);
  if (!ls.read) {
    // Nothing was pushed and nothing was read, so what the remote carries is unknown —
    // which a `false` here would state as a fact.
    answer.published = null;
    answer.publish.reason = `${opts.pushRemote} could not be read (${ls.why}), so what it`
      + ` carries under ${ships} is unknown`;
  } else {
    const remoteTip = ls.tip;
    let ready = true;
    if (remoteTip) {
      // Not for the lease, which carries its own value below: for the two readings that
      // need the remote's tip as an OBJECT here — whether this branch already contains it,
      // and whether it ever stood on it. A tip that was never fetched answers neither, and
      // an `is-ancestor` that errored reads exactly like one that said no.
      const f = run(['fetch', endpoint, `+${shipRef}:${tracking}`]);
      if (!f.ok) {
        ready = false;
        // Nothing was pushed, and what the remote already carries decides which of the two
        // this is: a tip that is not this branch's is a `false` a read proved, and this
        // branch's own tip is a ref that is up with no way to track it from here.
        answer.published = remoteTip === tip ? null : false;
        answer.publish.reason = `the tracking ref for ${ships} could not be refreshed`
          + ` (${detail(f)}), so its age is unknown and a lease would rest on nothing`
          + (remoteTip === tip ? `; ${opts.pushRemote} does carry ${ships} at ${text(tip)},`
            + ' but nothing here tracks it' : '');
      }
    }
    if (ready) {
      // Full refnames on both sides: a bare name is ambiguous where a tag shares it, and
      // `gh`-style short forms reach that tag instead of the branch.
      const spec = `${shipRef}:${shipRef}`;
      if (!remoteTip) answer.publish.mode = 'first';
      else if (git(['merge-base', '--is-ancestor', tracking, shipRef]).ok) answer.publish.mode = 'fast-forward';
      else answer.publish.mode = 'leased';
      // `--progress`: with stderr a pipe git says nothing until it is asked to, so a push
      // this run stops waiting for leaves no trace of which phase it stood in.
      let args = ['push', opts.pushRemote, '-u', '--progress', spec];
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
        args = ['push', `--force-with-lease=${shipRef}:${remoteTip}`, opts.pushRemote, '-u',
          '--progress', spec];
      }
      if (ready) {
        const p = run(args, PUSH_TIMEOUT * 1000);
        if (p.ok) answer.published = true;
        else {
          // Asked of the remote, not of the exit status. A push refused and a push stopped
          // mid-way both come back non-zero, and only the first of them measured anything:
          // the ref this branch is publishing may be up already, put there by a receiving
          // side that outlived the client.
          const pending = unanswered(p);
          const stopped = p.timedOut
            ? `the push was not waited out — ${PUSH_TIMEOUT}s passed with no answer`
              + `${p.err ? ` (last: ${p.line()})` : ''}`
            : (pending
              ? `the push ended without a verdict from ${opts.pushRemote} (${p.line()})`
              : `the push was refused (${p.line()})`);
          const at = pushUrls > 1 ? null
            : settled(shipRef, (t) => tip !== null && t === tip, pending);
          if (at === null) {
            answer.published = null;
            answer.publish.reason = `${stopped}, and ${opts.pushRemote} pushes to ${pushUrls}`
              + ' urls — a read of one settles nothing about the others';
          } else if (at.read && tip !== null && at.tip === tip) {
            const missing = track();
            answer.published = missing === null ? true : null;
            answer.publish.reason = missing === null
              ? `${stopped}, and ${opts.pushRemote} carries ${ships} at ${text(tip)} — the ref`
                + ' is up, and the upstream the push never recorded was set here'
              : `${stopped}; ${opts.pushRemote} carries ${ships} at ${text(tip)}, but`
                + ` ${missing}, so a step downstream would push to nothing`;
          } else if (!at.read) {
            // A refusal measured something the read failing does not undo: the remote
            // answered, and what it answered was no.
            answer.published = pending ? null : false;
            answer.publish.reason = `${stopped}, and ${opts.pushRemote} could not be read`
              + ` afterwards (${at.why})${pending ? ` — whether ${ships} is up is unknown` : ''}`;
          } else if (pending) {
            answer.published = null;
            answer.publish.reason = `${stopped}, and ${opts.pushRemote} was not carrying`
              + ` ${ships} at this branch's tip ${settledAfter} — nothing may have been sent,`
              + ' or a receiving side still working may yet land the ref';
          } else {
            answer.published = false;
            answer.publish.reason = stopped;
          }
        }
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
    + ` (${detail(f)}), and a base of unknown age proves nothing about what a ref holds past it`;
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
  } else if (answer.published === null) {
    it.reason = `whether ${ships} is published is unknown, and removing this now could`
      + ' unpublish the branch';
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
  } else if (pushUrls > 1) {
    // Every proof below reads one repository, and the deletion goes to all of them.
    it.reason = `${opts.pushRemote} pushes to ${pushUrls} urls, and what a ref holds is read on`
      + ' one of them while a deletion lands on every one';
  } else {
    const ls = remoteAt(ref);
    if (!ls.read) {
      it.reason = `${opts.pushRemote} did not answer for ${ref} (${ls.why}) — report it as possibly standing`;
    } else if (!ls.tip) {
      it.verdict = 'absent';
      it.reason = `not on ${opts.pushRemote} — there is nothing to retire`;
    } else {
      const { tip } = ls;
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
          const del = run(['push', `--force-with-lease=${ref}:${tip}`, opts.pushRemote,
            '--delete', ref], PUSH_TIMEOUT * 1000);
          if (del.ok) it.verdict = 'retired';
          else {
            // Read, for the publish's reason and with more riding on it: a deletion is the
            // act that cannot be taken back, and one this run stopped waiting for may have
            // landed — reporting that as `kept` says a ref is standing that is gone.
            const pending = unanswered(del);
            const stopped = del.timedOut
              ? `the delete was not waited out — ${PUSH_TIMEOUT}s passed with no answer`
                + `${del.err ? ` (last: ${del.line()})` : ''}`
              : (pending
                ? `the delete ended without a verdict from ${opts.pushRemote} (${del.line()})`
                : `the delete was refused (${del.line()})`);
            // Stops at the first move away from the leased tip, not only at its absence: a
            // ref that moved is one this lease cannot remove, and whatever takes it off
            // later took it off without this run.
            const at = settled(ref, (t) => t !== tip, pending);
            if (at.read && at.tip === '') {
              // Gone — and whose deletion that was is what the verdict says. With a refusal
              // the remote answered and this run's delete never ran, so the ref came off
              // somewhere else; `retired` would claim an act this run did not make.
              it.verdict = pending ? 'retired' : 'absent';
              it.reason = `${stopped}, and ${opts.pushRemote} no longer carries it`
                + (pending ? '' : ' — something else took it off');
            } else if (at.read && at.tip !== tip) {
              it.reason = `${stopped}, and ${opts.pushRemote} now carries it at`
                + ` ${text(at.tip)} — it moved, and a lease pinned to ${it.tip} takes nothing`
                + ' off';
            } else if (at.read && !pending) {
              it.reason = `${stopped} — a stale lease or a deletion rule`;
            } else if (at.read) {
              it.verdict = 'unknown';
              it.reason = `${stopped}, and ${opts.pushRemote} still carried it ${settledAfter}`
                + ' — it may yet come off';
            } else {
              // The read that would settle it failed; a refusal settled it by itself.
              it.verdict = pending ? 'unknown' : 'kept';
              it.reason = `${stopped}, and ${opts.pushRemote} could not be read afterwards`
                + ` (${at.why})`;
            }
          }
        }
      }
    }
  }
}

answer.read = true;
finish();
