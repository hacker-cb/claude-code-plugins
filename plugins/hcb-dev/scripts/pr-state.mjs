#!/usr/bin/env node
// pr-state.mjs — what the forge says about one change request, and what is outstanding
// on it. Prints JSON.
//
// PERMISSION, not readiness. The gates decide whether a merge is allowed; a driver's own
// bar decides whether it should happen, and the two are not the same question — where
// they diverge the stricter one wins, which is the caller's to apply. This answers the
// first half, and hands over the facts the second half needs.
//
// Usage: node pr-state.mjs --pr <n> [--repo <owner/name>] [--repo-dir <path>]
//                          [--base-ref <remote-tracking ref>]
//
// `--base-ref` is what the drift is measured against, and the drift is measured HERE
// rather than read off `mergeStateStatus`: `BEHIND` arrives only where the base requires
// a current head, so where it does not, a head sitting far behind reads `CLEAN`.
//
// Exit 0 either way: `"read": true` with the state, or `"read": false` with a `reason`.
// Exit 2 only for a call this script cannot act on at all.

import { writeAll, refOk, repoOk, runner, text } from './lib/forge.mjs';

const USAGE = 'usage: node pr-state.mjs --pr <n> [--repo <owner/name>]'
  + ' [--repo-dir <path>] [--base-ref <ref>]\n';
const die = (m) => { writeAll(2, `pr-state: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { pr: null, repo: null, repoDir: null, baseRef: null };
const FLAGS = { '--pr': 'pr', '--repo': 'repo', '--repo-dir': 'repoDir', '--base-ref': 'baseRef' };
for (let i = 0; i < argv.length; i += 1) {
  const key = FLAGS[argv[i]];
  if (!key) die(`unknown argument '${argv[i]}'`);
  if (argv[i + 1] === undefined) die(`${argv[i]} needs a value`);
  opts[key] = argv[i += 1];
}
if (!opts.pr) die('--pr is required');
if (!/^[1-9][0-9]{0,9}$/.test(opts.pr)) die(`--pr '${opts.pr}' is not a request number`);
if (opts.repo && !repoOk(opts.repo)) die(`--repo '${opts.repo}' is not owner/name`);
if (opts.baseRef && !refOk(opts.baseRef)) die(`--base-ref '${opts.baseRef}' is not a ref`);

const cwd = opts.repoDir || process.cwd();
const git = runner(cwd, 'git');
const gh = runner(cwd);
const repoArgs = opts.repo ? ['--repo', opts.repo] : [];

// What the forge answers with, and what each answer means for a merge. `UNKNOWN` is the
// one that matters: the forge computes mergeability asynchronously and says so, and
// reading it as clear is reading "not yet" as "yes".
const CLEARS = new Set(['CLEAN', 'HAS_HOOKS', 'UNSTABLE']);

const answer = {
  read: false, pr: Number.parseInt(opts.pr, 10),
  // The forge's own fields, verbatim, so a caller can route on what it actually said.
  request: null,
  // `read: false` here is a listing that failed, which is not a request with no threads.
  threads: { read: false, total: null, unresolved: null, open: [], reason: null },
  // Measured, never read off an enum. `behind > 0` is a JUDGEMENT, not a blocker: re-sync
  // where what those paths carry can break this head, and merge without one where the
  // base moved elsewhere. Neither answer is free, and neither is this script's to make.
  drift: { measured: false, behind: null, paths: [], ref: opts.baseRef, reason: null },
  blockers: [],
  mayMerge: false,
  reason: null, notes: [],
};
const finish = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (reason) => { answer.reason = reason; finish(); };

// --- the request's own state
const FIELDS = ['state', 'isDraft', 'mergeable', 'mergeStateStatus', 'reviewDecision',
  'baseRefName', 'headRefName', 'headRefOid', 'url'];
const view = gh(['pr', 'view', opts.pr, '--json', FIELDS.join(','), ...repoArgs]);
if (!view.ok) refuse(`could not read pull request ${opts.pr} (${view.line()})`);
let pr;
try { pr = JSON.parse(view.out); } catch { refuse('the pull request view was not JSON'); }
if (!pr || typeof pr !== 'object' || Array.isArray(pr)) {
  refuse('the pull request view came back in a shape this cannot read');
}
answer.request = Object.fromEntries(FIELDS.map((f) => [f, pr[f] ?? null]));

// --- the review threads, which no `pr view` field carries
const owner = (opts.repo || (typeof pr.url === 'string' ? new URL(pr.url).pathname.slice(1) : ''))
  .split('/').slice(0, 2);
if (owner.length === 2 && owner.every(Boolean)) {
  const q = gh(['api', 'graphql', '-f', `query=
    query($owner:String!,$repo:String!,$pr:Int!){
      repository(owner:$owner,name:$repo){
        pullRequest(number:$pr){
          reviewThreads(first:100){
            nodes{ id isResolved isOutdated resolvedBy{ login }
                   comments(first:1){ nodes{ author{login __typename} path line } } }
          }
        }
      }
    }`, '-F', `owner=${owner[0]}`, '-F', `repo=${owner[1]}`, '-F', `pr=${opts.pr}`]);
  if (!q.ok) answer.threads.reason = q.line();
  else {
    let nodes = null;
    try {
      nodes = JSON.parse(q.out).data.repository.pullRequest.reviewThreads.nodes;
    } catch { nodes = null; }
    if (!Array.isArray(nodes)) answer.threads.reason = 'the thread listing was not a list';
    else {
      answer.threads.read = true;
      answer.threads.total = nodes.length;
      // `isResolved` alone cannot tell a thread you answered from one the reviewer closed
      // itself — `resolvedBy` is what says which, and it travels with the open ones too.
      const open = nodes.filter((t) => t && t.isResolved !== true);
      answer.threads.unresolved = open.length;
      answer.threads.open = open.map((t) => {
        const first = t.comments?.nodes?.[0] || {};
        return { id: text(t.id), isOutdated: t.isOutdated === true,
          resolvedBy: text(t.resolvedBy?.login), author: text(first.author?.login),
          authorType: text(first.author?.__typename),
          path: text(first.path), line: Number.isInteger(first.line) ? first.line : null };
      });
      // A hundred is the page this asks for, so a request with more has threads it did
      // not see — and an unread thread is not a resolved one.
      if (nodes.length >= 100) {
        answer.threads.read = false;
        answer.threads.reason = 'the first hundred threads is all this asked for, and the'
          + ' request has at least that many';
      }
    }
  }
} else answer.threads.reason = 'could not tell which repository this request is in';

// --- the drift, measured rather than read off an enum
if (opts.baseRef) {
  const have = git(['rev-parse', '--verify', '-q', `${opts.baseRef}^{commit}`]);
  if (!have.ok) answer.drift.reason = `${opts.baseRef} is not a commit this checkout carries`;
  else {
    // `HEAD..` is what this head has NOT absorbed, so a re-sync already moved the line
    // forward: this is the window since the last one, never since the branch was cut.
    const count = git(['rev-list', '--count', `HEAD..${opts.baseRef}`]);
    const n = count.ok ? Number.parseInt(count.out.trim(), 10) : NaN;
    if (!Number.isInteger(n)) answer.drift.reason = `could not count the drift (${count.line()})`;
    else {
      answer.drift.measured = true;
      answer.drift.behind = n;
      if (n > 0) {
        const paths = git(['diff', '--name-only', `HEAD..${opts.baseRef}`]);
        if (paths.ok) answer.drift.paths = paths.out.split('\n').filter(Boolean).map(text);
        else answer.drift.reason = `could not list what moved (${paths.line()})`;
      }
    }
  }
}

// --- the blockers, and then the one verdict, after every reading is in
const r = answer.request;
if (r.state !== 'OPEN') answer.blockers.push(`the request is ${r.state ?? 'in an unknown state'}, not open`);
// Measured: a draft with a rule on its base reports `BLOCKED` rather than `DRAFT`, so the
// enum is not where draftness is read.
if (r.isDraft === true) answer.blockers.push('it is a draft');
if (r.mergeable === 'CONFLICTING') answer.blockers.push('it conflicts with its base');
if (r.mergeable !== 'MERGEABLE' && r.mergeable !== 'CONFLICTING') {
  answer.blockers.push(`mergeability is ${r.mergeable ?? 'absent'}, which the forge computes`
    + ' asynchronously — not yet is not yes');
}
if (typeof r.mergeStateStatus === 'string' && !CLEARS.has(r.mergeStateStatus)) {
  answer.blockers.push(`the merge state is ${r.mergeStateStatus}`);
} else if (typeof r.mergeStateStatus !== 'string') {
  answer.blockers.push('the merge state did not come back');
}
if (r.reviewDecision === 'CHANGES_REQUESTED') answer.blockers.push('a reviewer asked for changes');
if (r.reviewDecision === 'REVIEW_REQUIRED') answer.blockers.push('the base asks for an approval it has not got');
if (!answer.threads.read) {
  answer.blockers.push(`the review threads could not be read (${answer.threads.reason ?? 'no detail'})`);
}

answer.mayMerge = answer.blockers.length === 0;
answer.read = true;
finish();
