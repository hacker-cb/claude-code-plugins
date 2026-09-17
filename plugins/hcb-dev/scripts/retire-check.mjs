#!/usr/bin/env node
// retire-check.mjs — is this branch safe to retire, and on which side? Prints JSON.
//
// This READS and judges; it deletes nothing and moves no HEAD. Those are the caller's,
// and deliberately: a deletion folded into the reading runs before the reading is
// believed, and what it reports is then not what it did.
//
// The two sides are answered separately because they fail separately. A dirty tree or a
// local tip carrying commits the merge never took says nothing about the published ref
// — and the published ref is the one nothing else can clear afterwards.
//
// Usage: node retire-check.mjs --branch <name> (--tip <ref> | --pr <n>)
//                              [--push-remote <name>] [--repo <owner/name>]
//                              [--repo-dir <path>]
//
// Exit 0 either way: `"read": true` with the two verdicts, or `"read": false` with a
// `reason`. Exit 2 only for a call this script cannot act on at all.

import { realpathSync } from 'node:fs';
import { dirOk, readable, refOk, repoOk, runner, writeAll } from './lib/forge.mjs';

const USAGE = 'usage: node retire-check.mjs --branch <name> (--tip <ref> | --pr <n>)'
  + ' [--push-remote <name>] [--repo <owner/name>] [--repo-dir <path>]\n';
const die = (m) => { writeAll(2, `retire-check: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { branch: null, tip: null, pr: null, pushRemote: null, repo: null, repoDir: null };
const FLAGS = { '--branch': 'branch', '--tip': 'tip', '--pr': 'pr', '--push-remote': 'pushRemote', '--repo': 'repo', '--repo-dir': 'repoDir' };
for (let i = 0; i < argv.length; i += 1) {
  const key = FLAGS[argv[i]];
  if (!key) die(`unknown argument '${argv[i]}'`);
  if (argv[i + 1] === undefined) die(`${argv[i]} needs a value`);
  opts[key] = argv[i + 1];
  i += 1;
}
if (!opts.branch) die('--branch is required');
if (!refOk(opts.branch)) die(`--branch '${opts.branch}' is not a branch name this can read`);
if (!opts.tip && !opts.pr) die('one of --tip or --pr is required — the commit the merge produced');
if (opts.tip && opts.pr) die('--tip and --pr are two ways to name the same commit; pass one');
if (opts.pr && !/^[1-9][0-9]{0,9}$/.test(opts.pr)) die(`--pr '${opts.pr}' is not a request number`);
if (opts.tip && !refOk(opts.tip)) die(`--tip '${opts.tip}' is not a ref this can read`);
if (opts.pushRemote && !readable(opts.pushRemote)) die(`--push-remote '${opts.pushRemote}' is not a remote name`);
if (opts.repo && !repoOk(opts.repo)) die(`--repo '${opts.repo}' is not owner/name`);

// A directory, proved here: passed on as `cwd` it would come back as a call that failed
// with nothing on stderr, which reads as a forge that would not answer.
if (opts.repoDir && !dirOk(opts.repoDir)) die(`--repo-dir '${opts.repoDir}' is not a directory`);
const cwd = opts.repoDir || process.cwd();
const git = runner(cwd, 'git');
const gh = runner(cwd);

// Where a request's head LIVES. Two requests carry the same branch NAME from different
// repositories all the time — a fork's ref is not this one — so identity is what says
// whether a deletion would reach it.
const headRepo = (pr) => {
  const r = pr && pr.headRepository;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const id = typeof r.id === 'string' && r.id ? r.id : null;
  const named = typeof r.nameWithOwner === 'string' && r.nameWithOwner ? r.nameWithOwner : null;
  return id || named ? { id, nameWithOwner: named } : null;
};
// Three answers, and the third carries the weight: `null` is "cannot tell", which blocks
// exactly as a match does. Compared key for key — an id against a name is not a
// comparison, and reading it as a difference would clear the blocker it cannot see.
const sameRepo = (a, b) => {
  if (!a || !b) return null;
  if (a.id && b.id) return a.id === b.id;
  if (a.nameWithOwner && b.nameWithOwner) return a.nameWithOwner === b.nameWithOwner;
  return null;
};
// A path answered by two git commands is not two spellings of two places: `/tmp` is a
// symlink to `/private/tmp` on macOS, and comparing the strings reads the worktree you
// stand in as somebody else's.
const samePath = (a, b) => {
  if (a === b) return true;
  try { return realpathSync(a) === realpathSync(b); } catch { return false; }
};

const answer = {
  read: false, branch: opts.branch,
  // What containment is measured against and what the remote deletion LEASES — never
  // where HEAD should go. After a squash the request's head is not in the base at all,
  // so a caller detaching onto it would stand on unmerged work and cut the next branch
  // from there. The HEAD move uses the refreshed base; `base-resolution.md` owns it.
  measuredAgainst: null,
  // Request mode only. `state` and `headRefOid` are what every deletion rests on, and a
  // run that could not read them retires nothing. `headRepo` is where that head LIVES,
  // which is what tells a second request on this ref apart from a fork's same-named one.
  request: null,
  local: { exists: false, contained: false, noRefProof: false, callerDecides: false,
    heldBy: null, dirty: false, blockers: [] },
  // `published: null` is "the endpoints did not all answer" — never "no branch there".
  remote: { published: null, endpoints: [], blockers: [] },
  // Named apart on purpose: `safe` on both sides was one word at two levels, and a
  // reader — or a test — cannot tell two levels of one word apart.
  deleteLocal: false, deleteRemote: false,
  reason: null, notes: [],
};
const finish = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (reason) => { answer.reason = reason; finish(); };

if (!git(['rev-parse', '--git-dir']).ok) die('not inside a git checkout');

// --- the tip: the state the merge produced
let tip = opts.tip;
if (opts.pr) {
  const view = gh(['pr', 'view', opts.pr, '--json', 'state,headRefOid,headRepository',
    ...(opts.repo ? ['--repo', opts.repo] : [])]);
  if (!view.ok) refuse(`could not read pull request ${opts.pr} (${view.line()})`);
  let pr;
  try { pr = JSON.parse(view.out); } catch { refuse('the pull request view was not JSON'); }
  if (!pr || typeof pr !== 'object' || Array.isArray(pr)) {
    refuse('the pull request view came back in a shape this cannot read');
  }
  answer.request = { state: pr.state ?? null, headRefOid: pr.headRefOid ?? null,
    headRepo: headRepo(pr) };
  if (answer.request.state !== 'MERGED') {
    // Not a refusal — the read succeeded. It is an answer, and it says retire nothing.
    answer.local.blockers.push(`the request is ${answer.request.state ?? 'in an unknown state'}, not merged`);
    answer.remote.blockers.push(`the request is ${answer.request.state ?? 'in an unknown state'}, not merged`);
  }
  if (!refOk(answer.request.headRefOid || '')) {
    refuse(`pull request ${opts.pr} recorded no head commit — nothing to measure against`);
  }
  tip = answer.request.headRefOid;
  // A head that advanced on the forge alone — a base update taken there, a suggestion
  // committed in the web UI — is not an object this repository carries, and the proof
  // below would read it as unmerged rather than as unknown. Fetch it by its id first.
  if (opts.pushRemote && !git(['rev-parse', '--verify', '-q', `${tip}^{commit}`]).ok) {
    const f = git(['fetch', opts.pushRemote, tip], 120000);
    if (!f.ok) answer.notes.push(`${tip} is not in this checkout and could not be fetched from ${opts.pushRemote}`);
  }
}
answer.measuredAgainst = tip;

// --- the local side
const ref = `refs/heads/${opts.branch}`;
answer.local.exists = git(['rev-parse', '--verify', '-q', `${ref}^{commit}`]).ok;
if (!answer.local.exists) {
  answer.notes.push(`${ref} is not in this checkout — there is nothing local to retire`);
} else {
  // Another worktree's branch is not this session's to move or delete. Compared against
  // THIS worktree's path: a bare name check reads the branch you stand on as somebody
  // else's.
  const here = git(['rev-parse', '--show-toplevel']);
  const wt = git(['worktree', 'list', '--porcelain']);
  if (!here.ok || !wt.ok) refuse('could not read this checkout\'s worktrees');
  let current = null;
  for (const line of wt.out.split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length);
    else if (line === `branch ${ref}` && current && !samePath(current, here.out)) {
      answer.local.heldBy = current;
    }
  }
  if (answer.local.heldBy) answer.local.blockers.push(`another worktree holds it: ${answer.local.heldBy}`);

  // An uncommitted change stops the local half outright — and only the local half.
  const status = git(['status', '--porcelain', '-unormal']);
  if (!status.ok) refuse('could not read the working tree\'s status');
  answer.local.dirty = status.out !== '';
  if (answer.local.dirty) answer.local.blockers.push('the working tree has uncommitted changes');

  // The proof. `git branch -d` is NOT it: with an upstream set, git tests containment
  // against that upstream rather than against the tip, so a branch pushed at some
  // earlier point passes whether or not the merge landed. Measured, with git saying so
  // out loud: `deleting branch 'feature' that has been merged to
  // 'refs/remotes/origin/feature', but not yet merged to HEAD`.
  // `refOk`, not `readable`: a parent is `feature/x` and a remote-tracking ref is
  // `refs/remotes/origin/main` — many segments, and holding them to one refuses every
  // ordinary local completion.
  if (!refOk(tip || '')) refuse('no tip to measure containment against');
  const have = git(['rev-parse', '--verify', '-q', `${tip}^{commit}`]).ok;
  if (!have) {
    answer.local.blockers.push(`${tip} is not an object this checkout carries, so containment is unknown — not unmerged`);
  } else {
    const c = git(['merge-base', '--is-ancestor', ref, tip]);
    answer.local.contained = c.ok;
    if (!c.ok) {
      // Two states, one git answer: git cannot tell them apart and neither can this.
      // The caller can — it has just confirmed the merge and knows its strategy — so
      // the blocker names both rather than picking one.
      answer.local.contained = false;
      if (opts.pr) {
        // Request mode measures against the head the request RECORDED, which is
        // pre-squash — so the strategy invalidates nothing here, and `false` means
        // commits that never reached the request. There is no exception to offer.
        answer.local.blockers.push('its tip carries commits the request never took —'
          + ' containment is measured against the head the request recorded, which a'
          + ' squash does not move');
      } else {
        // Local mode: git cannot tell a squash from work that never landed, and neither
        // can this. The caller has just confirmed the merge and knows its strategy — and
        // `callerDecides` below is where that judgement is handed over, so that making it
        // never means reading this blocker's prose.
        answer.local.noRefProof = true;
        answer.local.blockers.push('no ref-level proof: either its tip carries commits the'
          + ' merge never took, or the strategy collapsed them — a squash leaves none, and'
          + ' the confirmed merge is then what landed it');
      }
    }
  }
}

// --- the published side, which stands on its own
if (!opts.pr) {
  // Request mode only. A local merge publishes nothing, so a ref an earlier push left
  // on the remote is not this step's to remove — and there is no recorded head to lease
  // the deletion against, which is what stops it removing a ref that moved since.
  answer.remote.blockers.push('local mode publishes nothing, and there is no recorded'
    + ' head to lease a deletion against — what is published is not this step\'s');
} else if (!opts.pushRemote) {
  answer.remote.blockers.push('no push remote named — what is published was not asked');
} else {
  // The URLs that RECEIVE pushes, not the remote by name: a `pushurl` sends pushes
  // somewhere the fetch url never published to. `--all`, because a push reaches every
  // configured endpoint.
  const urls = git(['remote', 'get-url', '--push', '--all', opts.pushRemote]);
  if (!urls.ok) {
    answer.remote.blockers.push(`${opts.pushRemote} does not resolve`);
  } else {
    for (const url of urls.out.split('\n').filter(Boolean)) {
      const r = git(['ls-remote', '--heads', url, ref], 120000);
      // Three answers, and the middle one is the whole point: a ref line means still
      // published; nothing at all means the merge already took it; a call that did not
      // answer is NEITHER, and reading it as "no branch" calls a live ref one the merge
      // took.
      if (!r.ok) answer.remote.endpoints.push({ url, has: null, error: r.line() });
      else answer.remote.endpoints.push({ url, has: r.out !== '' });
    }
    const unknown = answer.remote.endpoints.filter((e) => e.has === null);
    if (unknown.length) {
      answer.remote.blockers.push(`${unknown.length} endpoint(s) did not answer`);
    }
    const live = answer.remote.endpoints.some((e) => e.has === true);
    answer.remote.published = unknown.length ? null : live;
  }
}
// Another request open on this ref keeps the branch: that request's head IS this ref,
// and deleting it closes the request along with whatever a reviewer asks for next.
if (opts.pr) {
  const others = gh(['pr', 'list', '--head', opts.branch, '--state', 'open',
    '--json', 'number,headRepository', ...(opts.repo ? ['--repo', opts.repo] : [])]);
  // BOTH sides, on every path: a branch under an open request stays locally too — that
  // request's head is this ref, and what a reviewer asks for next has nowhere to land.
  // Unknown is not `none`, so a reading that failed blocks exactly as a second request
  // standing does.
  const bothWays = (why) => { answer.local.blockers.push(why); answer.remote.blockers.push(why); };
  if (!others.ok) {
    bothWays(`could not read what else is open on this ref (${others.line()})`);
  } else {
    let list;
    try { list = JSON.parse(others.out); } catch { list = null; }
    if (!Array.isArray(list)) {
      bothWays('what else is open on this ref came back in a shape this cannot read');
    } else {
      // `--head` filters by branch NAME, which is not unique across forks: a
      // contributor's own `fix/typo` is a different ref, and deleting this one cannot
      // reach it. Identity decides, and where it cannot be read the blocker stands.
      const hits = [];
      const unsure = [];
      for (const r of list) {
        const n = r && r.number;
        if (String(n) === String(opts.pr)) continue;
        const same = sameRepo(answer.request.headRepo, headRepo(r));
        if (same === true) hits.push(n);
        else if (same === null) unsure.push(n);
      }
      if (hits.length) bothWays(`another request is open on this ref: ${hits.join(', ')}`);
      if (unsure.length) {
        bothWays('another request carries this branch name and which repository its head'
          + ` is in could not be read: ${unsure.join(', ')}`);
      }
    }
  }
}

if (answer.local.heldBy) {
  // That session can push to this ref and would recreate what the deletion removed.
  answer.remote.blockers.push('another worktree can push to this ref and would recreate it:'
    + ` ${answer.local.heldBy}`);
}
// Both verdicts here, after every blocker is in. Computing one earlier is how a check
// that runs later adds its blocker beside a `safe: true` that no longer holds.
// The one refusal a caller may overrule, and local mode's alone. A flag rather than a
// blocker to read around: `false` the moment anything else is also in the way, so
// overruling it can never carry a dirty tree or another worktree along with it.
answer.local.callerDecides = answer.local.noRefProof && answer.local.blockers.length === 1;
// One rule, said once and for both sides: there is something to delete, and nothing in
// the way. Naming a proof here as well — `contained`, say — reads as a second guard and
// is not one: every path that leaves it false pushes a blocker, so the term can never
// change an answer, and a dead term in a verdict is what the last round removed.
answer.deleteLocal = answer.local.exists && answer.local.blockers.length === 0;
answer.deleteRemote = answer.remote.published === true && answer.remote.blockers.length === 0;

answer.read = true;
finish();
