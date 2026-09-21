# A finding, and what to do with it

Read wherever work turns up a finding — a reviewer that reported one, a step that noticed it while
editing something else, a completion that ran past it. This file owns how a finding is rated and
everything between noticing it and the tracker, so one gets the same treatment whichever skill
found it; the tracker operations are `hcb-dev:issue-tracking`'s. Two questions, in order: **is it
fixed here**, and for what is not, **what record it leaves**.

## How much it matters

- **Critical** — security vulnerabilities, data loss or corruption, crashes, auth/permission
  flaws, secrets exposure, broken core behaviour.
- **Important** — real logic bugs, wrong results in plausible cases, significant performance
  problems, resource leaks, missing error handling on a likely path, API/contract mistakes.
- **Minor** — style, naming, formatting, subjective readability, "consider" suggestions carrying
  no concrete defect, speculative edge cases that cannot occur.

**On the code this work is writing, doubt between Important and Minor resolves upward**;
anywhere else by consequence — name what observably breaks if this is never fixed, and where
nothing does, it is Minor. Where the reviewer rated the finding, take its rating.

## Whether it belongs to the work in hand

A finding on the code this work is writing belongs to it and is not weighed against scope at all.
For anything else the reviewers happened to read, five conditions, **all** of which hold:

| condition | what fails it |
|---|---|
| **it would have been in scope had it been seen earlier** — the test is the planning gate | another subsystem, another kind of problem, something sharing only a file. The same defect one line over, the other half of the rename, the case the new branch forgot: in scope |
| **nothing is being decided** — the fix is mechanical, or has one obviously-correct form | two defensible shapes, which is an architectural fork ([`architecture-decisions.md`](architecture-decisions.md) §1), and a fork is not a drive-by |
| **intended behaviour stays intended** | what the code is *meant* to do, which is the user's call whatever it currently does |
| **it fits inside the review already coming** | a fix wanting a reading of its own — a new surface, a migration, a slice's worth of work — however plainly the thing is broken |
| **the ground is yours** | another slice in flight, another worktree's checkout, a vendored tree |

A finding that is simply **wrong** is neither fixed nor surfaced: say why it does not hold and
move on. A fork does not go below either — §1 routes it, and where it is genuinely unforeseen the
route is stopping the run, not filing it. Everything else failing a condition surfaces.

**A fix costing less than the record of it is done rather than written down**, which lifts the
first and fourth conditions and only those — the two saying the fix does not belong to this work,
no reason to spend an entry on what a few lines settle. A fork is still a fork, the user's call
still theirs, and ground that is not yours sends it to **HAND OVER** rather than to your commit.
The measure is the fix: a few lines with one obviously-correct form, **proposed** rather than
made where it falls outside the range the reviewers read.

## What record it leaves

Everything below decides where a finding that was **not** fixed is written down; none of it
reaches back into the fix, which this work owes whatever the record says.

**Count before deciding anything else.** Where several findings share a mechanism — distinct
defects, each real, one cause — the mechanism is what is recorded, instances listed under it,
never one entry each; where a gate could hold that mechanism, the gate is recorded and the
instances are its evidence. They are still fixed on whatever terms they were owed. A repeat of a
finding already ruled on is *The same finding twice*, below.
**Where it came from decides what it is measured against.** One turned up while working on an
issue, or reviewing the change that closes it, is measured against that issue **before any search
by words**: the same mechanism, or a consequence of the fix just made, belongs to it, and where
that is recorded follows the issue's own state. A different mechanism is recorded on its own.

**Worth remembering.** Everything below `Critical` passes this before it earns a number of its
own. Three questions, one *yes* ending it: does it come back on its own, tripping a gate, a test,
a review or a person again? Is it cheap to derive again? Does nothing observable follow from
leaving it? What survives says in one sentence what it costs to never do it — the sentence
**OPEN** carries. `Critical` skips the questions, not the sentence; where it cannot be written,
the finding is **DROP**.

Every finding then ends in exactly one outcome, named when it is proposed:

| outcome | what it means |
|---|---|
| **FIX** | done in this work — no proposal, no number |
| **HAND OVER** | the ground is someone else's: it reaches whoever holds it, on their change |
| **INTO #N** | an issue already carries this mechanism — a comment, or an update where it adds facts — and is open, or reopened by it where `hcb-dev:issue-tracking` rules a closed one so |
| **OPEN** | a number of its own, carrying what says when to come back to it and, in one sentence, what it costs to never do it |
| **DROP** | nothing written to the tracker: named with its reason, in the report where the run writes one |

`Critical` and `Important` on the code this work is writing are **FIX**, blocking completion until
they are; `Minor` on that code is **FIX** where the fix rides a reading happening anyway and
**DROP** otherwise. Out of scope, severity decides how loudly a finding travels rather than
whether — one severe enough may stop the run instead of being carried.

**Ranked, not enumerated.** Candidates out of one run are ranked against each other, never listed
in the order found, and `Critical` never enters that ranking: it travels whatever else does. Under
a budget a further candidate enters only by naming the one it outranks, and the displaced one is
**still named**, carrying **DROP** and the displacement as its reason — so the pass that rules
them sees what the budget pushed out rather than a list already cut.
**Decided cold.** Where something other than this run rules its candidates — an order's
addressee, a master session, the user — a candidate is not decided in the response that found
it: it travels with its proposed outcome and waits for the pass reading the run's candidates
together, against each other and against what the tracker holds. Absent such an authority, the
run's own end is that pass. That pass is `hcb-dev:findings-pass`, and it **verifies before it
rules**: every candidate re-measured by a check that never saw the finder's argument. **Fixing
never waits for it**: **FIX** and **HAND OVER** are settled where the finding is found.

**The same finding twice.** A finding is identified by `(file, line)` **and** by mechanism, the key
`hcb-dev:multi-review` dedupes on, since reviewers routinely anchor one root cause at different
lines. One a run has already ruled on earns no second reading and blocks nothing: the outcome
stands, and where that was **FIX** and a reviewer reports it again, the fix is what to check.

## A drive-by fix is its own commit

A fix that is not what the change set out to make — as against a fix to the code this change is
writing, which is just the work — never rides inside another commit, and never shares one with a
second drive-by. [`branch-naming.md`](branch-naming.md) owns what a passenger commit is called.
Commits, not pushes: where a push costs a re-review round they still go up together, the history
being what stays separate. **Notice it before the reviewers run**, so it sits inside the range
they read — one noticed after they report is fixed only where it falls inside that range, and
surfaces otherwise. **Where the merge collapses the commits, name the fix in the message it
leaves** ([`merge-message.md`](merge-message.md)), and in the change-request body that message is
written from; a merge keeping the commits carries it already.

A fix is not surfaced as a finding: the commit and that line are its record. What surfaces is
everything left unfixed that the next reader would want.

## Proposing what is left

Three things happen before the finding is proposed, never after it is accepted:

- **Search the tracker**, closed entries included (`hcb-dev:issue-tracking`) — its result decides
  the outcome: **INTO** the issue already carrying the mechanism, **DROP** where one carries it as
  it stands, a record of its own where none does.
- **Re-measure it** at its coordinate on the tree the work stands on — the base where the code is
  already in it, the branch carrying it where it is not — with whatever will judge it there. In
  the pass that rules it, this is its verification.
- **Read the repository's own classification** ([`classification.md`](classification.md)), once
  for the run rather than once per finding. Where a role has no vocabulary there, name the role
  and offer nothing for it.

With no tracker to reach the search is impossible and the classification reaches only what the
project states, while the re-measure still runs: the finding surfaces as an observation with no
proposal, saying there is nowhere to file it.

What is proposed is shown in the table [`findings-table.md`](findings-table.md) fixes, at the end
of the response that did not fix it, each row carrying the outcome *Decided cold* rules. Under an
orchestrator it does not: the finding rides its slice's `incidental` output to the run's own
report, and an autonomous run is never interrupted to ask.

**Who authorizes a tracker write, and what answers count as one**, is the skill that does the
writing: `hcb-dev:issue-tracking`. Where no answer comes the finding stays undecided
rather than dropped — re-surface it at the natural end of the session, once the primary work is
done.
