# Collaborating with Copilot review

How to find, classify, fix, and respond to GitHub Copilot's PR review findings.

## The state is read by a script, not by hand

`scripts/copilot-state.mjs` answers one question — **what is Copilot's state on this
pull request's current head** — and the skill invokes it (skill content is where the
plugin root is substituted; here the placeholder would stay literal text). It reads
the rules in force on the base, every Copilot review that posted, and the request's
own timeline, and returns:

| field | what it settles |
|---|---|
| `read` | every feed answered. `false` is unread, never "nothing there" |
| `expects.rule` / `.onPush` / `.drafts` | what the base's rules ask of Copilot — `rule: false` means no rule applies **to this base**, which is not "this repo has no such rule". Where rulesets disagree the **looser** answer wins: every rule in force applies |
| `expects.more` | is another review coming to this request **at all**. `false` is the difference between a head waiting out a cutoff and one nothing is on its way to. Where the head carries no review of its own it answers `true` even when it cannot be sure — a cutoff spent for nothing costs minutes, a review skipped costs its findings |
| `verdict` | `waiting` — a request stands, which **outranks** a review of the head: the timeline is oldest-first, so a request that is still the latest move came after that review and a round is outstanding; `reviewed` — a review whose `commit_id` is the head and nothing since; `unrequested` — neither; `not-expected` — no rule, no request ever, no review ever |
| `headReview`, `reviews` | the head's own review, and every Copilot review on the request |
| `latestMove`, `latestMoveAt`, `requests`, `newestRequestAt` | read from the timeline, never from the request list. `latestMoveAt` is when an earlier head's request released, which is where the cutoff below starts counting |
| `draft` | beside `expects.drafts: false`, nothing is coming until the request is opened ready for review |

Two things the script is built around, and a caller reading its answer relies on:

- **The test is never "does a Copilot review exist" but "has Copilot reviewed this exact
  commit".** Right after a push the request looks finished — CI green, the previous review's
  threads resolved, the forge reporting it mergeable — while the review of the push just made
  has not posted, and acting there discards every comment it was about to write.
- **One actor, a different login on every surface**, which is why the filter is a pair (type
  `Bot` and a case-insensitive `^copilot`) and lives in `scripts/lib/forge.mjs` rather than in
  any caller. The same pair survives a deleted account leaving `"user": null`.

**Never place a request** — every review waited for is one already requested; the request list
answers nothing either way
([`../../../references/forge-behaviour.md`](../../../references/forge-behaviour.md)).

**What a review SAID is a second script's** (*Finding the findings* below): this one answers
about the head's state.

## What the review lands as

A review posts as `COMMENTED` — findings under a state that satisfies no requirement and blocks
nothing *of itself*, while the threads its inline findings open block on their own wherever the
base requires them resolved — or as `APPROVED`, which counts toward
`required_approving_review_count` like a teammate's **where this repository lets it count**.
Whether Copilot may approve at all, whether its approval counts, and which changed paths it may
count for are repository settings that the `copilot_code_review` rule does not carry: predict
nothing from configuration, read what posted. Treat anything that is not `APPROVED` as not an
approval — `DISMISSED` above all, an approval that was one and was taken back — and never as a
decline it did not state.

**One approval is not the verdict**, and an empty `reviewDecision` is not one either:
[`merge-gates.md`](merge-gates.md) owns the aggregate and every requirement standing behind it,
including what a push does to an approval already given. Read the review's `state` for what
*this reviewer* did, and that file for where the pull request stands.

**The body's verdict is not the review's state.** Every Copilot review opens with an approval
*assessment* — a line saying whether it considers the PR ready to approve — and a review
carrying the most favourable such line still lands `COMMENTED` when it did not approve. Route
the approval question on `.state`, never on that line.

**But the assessment tells a round you can finish from one you cannot.** Read what the sentence
under it is *about*:

- **The findings** — some number outstanding, named or counted. That is the fix loop's own case:
  fix and push; where a rule reviews pushes, take the wait and the next review can approve.
  Where none does and no request stands, no next review comes, and an approval the base still
  requires is the main skill's Step 4 stop.
- **The change itself** — its breadth, the planes it crosses, what it commits the product to, or
  something the reviewer could not reach and so could not judge. Nothing in the diff is being
  asked for: the reviewer is handing the decision to a human, and another round buys another
  review of the same kind. Confirm that on the head you are handing in rather than from the
  sentence alone — neither reading under *Finding the findings* leaves a finding unanswered —
  and take it to the Step 4 stop.

**Read the assessment as a fact about this head, never as a prediction about the pull request.**
Where a review of a later head is still to come, a change cut down, or simply pushed again, can
earn an approval from the reviewer that declined to judge it before: a deferral is grounds to
raise the question now, never to declare the approval unreachable.

Neither state settles your own bar. `APPROVED` is not "no findings": an approving review can
still carry comments, and every one is read, answered and resolved like any other.

## Wait for the review of the CURRENT head

This section applies once a rule in force reviews this request, again after a push
where that rule reviews pushes, and wherever a request is standing. Elsewhere there
is nothing to wait for — `verdict: not-expected` says exactly that.

**Route on `verdict`, and re-read it after every push:**

| `verdict` | the step |
|---|---|
| `reviewed` | the head's own review is in hand — go to *Finding the findings* |
| `waiting` | a request stands: wait, on the budget below |
| `unrequested`, `expects.more: true` | no review of the head and nothing standing — the cutoff below decides whether that is final |
| `unrequested`, `expects.more: false` | **nothing is coming at all**, so there is no cutoff to wait out: a draft no rule in force reviews — open it ready for review (Step 3), or Copilot never runs on it. Act, do not wait |
| `not-expected` | Copilot is not part of this request's flow; rely on the rest of your bar |
| `read: false` | the feeds were not read — unread, never unreviewed; take the platform path (*When the platform is down, the red check is not yours*) |

**The cutoff — when `unrequested` is final.** The rule registers a request asynchronously, some
time after the push has *landed* (a pre-push hook delays the landing, not the request), so an
`unrequested` head right after a push is "not yet" (*Empty is not negative*). It is ruled
unrequested only once **both** hold: the head's checks have settled, **and** a couple of minutes
have passed since the push landed — or, where a request for an earlier head was standing, since
that released. At the cutoff, go on and say so in the report: never requested, or requested and
removed. Never place one in its stead.

**A review of an earlier commit is not a decline.** It consumes the request and leaves the head
unreviewed; where a rule reviews pushes, the request for this head registers as that review
posts. Elapsed time settles nothing — while `verdict` is `waiting`, wait. **Nor is a repository
check a substitute**: one standing in for this review is satisfied by *a* review of the request,
not by one of the head, and CI is usually green before Copilot has posted.

**The wait runs, and runs out, the way a review run's does** — waited on in the blocking windows
of [`../../../references/review-runs.md`](../../../references/review-runs.md), spent on what does
not depend on it, and run out at that file's ceiling, counted from `newestRequestAt` and never
from the push. While an earlier head's request is still standing the wait is that round's; this
head's own starts when it releases. **Running out is a stop, not a verdict**: record the head as
unreviewed by this reviewer and stop at the addressee `merge-auth` names — another window, or
merge with the head unreviewed and say so in the report.

**Merge only once every review this driver waits for has settled**, or the ceiling was reached
and the addressee said to merge past it. Nothing the repository enforces holds the merge for it:
the check above is already satisfied by a review of any earlier commit, and an approval
requirement holds only where this repo counts Copilot's approval at all. A driver that merges on
green without this wait merges before the review of what it merged, and the findings land on a
closed request where thread resolution can no longer block them. Do this after *every* push, the
last one included.

## What the review said, and what to do with it

Two readings, the severity ladder, the fix and the reply-and-resolve protocol are
[`copilot-findings.md`](copilot-findings.md)'s — read once a review of the head is in hand, and
not before.

## What the report says about this reviewer

The end-of-session report gives Copilot one line among the gates: **the review of the head that
merged** and the `state` it carries — or, where that head has none, the commit the last review
covered and why. `headReview` and `reviews` are both, and they survive the merge and the
deletion of the branch, so the line is available after the merge as well as before it. No review
of the head exists for one of three reasons, which take different steps, so report which: **no
request reached the later commits** — no rule in force, none that reviews pushes, or what the
wait recorded at its cutoff, a removal included; **the ceiling reached**, and the addressee's
word to merge past it; or **a review still outstanding**, which `latestMove` tells and which
after a merge is the late review Step 7 goes back for.
