#!/usr/bin/env node
// commit-checks.mjs — what the two check feeds say about ONE commit. Prints JSON on stdout.
//
// This is deliberately ONE question. "Is this pull request mergeable" is a different one:
// it answers from the request's own rollup, which is not the set on the commit, and
// conflating them is how a merge is declared green over checks nobody read.
//
// There are two feeds and they are not the same feed. `check-runs` carries what the
// Checks API knows; `status` carries the older commit statuses, which an external CI may
// post to and nothing else. A reader of one is blind to the other however red it is.
//
// Usage: node commit-checks.mjs (--pr <n> | --repo <owner/name>) --sha head|base|merge|<oid>
//                               [--require <name>]... [--require-from-gates] [--repo-dir <path>]
//
// `complete` is `null` until `--require-from-gates` actually asks a gate source, `true`
// when every source answered, and `false` when one did not — so a green verdict beside
// `false` is green as far as this run knew to look. "Not asked" is not "asked and
// whole", the same distinction `gates: null` keeps one field over.
//
// Exit 0 either way: `"read": true` with what the feeds held, or `"read": false` with a
// `reason`. A read that did not happen is not a commit with nothing on it — unread is not
// empty, and a caller that cannot tell them apart reports a base as quiet because the
// call 404'd. Exit 2 only for a call this script cannot act on at all.

import { writeAll, parsePages, readable, refOk, repoOk, runner } from './lib/forge.mjs';

const USAGE = 'usage: node commit-checks.mjs (--pr <n> | --repo <owner/name>)'
  + ' --sha head|base|merge|<oid> [--require <name>]... [--require-from-gates]'
  + ' [--repo-dir <path>]\n';
const die = (m) => { writeAll(2, `commit-checks: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { pr: null, repo: null, sha: null, repoDir: null, require: [], fromGates: false };
for (let i = 0; i < argv.length; i += 1) {
  const flag = argv[i];
  const value = argv[i + 1];
  if (flag === '--require-from-gates') { opts.fromGates = true; continue; }
  if (!['--pr', '--repo', '--sha', '--repo-dir', '--require'].includes(flag)) {
    die(`unknown argument '${flag}'`);
  }
  if (value === undefined) die(`${flag} needs a value`);
  if (flag === '--require') opts.require.push(value);
  else if (flag === '--repo-dir') opts.repoDir = value;
  else opts[flag.slice(2)] = value;
  i += 1;
}
if (!opts.sha) die('--sha is required: head, base, merge, or a commit id');
// The one argument that reaches `gh` before anything else, and it had no guard at all:
// `--pr --repo=other/repo` arrives as a flag, and `--pr https://host/other/repo/pull/1`
// is accepted by the CLI and reads somebody else's request — under a caller that
// believes it passed a number, and whose `.repo` then names a repository it never asked
// about.
if (opts.pr !== null && !/^[1-9][0-9]{0,9}$/.test(opts.pr)) die(`--pr '${opts.pr}' is not a request number`);
// An empty `--require` matches no name there is, so `present` stays false forever and a
// caller polling on it spends its whole budget on a placeholder nobody substituted.
if (opts.require.some((n) => n.trim() === '')) die('--require needs a check name, not an empty string');
if (!opts.pr && !opts.repo) die('one of --pr or --repo is required');
// `--sha head` and `--sha merge` are the pull request's, so they need one named.
const SYMBOLIC = ['head', 'merge', 'base'];
// The gates belong to a branch, and only a request names one.
if (!opts.pr && opts.fromGates) die('--require-from-gates needs --pr: the gates belong to the base branch');
if (!opts.pr && SYMBOLIC.includes(opts.sha)) {
  die(`--sha ${opts.sha} names a pull request's commit — pass --pr, or an explicit id`);
}
// Shape-checked HERE, before any call goes out: a bad value caught after `gh pr view`
// has already run has cost a round trip to learn what the argument said all along.
//
// A BRANCH name is many segments, not one: `release/1.0` and `feature/foo` are ordinary
// names, and the single-segment rule refuses them — which would have turned the gate
// read into a refusal on every repository that targets one, taking the whole step with
// it. Each segment is held to the same rule instead, so nothing steers the url and every
// real branch name still reaches it.
// Shape-checked HERE, before any call goes out: a bad value caught after `gh pr view`
// has already run has cost a round trip to learn what the argument said all along.
// `<sha>^` is refused as an argument rather than 404ing as a failed read: the two mean
// different things to a caller — one is an argument to fix, the other a forge to retry.
// A caller wanting a parent resolves it itself and passes the oid. `--sha base` is a
// different thing and not a substitute: it is the BASE BRANCH's tip.
if (!SYMBOLIC.includes(opts.sha) && !readable(opts.sha)) {
  die(`--sha '${opts.sha}' is not a commit id or a ref this can read`);
}
if (opts.repo && !repoOk(opts.repo)) die(`--repo '${opts.repo}' is not owner/name`);

const gh = runner(opts.repoDir || process.cwd());

const answer = {
  // `read` is the only field a caller may act on without saying it did not look: BOTH
  // feeds answered. It is set last, after everything that can refuse has refused.
  read: false, repo: null, sha: null, gates: null, gatesUnknown: [],
  runs: [], statuses: [], rollup: null, rollupSpeaks: false,
  counts: { runs: 0, statuses: 0, unfinished: 0, failing: 0 },
  // One field to route on. Reassembling it from four numbers at every call site is how a
  // combination gets missed — a server rollup of `failure` beside rows that all passed,
  // for one, which the counts alone report as green.
  // Precedence: unread > retry > failing > running > empty > green.
  verdict: 'unread',
  // `null` until a gate source is actually asked — "not asked" is not "asked and whole",
  // the same distinction `gates: null` keeps one field over.
  complete: null,
  // A refusal splits two ways a caller must not conflate: `retry` says the answer is
  // simply not published yet and the same call will work shortly, while a refusal
  // without it says the read failed. Routing on the reason's prose would make a caller
  // parse English to tell a queue from an outage.
  retry: false,
  empty: false, unfinished: [], failing: [], required: [],
  reason: null, notes: [],
};
const finish = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (reason, retry = false) => {
  answer.reason = reason; answer.retry = retry;
  answer.verdict = retry ? 'retry' : 'unread';
  finish();
};


let repo = opts.repo;
let sha = opts.sha;
let baseRef = null;

if (opts.pr) {
  const view = gh(['pr', 'view', opts.pr, '--json', 'url,headRefOid,baseRefOid,baseRefName,mergeCommit',
    ...(opts.repo ? ['--repo', opts.repo] : [])]);
  if (!view.ok) refuse(`could not read pull request ${opts.pr} (${view.err.split('\n')[0] || 'no detail'})`);
  let pr;
  try { pr = JSON.parse(view.out); } catch { refuse('the pull request view was not JSON'); }
  // Valid JSON is not an object: `null` parses, and reaching a field on it throws — exit
  // 1 with nothing on stdout, which is the one outcome this contract forbids.
  if (!pr || typeof pr !== 'object' || Array.isArray(pr)) {
    refuse('the pull request view came back in a shape this cannot read');
  }
  // The request's OWN repository, taken from its url — never gh's default, which in a
  // fork checkout is the parent, where this commit does not exist and every read below
  // 404s into a silence that looks exactly like a commit with nothing on it. The host is
  // stripped rather than matched: an Enterprise instance serves its own.
  if (!repo) {
    const m = String(pr.url || '').match(/^https?:\/\/[^/]+\/(.+?)\/pull\/\d+/);
    if (!m) refuse(`could not read the repository out of the pull request url '${pr.url}'`);
    repo = m[1];
  }
  if (sha === 'head') sha = pr.headRefOid || '';
  // `base` is a commit ON the base branch, which is what answers "does this base run
  // anything on a push" — and it is the only form that answers it under every merge
  // strategy. A merge commit's first parent is the base tip only when the merge was a
  // true merge: rebased, `mergeCommit` names the last rebased commit and its parent
  // belongs to this same request, so a feed read there says nothing about the base.
  else if (sha === 'base') sha = pr.baseRefOid || '';
  else if (sha === 'merge') sha = (pr.mergeCommit && pr.mergeCommit.oid) || '';
  baseRef = pr.baseRefName || '';
  // Empty until the merge commit is published — a queue, a replica behind. Refusing is
  // the whole point: an empty id builds a url that 404s, and a 404 prints no rows, which
  // a caller reads as a base with nothing to run.
  if (!sha) {
    refuse(opts.sha === 'merge'
      ? `pull request ${opts.pr} carries no merge commit yet — re-poll rather than reading an empty id`
      : `pull request ${opts.pr} reports no ${opts.sha} commit`, opts.sha === 'merge');
  }
}

// What the request answered with is checked too — it is data from a forge, not argv, so
// it refuses rather than dying: a caller gating on `read` is told the question could not
// be answered, which is what every other refusal here says.
if (!readable(sha)) refuse(`the pull request named '${sha}' as its ${opts.sha} commit, which is not a ref this can read`);
if (!repoOk(repo)) refuse(`the pull request's url gave '${repo}', which is not owner/name`);
answer.repo = repo;

// `--require-from-gates` exists so that a check's NAME never has to travel through a
// shell. A workflow may be called `Team's CI`, or anything with a `$` or a backtick in
// it, and a caller composing that into a command line has to quote it exactly right
// every time — which three separate fixes to one line of a calling skill failed to do,
// each moving the injection point rather than closing it. Read here, the name goes from
// one forge response into another as data and is never text anyone escapes.
//
// The base's gates are also the right authority for WHICH check gates a merge: a name
// typed by a caller is that caller's belief about the ruleset.
if (opts.fromGates) {
  if (!refOk(baseRef)) refuse(`the pull request named '${baseRef}' as its base branch, which is not a ref this can read`);
  // ONE path parameter, encoded. A branch name may carry slashes, and in
  // `branches/<branch>/protection/...` the name sits in the middle of the path — so a
  // literal slash makes the router read a different branch, or none, and the 404 that
  // follows is indistinguishable from a branch that simply is not protected.
  const branch = encodeURIComponent(baseRef);
  const fromGates = [];

  // SOURCE ONE — rulesets.
  const r = gh(['api', '--paginate', `repos/${repo}/rules/branches/${branch}`]);
  if (r.ok) {
    const pages = parsePages(r.out);
    if (pages === null) answer.gatesUnknown.push(`the ruleset on ${baseRef} did not come back as JSON`);
    else {
      let unreadable = false;
      for (const page of pages) {
        // A page that is not a list of rules is a response this cannot read, not a base
        // with no rules — an error body from a proxy is valid JSON too. Recorded once
        // for the source, not once per page: a paginated answer would otherwise repeat
        // the same sentence as many times as it had pages.
        if (!Array.isArray(page)) { unreadable = true; continue; }
        for (const rule of page) {
          if (!rule || rule.type !== 'required_status_checks') continue;
          const checks = rule.parameters && rule.parameters.required_status_checks;
          // Guarded like every other list here. Unguarded, a `for…of` over an object
          // throws, and an uncaught throw leaves stdout EMPTY — no verdict, no reason,
          // which this file's whole contract is written against.
          if (!Array.isArray(checks)) { unreadable = true; continue; }
          for (const c of checks) {
            if (c && typeof c.context === 'string' && c.context.trim()) fromGates.push(c.context);
          }
        }
      }
      if (unreadable) answer.gatesUnknown.push(`the ruleset on ${baseRef} came back in a shape this cannot read`);
    }
  } else {
    // No exception for a 404 here, and that is measured: this endpoint answers `[]` with
    // status 200 both for a branch carrying no rules AND for a branch that does not
    // exist. So a 404 is never "no ruleset" — it is the repository failing to read, and
    // treating it as an absence is how an unread source becomes a confirmed empty one.
    answer.gatesUnknown.push(`the ruleset on ${baseRef} (${r.err.split('\n').filter(Boolean).pop() || 'no detail'})`);
  }

  // SOURCE TWO — classic branch protection, a different mechanism with its own endpoint
  // ([merge-gates.md]). A repository on it has an empty ruleset, so a list built from
  // source one alone comes back short and a merge commit reads green before a required
  // check has registered.
  const prot = gh(['api', `repos/${repo}/branches/${branch}/protection/required_status_checks`]);
  if (prot.ok) {
    let p;
    let parsed = true;
    try { p = JSON.parse(prot.out); } catch { parsed = false; }
    // Kept apart, because a caller chooses differently between them: a body that is not
    // JSON is a transport that went wrong and may work on a retry, while a body that
    // parses into the wrong shape will parse the same way every time.
    if (!parsed) {
      answer.gatesUnknown.push(`classic protection on ${baseRef} did not come back as JSON`);
    } else {
      const obj = p && typeof p === 'object' && !Array.isArray(p) ? p : null;
      const hasContexts = obj !== null && 'contexts' in obj;
      const hasChecks = obj !== null && 'checks' in obj;
      // A field that is PRESENT must be an array. Requiring both to be unreadable let
      // `{"contexts": [], "checks": {…}}` through as zero names — and `contexts` is the
      // deprecated half, so the readable-but-empty one is exactly what stays behind.
      const ok = obj !== null && (hasContexts || hasChecks)
        && (!hasContexts || Array.isArray(obj.contexts))
        && (!hasChecks || Array.isArray(obj.checks));
      if (!ok) {
        answer.gatesUnknown.push(`classic protection on ${baseRef} came back in a shape this cannot read`);
      } else {
        for (const c of obj.contexts || []) if (typeof c === 'string' && c.trim()) fromGates.push(c);
        for (const c of obj.checks || []) {
          if (c && typeof c.context === 'string' && c.context.trim()) fromGates.push(c.context);
        }
      }
    }
  } else if (/branch not protected|not enabled/i.test(prot.err)) {
    // Measured, and the wording is the whole distinction: "Branch not protected" is this
    // endpoint saying the answer is none. A BARE "Not Found" is not — GitHub hides a
    // resource the credentials may not see behind exactly that, so reading it as absence
    // is how an unread source becomes a complete-looking green.
  } else if (/branch not found/i.test(prot.err)) {
    answer.gatesUnknown.push(`${baseRef} is not a branch on ${repo} — its gates were never read`);
  } else {
    answer.gatesUnknown.push(`classic protection on ${baseRef} (${prot.err.split('\n').filter(Boolean).pop() || 'no detail'})`);
  }

  // What the GATES name, and nothing else. `opts.require` also holds whatever the caller
  // typed, and reporting those as the base's requirements passes one person's belief off
  // as the ruleset — while hiding the one signal that says the base requires nothing.
  answer.gates = [...new Set(fromGates)];
  opts.require = [...new Set([...opts.require, ...fromGates])];
  // Settled here, beside the reads it speaks for. It is the one field that would
  // otherwise carry an optimistic default out through a later refusal.
  answer.complete = answer.gatesUnknown.length === 0;
  if (answer.gates.length === 0 && answer.complete) {
    answer.notes.push(`${baseRef} requires no status check — neither a ruleset nor classic`
      + ' protection names one');
  }
  if (!answer.complete) {
    answer.notes.push(`the gate list is incomplete: ${answer.gatesUnknown.join('; ')}`);
  }
}
answer.sha = sha;

// Both feeds paginate. Both are captured with their exit status rather than piped
// onward: a call that failed prints no rows, exactly as a commit with nothing on it
// does, and the two take different steps.
const feed = (path) => {
  const r = gh(['api', '--paginate', `repos/${repo}/commits/${sha}/${path}`]);
  if (!r.ok) return { ok: false, err: r.err.split('\n').filter(Boolean).pop() || 'no detail' };
  const pages = parsePages(r.out);
  if (pages === null) return { ok: false, err: `could not parse the ${path} response` };
  return { ok: true, pages };
};

const runsFeed = feed('check-runs');
if (!runsFeed.ok) refuse(`the check-runs feed could not be read (${runsFeed.err})`);
const statusFeed = feed('status');
if (!statusFeed.ok) refuse(`the status feed could not be read (${statusFeed.err})`);

// Keyed by id, not by name: a name is not unique on a commit — one measured merge commit
// carried `audit-full` three times from three matrix legs — so a caller collapsing by
// name reads three runs as one and calls the set finished while two are still going.
const runsById = new Map();
let unkeyed = 0;
for (const page of runsFeed.pages) {
  for (const [i, run] of ((page && page.check_runs) || []).entries()) {
    if (!run) continue;
    // A row with no `id` is kept under a key of its own rather than dropped. Dropping it
    // is how an unfinished run disappears from `unfinished` and a commit reads green —
    // silently losing data is the same failure as reading none, and this file refuses
    // that everywhere else.
    if (run.id === undefined) { unkeyed += 1; runsById.set(`#${runsById.size}:${run.name ?? i}`, run); }
    else runsById.set(String(run.id), run);
  }
}
if (unkeyed) {
  answer.notes.push(`${unkeyed} check-run(s) came back without an id and are counted by`
    + ' name — two rows of one name cannot be told apart among them');
}
answer.runs = [...runsById.values()].map((r) => ({
  id: String(r.id), name: r.name ?? null,
  status: r.status ?? null, conclusion: r.conclusion ?? null,
}));

const statuses = [];
let rollup = null;
for (const page of statusFeed.pages) {
  if (!page) continue;
  // The rollup line repeats once per page, identically — it is a property of the commit,
  // not of the page. Taking the last is taking the same value the first page carried.
  if (page.state !== undefined) rollup = page.state;
  for (const s of page.statuses || []) statuses.push({ context: s.context ?? null, state: s.state ?? null });
}
answer.statuses = statuses;
answer.rollup = rollup;
// A rollup says something only beside a non-empty list. Measured on seven commits across
// four repositories, every one of them with completed check-runs: this feed answers
// `pending` over zero statuses — its empty answer wearing the shape of a run in flight.
// A caller polling on `.state` alone waits for a list that will never arrive.
answer.rollupSpeaks = statuses.length > 0;
if (rollup && !answer.rollupSpeaks) {
  answer.notes.push(`the status feed is empty and its rollup reads '${rollup}' —`
    + ' that is this feed having nothing, not a run in flight');
}

// A run is unfinished until `status` says completed. `conclusion` is null while it runs,
// and null is not a pass.
for (const r of answer.runs) {
  if (r.status !== 'completed') { answer.unfinished.push(r.name); continue; }
  if (!['success', 'neutral', 'skipped'].includes(String(r.conclusion))) answer.failing.push(r.name);
}
for (const s of answer.statuses) {
  if (s.state === 'pending') answer.unfinished.push(s.context);
  else if (s.state !== 'success') answer.failing.push(s.context);
}

answer.counts = {
  runs: answer.runs.length, statuses: answer.statuses.length,
  unfinished: answer.unfinished.length, failing: answer.failing.length,
  // Counted, not just listed: a list that silently came back empty and one that was
  // never asked for read the same in a name-by-name assertion.
  gates: answer.gates === null ? null : answer.gates.length,
};

// Empty is both feeds carrying nothing, and it is never a verdict. A run registers after
// the push that triggers it, so an empty pair right after a merge is the answer arriving
// rather than the answer. What tells that apart from a commit nothing runs on is the
// same read on the commit before it — which is this script called again, not a branch
// inside it.
answer.empty = answer.runs.length === 0 && answer.statuses.length === 0;
if (answer.empty) {
  answer.notes.push('both feeds are empty — nothing has registered yet, or nothing runs'
    + ' here; read the commit before this one to tell which');
}

// Waiting by name, never for the count to settle. Measured: the aggregate check is born
// LAST — it started three seconds after the last of the other nineteen completed — so at
// the instant "every check has finished" became true, the one that gates the merge did
// not yet exist.
for (const name of opts.require) {
  const matching = answer.runs.filter((r) => r.name === name)
    .concat(answer.statuses.filter((s) => s.context === name)
      .map((s) => ({ name: s.context, status: s.state === 'pending' ? 'in_progress' : 'completed', conclusion: s.state })));
  // Always a list, however many rows carry the name — one repository running the
  // aggregate once and the next running it as a matrix must answer the same shape, or a
  // filter tuned on the first quietly matches nothing on the second. That is the very
  // case that made this script key by `id`.
  answer.required.push({
    name,
    present: matching.length > 0,
    finished: matching.length > 0 && matching.every((r) => r.status === 'completed'),
    passed: matching.length > 0
      && matching.every((r) => ['success', 'neutral', 'skipped'].includes(String(r.conclusion))),
    conclusions: matching.map((r) => r.conclusion),
  });
}

// The server's own rollup over the statuses it holds is a VERDICT, not a row — it can
// read `failure` while every row this call captured passed, because the feed moved
// between pages. Reporting green over a failure that was read is the failure this whole
// script exists to prevent, so the verdict outranks the rows.
const rollupRed = answer.rollupSpeaks && !['success', 'pending'].includes(String(answer.rollup));
const requiredWaiting = answer.required.some((r) => !r.present || !r.finished);
if (answer.counts.failing > 0 || rollupRed) answer.verdict = 'failing';
else if (answer.counts.unfinished > 0 || requiredWaiting) answer.verdict = 'running';
else if (answer.empty) answer.verdict = 'empty';
else answer.verdict = 'green';
if (rollupRed && answer.counts.failing === 0) {
  answer.notes.push(`every row read passed, but the feed's own rollup says '${answer.rollup}'`
    + ' — the rollup is over what the server holds, not over what this call captured');
}

// Set last, and only here. Every refusal above returns with it false, so a caller gating
// on it can never be handed an empty list that no call actually produced.
answer.read = true;
finish();
