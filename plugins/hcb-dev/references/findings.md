# A finding, and what to do with it

Read wherever work turns up a finding — a reviewer that reported one, a step that
noticed it while editing something else, a completion that ran past it. A finding
on the code the work is writing and one noticed in passing are both here: this
file owns how a finding is rated, whether it is fixed in the work that found it,
and, for what is left, everything between noticing and the tracker — so one
finding gets the same treatment whichever skill found it. The tracker operations
themselves — searching, the issue body, hierarchy, closing — belong to
`hcb-dev:issue-tracking`.

Two questions decide everything below, in this order: **is it fixed here** — how
much it matters, whether it belongs to the work in hand, and what the fix costs
against the record of it — and, for what is not fixed, **what record it leaves**.
Every finding ends in one of the outcomes this file closes on.

## How much it matters

- **Critical** — security vulnerabilities, data loss or corruption, crashes,
  auth/permission flaws, secrets exposure, broken core behaviour.
- **Important** — real logic bugs, incorrect results in plausible cases,
  significant performance problems, resource leaks, missing error handling on a
  likely path, API/contract mistakes.
- **Minor** — style, naming, formatting, subjective readability, "consider"
  suggestions carrying no concrete defect, speculative edge cases that cannot
  occur.

**On the code this work is writing, doubt between Important and Minor resolves
upward.** Anywhere else it resolves by consequence: name what observably breaks
if this is never fixed, and where nothing does, it is Minor. Where the reviewer
rated the finding itself, take its rating; reading a rating back out of an engine
is that engine's skill's own business.

## Whether it belongs to the work in hand

A finding on the code this work is writing belongs to it, and is not weighed
against scope at all. For anything else the reviewers happened to read, five
conditions, all of which have to hold:

- **It would have been in scope had it been seen earlier.** The test is the
  planning gate: named while this work was being scoped, would it have gone in?
  The same defect one line over, the other half of the rename, the case the new
  branch forgot — yes. Another subsystem, another kind of problem, something that
  shares only a file — no.
- **Nothing is being decided.** The fix is mechanical, or has one
  obviously-correct form. Where two shapes are both defensible it is an
  architectural fork ([`architecture-decisions.md`](architecture-decisions.md) §1),
  and a fork is not a drive-by.
- **Intended behaviour stays intended.** What the code is *meant* to do is the
  user's call, whatever it currently does.
- **It fits inside the review already coming.** A fix wanting a reading of its
  own — a new surface, a migration, a slice's worth of work — is its own work,
  however plainly the thing is broken.
- **The ground is yours.** Another slice in flight, another worktree's checkout, a
  vendored tree: not yours to edit, whatever is wrong in it.

A finding that is simply **wrong** is neither fixed nor surfaced: say why it does
not hold, and move on. A fork does not go below either — §1 routes that one, and
where it is genuinely unforeseen the route is stopping the run, not filing it.
Everything else that fails a condition surfaces.

## Cheaper to do than to record

A fix that costs less than the record of it is done rather than written down: a
scope condition that turned it down does not send it to the tracker by itself.

**It lifts two of the five conditions, and only those.** *Would have been in
scope* and *fits inside the review already coming* are what it answers — they say
the fix does not belong to this work, which is no reason to spend an entry on
something a few lines settle. *Nothing is being decided*, *intended behaviour
stays intended* and *the ground is yours* stand as written: a fork is still a
fork, the user's call is still theirs, and ground that is not yours sends it to
**HAND OVER** rather than to your commit.

The measure is the fix — a few lines with one obviously-correct form. On your own
ground it rides a commit of its own. Where it falls outside the range the
reviewers read, it is **proposed** as a fix rather than made, so nothing lands
that no review covered.

## What record it leaves

Everything from here decides where a finding that was **not** fixed is written
down. None of it reaches back into the fix: what this work is obliged to fix, it
fixes, whatever the sections below say about the record.

### One finding, or one of many

Count before deciding anything else. Where several findings share a mechanism —
distinct defects, each real, one cause — what is recorded is the mechanism, its
instances listed under it, never one entry per instance. Where a gate could hold
that mechanism, the gate is what is recorded and the instances are its evidence —
the instances are still fixed on whatever terms they were owed. A repeat of a
finding already ruled on is not this case; it is the one under *The same finding
twice*.

### Where it came from

A finding turned up while working on an issue, or in a review of the change that
closes one, is measured against that issue **before any search by words**. The
same mechanism, or a consequence of the fix just made, is recorded on that issue —
as a comment, and reopened where this run is what closed it. A different mechanism
is recorded on its own.

### Worth remembering

Everything below `Critical` passes this before it is proposed for a number of its
own. Three questions, and one *yes* ends it:

- **Does it come back on its own?** Where whatever makes it matter will trip a
  gate, a test, a review or a person again, an entry adds nothing.
- **Is it cheap to derive again?** Where it is a grep away from whoever next
  needs it, the entry costs more than it saves.
- **Does nothing observable follow from leaving it?** An observation with no
  consequence is not deferred work.

What survives says, in one sentence, what it costs to never do it — the sentence
**OPEN** carries. `Critical` skips the three questions, not the sentence. Where
it cannot be written, the finding is **DROP**.

## The outcomes

Every finding ends in exactly one, named when it is proposed:

| outcome | what it means |
|---|---|
| **FIX** | done in this work — no proposal, no number |
| **HAND OVER** | the ground is someone else's: it reaches whoever holds it, on their change |
| **INTO #N** | an issue already carries this mechanism — a comment, or an update where it adds facts |
| **OPEN** | a number of its own, carrying what says when to come back to it and, in one sentence, what it costs to never do it |
| **DROP** | nothing written to the tracker: named with its reason, in the report where the run writes one |

`Critical` and `Important` on the code this work is writing are **FIX**, before
the work completes and blocking completion until they are. `Minor` on that code
is **FIX** where the fix rides a reading happening anyway, and **DROP** otherwise.
Out of scope, severity decides how loudly a finding travels rather than whether:
one severe enough may stop the run instead of being carried.

## Ranked, not enumerated

Candidates out of one run are ranked against each other, not listed in the order
they were found. `Critical` never enters that ranking — it travels whatever else
does. Where the order or the user set a budget, a further candidate enters only by
naming the one it outranks, and the one displaced is **still named** in what the
run hands over, carrying **DROP** as its proposal and the displacement as its
reason — so the pass that rules them sees what a budget pushed out rather than
inheriting a list already cut.

## Decided cold

Where something other than this run rules its candidates — an order's addressee, a
master session, the user — a candidate is not decided in the response that found
it. It travels with its proposed outcome and waits for the pass that reads the
run's candidates together, against each other and against what the tracker already
holds; whoever decides is then not whoever found it. Where no such authority
stands over the run, the run's own end is that pass, and the candidates are read
together there rather than one at a time.

**Fixing never waits for it.** **FIX** and **HAND OVER** are the work's own,
settled where the finding is found, and a `Critical` or `Important` on the code
this work is writing is fixed without asking anyone.

## The same finding twice

A finding is identified by `(file, line)` **and** by mechanism — the key
`hcb-dev:multi-review` dedupes on, since reviewers routinely anchor one root cause
at different lines. One a run has already ruled on is not a new finding: it earns
no second reading and blocks nothing. The outcome it was given stands; where it
was **FIX** and a reviewer reports it again, the fix is what to check.

## A drive-by fix is its own commit

A fix that is not what the change set out to make — as against a fix to the code
this change is writing, which is just the work — never rides inside another
commit, and never shares one with a second drive-by.

- **Its subject** — [`branch-naming.md`](branch-naming.md) owns what a passenger
  commit is called.
- **Commits, not pushes.** Where a push costs a re-review round they still go up
  together; it is the history that stays separate, not the round trips.
- **Notice it before the reviewers run**, so it sits inside the range they read.
  One noticed after they have reported is fixed only where it falls inside that
  range; outside it, it surfaces instead.
- **Where the merge collapses the commits, name the fix in the message it
  leaves** ([`merge-message.md`](merge-message.md)) — and in the change-request
  body that message is written from, where there is one. A slice always squashes
  and a standalone request usually does
  ([`slice-completion.md`](slice-completion.md)). A merge keeping the commits
  carries it already.

A fix is not surfaced as a finding — no proposal, no issue. It is done, and the
commit and that line are its record.

## What surfaces instead

Everything left unfixed that the next reader would want: a defect left alone, a
test not written, a duplication, a TODO, an assumption that did not hold.

## Prepare the proposal before making it

Both of these happen before the finding is proposed, not after it is accepted:

- **Search the tracker**, closed entries included
  ([`../skills/issue-tracking/SKILL.md`](../skills/issue-tracking/SKILL.md)) — it
  runs on what the lineage above leaves, and its result decides which of the three
  states below applies.
- **Read the repository's own classification**
  ([`classification.md`](classification.md)),
  once for the run rather than once per finding, so the proposal already carries
  what it would be opened with. Where a role has no vocabulary here, name the role
  and offer nothing for it.

Where there is no tracker to reach — no remote at all, or none a forge answers
for — neither is possible, and the finding still surfaces: as an observation with
no proposal attached, saying there is nowhere to file it.

## The form

Under `## Out-of-scope observations`, at the end of the response that did not fix
it, wherever that response lands — proposing the outcome, which is decided where
*Decided cold* says it is. Under an orchestrator it does not: the
finding rides its slice's `incidental` output
([`slice-completion.md`](slice-completion.md)) to the run's own report, and an
autonomous run is never interrupted to ask. One line each:

- **untracked** → what it is and where, the classification it would carry, the
  rating it arrived with where a review gave it one
  ([`report-format.md`](report-format.md)), and what it costs to never do it —
  then the outcome proposed for it;
- **tracked, and the finding adds something** → `#N` and what changes, then
  **INTO #N** or **DROP**;
- **tracked as it stands** → no entry; say so where it came up.

A line in a report is not this. Naming a finding among the things left undone
records it; it does not put the decision to anyone, and a finding recorded that
way ends with the response.

## Only the authorized answer writes to the tracker

The answer is the user's, and where this session works to an order — one written
by another session, whatever carried it here — it is whoever that order names
**for writing to the tracker**; an addressee it names for its forks is not that,
and an order naming none leaves the user. Opening or updating anything waits for
it, every time. **A standing instruction to work autonomously is not that
answer** — it authorizes the work, not the tracker — and an approval covers the
batch it was given for, never what turns up afterwards.

Where no answer comes, the finding stays undecided rather than dropped:
re-surface it at the natural end of the session, once the primary work is done.
