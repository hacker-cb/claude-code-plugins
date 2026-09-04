# A finding, and what to do with it

Read wherever work turns up a finding — a reviewer that reported one, a step that
noticed it while editing something else, a completion that ran past it. A finding
on the code the work is writing and one noticed in passing are both here: this
file owns how a finding is rated, whether it is fixed in the work that found it,
and, for what is left, everything between noticing and the tracker — so one
finding gets the same treatment whichever skill found it. The tracker operations
themselves — searching, the issue body, hierarchy, closing — belong to
`hcb-dev:issue-tracking`.

Two questions decide everything below: **how much it matters**, and **whether it
belongs to the work in hand**.

## How much it matters

- **Critical** — security vulnerabilities, data loss or corruption, crashes,
  auth/permission flaws, secrets exposure, broken core behaviour.
- **Important** — real logic bugs, incorrect results in plausible cases,
  significant performance problems, resource leaks, missing error handling on a
  likely path, API/contract mistakes.
- **Minor** — style, naming, formatting, subjective readability, "consider"
  suggestions carrying no concrete defect, speculative edge cases that cannot
  occur.

**When in doubt between Important and Minor, treat it as Important.** Where the
reviewer rated the finding itself, take its rating; reading a rating back out of
an engine is that engine's skill's own business.

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

## What the two answers decide

| | `Critical` / `Important` | `Minor` |
|---|---|---|
| **belongs** | fixed before the work completes, and blocks completion until it is | fixed where the fix rides a reading happening anyway; on its own it never earns one, and left unfixed it goes to the report |
| **does not** | surfaced as a proposal — and severe enough that a run may stop on it rather than carry it | surfaced as a proposal, or named as noise with the reason |

## The same finding twice

A finding is identified by `(file, line)` **and** by mechanism — the key
`hcb-dev:multi-review` dedupes on, since reviewers routinely anchor one root cause
at different lines. One a run has already ruled on is not a new finding: it earns
no second reading and blocks nothing. Where it was deferred it stays deferred;
where it was fixed and a reviewer reports it again, the fix is what to check.

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
- **Where the merge collapses the commits, name the fix in the change-request
  body** and in the squash message written from it. A slice always squashes and a
  standalone request usually does
  ([`slice-completion.md`](slice-completion.md)). A merge keeping the commits
  carries it already.

A fix is not surfaced as a finding — no proposal, no issue. It is done, and the
commit and that line are its record.

## What surfaces instead

Everything a condition above turned down, and the next reader would want: a defect
left alone, a test not written, a duplication, a TODO, an assumption that did not
hold.

## Prepare the proposal before making it

Both of these happen before the finding is proposed, not after it is accepted:

- **Search the tracker**, closed entries included
  ([`../skills/issue-tracking/SKILL.md`](../skills/issue-tracking/SKILL.md)) — its
  result decides which of the three states below applies.
- **Read the repository's own classification**
  ([`classification.md`](classification.md)),
  once for the run rather than once per finding, so the proposal already carries
  what it would be opened with. Where a role has no vocabulary here, name the role
  and offer nothing for it.

Where there is no tracker to reach — no remote at all, or none a forge answers
for — neither is possible, and the finding still surfaces: as an observation with
no proposal attached, saying there is nowhere to file it.

## The form

Under `## Out-of-scope observations`, at the end of the response that decided not
to fix it, wherever that response lands. Under an orchestrator it does not: the
finding rides its slice's `incidental` output
([`slice-completion.md`](slice-completion.md)) to the run's own report, and an
autonomous run is never interrupted to ask. One line each:

- **untracked** → what it is and where, the classification it would carry, and the
  rating it arrived with where a review gave it one
  ([`report-format.md`](report-format.md)) — then **OPEN / DEFER / DISMISS**;
- **tracked, and the finding adds something** → `#N` and what changes, then
  **UPDATE #N / DEFER / DISMISS**;
- **tracked as it stands** → no entry; say so where it came up.

A line in a report is not this. Naming a finding among the things left undone
records it; it does not put the decision to anyone, and a finding recorded that
way ends with the response.

## Only the authorized answer writes to the tracker

The answer is the user's, and where this session works to an order — one written
by another session rather than typed in chat — it is whoever that order names
([`order-anatomy.md`](order-anatomy.md)), the user again where it names nobody.
Opening or updating anything waits for it, every time. **A standing instruction
to work autonomously is not that answer** — it authorizes the work,
not the tracker — and an approval covers the batch it was given for, never what
turns up afterwards.

Where no answer comes, the finding stays undecided rather than dropped:
re-surface it at the natural end of the session, once the primary work is done.
