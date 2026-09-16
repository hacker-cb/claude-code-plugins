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

Three things the script is built around, and a caller reading its answer relies on:

- **The test is never "does a Copilot review exist" but "has Copilot reviewed this
  exact commit".** Right after a push the request looks finished — CI green, the
  previous review's threads resolved, the forge reporting it mergeable — while the
  review of the push just made has not posted. Acting there discards every comment it
  was about to write. Measured on a real request: six Copilot reviews standing, none
  of them of the head.
- **One actor, a different login on every surface, and the type under a different key
  too.** The filter is the **pair** — type `Bot` **and** a case-insensitive `^copilot` —
  and a filter pinned to one spelling matches nothing on the others, silently: an empty
  result reads as "no findings" rather than as a filter that missed. A login test alone
  takes a person named `copilot-…`; a type test alone takes `dependabot[bot]`.

  | Surface | `login` | the type field |
  |---|---|---|
  | REST `…/pulls/<pr>/reviews` | `copilot-pull-request-reviewer[bot]` | `.user.type` |
  | REST `…/pulls/<pr>/comments` | `Copilot` | `.user.type` |
  | REST `…/issues/<pr>/timeline` | `Copilot` | `.requested_reviewer.type`, a review's `.user.type` |
  | GraphQL `author` — reviews, comments | `copilot-pull-request-reviewer` | `.author.__typename` |

  ```jq
  select((.user.type? // "") == "Bot" and ((.user.login? // "") | test("^copilot"; "i")))
  ```
- **The request list is not the request.** `requested_reviewers` and
  `gh pr view --json reviewRequests` both read empty from the moment a request
  registers until its review posts, so a wait built on either never arms.

**Never place a request** — every review waited for is one already requested.

**What a review SAID is a second script's** (*Finding the findings* below): this one
answers about the head's state. Both hold to the same pair, and both survive a deleted
account leaving `"user": null` where a filter expected a login.

## What the review lands as

A review posts as `COMMENTED` — findings under a state that satisfies no
requirement and blocks nothing *of itself*, while the threads its inline findings
open block on their own wherever the base requires them resolved — or as
`APPROVED`, which counts toward `required_approving_review_count` like a
teammate's **where this repository lets it count** — two paragraphs down are the
settings that decide that, and the paths they limit it to. Where they do not,
`APPROVED` is a state and satisfies nothing. Those are what Copilot writes; the field holds other
values too, `DISMISSED` above all, which is an approval that *was* one and was
taken back. Treat anything that is not `APPROVED` as not an approval, and never as
a decline it did not state.

**One approval is not the verdict.** `reviewDecision` is the aggregate over every
reviewer and every requirement: it stays `REVIEW_REQUIRED` with Copilot's approval
already in when the base wants a second one or a code owner's. **Empty is not a
verdict either** — the field reads empty with an approval requirement in force and
unmet just as readily as with no requirement at all, so it never says which of the
two you are in. Read the review's `state` for what *this reviewer* did,
`reviewDecision` for where the *pull request* stands, and neither of them for what
the base requires — that read is
[`merge-gates.md`](merge-gates.md)'s.

**The body's verdict is not the review's state.** Every Copilot review opens with
an approval *assessment* — a line saying whether it considers the PR ready to
approve — and a review carrying the most favourable such line still lands
`COMMENTED` when it did not actually approve. Route the approval question on
`.state`, never on that line.

**But the assessment is what tells a round you can finish from one you cannot.** A
review that did not approve is one of two things, and they take opposite steps.
Read what the sentence under the assessment is *about*:

- **The findings** — some number of them outstanding, named or counted. That is the
  fix loop's own case: fix and push; where a rule reviews pushes, take the wait, and
  the next review can approve — where none does and no request stands, no next
  review comes, and an approval the base still requires is the main skill's Step 4
  stop.
- **The change itself** — its breadth, the planes it crosses, what it commits the
  product to, or something the reviewer could not reach and so could not judge.
  Nothing in the diff is being asked for. The reviewer is handing the decision to a
  human, and another round buys another review of the same kind.

Confirm the second on the head you are handing in rather than from the sentence
alone: neither reading under *Finding the findings* leaves a finding unanswered.
That is a finished review that is not an approval, and what is left is a decision
rather than a fix — the main skill's Step 4 stop is where it goes.

**Read it as a fact about this head, never as a prediction about the pull request.**
Where a review of a later head is still to come, a change cut down, or simply pushed
again, can earn an approval from the reviewer that declined to judge it before — so
a deferral is grounds to raise the question now, never grounds to declare the
approval unreachable.

Whether Copilot may approve at all, whether its approval counts toward the merge
requirements, and which changed paths it may count for are repository settings
(mirrored at the organization and enterprise level) that the `copilot_code_review`
rule does not carry — its parameters govern requesting the review, not approving
it. So predict nothing from configuration — read what actually posted.

**A push dismisses Copilot's approval exactly where it dismisses a human's** —
under `dismiss_stale_reviews_on_push`, and not otherwise. Where that is on, a repo
counting approvals reports `BLOCKED` after each fix until a fresh one lands: a wait
for the head's review, not a check that went missing. Where it is off, the approval
of an earlier head survives the push — which says nothing about the commit you are
now about to merge, and does not settle the aggregate either: under
`require_last_push_approval` that surviving review stops satisfying the gate and
`reviewDecision` goes back to `REVIEW_REQUIRED`. Read the field; never infer it
from this one parameter. Either way what settles the head is the next section,
never the approval standing. And where no rule in force reviews pushes and no
request stands, nothing brings a dismissed approval back: a requirement it was
closing stays open, which is the main skill's Step 4 stop.

Neither state settles your own bar. `APPROVED` is not "no findings": an approving
review can still carry comments, and every one of them is read, answered and
resolved like any other.

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

**The cutoff — when `unrequested` is final.** The rule registers a request
asynchronously, some time after the push has *landed* (a pre-push hook delays the
landing, not the request), so an `unrequested` head right after a push is "not yet"
(*Empty is not negative*). It is ruled unrequested only once **both** hold: the
head's checks have settled, **and** a couple of minutes have passed since the push
landed — or, where a request for an earlier head was still standing, since that
released. At that cutoff, go on and say so in the report: never requested, or
requested and removed. Never place one in its stead.

**A review of an earlier commit is not a decline.** It consumes the request and
leaves the head unreviewed; where a rule reviews pushes, the request for this head
registers as that review posts. Elapsed time settles nothing — while `verdict` is
`waiting`, wait.

**Never wait on a repository check instead.** A status check standing in for
Copilot's review is satisfied by *a* review of the request, not by one of the head,
and CI is usually green before Copilot has posted: **green checks with no review of
the head are the normal state right after a push, not a lost request.**

**The wait runs, and runs out, the way a review run's does.** Waited on in the
blocking windows of
[`../../../references/review-runs.md`](../../../references/review-runs.md), spent on
what does not depend on it, and run out at that file's ceiling — counted from
`newestRequestAt`, never from the push. While an earlier head's request is still
standing the wait is that round's, spending that round's ceiling; this head's own
starts when it releases. **Running out is a stop, not a verdict**: record the head as
unreviewed by this reviewer and stop at the addressee `merge-auth` names (*Every stop
carries its recommendation first*) — another window, or merge with the head
unreviewed and say so in the report. The clock decides none of it.

**Merge only once every review this driver waits for has settled** — or the ceiling
was reached and the addressee said to merge past it. Nothing the repository enforces
holds the merge for it: the status check above is already satisfied by a review of
any earlier commit, and an approval requirement holds only where this repo counts
Copilot's approval at all. A driver that merges on green without this wait merges
before the review of what it merged, and the findings land on a closed request where
thread resolution can no longer block them.

Do this after *every* push, the last one included.

## Finding the findings — two readings, not one

A review puts its findings in **two** places, and only one of them opens threads. Both
are read every round: one alone is half the review, and the half it drops is the half
nothing else catches — no thread, no gate, no count. A finding in the suppressed block
has no thread, so `required_review_thread_resolution` does not hold it and the check
that unresolved threads are zero reads a clean field while it stands.

`scripts/copilot-findings.mjs` does both readings and says what is still owed. It reads;
replying and resolving are *Replying*'s, and a reply folded into the reading is sent
before the reading is believed.

```text
node <plugin root>/scripts/copilot-findings.mjs --pr <n> [--repo <owner/name>]
```

| field | what it settles |
|---|---|
| `read` | **both halves answered.** Either half alone is half a review, and `false` here says so however much is in the answer |
| `threads.items[]` | one per review thread: `resolved`, `outdated`, `resolvedBy`, `byReviewer`, the `path` and `line`, and each comment with the `id` a reply is posted to |
| `threads.items[].answered` | whether anything of ours follows the finding — **position is what makes a reply one**. `null` where that thread's own comments paginated, which owes exactly as much as no answer does |
| `bodies.items[]` | one per review this reviewer posted, whichever commit it covers, with `state`, `head`, and `opening` — the body's first line, where the assessment sits, and a pointer to the body rather than a substitute for reading it |
| `bodies.items[].suppressed` | the findings that opened no thread. **`null` is "no such block", never zero** — they take different next steps |
| `bodies.items[].opened` | what the review OPENED, a count of threads and never of findings: a review whose findings all went to the suppressed block opened none, so zero there is that class's signature rather than evidence against it. It holds whatever the verdict says — an approving review carries a suppressed block as readily as a declining one |
| `open[]` | every thread still owed something, each carrying the `why` that says which of the three states it is in |

Above zero, `suppressed` means reading that body in full: the script says *whether* to
read one, never *what* it found. A suppressed finding carries no comment id, so there is
no thread to answer in and none to resolve — it ends in the fix, and is named, fixed or
turned down with its reason, in the pull request's conversation, which is where
*Replying* would otherwise have put it.

## Classifying severity

The ladder and what each tier costs are
[`../../../references/findings.md`](../../../references/findings.md)'s. What is
this reviewer's own: **Copilot does not tag severity consistently.** Where it
labels a finding — high or critical, a bug, a security issue — take its label;
otherwise rate it yourself by that reference.

**Critical** and **Important** are fixed in the loop unconditionally. A `Minor` is
not left alone by its rating either — put it through that same reference and fix
here whatever passes. It goes up like any other fix, riding the next substantive
push where one is still to come and taking whatever wait that push costs.
Whether it takes a push of its own where none is coming turns on what a push costs
on this head — the paragraph below. What a `Minor` never does is spend the loop's
iteration budget: that is there for what blocks the exit, and a `Minor` never does.
Only what the reference turns down goes into the end-of-session report (Step 7),
under its category so the user sees it.

**A push that would spend a standing approval is a fork, not a cost.** Where the
base dismisses stale reviews on push and that approval is what closes its approval
requirement, the next push takes the approval with it, and nothing says the next
review gives it back. This reviewer makes the case vivid — it approves and names a
finding in one review, so the fix for its own finding is what costs its own
approval — but the fork is the same wherever an approval is standing, whoever gave
it. What the finding is rated decides who weighs the two sides:

- **Critical or Important** — fixed, and the approval spent on it. Nothing is being
  weighed here: merging it was never on the table.
- **A `Minor` the reference routes to a fix** — the fork proper, and not the
  loop's to settle on its own. Put both sides to the addressee `merge-auth` names,
  recommendation first: spend the approval on the nit, or turn the finding down
  here — answered and resolved where it opened a thread, and in the end-of-session
  report either way — and merge the head that carries the approval.

**Three things collapse the fork, any one of them on its own, and each is read
rather than assumed.** The base does not dismiss stale reviews on push, so the
approval survives it. The standing approval does not close the base's approval
requirement, so spending it costs the merge nothing. A substantive push is coming
anyway, so the approval goes with that push whatever the `Minor` does and the
`Minor` rides along.

**What you *fix* and what you *resolve* are different questions.** A thread this
reviewer opened ends resolved once it has its answer — the fix is in, or the
finding was turned down with its reason — whatever the rating above decided; a
fix and an acknowledgement both end in a reply + resolve. Where the repo
requires all threads resolved (`required_review_thread_resolution`), a left-open
nit blocks the merge just as hard as a Critical one.

## Fixing

- Address the root cause, not just the symptom Copilot pointed at.
- **Where a round comes back to prose rather than to behaviour, cut the surface
  instead of rewording it.** Text a change does not require is text that can drift
  from the code, and the reviewer keeps finding it however carefully it is
  rephrased; removing it ends the class, while a better wording buys another round.
- Make each fix a focused commit (or a small logical group); clear messages.
- Batch fixes into as few pushes as is reasonable — each push costs another
  review wait where a rule reviews pushes, and, where the base dismisses stale
  reviews on push, the approval standing on the head it leaves behind.
- Re-run/observe CI after pushing.

## Replying — reply to EVERY Copilot comment

Every Copilot comment gets a reply, whether fixed or skipped. This closes the
loop and keeps the review thread honest.

- **Fixed:** reply briefly noting what you changed and, if useful, the commit.
  e.g. "Fixed — added input validation and a null check in `parseConfig` (abc123)."
- **Skipped:** reply with the reason it's out of scope / not a defect.
  e.g. "Acknowledged — this is a style preference; leaving as-is for consistency
  with the surrounding module. Noted in the session report."
- After replying, **resolve the thread**, where the comment sits in one — its
  finding fixed, or turned down with the reason given — so the PR's review state
  says what was actually settled rather than what the repo happens to enforce. A
  review summary carries no thread and needs no resolving. (See *Classifying
  severity*.)

**A thread this reviewer resolved is not by itself an answered thread.** Copilot
closes its own, under a login other than the one it commented under. The pair from
*The state is read by a script* has nothing to test here — `resolvedBy` is typed as a plain
user and carries no field distinguishing a bot from a person — so this is the one
place the `^copilot` prefix stands alone, case-insensitively, which is what covers
every spelling it resolves under.

**What that match means turns on whether your reply is already in the thread**, and
the query above returns both. A thread this reviewer closed with no answer of yours
in it is an open finding wearing the resolved badge, and
`required_review_thread_resolution` is satisfied the whole time it stands. One you
answered and it then closed is settled: its resolve lands *after* the reply rather
than with it, so a list taken as you answer is honest and already stale — retake it
on the head you hand in rather than answering twice.

Reply + resolve via:
```bash
# reply to a review comment thread:
gh api repos/{owner}/{repo}/pulls/<pr>/comments/<comment_id>/replies \
  -f body="<reply text>"
# resolve a thread (GraphQL mutation):
gh api graphql -f query='
  mutation($threadId:ID!){ resolveReviewThread(input:{threadId:$threadId}){ thread{ isResolved } } }' \
  -F threadId=<thread_node_id>
```
Or the equivalent MCP tools if available.

## What the report says about this reviewer

The end-of-session report (main skill Step 7) gives Copilot one line among the gates:
**the review of the head that merged** and the `state` it carries — or, where that head
has none, the commit the last review covered and why. `headReview` and `reviews` from
*The state is read by a script* are both, and they survive the merge and the deletion of
the branch, so the line is available after Step 6 as well as before it.

No review of the head exists for one of three reasons, which take different steps, so
report which it was:

- **no request reached the later commits** — no rule in force, none that reviews pushes,
  or what the wait recorded at its cutoff for this head, a removal included (*Wait for
  the review of the CURRENT head*, step 2);
- **the ceiling reached**, and the addressee's word to merge past it;
- **a review still outstanding** — `latestMove` tells that one, and after a merge it is
  the late review the main skill's Step 7 goes back for.
