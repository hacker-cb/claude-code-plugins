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

import { writeAll, readable, refOk, repoOk, runner } from './lib/forge.mjs';

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

const cwd = opts.repoDir || process.cwd();
const git = runner(cwd, 'git');
const gh = runner(cwd);

const answer = {
  read: false, branch: opts.branch, tip: null,
  // Request mode only. `state` and `headRefOid` are what every deletion rests on, and a
  // run that could not read them retires nothing.
  request: null,
  local: { exists: false, contained: false, heldBy: null, dirty: false, safe: false, blockers: [] },
  // `published: null` is "the endpoints did not all answer" — never "no branch there".
  remote: { published: null, endpoints: [], safe: false, blockers: [] },
  reason: null, notes: [],
};
const finish = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (reason) => { answer.reason = reason; finish(); };

if (!git(['rev-parse', '--git-dir']).ok) die('not inside a git checkout');

// --- the tip: the state the merge produced
let tip = opts.tip;
if (opts.pr) {
  const view = gh(['pr', 'view', opts.pr, '--json', 'state,headRefOid',
    ...(opts.repo ? ['--repo', opts.repo] : [])]);
  if (!view.ok) refuse(`could not read pull request ${opts.pr} (${view.line()})`);
  let pr;
  try { pr = JSON.parse(view.out); } catch { refuse('the pull request view was not JSON'); }
  if (!pr || typeof pr !== 'object' || Array.isArray(pr)) {
    refuse('the pull request view came back in a shape this cannot read');
  }
  answer.request = { state: pr.state ?? null, headRefOid: pr.headRefOid ?? null };
  if (answer.request.state !== 'MERGED') {
    // Not a refusal — the read succeeded. It is an answer, and it says retire nothing.
    answer.local.blockers.push(`the request is ${answer.request.state ?? 'in an unknown state'}, not merged`);
    answer.remote.blockers.push(`the request is ${answer.request.state ?? 'in an unknown state'}, not merged`);
  }
  if (!readable(answer.request.headRefOid || '')) {
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
answer.tip = tip;

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
    else if (line === `branch ${ref}` && current && current !== here.out) {
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
  if (!readable(tip || '')) refuse('no tip to measure containment against');
  const have = git(['rev-parse', '--verify', '-q', `${tip}^{commit}`]).ok;
  if (!have) {
    answer.local.blockers.push(`${tip} is not an object this checkout carries, so containment is unknown — not unmerged`);
  } else {
    const c = git(['merge-base', '--is-ancestor', ref, tip]);
    answer.local.contained = c.ok;
    if (!c.ok) {
      answer.local.blockers.push('its tip carries commits the merge never took —'
        + ' or the strategy collapsed them, which no ref-level check can show');
    }
  }
}
answer.local.safe = answer.local.exists && answer.local.contained
  && answer.local.blockers.length === 0;

// --- the published side, which stands on its own
if (!opts.pushRemote) {
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
if (answer.local.heldBy) {
  // That session can push to this ref and would recreate what the deletion removed.
  answer.remote.blockers.push('another worktree can push to this ref and would recreate it:'
    + ` ${answer.local.heldBy}`);
}
answer.remote.safe = answer.remote.published === true && answer.remote.blockers.length === 0;

answer.read = true;
finish();
