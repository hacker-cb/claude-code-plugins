#!/usr/bin/env node
// copilot-state.mjs — what is Copilot's state on this pull request's CURRENT head?
// Prints JSON on stdout.
//
// This is deliberately ONE question, and it is a question about a commit rather than
// about a pull request: "does a Copilot review exist" is what silently drops findings.
// Right after a push the request looks finished — CI green, the previous review's
// threads resolved, the forge reporting it mergeable — while the review of the push
// just made has not posted. Each review carries the sha it reviewed in `commit_id`,
// and that is the only signal here that carries one.
//
// What this does NOT decide: how long to wait, when a head with no request of its own
// is finally ruled unrequested, and what to do when a wait runs out. Those are policy
// — a clock and an addressee — and they stay with the skill.
//
// Usage: node copilot-state.mjs --pr <n> [--repo <owner/name>] [--repo-dir <path>]
//
// Exit 0 either way: `"read": true` with the state, or `"read": false` with a
// `reason`. Exit 2 only for a call this script cannot act on at all.

import { dirOk, isCopilot, otherBot, parsePages, readable, refOk, repoOk, runner, text, writeAll } from './lib/forge.mjs';

const USAGE = 'usage: node copilot-state.mjs --pr <n> [--repo <owner/name>]'
  + ' [--repo-dir <path>]\n';
const die = (m) => { writeAll(2, `copilot-state: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { pr: null, repo: null, repoDir: null };
for (let i = 0; i < argv.length; i += 1) {
  const flag = argv[i];
  const value = argv[i + 1];
  if (!['--pr', '--repo', '--repo-dir'].includes(flag)) die(`unknown argument '${flag}'`);
  if (value === undefined) die(`${flag} needs a value`);
  opts[flag === '--repo-dir' ? 'repoDir' : flag.slice(2)] = value;
  i += 1;
}
if (!opts.pr) die('--pr is required');
if (!/^[1-9][0-9]{0,9}$/.test(opts.pr)) die(`--pr '${opts.pr}' is not a request number`);
if (opts.repo && !repoOk(opts.repo)) die(`--repo '${opts.repo}' is not owner/name`);

// A directory, proved here: passed on as `cwd` it would come back as a call that failed
// with nothing on stderr, which reads as a forge that would not answer.
if (opts.repoDir && !dirOk(opts.repoDir)) die(`--repo-dir '${opts.repoDir}' is not a directory`);
const gh = runner(opts.repoDir || process.cwd());

const answer = {
  // `read` is the only field a caller may act on without saying it did not look: every
  // feed this needs answered. Set last, after everything that can refuse has refused.
  read: false, repo: null, pr: Number(opts.pr), head: null, base: null, draft: null,
  // What the base's rules ask of Copilot — `rule: false` means no rule applies TO THIS
  // BASE, which is not "this repo has no such rule".
  // `more` answers the question the verdict cannot: is another Copilot review coming to
  // this request AT ALL. `unrequested` with `more: false` is not a head waiting out a
  // cutoff — nothing is on its way, and the caller acts rather than waits.
  expects: { rule: false, onPush: false, drafts: null, more: null },
  reviews: [], headReview: null,
  requests: 0, newestRequestAt: null, latestMove: 'none', latestMoveAt: null,
  verdict: 'unread', reason: null, notes: [],
};
const finish = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (reason) => { answer.reason = reason; finish(); };

// --- the request itself
const view = gh(['pr', 'view', opts.pr, '--json', 'url,headRefOid,baseRefName,isDraft',
  ...(opts.repo ? ['--repo', opts.repo] : [])]);
if (!view.ok) refuse(`could not read pull request ${opts.pr} (${view.line()})`);
let pr;
try { pr = JSON.parse(view.out); } catch { refuse('the pull request view was not JSON'); }
// Valid JSON is not an object: `null` parses, and reaching a field on it throws — which
// exits 1 with nothing on stdout, the one outcome this contract forbids.
if (!pr || typeof pr !== 'object' || Array.isArray(pr)) {
  refuse('the pull request view came back in a shape this cannot read');
}

// The request's OWN repository, taken from its url — never gh's default, which in a
// fork checkout is the parent, where every read below 404s into a silence that looks
// exactly like a pull request Copilot was never asked on. The host is stripped rather
// than matched: an Enterprise instance serves its own.
let repo = opts.repo;
if (!repo) {
  const m = String(pr.url || '').match(/^https?:\/\/[^/]+\/(.+?)\/pull\/\d+/);
  if (!m) refuse(`could not read the repository out of the pull request url '${pr.url}'`);
  repo = m[1];
}
if (!repoOk(repo)) refuse(`the pull request's url gave '${repo}', which is not owner/name`);
const head = pr.headRefOid || '';
const base = pr.baseRefName || '';
if (!readable(head)) refuse(`pull request ${opts.pr} reports no head commit`);
if (!refOk(base)) refuse(`pull request ${opts.pr} named '${base}' as its base branch`);
answer.repo = repo; answer.head = head; answer.base = base;
answer.draft = Boolean(pr.isDraft);

// --- what the base asks of Copilot
// The rules IN FORCE on the base, never the repo's ruleset listing: this endpoint has
// already applied each ruleset's `ref_name` conditions and includes rules inherited
// from an organization-level ruleset, and a plain listing does neither.
const inForce = [];
const rules = gh(['api', '--paginate', `repos/${repo}/rules/branches/${encodeURIComponent(base)}`]);
if (!rules.ok) {
  // Measured on the neighbouring endpoint and true here too: it answers `[]` with
  // status 200 for a branch with no rules, so a non-zero exit is the repository
  // failing to read rather than a base without the rule.
  refuse(`the rules on ${base} could not be read (${rules.line()})`);
}
{
  const pages = parsePages(rules.out);
  if (pages === null) refuse(`the rules on ${base} did not come back as JSON`);
  for (const page of pages) {
    if (!Array.isArray(page)) refuse(`the rules on ${base} came back in a shape this cannot read`);
    for (const rule of page) {
      if (!rule || rule.type !== 'copilot_code_review') continue;
      const p = (rule.parameters && typeof rule.parameters === 'object') ? rule.parameters : {};
      answer.expects.rule = true;
      // Kept per RULE, not merged field by field. Several matching rulesets is normal,
      // and the looser answer wins across them — but taking the loosest of each field
      // separately invents a rule nobody wrote: one ruleset reviewing pushes but not
      // drafts, beside one reviewing drafts but not pushes, would read as a rule that
      // reviews pushes on drafts, which neither of them does.
      inForce.push({
        onPush: p.review_on_push === true,
        drafts: typeof p.review_draft_pull_requests === 'boolean'
          ? p.review_draft_pull_requests : true,
      });
      if (p.review_on_push === true) answer.expects.onPush = true;
      if (typeof p.review_draft_pull_requests === 'boolean') {
        answer.expects.drafts = answer.expects.drafts === true
          ? true : p.review_draft_pull_requests;
      }
    }
  }
}


// --- every Copilot review that posted, whatever the rules say
// One requested by hand on a base without the rule counts: a posted review CONSUMES
// its request, so a request with no rule and nothing standing can still carry one.
const reviews = gh(['api', '--paginate', `repos/${repo}/pulls/${opts.pr}/reviews`]);
if (!reviews.ok) refuse(`the reviews could not be read (${reviews.line()})`);
// Bots this does not take for Copilot that reviewed the HEAD. Copilot answering under a
// login the filter no longer matches leaves exactly this behind — a head with no review of
// its own, reviewed all the same — and ruling that head unrequested is a merge past a review.
const strangers = new Set();
{
  const pages = parsePages(reviews.out);
  if (pages === null) refuse('the reviews did not come back as JSON');
  for (const page of pages) {
    if (!Array.isArray(page)) refuse('a page of reviews came back in a shape this cannot read');
    for (const r of page) {
      if (!r || !isCopilot(r.user)) {
        if (r && r.commit_id === head && otherBot(r.user) && text(r.user.login)) {
          strangers.add(text(r.user.login));
        }
        continue;
      }
      answer.reviews.push({
        id: r.id ?? null,
        commitId: typeof r.commit_id === 'string' ? r.commit_id : null,
        state: r.state ?? null,
        submittedAt: r.submitted_at ?? null,
      });
    }
  }
}
// Selected on the head rather than taken off the end: a later review of an EARLIER
// commit would otherwise stand where the head's own review should be.
const ofHead = answer.reviews.filter((r) => r.commitId === head);
answer.headReview = ofHead.length ? ofHead[ofHead.length - 1] : null;
// Only where Copilot has no review of the head: beside one it does have, another bot is
// another reviewer and not a question about this one.
if (!answer.headReview && strangers.size > 0) {
  answer.notes.push(`the head was reviewed by ${[...strangers].join(', ')}, which this does not`
    + ' take for Copilot — if Copilot now answers under that login, this head is reviewed and'
    + ' `verdict` is not the whole of it');
}

// --- what stands now, read from the timeline
// Never the request list: `requested_reviewers` and `reviewRequests` both read empty
// from the moment a Copilot request registers until its review posts, so a wait built
// on either never arms.
const timeline = gh(['api', '--paginate', `repos/${repo}/issues/${opts.pr}/timeline`]);
if (!timeline.ok) refuse(`the timeline could not be read (${timeline.line()})`);
{
  const pages = parsePages(timeline.out);
  if (pages === null) refuse('the timeline did not come back as JSON');
  const MOVES = new Set(['review_requested', 'review_request_removed', 'reviewed']);
  for (const page of pages) {
    if (!Array.isArray(page)) refuse('a page of the timeline came back in a shape this cannot read');
    for (const e of page) {
      if (!e || !MOVES.has(e.event)) continue;
      // The actor sits under a different key per event kind. `copilot_work_started` is
      // deliberately not among the moves: a run beginning is neither the request nor
      // what settles it.
      if (!isCopilot(e.requested_reviewer) && !isCopilot(e.user)) continue;
      answer.latestMove = e.event;
      // The cutoff is counted from the push, or from the moment an earlier head's
      // request RELEASED — which is this timestamp when the latest move is a review or a
      // removal. Without it a caller cannot tell when its couple of minutes began.
      answer.latestMoveAt = e.created_at ?? e.submitted_at ?? answer.latestMoveAt;
      if (e.event === 'review_requested') {
        answer.requests += 1;
        answer.newestRequestAt = e.created_at ?? answer.newestRequestAt;
      }
    }
  }
}

// --- is another review coming at all
// A rule can place a request for THIS state of the request: it applies to a draft only
// if it reviews drafts, and it places one after a push only if it reviews pushes — both
// read from the SAME rule, never from the loosest of each across rulesets.
const canAct = inForce.filter((r) => !answer.draft || r.drafts);
if (answer.latestMove === 'review_requested') {
  answer.expects.more = true;                       // one is on its way
} else if (canAct.length === 0) {
  // No rule applies to the request as it stands. A draft the rules all skip is the
  // usual way here, and the caller opens it ready rather than waiting.
  answer.expects.more = false;
} else if (!answer.headReview) {
  // A rule applies and the head carries no review of its own. Whether the request is
  // still to come is not something this can settle — a review already on the request
  // may have been asked for by hand, and consuming the rule's request is not the same
  // as having been placed by it. It answers TRUE and lets the caller's cutoff decide:
  // waiting out a couple of minutes for nothing costs a couple of minutes, and going
  // on without a review that was coming costs its findings.
  answer.expects.more = true;
} else {
  // The head has its own review and nothing stands. Another comes only from a push,
  // and only where a rule that applies here reviews them.
  answer.expects.more = canAct.some((r) => r.onPush);
}
if (answer.draft && canAct.length === 0 && answer.latestMove !== 'review_requested') {
  answer.notes.push('this request is a draft and no rule in force reviews drafts —'
    + ' nothing is coming until it is opened ready for review');
}

// --- the verdict, computed once here rather than reassembled at every call site
// A STANDING request outranks a review of the head, and that order is the whole point:
// the timeline is read oldest-first, so a `review_requested` that is still the latest
// move came AFTER the review beside it — somebody re-requested Copilot on a head it had
// already reviewed, and a round is outstanding. Taking `reviewed` there merges before
// its findings arrive, which is this file's own failure mode one level up.
if (answer.latestMove === 'review_requested') answer.verdict = 'waiting';
else if (answer.headReview) answer.verdict = 'reviewed';
else if (answer.expects.rule || answer.reviews.length || answer.latestMove !== 'none') {
  // A head with no review of its own and no request standing. Whether that is final
  // is the skill's cutoff to judge — this says only that nothing is outstanding here.
  answer.verdict = 'unrequested';
} else {
  // No rule on this base, no request ever, no review ever: Copilot is not part of
  // this request's flow.
  answer.verdict = 'not-expected';
}

answer.read = true;
finish();
