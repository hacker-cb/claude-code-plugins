# Collaborating with Copilot review

How to find, classify, fix, and respond to GitHub Copilot's PR review findings.

## Identifying Copilot — never match one literal

One actor, a different login on **every** surface:

| Surface | `login` | the type field |
|---|---|---|
| REST `…/pulls/<pr>/reviews` | `copilot-pull-request-reviewer[bot]` | `.user.type` |
| REST `…/pulls/<pr>/comments` | `Copilot` | `.user.type` |
| REST `…/issues/<pr>/timeline` → `requested_reviewer`, a review's `user` | `Copilot` | `.type` |
| GraphQL `author` — reviews, comments | `copilot-pull-request-reviewer` | `__typename` |

So a filter pinned to any one spelling matches nothing on the others, and the
failure is **silent**: the inline comments are exactly what a `/comments` filter
returns, and an empty result reads as "Copilot had no findings" rather than as a
filter that missed. Match the pair instead — `Bot` **and** a case-insensitive
`^copilot` prefix, which also survives GitHub renaming the bot again:

```jq
select((.user.type? // "") == "Bot" and ((.user.login? // "") | test("^copilot"; "i")))
```

In GraphQL the same test reads `.author.__typename` and `.author.login`.

**Reach every field through `?` and `// ""`.** `test/1` raises on anything that is
not a string, and a deleted account leaves `"user": null` behind — one such row
aborts the whole `--jq` program, turning a PR full of findings into a PR with
none. That is the same silent-empty failure by another route.

## What the repository asks of Copilot

Two questions, and neither answers the other: which Copilot reviews this driver
**waits** for, and which ones it **reads**. **It never requests a review itself** —
not after a push, not for a head the rule passed over, not in place of a review that
did not come: every review it waits for is one already requested.

### What to wait for — the rules in force on the base

Copilot reviews a PR on its own when a `copilot_code_review` rule is in force **for
that PR's base branch**. Ask for the rules in force on the base rather than listing
the repo's rulesets: this endpoint has already applied each ruleset's `ref_name`
conditions *and* includes rules inherited from an organization-level ruleset, and a
plain `/rulesets` listing does neither.

```bash
# One line per rule in force on the base branch. `ruleset_source_type` says
# whether it came from this repo or from an org-level ruleset.
gh api repos/{owner}/{repo}/rules/branches/<base> \
  --jq '.[] | select(.type=="copilot_code_review") | .parameters | @json'
```

Several lines is normal — a repo can carry the rule in more than one ruleset that
matches the branch. No line at all means no rule applies **to this base**, which is
a different statement from "this repo has no such rule": the same repo can enforce
Copilot on its default branch and nothing at all on a side branch.

- **No line** — wait for no Copilot review.
- **Lines, none of them `review_on_push: true`** — wait for the review the rule
  requests when the PR opens ready for review, and for none after a push.
- **Any line with `review_on_push: true`** — the rule requests Copilot again on
  every push, so every push in the fix loop may owe you a review to wait for and
  read before you call the PR done. *Wait for the review of the CURRENT head* below
  is what that costs you, and says when a head's request is not coming.
- **`review_draft_pull_requests: false`** — drafts are not reviewed at all. Open
  the PR ready-for-review (main skill Step 3), or Copilot never runs.

Whichever line applies, a request already standing is waited for too, whoever
placed it.

**The rule requests the review; whether that review gates the merge is settled
elsewhere** — *What the review lands as* below. The rule's own parameters say
nothing about it.

A repo may separately mark some status check required that stands in for the
review. You need not know which, or what it is called: it is just another context
under `required_status_checks`, satisfied like any other. Never read such a check's
green as proof that Copilot reviewed the *current* head — verify that yourself,
below.

### What to read — every review that posted

Every Copilot review on the PR is read, whatever the rules say — one someone
requested by hand on a base without the rule included. A review that has already
posted **consumes its request**, so a PR with no rule and no request standing can
still carry one, and its comments go unread if either of those is taken for "never
involved". Count before concluding there is nothing to read:

```bash
# --paginate applies --jq per page, so a bare `length` prints one number *per
# page* — sum them, or a PR with >100 reviews answers with several numbers.
gh api --paginate repos/{owner}/{repo}/pulls/<pr>/reviews \
  --jq '[ .[] | select((.user.type? // "") == "Bot" and ((.user.login? // "") | test("^copilot"; "i"))) ] | length' \
  | awk '{ n += $1 } END { print n + 0 }'
```

Whether a request stands is Copilot's latest move on the pull request's timeline —
never the request list, which reads empty through a live request as readily as
through none:

```bash
# The timeline lists events oldest first, so the last line is Copilot's latest move:
# `review_requested` — a request standing, which it does until its review posts;
# `reviewed` or `review_request_removed` — nothing standing; no line at all —
# Copilot has never been asked on this pull request. `copilot_work_started` is
# deliberately not among them: a run beginning is neither the request nor what
# settles it. The line carries the time step 5 counts its ceiling from.
# Captured with its exit status rather than piped straight into `tail`, which
# exits 0 over a call that failed — and a read that failed prints exactly what a
# pull request Copilot has never been asked on prints.
if ! moves="$(gh api --paginate repos/{owner}/{repo}/issues/<pr>/timeline \
  --jq '.[] | (.event? // "") as $e
        | select(($e | test("^(review_requested|review_request_removed|reviewed)$"))
                 and ((.requested_reviewer // .user // {})
                      | (.type? // "") == "Bot" and ((.login? // "") | test("^copilot"; "i"))))
        | {event: $e, at: (.created_at // .submitted_at)} | @json')"; then
  echo "TIMELINE UNREAD — no verdict about Copilot, and not an absent one"; exit 1
fi
printf '%s\n' "$moves" | tail -1
```

No rule, no request standing and no review posted: Copilot is not part of this PR's
flow — skip it and rely on the rest of your bar.

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

This section applies once the PR is one a rule in force reviews — ready for review,
or still a draft where that rule carries `review_draft_pull_requests: true` — after
a push wherever a rule in force reviews pushes (`review_on_push: true`), and
wherever a request is standing; anywhere else there is nothing to wait for — go on.
In the steps below, the moment the PR became reviewable counts as its first push.

The trap that silently drops findings: right after you push a fix, the PR briefly
looks finished — CI goes green, the previous review's threads are all resolved,
GitHub reports the PR mergeable — while Copilot's review *of the push you just
made* has not posted yet. Acting in that window discards every comment Copilot was
about to write.

So the test is never "does a Copilot review exist" but "**has Copilot reviewed this
exact commit**". Each review carries the SHA it reviewed in `commit_id`; compare it
with the PR head:

```bash
head=$(gh pr view <pr> --json headRefOid --jq .headRefOid)
# `| @json` pins each review to exactly one line, so `tail -1` is the last review
# and not whatever gh's output formatting happened to put on the last line.
gh api --paginate repos/{owner}/{repo}/pulls/<pr>/reviews \
  --jq '.[] | select((.user.type? // "") == "Bot" and ((.user.login? // "") | test("^copilot"; "i")))
        | {commit_id, submitted_at} | @json' | tail -1
# fresh iff commit_id == $head
```

The rule's request for a push can be late, and on some pushes it never registers,
so the wait ends on **the request's own events on the timeline** — never on the repository's checks, and on
the clock only where step 5 says the wait has run out: a status check that stands
in for Copilot's review is satisfied by *a* review of the pull request, not by one
of the current head, and CI is usually green before Copilot has posted. **Green checks with
no review of the head are the normal state right after a push, not a lost request.**
After each push:

1. **Watch the request appear for this head — never place one.** The rule
   registers the request itself, asynchronously, some time after the push has
   *landed* (a pre-push hook delays the landing, not the request),
   and until it has, the timeline carries no request of this head's — absence there
   is "not yet", never "not requested". **Read the request on the timeline, never in
   the request list**: `requested_reviewers` and `gh pr view --json reviewRequests`
   can both read empty from the moment a Copilot request registers until its review
   posts, so a wait built on either never arms. The timeline carries it as events
   instead — its `review_requested`. A `review_request_removed` belongs to the
   latest-move read rather than to this count, which a removal would grow exactly as
   a request does. Take the reading before you
   push and again after: a count that has grown says a request registered after the
   push, which is what tells the rule working from the rule skipping this head. **It
   does not say which head the rule placed it for** — the event carries no SHA, and a
   request the previous push earned can register after your reading just as readily.
   The only signal that carries a SHA is the review's own `commit_id`, and step 4 is
   what catches a request that turns out to have been an earlier head's.
   ```bash
   # What is already there, counted — not a moment off the clock: `created_at` is
   # whole seconds, so a timestamp bound drops the event that lands inside the very
   # second it was taken in, and admits one that was already there.
   # Captured with its exit status: a call that failed prints no events, exactly as
   # a pull request with none does.
   if ! requests="$(gh api --paginate repos/{owner}/{repo}/issues/<pr>/timeline \
     --jq '.[] | select((.event? // "") == "review_requested")
           | select((.requested_reviewer // {})
                    | (.type? // "") == "Bot" and ((.login? // "") | test("^copilot"; "i")))
           | {event, at: .created_at} | @json')"; then
     echo "TIMELINE UNREAD — neither a request nor its absence"; exit 1
   fi
   # One more than before the push is a request that registered after it. Counted
   # with `awk`, which succeeds over no lines at all — `grep -c` exits 1 there, and
   # none is the baseline this reading exists to state, not a failure.
   printf '%s\n' "$requests" | awk 'NF { n++ } END { print n + 0 }'
   # And the newest of them: its `at` is what step 5 counts the ceiling from.
   printf '%s\n' "$requests" | tail -1
   ```
2. **Hold while a request stands, and rule a head unrequested only at the cutoff.**
   A push landing while an earlier head's review is still to post gets its request
   from the rule the moment that review posts, and not before: until then a head
   with no `review_requested` of its own is waiting rather than passed over. So hold
   while Copilot's latest move (*What to read* above) is `review_requested`.

   **A head with no request of its own is ruled not requested only once both
   hold**: its checks have settled, **and** at least a couple of minutes have passed
   since the push landed — or, where the hold above was in force, since it
   released. The minutes are for a CI that settles before the rule registers its
   request. At that point the repository chose not to review this head: go on, and
   record it for the report. Never place a request in its place.
3. **Wait until it settles — on a Copilot review whose `commit_id == $head`, and on
   nothing else.** A `review_request_removed` ends the request it removes, never this
   head's wait: the event carries no SHA, and an earlier head's request can register
   late and be removed after this head's push, so no removal says this head was
   declined. What a removal leaves is a head with no request standing, which step
   2's cutoff decides; the report names the removals as what Copilot did, never as a
   review. A `copilot_work_finished_failure` ends nothing either: a request stands
   until its review posts, and the review that run was writing still posts.
4. **A review of an earlier commit is not a decline.** It consumes the request and
   leaves the head unreviewed; where a rule reviews pushes, its request for this head
   registers as that review posts — step 1's watch again, from that moment, up to
   step 2's cutoff. Elapsed time settles nothing: while Copilot's latest move is
   `review_requested`, hold — in the windows and up to the ceiling of step 5 — and
   say the head review is outstanding.
5. **The wait runs, and runs out, the way a review run's does.** It is waited on
   in the blocking windows of
   [`../../../references/review-runs.md`](../../../references/review-runs.md),
   spent on what does not depend on it — the loop's live-state read, its drift
   measure — and it runs out at that file's ceiling, counted from the
   `review_requested` this head is waiting on, whose time step 1's reading
   carries, rather than from the push. While step 2's hold is in force the wait
   is the earlier head's round, spending that round's ceiling: this head's own
   starts when the hold releases and its watch begins, so a round that has
   already spent its ceiling never expires this one before it has waited at all.
   Running out is a stop, not a verdict: record the head as unreviewed by this
   reviewer, and stop at the addressee `merge-auth` names, recommendation first —
   another window, or merge with the head unreviewed by Copilot and say so in the
   report. The clock decides none of that; the addressee does.

**Merge only once every review this driver waits for has settled** — or the
ceiling above was reached and the addressee said to merge past it. Nothing the
repository enforces can be relied on to hold the merge for it: a status check standing in for the
review is already satisfied by a review of any earlier commit, and an approval
requirement holds only where this repo counts Copilot's approval at all. So a
driver that merges on green without this wait merges before the review of what it
merged, and the findings arrive on a closed pull request where the
thread-resolution rule can no longer block them.

Do this after *every* push, the last one included — its review is the easiest to
skip and the most likely to be missed.

## Finding the findings — two readings, not one

A review puts its findings in **two** places, and only one of them opens threads.
Both are read, every round: one of them alone is half the review, and the half it
drops is the half nothing else catches — no thread, no gate, no count.

### Reading 1 — the threads

Use whichever source is available (in priority order):

1. **GitHub MCP** — use the connected GitHub MCP tools to list PR review comments
   and review threads. Richest structured output (author, path, line, body,
   thread/resolution state).
2. **`gh` CLI:**
   ```bash
   gh pr view <pr> --comments
   # review threads with resolution state (GraphQL). Select the thread `id` and each
   # comment's `databaseId` — you need them below: `id` is the `<thread_node_id>` for
   # resolveReviewThread, `databaseId` is the `<comment_id>` for the replies endpoint.
   # `resolvedBy` and `isOutdated` are what *Replying* judges a thread by; `isResolved`
   # alone cannot tell one you answered from one the reviewer closed itself.
   gh api graphql -f query='
     query($owner:String!,$repo:String!,$pr:Int!){
       repository(owner:$owner,name:$repo){
         pullRequest(number:$pr){
           reviewThreads(first:100){
             nodes{ id isResolved isOutdated resolvedBy{ login }
                    comments(first:100){ nodes{ databaseId author{login __typename} body path line } } }
           }
         }
       }
     }' -F owner=<owner> -F repo=<repo> -F pr=<pr>
   ```
3. **REST API** via `gh api repos/{owner}/{repo}/pulls/<pr>/comments` as a
   fallback.

Filter all three by the pair from *Identifying Copilot*, never by a login you saw
on another surface: on `/comments` the login is a bare `Copilot`, and in GraphQL it
carries no `[bot]` suffix.

### Reading 2 — the review bodies

Findings that opened no thread are in the **review body itself**, under a
suppressed-comments heading: a file and a line, the finding, and the code it sits
on — everything an inline comment carries except the comment. Having no thread is
what makes every habit built around threads miss them at once. The comment sources
above return nothing of them, `required_review_thread_resolution` does not hold
them, and the check that unresolved threads are zero reads a clean field while they
stand.

Read the body of **every** Copilot review that posted, whichever commit it covers —
the head you hand in may never get a review of its own while an earlier commit's
review still carries its findings, and several runs can review one commit, a later
one carrying findings the earlier one did not. A body whose findings the PR's
conversation already names was read in an earlier round:

```bash
gh api --paginate repos/{owner}/{repo}/pulls/<pr>/reviews \
  --jq '.[] | select((.user.type? // "") == "Bot" and ((.user.login? // "") | test("^copilot"; "i")))
        # markup stripped before either count is read: both labels arrive as a heading
        # or a bold run as often as plain text, and GitHub may reword either of them
        | ((.body? // "") | gsub("<[^>]*>"; " ") | gsub("[*_#]"; " ")) as $b
        | {at: .submitted_at, commit: ((.commit_id // "")[:7]), state,
           opening: (((.body? // "") | split("\n")[0] // "") | gsub("^#+ *|[[:space:]]+$"; "")),
           # `// "none"` and not `// "0"`: a body carrying no such block and a block
           # reporting none are different readings, and they take different next steps
           suppressed: (($b | capture("[Ss]uppressed[^(]{0,40}\\((?<n>[0-9]+)\\)").n) // "none"),
           threads_opened: (($b | capture("[Cc]omments generated[^0-9]{0,20}(?<n>[0-9]+)").n) // "none")}
        | @json'
```

That says *whether* to read a body, never *what* it found — read the ones it names
in full. `opening` is the body's first line and nothing more: it is where the
assessment sits when the review carries one, and a pointer to the body rather than
a substitute for reading it.

**The count the body reports is a count of threads, not of findings.** It says what
the review opened, and a review whose findings all went to the suppressed block
opened none — so zero there is this class's *signature*, never evidence against it.
And this holds whatever the verdict says: an approving review carries a suppressed
block as readily as a declining one, and its body is read like any other.

A suppressed finding carries no `comment_id`, so there is no thread to answer in and
none to resolve. It ends in the fix, and is named — fixed, or turned down with its
reason — in the pull request's conversation, which is where *Replying* would
otherwise have put it.

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
*Identifying Copilot* has nothing to test here — `resolvedBy` is typed as a plain
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

The end-of-session report (main skill Step 7) gives Copilot one line among the
gates: **the commit its last review covered**, the `state` that review carries, and
— where that commit is not the head that merged — why no review of the head exists.
Read the head first: `headRefOid` survives both the merge and the deletion of the
branch, so this works after Step 6 as well as before it.

```bash
HEAD_SHA="$(gh pr view <pr> --json headRefOid --jq .headRefOid)"
# Unset it and the line below reads `head: false` — "the merged head went
# unreviewed", said by a variable that never got a value rather than by the PR.
[ -n "$HEAD_SHA" ] || { echo "HEAD SHA UNREAD — report no Copilot line"; exit 1; }
export HEAD_SHA
# Captured with its exit status: a call that failed prints no review, exactly as a
# PR Copilot never reviewed does. The rows come back in the order they were
# published, so the last line is the last review.
if ! rows="$(gh api --paginate repos/{owner}/{repo}/pulls/<pr>/reviews \
  --jq '.[] | select((.user.type? // "") == "Bot" and ((.user.login? // "") | test("^copilot"; "i")))
        | {commit_id, state, head: (.commit_id == env.HEAD_SHA)} | @json')"; then
  echo "REVIEWS UNREAD — no Copilot line, and not an absent one"; exit 1
fi
printf '%s\n' "$rows" | tail -1
```

An empty line is a PR Copilot never reviewed — say that instead of a commit.
`head: false` has four causes, and they take different steps — report which it was:

- **the repository requested no review of the later commits** — no rule in force,
  none that reviews pushes, or a head that reached the cutoff with no request of its
  own (*Wait for the review of the CURRENT head*, step 2);
- **a request removed** without a review;
- **the ceiling reached**, and the addressee's word to merge past it;
- **a review still outstanding** — Copilot's latest move on the timeline tells that
  one, and after a merge it is the late review the main skill's Step 7 goes back
  for.
