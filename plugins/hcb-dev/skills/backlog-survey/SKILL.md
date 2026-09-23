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
  into waves when no survey exists yet. Report-first: every tracker edit it
  proposes executes only on the user's word, item by item through
  `hcb-dev:issue-tracking`.
  Not for one issue's mechanics (`hcb-dev:issue-tracking`); the ask to split
  into waves AND run them is `hcb-dev:master-session`'s — this skill surveys
  and recommends. A slice already under a ledger, with a pin to diff from, is
  recomputed by `hcb-dev:wave-refresh` instead — a survey run over one hands
  its reading to the session holding it.
---

# Backlog survey

**Paths**, substituted at invocation — use verbatim: `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}`.

## Scope, then scale

Name the slice — a milestone, a label, everything open — and count it before
reading it deep. Where this session opened the run, the slice named is its title, per
[`../../references/session-naming.md`](../../references/session-naming.md).

**Read it in two tiers**, both through the one form
[`../../references/issue-currency.md`](../../references/issue-currency.md) gives
under "What is read":

- **Wide, whole, and here** — the slice's filter, every page, written to a file
  rather than into the conversation. Its first line is the count (`total`
  against `fetched`) and whether the slice came back whole; short of that, the
  report's first line says which part was surveyed, since a survey of part
  reads as a survey of the whole. On GitLab that slice holds issues and tasks
  alone, and the report's first line says so: incidents and the other work item
  types stay outside it. The picture, the graph and the tiers are drawn from
  this file in this session whatever the slice's size — projected with `jq` to
  the keys a section needs where the file would not fit whole.
- **Deep, for the verdicts** — bodies and comments, which weigh several times
  what a wide line does
  ([`../../references/forge-behaviour.md`](../../references/forge-behaviour.md),
  "what a slice read costs the reader"). **Bytes pick the mechanics, not the
  count of issues**: the numbers this session can hold deep beside its own work
  it reads itself, one call for all of them; past that, they fan out to parallel
  reader subagents, each handed numbers weighed by their comment count (`c` on
  the wide line) rather than an equal share, the verdict reference by path, the
  plugin root `${CLAUDE_PLUGIN_ROOT}` its command resolves against — a reader
  session binds none of its own — and the one priority scale resolved below,
  with every conclusion synthesized back here.

Whichever mechanics run, the conclusions below are this session's — a reader's
summary is input, not a verdict.

## Read against the code, not against the tracker

Every issue in the slice carries a verdict — an epic's umbrella and waves, labelled `epic` and
`wave` ([`../../references/epic-structure.md`](../../references/epic-structure.md)), being
structure, not work, carry none — reached per `issue-currency.md` on
its deep read, and carrying the coordinate it stands on together with the base pin
(`<remote>/<branch>@<sha>`) and the tracker moment the slice was read at — the
survey's whole reading dates to those two, and a session that adopts this layout
records them ([`../../references/wave-ledger.md`](../../references/wave-ledger.md)) — and
one whose parked reason still holds stays out of every "ready" tier below,
whatever that verdict was.

The priority role
[`../../references/classification.md`](../../references/classification.md)
resolves is the issue's **declared priority** — read it per issue and carry it
as an input of its own, never folded into the importance the tests below
derive. Resolve the family once for the whole slice, by that reference rather
than from the values that happen to appear on these issues, and hand the scale
it yields to every reader the slice fans out to. Everything below that weighs
one priority against another — the divergence, the ordering, the
recommendation's reasons — holds only between values that scale compares, and
the report says which issues it could not place: the ones the repository left
unlabelled, the ones whose labels break the reference's cardinality, and all of
them where no scale resolved at all.

## The report

The grammar is
[`../../references/report-format.md`](../../references/report-format.md)'s and the blocks
[`../../references/report-blocks.md`](../../references/report-blocks.md)'s. A reading or a plan
with nothing in it says so in a bullet of its own rather than going unprinted: a survey that
found no hygiene is not one that did not look.

**`## The picture`** — four readings, in this order:

1. The slice by milestone or theme: open counts, what each group is, where the current front
   line runs. A wide line names a milestone and nothing more, so the milestones are listed once,
   with their state and description, by the read `classification.md` gives; the counts come from
   the wide lines — on GitLab counted by `ty`, tasks standing beside the issues they belong to —
   never from a milestone's own counters.
2. The dependency graph and the critical path — chains, the unblocked vertices, and the
   constraints visible only from reading the slice whole (the classes
   [`../../references/wave-planning.md`](../../references/wave-planning.md) rules sequential).
   The edges are the wide lines' links; what the first line names as `unavailable`, and the
   issues it lists under `cut` and `hidden`, are drawn as the part of the graph this reading
   could not see — named here, never read as edges that are not there. On GitHub a parent out of
   this token's sight is in none of them and reads as no parent at all: the search
   `forge-behaviour.md` names is what finds one.
3. The tiers of importance the rows below are placed in, each named with its meaning.
4. What turned up beside the survey: epics closable as already met, change requests stuck with
   their reason, contradictions between issues.

**`## Where it stands`** — a row per issue: its verdict (`issue-currency.md`) with the coordinate
that shows it as its state — 🟢 `current`, 🟡 `needs rewrite`, the rewrite being the user's, ⚪
`stale` and `unverifiable`, which stand outside any layout — its tier, its declared priority, and what it blocks or waits on. The
tier comes of three tests: does it block others; does it fire today (a reproduced defect, a live hole); does it
catch regressions (a guard, a gate). Carry each issue's declared priority, where it has one,
beside the tier the tests put it in. The tests
measure what the code makes true, the priority what the queue was told to want, and neither
disproves the other — so where the two are at odds the divergence is a result of its own:
reported in the row with what the code showed and left to the user to settle, never corrected as an error,
never claimed where a verdict above or a live parked reason already explains the quiet, and
never read out of the normal that absence declares. Where the tests leave two issues level, the
priority orders them.

**`## The plan`** — candidate batches in the columns of `wave-planning.md`'s closing table,
every pair carrying what that file's axes say of it — what clears the ones placed side by side,
what separates the ones kept apart — and the gates the dependencies imply. What a verdict past
`current` does to a batch is `wave-planning.md`'s, written where that batch stands; a `stale`
issue's closure is then the hygiene plan's to propose. What a builder reads is the tracker's
body, never this report.

**`## Needs your word`** — one recommendation for what to take next, with its rationale and the
cut to start with, the declared priorities of what it names among its reasons where they weigh;
alternatives only where the choice genuinely turns on what the user wants next. Then the hygiene
plan, an ask each: bodies to rewrite, issues to close or re-milestone, links to fix, and the
issues read here that `classification.md` leaves out of line. Where it leaves any, the rest of
the repository's carrying that same value ride the ask with them — closed ones included, found
by filtering on the value itself in every mechanism that can carry it, the stray one as much as
the ones the resolution names, and over every state rather than the open ones a listing answers
with by default; never by a text search a title can answer, and never by reading the closed
backlog through. A label or a milestone is counted on the first line alone of a wide read over
`--state all` with it as the filter — on GitLab within that slice's own types — one label a
call; a native type, which the script does not filter on, by the forge's own filter for it. They
are counted rather than listed, save the ones carrying a second value that contradicts it: those
are named one by one, the value on them being the user's. The count is what the ask proposes —
taking it enumerates them, each edit going through the tracker as any other, and what the
enumeration finds past that count goes back to the user before it is touched; where the forge
answers for no such value the ask says so instead of standing on a number nobody read. The
hygiene plan holds up nothing; a rewrite a candidate batch stands on is an ask of its own, among
the blocking ones, since the layout launches on it.

## After the report

- **Every tracker edit executes on the user's word** — one this report **asks
  for** where it is handed over, never one it merely displays and waits for —
  item by item through `hcb-dev:issue-tracking`; a survey that silently edits
  the tracker has outrun its mandate. What the layout's preconditions change is
  *when* that word is needed, never whether: they are asked with the layout, and
  a batch runs once its own is settled.
- **`## The plan` is the wave plan's input** — it already carries the
  closing-table columns as candidates. When the user says to run them, the
  session assumes `hcb-dev:master-session` — or hands the table to the session
  that will.
- **The executed hygiene is read back, and it settles the handover** — what the
  user took, never what this report proposed: an issue closed or moved out of
  the slice leaves the layout, a rewritten body releases the batch its verdict
  held once `issue-currency.md` rules it `current` on the body it now has, a
  corrected link moves an edge. What that leaves is handed over on the user's
  word:
  - **to the session holding the ledger**, where one already stands over the
    slice — the waves behind the hygiene are redrawn there, from the newest
    reading that session holds rather than from the backlog again
    (`hcb-dev:master-session`, reached through `hcb-dev:session-handoff` where
    that session is not this one);
  - **to one master session over the cut the user takes** otherwise, carrying
    the epic it hangs on; the themes it leaves are named as the epics that
    follow it, never as masters to run beside it. A layout of one batch nothing
    holds goes to `hcb-dev:implementation-workflow` instead, and carries no
    epic.
