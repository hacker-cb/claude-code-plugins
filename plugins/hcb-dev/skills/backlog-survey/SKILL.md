---
name: backlog-survey
description: >-
  Survey a whole slice of the backlog and say what to work on: read every
  open issue of a milestone, a label or the repository, verify each against
  the code, tier them by importance, draw the dependency graph and the
  parallel layout of candidate batches, and recommend what to take next. Use
  when the user asks to study, re-check or lay out the backlog as a whole —
  "изучи все issues", "раздели по важности", "что брать в работу", "разложи
  бэклог", "перепроверь все issues вехи/метки" — and before an epic is split
  into waves when no survey exists yet. Report-first: tracker hygiene it
  proposes (bodies to rewrite, issues to close, milestones to move) executes
  only on the user's word, item by item through `hcb-dev:issue-tracking`.
  Not for one issue's mechanics (`hcb-dev:issue-tracking`); the ask to split
  into waves AND run them is `hcb-dev:master-session`'s — this skill surveys
  and recommends.
---

# Backlog survey

## Scope, then scale

Name the slice — a milestone, a label, everything open — and count it before
reading. The slice named is this session's title, per
[`../../references/session-naming.md`](../../references/session-naming.md).
**Count exhaustively** (per
[`../../references/forge-docs.md`](../../references/forge-docs.md)) — a survey of
the first page reads as a survey of the whole. The count picks the
mechanics: a slice a session can read, it reads itself; hundreds of issues
fan out to parallel reader subagents, each handed a sub-slice, the same
per-issue questions and the one priority scale resolved below, with every
conclusion synthesized back here. Whichever mechanics run, the conclusions
below are this session's — a reader's summary is input, not a verdict.

## Read against the code, not against the tracker

The code the verdicts stand on is the refreshed base — resolved and fetched
per [`../../references/base-resolution.md`](../../references/base-resolution.md),
never this checkout's own state, which may be stale or mid-feature — and the
report names the revision it read.

Per issue: the body, every comment, the labels, native type, milestone and
state reason (classified per
[`../../references/classification.md`](../../references/classification.md)
— a parked reason that still holds keeps an issue out of every "ready" tier),
the sub-issue and dependency links (both sit past either CLI's issue commands
— the entry points are resolved per
[`../../references/forge-docs.md`](../../references/forge-docs.md)), the change
requests that touch it — then the tree itself at the issue's coordinates. The
verdict on each is one of: **current** (the defect or gap is still there — cite
the coordinate that shows it), **stale** (the tree moved — cite what fixed or
invalidated it), **needs rewrite** (real, but the body misleads),
**unverifiable** (the trigger cannot be checked from here — an unreproduced
defect, an environment this session lacks — say why; it stays out of every
closure proposal).

The priority role `classification.md` resolves is the issue's **declared
priority** — read it per issue and carry it as an input of its own, never
folded into the importance the tests below derive. Resolve the family once
for the whole slice, by that reference rather than from the values that
happen to appear on these issues, and hand the scale it yields to every
reader the slice fans out to. Everything below that weighs one priority
against another — the divergence, the ordering, the recommendation's reasons
— holds only between values that scale compares, and the report says which
issues it could not place: the ones the repository left unlabelled, the ones
whose labels break the reference's cardinality, and all of them where no
scale resolved at all.

## The report

In this order, each section explicit even when empty:

1. **The picture** — the slice by milestone or theme: open counts, what each
   group is, where the current front line runs.
2. **Tiers of importance**, each issue placed by three tests: does it block
   others; does it fire today (a reproduced defect, a live hole); does it
   catch regressions (a guard, a gate). Name the tier's meaning, not only
   its members, and carry each issue's declared priority, where it has one,
   beside the tier the tests put it in. The tests measure what the code
   makes true, the priority what the queue was told to want, and neither
   disproves the other — so where the two are at odds the divergence is a
   result of its own: reported with what the code showed and left to the
   user to settle, never corrected as an error, never claimed where a
   verdict above or a live parked reason already explains the quiet, and
   never read out of the normal that absence declares. Where the tests leave
   two issues level, the priority orders them.
3. **The dependency graph and the critical path** — chains, the unblocked
   vertices, and the constraints visible only from reading the slice whole
   (the classes
   [`../../references/wave-planning.md`](../../references/wave-planning.md) rules
   sequential).
4. **The parallel layout** — candidate batches in the columns of
   `wave-planning.md`'s closing table, what must not run in parallel with its
   reason, and the gates the dependencies imply.
5. **What to take next** — one recommendation with its rationale and the
   cut to start with, the declared priorities of what it names among its
   reasons where they weigh; alternatives only where the choice genuinely
   turns on what the user wants next.
6. **Incidental findings** — epics closable as already met, change requests
   stuck with their reason, contradictions between issues — and the hygiene
   plan: bodies to rewrite, issues to close or re-milestone, links to fix.

## After the report

- **Hygiene executes on the user's word**, item by item through
  `hcb-dev:issue-tracking` — a survey that silently edits the tracker has
  outrun its mandate.
- **The parallel layout is the wave plan's input** — it already carries the
  closing-table columns as candidates. When the user says to run them, the
  session assumes `hcb-dev:master-session` — or hands the table to the session
  that will.
