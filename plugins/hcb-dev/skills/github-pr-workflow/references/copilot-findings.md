# What a Copilot review said, and what to do with it

Read once a review of the current head is in hand — [`copilot.md`](copilot.md) owns whether one
is, and what it lands as. This file owns the two places a review puts its findings, how they are
rated, and what closes each one out.

## Two readings, not one

A review puts its findings in **two** places, and only one opens threads. Both are read every
round: one alone is half the review, and the half it drops is the half nothing else catches — a
finding in the suppressed block has no thread, so `required_review_thread_resolution` does not
hold it and a check that unresolved threads are zero reads a clean field while it stands.

`scripts/copilot-findings.mjs` does both readings and says what is still owed. It reads;
replying and resolving are this file's too, and a reply folded into the reading is sent before the
reading is believed.

```text
node <plugin root>/scripts/copilot-findings.mjs --pr <n> [--repo <owner/name>] [--me <login>]
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
| `bodies.items[]` | one per review this reviewer posted, whichever commit it covers, with `state`, `head`, `opening` and the `body` itself |
| `bodies.items[].suppressed` | the block's own count of the findings that opened no thread, taken with the body's quoted code left out — **the checksum a reading is held to**: the thread-less findings you classify from the body number exactly this, and where they do not, the body is read again. **`null` is "no such block", never zero**, and `null` beside `ambiguous` is a count that could not be pinned — a reading with nothing to check it against, never a body to skip |
| `bodies.items[].opened` | what the review OPENED, a count of threads and never of findings: a review whose findings all went to the suppressed block opened none, so zero there is that class's signature rather than evidence against it. It holds whatever the verdict says — an approving review carries a suppressed block as readily as a declining one |
| `bodies.items[].unrecognised` | what of the body this could not account for — none of the labels it reads, a counted block it has no name for, findings outside any block it read — and `null` where it accounted for all of it. Not `null` is a layout that may have moved ([`../../../references/invariants.md`](../../../references/invariants.md), *An unrecognised shape is not an empty one*): its count checks nothing, and the report names the review (`copilot.md`) |
| `open[]` | every thread still owed something, each carrying the `why` that says which state it is in |
| `notes[]` | what the answer says beyond its fields. One naming a bot this does not take for Copilot is read before `open` is believed: where that bot is Copilot under a new login, its threads and its body are owed as this reviewer's are, and nothing here counted them |

A suppressed finding carries no comment id, so there is no thread to answer in and none to
resolve — it ends in the fix, and is named, fixed or turned down with its reason, in the pull
request's conversation, which is where the reply protocol below would otherwise have put it. A `truncated`
flag beside a body or a comment says the text was clipped; nothing else is lossy.

**Every body this reviewer posted that the pull request's conversation is silent about is read
whole**, whatever the fields beside it say: they count what a body carries and never decide
whether it is read. Every review this reviewer ever posted is in the answer, so a body settled
three pushes ago still carries its findings. What settles one is the conversation, which this
does not read: **a body whose findings the conversation already names was read in an earlier
round**, and re-classifying it posts the same answers again every iteration.

**The head's review also says what it did not review** — the body whose `head` is `true`. The
files it skipped are files nobody reviewed on the head: read them against the change, and name in
the report every one that is code this change writes. Where it reviewed no file at all, the head
is unreviewed by this reviewer — the stop `copilot.md` takes where a wait runs out, never the
exit. A review of an earlier commit says neither about the head.

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
