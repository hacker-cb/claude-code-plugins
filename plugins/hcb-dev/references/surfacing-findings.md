# Surfacing a finding

Read wherever work turns up something it will not fix — a review that reported it,
a completion that skipped it, a step that noticed it in passing. It owns what
happens between noticing and the tracker, so one finding gets the same treatment
whichever skill found it. The tracker operations themselves — searching, the issue
body, hierarchy, closing — belong to `hcb-dev:issue-tracking`.

## What surfaces

Anything this work will not fix and the next reader would want: a defect left
alone, a test not written, a duplication, a TODO, an assumption that did not hold.
What was fixed surfaces nowhere — the change records it.

## Prepare the proposal before making it

Both of these happen before the finding reaches the user, not after they accept
it:

- **Search the tracker**, closed entries included
  ([`../skills/issue-tracking/SKILL.md`](../skills/issue-tracking/SKILL.md)) —
  which of the three states below applies is its answer.
- **Read the repository's own classification**
  ([`../skills/issue-tracking/references/classification.md`](../skills/issue-tracking/references/classification.md)),
  once for the run rather than once per finding, so the proposal already carries
  what it would be opened with. Where a role has no vocabulary here, name the role
  and offer nothing for it.

## The form

Under `## Drive-by observations`, at the end of the response that decided not to
fix it — not held until the work finishes. One line each:

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
