# What a Copilot review said, and what to do with it

Read once a review of the current head is in hand — [`copilot.md`](copilot.md) owns whether one
is, and what it lands as. This file owns where a review puts its findings, how they are rated,
and what closes each one out.

## Finding the findings

A review speaks in its **threads** and in its **body**, and only the threads are held by anything:
a finding in the body has no thread, so `required_review_thread_resolution` does not hold it and a
check that unresolved threads are zero reads a clean field while it stands. Both are read every
round.

`scripts/copilot-findings.mjs` collects both — every thread, every body whole — and says which
threads are still owed. It reads; replying and resolving are this file's too, and a reply folded
into the reading is sent before the reading is believed. What a body says is yours to read: the
script hands it over uninterpreted.

```text
node "<plugin root>/scripts/copilot-findings.mjs" --pr <n> [--repo <owner/name>] [--me <login>]
```

`--me` where the token cannot read its own user — a repository's `GITHUB_TOKEN` and an App
installation token both answer 403 to `/user`. Without it `me` is `null`, no comment counts as
ours, and every thread stays owed for the life of the run.

| field | what it settles |
|---|---|
| `read` | **both halves answered.** Either half alone is half a review, and `false` here says so however much is in the answer |
| `me` | who this run is authenticated as, which is what "answered" is measured against. `null` leaves every thread owed |
| `threads.items[]` | one per review thread: `resolved`, `outdated`, `resolvedBy`, `byReviewer`, the `path` and `line`, and each comment with the `id` a reply is posted to |
| `threads.items[].answered` | whether a comment of **ours** follows the reviewer's LAST word. Anyone at all can reply in a thread, so a reply is ours by identity and an answer by position; `othersSpoke` beside it is a third party having attended to the thread, which is not an answer to the finding. `null` where that thread's own comments paginated, which owes exactly as much as no answer does |
| `bodies.items[]` | one per review this reviewer posted, whichever commit it covers, with `state`, `head` and the `body` itself, whole. `body: null` is the feed carrying no body at all — a note says so — never a review that said nothing |
| `open[]` | every thread still owed something, each carrying the `why` that says which state it is in |
| `notes[]` | what the answer says beyond its fields. One naming a bot this does not take for Copilot is read before `open` is believed: where that bot is Copilot under a new login, its threads and its body are owed as this reviewer's are, and nothing here counted them |

A `truncated` flag beside a comment says its text was clipped; a body comes back whole, and
nothing else is lossy.

**Every body this reviewer posted that the pull request's conversation is silent about is read
whole.** Every review this reviewer ever posted is in the answer, so a body settled three pushes
ago still carries its findings. What settles one is the conversation, which the script does not
read: **a body whose findings the conversation already names was read in an earlier round**, and
re-classifying it posts the same answers again every iteration.

**A body's findings are wherever it asserts a defect.** The layout is published nowhere and moves
([`../../../references/forge-behaviour.md`](../../../references/forge-behaviour.md) carries the
ones measured), so where findings have been seen is a guide, never the list:

- **the sentence under the heading.** A claim about a defect there is a finding of its own — a
  body counting no new comments carries one there as readily as any, and often nothing else;
- **a counted block** of comments that opened no thread, each under its path and line;
- **anything else** in the body that asserts a defect. A body you cannot place in any layout you
  know is read as prose all the same, and named in the end-of-session report
  ([`../../../references/invariants.md`](../../../references/invariants.md), *An unrecognised
  shape is not an empty one*).

**Write the reading down.** For each body read, list its findings — where each sits, what it is
about, and what became of it: fixed and where, already gone at the head, turned down with its
reason, or the thread it repeats. A finding in a body carries no comment id, so there is no thread
to answer in and none to resolve: the list goes to the pull request's conversation — with the push
that settles it, or on its own where nothing is pushed — which is where the reply protocol below
would otherwise have put it, and it is what the next round finds there. A count a body states is
never the length of that list: it counts one of the places, not the body.

**The head's review also says what it did not review** — the newest body whose `head` is `true`
among those that ran: a review that could not run says nothing about a commit another review of it
covered, whichever came first. It says so in two places: a block naming the files it did not
review, and a count of files reviewed against files changed. Files it names are read against the
change. Where the count comes up short and nothing names the files, which ones went unreviewed is
unknown: read every changed file that is code this change writes against the change, the largest
diffs first (`forge-behaviour.md`), rather than a guess at which ones they were. The end-of-session
report names the shortfall, and the files it named that are code this change writes. Where it
reviewed no file at all — a count of none, or every review of it saying it could not run — the head
is unreviewed by this reviewer: the stop `copilot.md` takes where a wait runs out, never the exit.
A review of an earlier commit says neither about the head.

**The end-of-session report carries, for the head's review**, the files-reviewed count and the
effort level its body states — the level as a fact about that round, never as grounds for any step.

## Classifying, fixing, replying

The ladder and what each tier costs are
[`../../../references/findings.md`](../../../references/findings.md)'s. What is this reviewer's
own: **Copilot does not tag severity consistently** — where it labels a finding, take the label;
otherwise rate it yourself by that reference. **Critical** and **Important** are fixed in the
loop unconditionally. A `Minor` goes through that same reference and whatever passes is fixed
here too, riding the next substantive push where one is still to come; what a `Minor` never does
is spend the loop's iteration budget, which is for what blocks the exit. Only what the reference
turns down goes into the end-of-session report, under its category.

**A push that would spend a standing approval is a fork, not a cost.** Where the base dismisses
stale reviews on push and that approval is what closes its approval requirement, the next push
takes the approval with it, and nothing says the next review gives it back. A `Critical` or
`Important` is fixed and the approval spent — nothing is being weighed, merging it was never on
the table. **A `Minor` the reference routes to a fix is the fork proper**, and not the loop's to
settle: put both sides to the addressee `merge-auth` names, recommendation first — spend the
approval on the nit, or turn the finding down here, answered and resolved where it opened a
thread and in the report either way. Three things collapse the fork, any one alone and each read
rather than assumed: the base does not dismiss stale reviews on push; the standing approval does
not close the base's approval requirement; or a substantive push is coming anyway.

**What you *fix* and what you *resolve* are different questions.** A thread this reviewer opened
ends resolved once it has its answer — the fix is in, or the finding was turned down with its
reason — whatever the rating decided; where the repo requires all threads resolved, a left-open
nit blocks the merge as hard as a Critical one.

Fixing: address the root cause, not the symptom pointed at. **Where a round comes back to prose
rather than to behaviour, cut the surface instead of rewording it** — text a change does not
require is text that can drift, and the reviewer keeps finding it however carefully it is
rephrased. Focused commits, and batch them into as few pushes as is reasonable: each push costs
another review wait where a rule reviews pushes, and the approval standing on the head it leaves
behind where the base dismisses stale reviews.

**Every Copilot comment gets a reply**, fixed or skipped — what changed and where, or the reason
it is out of scope or not a defect — and then the thread is resolved, where the comment sits in
one, so the review state says what was settled rather than what the repo happens to enforce. A
review summary carries no thread and needs no resolving.

**A thread this reviewer resolved is not by itself an answered thread**, and *Finding the
findings* tells the two apart: `byReviewer` says it closed its own, `answered` says whether a
reply of ours follows its last word, and each entry in `open` names which state it is in.
`resolvedBy` is typed as a plain user and carries no field distinguishing a bot from a person,
so that one match is by login prefix alone — the single place the pair does not apply. A resolve
lands *after* the reply, so a list taken as you answer is already stale: **retake it on the head
you hand in** rather than answering twice.

```bash
# reply to a review comment thread:
gh api repos/{owner}/{repo}/pulls/<pr>/comments/<comment_id>/replies -f body="<reply text>"
# resolve a thread (GraphQL mutation):
gh api graphql -f query='
  mutation($threadId:ID!){ resolveReviewThread(input:{threadId:$threadId}){ thread{ isResolved } } }' \
  -F threadId=<thread_node_id>
```
