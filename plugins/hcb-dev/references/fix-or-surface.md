# What to do with something you noticed

Read wherever work turns up something it did not set out to do — a review that
reported it, a step that noticed it while editing something else, a completion
that ran past it. It owns both halves of that: the choice between fixing it here
and leaving it, and, for what is left, everything between noticing and the
tracker — so one finding gets the same treatment whichever skill found it. The
tracker operations themselves — searching, the issue body, hierarchy, closing —
belong to `hcb-dev:issue-tracking`.

## The default is to fix it

Something noticed in passing that belongs to the work in hand is fixed **in that
work, as it is noticed** — never carried to a report and handed back as something
for the user to schedule. Five conditions, all of which have to hold; the first is
what makes it a drive-by rather than new work:

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

## A drive-by fix is its own commit

A fix that is not what the change set out to make — as against a fix to the code
this change is writing, which is just the work — never rides inside another
commit, and never shares one with a second drive-by: each is read, and can be
rejected, apart from the change that carried it.

- **Its subject** — [`branch-naming.md`](branch-naming.md) owns what a passenger
  commit is called.
- **Commits, not pushes.** Where a push costs a re-review round they still go up
  together; it is the history that stays separate, not the round trips.
- **Notice it before the reviewers run**, so it sits inside the range they read.
  One noticed after they have reported is fixed only where it falls inside that
  range; outside it, it surfaces instead — a coverage gate that has already
  reported the change fully read is not a gate anything may land behind.
- **Where the merge collapses the commits, name the fix in the change-request
  body** and in the squash message written from it. A slice always squashes and a
  standalone request usually does
  ([`slice-completion.md`](slice-completion.md)), so the boundary serves the
  branch and the review and then goes; that line is what reaches the base. A merge
  keeping the commits carries it already.

A fix is not surfaced as a finding — no proposal, no issue. It is done, and the
commit and that line are its record.

## What surfaces instead

Everything a condition above turned down, and the next reader would want: a defect
left alone, a test not written, a duplication, a TODO, an assumption that did not
hold.

## Prepare the proposal before making it

Both of these happen before the finding reaches the user, not after they accept
it:

- **Search the tracker**, closed entries included
  ([`../skills/issue-tracking/SKILL.md`](../skills/issue-tracking/SKILL.md)) — its
  result decides which of the three states below applies.
- **Read the repository's own classification**
  ([`../skills/issue-tracking/references/classification.md`](../skills/issue-tracking/references/classification.md)),
  once for the run rather than once per finding, so the proposal already carries
  what it would be opened with. Where a role has no vocabulary here, name the role
  and offer nothing for it.

Where there is no tracker to reach — no remote at all, or none a forge answers
for — neither is possible, and the finding still surfaces: as an observation with
no proposal attached, saying there is nowhere to file it. A local completion is
built to run without a remote, so this is an ordinary case and not a failure.

## The form

Under `## Out-of-scope observations`, at the end of the response that decided not
to fix it, wherever that response reaches the user. Under an orchestrator it does
not: the finding rides its slice's `incidental` output
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

## Only the user's answer writes to the tracker

Opening or updating anything waits for that answer, every time. **A standing
instruction to work autonomously is not that answer** — it authorizes the work,
not the tracker — and an approval covers the batch it was given for, never what
turns up afterwards.

Where no answer comes, the finding stays undecided rather than dropped:
re-surface it at the natural end of the session, once the primary work is done.
