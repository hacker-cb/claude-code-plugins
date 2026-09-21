# The merge gates of a GitHub repository

Read by `hcb-dev:github-pr-workflow` before its fix loop, which routes on the
values below. It sits outside the skill because none of it is read on a run whose
gates go green.

Resolve anything here that this file does not spell out per
[`../../../references/forge-docs.md`](../../../references/forge-docs.md).

## Read the rules behind the signals

The skill's two live signals give the verdict; these give the why:

```bash
# The per-branch view, NOT a plain /rulesets listing: it has
# already applied each ruleset's ref_name conditions and includes org-level rulesets.
gh api repos/{owner}/{repo}/rules/branches/<base>              # rules in force on the base
gh api --paginate repos/{owner}/{repo}/rulesets --jq '.[].id' \
  | xargs -I% gh api repos/{owner}/{repo}/rulesets/%           # -I%, not -I{}: gh's own placeholders are braces too
gh api repos/{owner}/{repo}/branches/<base>/protection 2>/dev/null || true  # classic (NOT in /rulesets)
```

`mergeStateStatus` names exactly what's missing (the GraphQL enum is `BEHIND`,
`BLOCKED`, `UNSTABLE`, `DIRTY`, `UNKNOWN`, `HAS_HOOKS`, `CLEAN` — there is no
`DRAFT` value; a draft PR reads `BLOCKED`, and you detect draftness via the
separate `--json isDraft`):

| status | meaning | what to do |
|---|---|---|
| `BEHIND` | branch not up to date with base — reported **only** where the base requires it | a gate: re-sync (Step 2). Where the base does not require it, a head far behind reads `CLEAN` instead and this row never fires; the drift is Step 4's to measure and judge |
| `BLOCKED` | a required check, review, or thread resolution is missing (a draft also reads `BLOCKED`) | keep looping (Step 4); if it's a draft, mark ready (Step 3) |
| `UNSTABLE` | a non-required check is red — GitHub *will* let you merge | don't merge until you confirm it's irrelevant or a known flake (see below) |
| `DIRTY` | merge conflicts | resolve conflicts |
| `UNKNOWN` | GitHub is still recomputing mergeability (transient — e.g. right after a push) | wait and re-poll |
| `HAS_HOOKS` | mergeable and checks pass, but the repo has pre-receive hooks that run *at merge time* and can still reject the merge | proceed as for `CLEAN`, but don't treat the merge as guaranteed — a hook may reject it, so confirm it actually landed (Step 6) |
| `CLEAN` | GitHub's own gates are satisfied | merge-*permitted* by GitHub — still meet your own bar (Step 4) before Step 5 |

### Read the rules, not a checklist of names

Rulesets express gates as **typed rules**; classic protection expresses the same
ideas under its own keys. Map whichever rules you find onto work — and presume
none of them are present until you've read them:

| ruleset rule | parameters that matter | what it means for you |
|---|---|---|
| `required_status_checks` | `required_status_checks[].context`, `strict_required_status_checks_policy` | every listed context must go green. Treat the names as **opaque** — the repo chooses them, and what any one check stands for is its own business. `strict` additionally means the branch must be current with base (Step 2) — read it from the per-branch view above, never from a repo-wide assumption, since one repo's bases differ. That view returns no classic protection, so an empty answer is not yet `false`: read `branches/<base>/protection` for `required_status_checks.strict` before ruling the requirement absent. Where it genuinely is off, no pre-merge signal reads two heads combined — and `BEHIND` is not reported at all — so Step 4 measures the drift itself and Step 6 watches the base. |
| `pull_request` | `required_review_thread_resolution`, `allowed_merge_methods`, `required_approving_review_count`, `dismiss_stale_reviews_on_push`, `require_code_owner_review`, `require_last_push_approval` | thread resolution `true` means *every* thread must end resolved, not just the severe ones. Merge methods: pick from the allowed set only (Step 5). Approvals are often 0; if >0, `reviewDecision` answers for the aggregate rather than for any one reviewer, and only while it carries a value: read `REVIEW_REQUIRED` as approvals still missing and `CHANGES_REQUESTED` as a rejection standing whatever the approval count says, and read neither into an empty field — and where the repo counts Copilot's approval, one of the approvals can be Copilot's ([`copilot.md`](copilot.md)). The count is not the whole gate: `require_code_owner_review` wants one of them from a code owner, and `require_last_push_approval` one that postdates the last reviewable push *and* comes from someone other than whoever pushed it — so a satisfied number still reads `REVIEW_REQUIRED` while either is outstanding, and the pusher's own approval never closes the second. **An empty `reviewDecision` proves nothing in either direction** — it reads empty with an unmet approval requirement in force, `BLOCKED` beside it, as readily as with none — so route on `mergeStateStatus` and on the rules you read here, never on that emptiness. |
| `copilot_code_review` | `review_on_push`, `review_draft_pull_requests` | Copilot reviews this base's PRs on its own. These parameters decide which of its reviews the driver waits for — the one at opening, or one after every push as well; whether its review can approve is a setting no rule here carries — `copilot.md` owns both. |
| `deletion`, `non_fast_forward` | — | the matched branches can't be deleted or force-pushed. Affects Step 1's rename and Step 6's retirement when they touch a protected ref. |

Anything the rules don't cover, the live signals still do: `gh pr checks` is the
final word on which contexts are required, whatever produced them.

### When there are no gates, or they can't be trusted

A repo with no *enforced* gates reports `CLEAN` the instant the PR opens — that
means "GitHub won't stop you," not "the work is ready."

The bypass the skill forbids merging on is `current_user_can_bypass` other than
`never`, or your presence in a rule's `bypass_actors` — satisfy the gates as if
you could not. An `evaluate` or `disabled` ruleset is advisory in the same way: it
appears in the API and blocks nothing.

**Confirm gates are absent; don't infer it from an empty rulesets list.** A repo
can enforce required checks, reviews and thread-resolution through **classic branch
protection**, which `/rulesets` does not return. Treat them as truly absent only
when the live signals agree: `gh pr checks` shows no required checks, and neither
`rules/branches/<base>` nor `branches/<base>/protection` enforces anything. An
empty `reviewDecision` is not one of those signals — the `pull_request` row above
says why.

Then supply the gates yourself — the Step 4 loop's bar becomes the authoritative
one — and be *more* conservative, not less: keep the explicit-go-ahead gate, avoid
irreversible force-pushes, and tell the user their judgment is the only safety net
here.

## What `commit-checks.mjs` answers, and what each verdict asks

`github-pr-workflow` Step 4 reads one commit with it and Step 6 reads two. Both route on
`.verdict`, which is the field this answer is designed to be read by: the rollup a server
computes can say `failure` over rows that all passed, so a caller assembling a verdict out
of the counts reports green on a red base.

| `.verdict` | the step |
|---|---|
| `retry` | the answer is not published yet — re-poll the same call; a merge commit appears late behind a queue or a replica |
| `unread` | the feeds were not read: unread, never unchecked — take the platform path and claim nothing about this base |
| `running` | poll, on Step 4's budget and its escalation |
| `failing` | attribute, then report |
| `empty` | nothing registered yet where the base's own tip has rows; where that is `empty` too, this base runs nothing on a push — say it is unchecked and that the step guaranteed nothing |
| `green` | green, as of this read — and **only as far as `.complete` says it looked**: `false` there means a gate source did not answer, and `null` that none was ever asked, so a required check may exist that the run never knew to wait for. Report the weaker guarantee, naming what `.gatesUnknown` holds |

**`--require-from-gates` is why no check name is ever written into a call.** The names
come out of the base's own gates and travel between forge responses as data, never
through a command line, where a workflow called `Team's CI` has to be quoted exactly
right every time. `.gates` is what the base requires, and `null` there is a question
never asked rather than an empty list.

**Read the base's own tip before believing what the merge commit lacks.** An unread
answer carries empty `runs` and `statuses` too, so "the base does not run this" and
"nothing was read" look identical in the rows — only an answer whose `verdict` says it
was read may say the base runs nothing on a push.

**Wait by name, never for the count to settle**, which is what `--require-from-gates`
does: the aggregate registers after the checks it aggregates, so the moment every check
has finished is a moment it does not exist. One name it brings needs judgement — a gate
belonging to a `pull_request`-only workflow never appears on a merge commit, so the merge
commit stays `running` on it while every push check is green. The base's own tip settles
that: a required name absent there is absent from the base's pushes, and waiting for it
spends the budget for nothing. Report the weaker guarantee rather than waiting it out.

A budget that runs out mid-poll is not waited out: report the state the feeds stood at,
empty included. **What a report claims is what these reads saw**, never that the base is
quiet — a check that registers after them, and one that runs for the pull request and not
for the push that landed it, are both outside what they can see.

Captured in variables, never redirected to a file: these run inside the user's checkout,
where a stray `merged.json` is an untracked file the report, `git-cleanup` and branch
retirement all read as work in progress. **A non-zero exit is the invocation being
wrong**, never a state to retry.

## The two exit items a round cannot close

**Drift, where the base does not require the branch current.** That enum never arrives, so
a head sitting well behind its base reads `CLEAN` and the drift is measured rather than read
off a status. `drift.behind` above zero is a judgement, not a gate: re-sync when what
`drift.paths` carries can break this head — the code in flight or its environment, read as
[`../../../references/base-delta.md`](../../../references/base-delta.md) reads them — and merge
without one when the base moved elsewhere.
Neither answer is free: a re-sync is a push, which restarts the checks — and the review, where
a rule reviews pushes — and is no fix, earning no request of the driver's own; a skipped one
that was needed puts the break in the base, where only the post-merge read finds it.

**The approval.** Every other exit item answers to a push; this one answers to a reviewer,
and all a round can do is remove reasons to withhold it. Read the **requirement** — the
`pull_request` row above — before spending an iteration against it, never one reviewer's
verdict. Where it is outstanding and the head's review has settled without closing it, which
of the two kinds of review that is ([`copilot.md`](copilot.md), *What the review lands as*)
decides: findings still outstanding are the loop's work where a rule in force reviews pushes
or a request stands, since the next review can close the requirement. Where neither holds no
next review comes — that, and a reviewer handing the decision to a human, are stops, carrying
the reason the review gave and what would answer it, and neither is a reason to place a request.

**An approval standing on the head says nothing about what was pushed under it.** Where the base
does not dismiss stale reviews on push, one given to an earlier head survives every push after
it; what reads those pushes is [`copilot-findings.md`](copilot-findings.md)'s *What reads the
fix*, never the approval.
