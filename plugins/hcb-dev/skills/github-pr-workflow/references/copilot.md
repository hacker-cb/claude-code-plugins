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

## Is Copilot even in the loop?

Copilot reviews a PR when a `copilot_code_review` rule is in force **for that PR's
base branch**, or when someone — you included — requests it on the PR. Ask for the
rules in force on the base rather than listing the repo's rulesets: this endpoint
has already applied each ruleset's `ref_name` conditions *and* includes rules
inherited from an organization-level ruleset, and a plain `/rulesets` listing does
neither.

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

- **`review_on_push: true`** — Copilot is re-*requested* on *every* push, so every
  push in the fix loop owes you a review to wait for and read before you call the
  PR done. The request is not a promise that one posts; *Wait for the review of the
  CURRENT head* below is what that costs you.
- **`review_draft_pull_requests: false`** — drafts are not reviewed at all. Open
  the PR ready-for-review (main skill Step 3), or Copilot never runs.

**The rule requests the review; whether that review gates the merge is settled
elsewhere** — *What the review lands as* below. The rule's own parameters say
nothing about it.

A repo may separately mark some status check required that stands in for the
review. You need not know which, or what it is called: it is just another context
under `required_status_checks`, satisfied like any other. Never read such a check's
green as proof that Copilot reviewed the *current* head — verify that yourself,
below.

Copilot is out of the loop only when **all three** of these are false: there is no
`copilot_code_review` rule, no Copilot request is standing, *and* the PR
carries no Copilot review already. That third one is easy to forget and expensive
to get wrong — a review that has already posted **consumes its request**, so on a
repo without the rule a manually-requested Copilot that has already reviewed looks
exactly like "never involved" if you only check the first two, and its comments
would go unread. Check for an existing review before skipping:

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

Only when all three say no is Copilot genuinely not part of this repo's flow — then
skip it and rely on the rest of your bar.

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
  fix loop's own case: fix, push, take the wait, and the next review can approve.
- **The change itself** — its breadth, the planes it crosses, what it commits the
  product to, or something the reviewer could not reach and so could not judge.
  Nothing in the diff is being asked for. The reviewer is handing the decision to a
  human, and another round buys another review of the same kind.

Confirm the second on the head you are handing in rather than from the sentence
alone: neither reading under *Finding the findings* leaves a finding unanswered.
That is a finished review that is not an approval, and what is left is a decision
rather than a fix — the main skill's Step 4 stop is where it goes.

**Read it as a fact about this head, never as a prediction about the pull request.**
A change cut down, or simply pushed again, earns an approval from the reviewer that
declined to judge it before — so a deferral is grounds to raise the question now,
never grounds to declare the approval unreachable.

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
never the approval standing.

Neither state settles your own bar. `APPROVED` is not "no findings": an approving
review can still carry comments, and every one of them is read, answered and
resolved like any other.

## Wait for the review of the CURRENT head

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

Copilot does not re-review every push — one that only applies its own suggestions
often earns none — so the wait ends on **the request's own events on the
timeline** — never on the repository's checks, and on the clock only where step 5
says the wait has run out: a status check that stands in for
Copilot's review is satisfied by *a* review of the pull request, not by one of the
current head, and CI is usually green before Copilot has posted. **Green checks with
no review of the head are the normal state right after a push, not a lost request.**
After each push:

1. **Watch the request appear for this head — do not place one.** Under
   `review_on_push` the rule registers the request itself, asynchronously, some time
   after the push has *landed* (a pre-push hook delays the landing, not the request),
   and until it has, the timeline carries no request of this head's — absence there
   is "not yet", never "not requested". **Read the request on the timeline, never in
   the request list**: `requested_reviewers` and `gh pr view --json reviewRequests`
   can both read empty from the moment a Copilot request registers until its review
   posts, so a wait built on either never arms. The timeline carries it as events
   instead — its `review_requested`. A `review_request_removed` is the decline
   step 3 reads, and it belongs to the latest-move read rather than to this count,
   which a removal would grow exactly as a request does. The event carries no SHA,
   so what makes one this head's is that the timeline did not carry it before: take
   this reading before you push, and again after.
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
   # One more than before the push is this head's, and the last line is it.
   printf '%s\n' "$requests" | grep -c .
   ```
2. **Request one yourself only when the rule did not — and never over a request
   already standing.** A push landing while an earlier head's review is still to
   post gets its request from the rule the moment it does, and not before: until
   then a head with no `review_requested` of its own is waiting rather than skipped,
   and a request placed meanwhile leaves no event of its own. So hold while
   Copilot's latest move (*Is Copilot even in the loop?*) is `review_requested`.

   **What tells a skipped head from a waiting one is the watch, never the checks.**
   The rule registers its request well before CI finishes, so settled checks with no
   request are the rule skipping this head — a force-push after a review has already
   posted is the known case — or a repository without the rule at all. But where the
   hold above was in force, those checks settled while the earlier review was being
   written and say nothing about this head: restart step 1's watch from the moment
   the hold released, and give the rule the seconds its deferred request takes. A
   request of your own goes only to a head whose watch stays empty past that. Take
   step 1's reading first, then place it:
   ```bash
   # The login the reviews surface carries, `[bot]` and all — not the `Copilot` the
   # timeline reads back.
   gh api --silent -X POST repos/{owner}/{repo}/pulls/<pr>/requested_reviewers \
     -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
   ```
   **Then confirm it registered — what the call answers with cannot say.** The
   request is placed once step 1's reading carries one more than it did before the
   call; a call that registered nothing exits 0 and answers with the same pull
   request, and the request list reads empty either way. Registering takes its own
   moment, so a reading that has not grown is "not yet" until the first of step 5's
   windows is out — and one that has not grown by the end of that window is no
   request, whatever the call returned: step 5's case of nothing left to wait on. **A request placed while one
   is pending, or after the head's review has posted, buys a second review of the
   same commit** — one more set of threads to answer, and, placed late enough, a
   review that lands after the merge with its findings orphaned on a closed pull
   request. It never buys a faster one.
3. **Wait until it settles**, which is one of exactly two things: a Copilot review
   whose `commit_id == $head`, or a `review_request_removed` with no such review — a
   decline, which the report says out loud rather than implying it reviewed. Nothing
   else settles it: a request stands until its review posts, and a
   `copilot_work_finished_failure` along the way does not end it — the review that
   run was writing still posts.
4. **A review of an earlier commit is not a decline.** It consumes the request and
   leaves the head unreviewed, so re-request — step 2's case, on step 2's terms —
   and keep waiting. Elapsed time settles nothing: while Copilot's latest move is
   `review_requested`, hold — in the windows and up to the ceiling of step 5 — and
   say the head review is outstanding.
5. **The wait runs, and runs out, the way a review run's does.** It is waited on
   in the blocking windows of
   [`../../../references/review-runs.md`](../../../references/review-runs.md),
   spent on what does not depend on it — the loop's live-state read, its drift
   measure — and it runs out at that file's ceiling, counted from the
   `review_requested` being waited on — this head's own, or the one still
   standing from an earlier head, whose time the latest-move read carries —
   rather than from the push; or at once where nothing is left to wait on: no
   request standing on this head and none this driver can place — step 2's
   request that registered nothing. Running out is a stop,
   not a verdict: record the head as unreviewed by this reviewer, and stop at the
   addressee `merge-auth` names, recommendation first — another window,
   re-request and wait again, or merge with the head unreviewed by Copilot and
   say so in the report. The clock decides none of that; the addressee does.

**Merge only once the head's review has settled** — or the ceiling above was
reached and the addressee said to merge past it. Nothing the repository enforces
can be relied on to hold the merge for it: a status check standing in for the
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

Read the body of **every** review on the head you are handing in — several runs can
review one commit, and a later one carries findings the earlier one did not:

```bash
HEAD_SHA="$(gh pr view <pr> --json headRefOid --jq .headRefOid)"
# Unset it and the filter below keeps every review ever posted — an old head's
# suppressed block then reads as this head's finding, said by an empty variable
[ -n "$HEAD_SHA" ] || { echo "HEAD SHA UNREAD — the bodies are unread, not clean"; exit 1; }
export HEAD_SHA
gh api --paginate repos/{owner}/{repo}/pulls/<pr>/reviews \
  --jq '.[] | select((.user.type? // "") == "Bot" and ((.user.login? // "") | test("^copilot"; "i")))
        | select(.commit_id == env.HEAD_SHA)
        # markup stripped before either count is read: both labels arrive as a heading
        # or a bold run as often as plain text, and GitHub may reword either of them
        | ((.body? // "") | gsub("<[^>]*>"; " ") | gsub("[*_#]"; " ")) as $b
        | {at: .submitted_at, state,
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
push where one is still to come and taking the re-review wait that push costs.
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
  re-review wait, and, where the base dismisses stale reviews on push, the approval
  standing on the head it leaves behind.
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

The end-of-session report (main skill Step 7) states the verdict Copilot left **on
the head that merged** — the state that review actually carries, whichever it is —
and the effort level each of its runs went at. The verdict is the `state` of the
review whose `commit_id` is that head, which is why the head is read first: `headRefOid` survives both the merge and
the deletion of the branch, so this works after Step 6 as well as before it.

```bash
HEAD_SHA="$(gh pr view <pr> --json headRefOid --jq .headRefOid)"
# Unset it and every row below reads `head: false` — "no verdict on the merged
# head", said by a variable that never got a value rather than by the PR.
[ -n "$HEAD_SHA" ] || { echo "HEAD SHA UNREAD — report no verdict"; exit 1; }
export HEAD_SHA
gh api --paginate repos/{owner}/{repo}/pulls/<pr>/reviews \
  --jq '.[] | select((.user.type? // "") == "Bot" and ((.user.login? // "") | test("^copilot"; "i")))
        | (((.body? // "") | split("\n")
             # stripped before the line is picked: the label is a table cell or a bold run as often as a bullet
             | map(gsub("<[^>]*>"; " ") | gsub("\\*"; " "))
             # per line, anchored: prose naming a level otherwise wins, and a pattern crossing non-word characters walks through the newline into the next line
             | map(select(test("^[^A-Za-z0-9]*(review )?effort level"; "i")))
             | last) // "") as $line
        | {state, head: (.commit_id == env.HEAD_SHA),
           # `// ""` and not the `?`: capture yields NOTHING here rather than raising, and without it the object is never built — the review vanishes from the report instead of arriving with no level
           effort: (($line | capture("effort level[^A-Za-z0-9]*(?<v>[A-Za-z][A-Za-z0-9 _-]*)"; "i").v // "")
                    | gsub("^\\s+|\\s+$"; "")),
           effort_line: ($line | gsub("^\\s+|\\s+$"; ""))} | @json'
```

Report the label verbatim, whatever word it holds — the set of levels is GitHub's
to extend, and a level you translate into a familiar one is a level you invented.
An empty `effort` beside an empty `effort_line` is a review that named no level;
an empty one beside a non-empty line is a label this filter could not read — say
which of the two it was, and never fill in a default for either.

**`head: true` is a row count, not a verdict, and both of its other counts
happen.** No such row has three causes and they take different steps: a review
still outstanding — Copilot's latest move on the timeline is what tells that one,
and after a merge it is the late review the main skill's Step 7 goes back for — a
request that declined, or a repository Copilot is out of. Report which of the
three it was; never a verdict borrowed from an earlier head's row.
Several mean several runs reviewed the same commit, which is what a re-requested
review buys; the verdict is the last of them — the rows come back in the order
they were published — and every run still contributes its own effort level to the
line.
