---
name: wave-refresh
description: >-
  Recompute what parallel work can safely start right now: pin the base and the
  moment the tracker was read, measure the ground the running batches hold, take
  the delta since the last reading, rule what clears it, and say how many
  batches are actually free — then hand what the user approves to the launcher.
  Use when a coordinating session is asked "что ещё можно взять параллельно",
  "что блокирует", "что делать дальше", "какая следующая волна", "освежи и
  спланируй заново", or is handed a capacity ("до N батчей"); and after a
  landing frees ground. Differential by construction — it reads a delta and the
  occupied ground, where `hcb-dev:backlog-survey` reads every issue of a slice
  from scratch; use that one where nothing records a point to diff from. Not
  the launcher (`hcb-dev:wave-dispatch`, which this hands to), and not
  re-reading a moved plugin (`hcb-dev:session-plugin-refresh`).
---

# Wave refresh

What can start right now, recomputed against the tree rather than against the
plan drawn when the wave opened. The layout it produces is
[`../../references/wave-planning.md`](../../references/wave-planning.md)'s, each
issue's verdict is
[`../../references/issue-currency.md`](../../references/issue-currency.md)'s,
what the user approves goes out through `hcb-dev:wave-dispatch`, and the role
around it is `hcb-dev:master-session`.

**Differential by construction.** This pass reads a delta and the ground the
running batches hold. What it needs to exist is a recorded point to diff from —
the ladder below says which. A slice with none is surveyed rather than refreshed
(`hcb-dev:backlog-survey`); say so instead of reading the backlog whole under
this skill's name.

## What the ask carries

The **capacity** — how many batches the user can start — and the **slice**:
the epic, the milestone, everything open. Where the ask names neither, the slice
is the epic this session coordinates, and the capacity is what the report
concludes rather than a number handed in.

## The base

Resolve and refresh it per
[`../../references/base-resolution.md`](../../references/base-resolution.md),
and pin it as `<remote>/<branch>@<sha>` beside the moment the tracker is read at:
together they are what this pass verified on, and what the next one diffs from.

**Every read of this pass goes through that ref, never through a working tree** —
the ground below, the delta, and every coordinate a verdict rests on alike.

The pin travels with the facts, not as the orders' own: `wave-dispatch` pins
again when it hangs, and where its pin is newer, the facts handed to it name
this one so the delta between them is re-verified rather than assumed.

## The ground that is occupied

Three sources, read together — each is partial, and where they disagree the
disagreement is itself a finding:

- **the batch rows of the ledger**
  ([`../../references/wave-ledger.md`](../../references/wave-ledger.md)) — the
  file zone each running batch was given;
- **the live registry**
  ([`../../references/session-comms.md`](../../references/session-comms.md)) — who
  is running now, since a row outlives the session it describes;
- **the files the running batches' open change requests touch**, resolved per
  [`../../references/forge-docs.md`](../../references/forge-docs.md) — what a
  batch is actually writing, which may reach past the zone its order drew.

Every disagreement goes to the user — a request reaching past its zone, a row
with no session, a session with no row. Until one is settled the ground is read
the **safer** way rather than the wider or the narrower: a zone read two ways is
occupied to the union of both, and a session whose zone no source gives holds
**everything a candidate would touch**, since an unknown zone is unbounded and
not empty.

## The delta since the last reading

Two halves, because an issue closes without a commit:

- **the base**, from the pin the point below names to the pin taken now:
  what landed, and which premises those landings moved;
- **the tracker**, from the moment that point read it: every change a verdict
  reads (`issue-currency.md`), and what entered or left the slice.

Both together are the re-verification list — not the slice, which is what makes
this pass cheap.

**The point to diff from, first that answers**: the newest whole reading of the
slice the ledger records — a refresh's own pin and tracker moment, or a
survey's, whichever read the slice later; else the pin the ledger's header
carries for the wave's live step; else the newest pin among the orders the
ledger records, ended batches included. Where none of the three answers, this is
a survey rather than a refresh — say so and stop. A rung carrying no tracker
moment fixes the base half alone: the tracker half is then read over the slice
whole, and the report says which half was a delta.

A premise a landing knocked out — an issue whose blocker is now closed, whose
coordinate moved, whose defect is gone — takes its verdict into the layout by
`wave-planning.md`, and the tracker edit that releases a held batch is
`hcb-dev:issue-tracking`'s, on the user's word.

## Ruling the candidates

1. **Verdict.** `issue-currency.md` — it is what establishes the coordinates
   the work actually stands on, and a body naming a path the tree moved past is
   exactly what it catches. It is re-derived where the delta reaches: a candidate
   the tracker half changed, and one whose coordinates the base half moved past.
   Every other candidate carries the verdict the ledger's verdicts section
   records for it, with the coordinate it stood on; one the section does not
   carry is read now, and what is re-read is written back there. The report says
   which verdicts this pass read and which it carried. What each verdict past
   `current` does to the batch is `wave-planning.md`'s.
2. **Ground.** From those coordinates, never from the paths a body happens to
   name — one cited as an example is not ground. A candidate colliding with
   occupied ground is not free this round: `wave-planning.md` places it behind
   whatever holds that ground, and the report names the batch it waits on.
3. **The three axes.** `wave-planning.md`, each survivor against the occupied
   ground and against every other survivor.
4. **The placed candidates, on this pass's own reading.** Nothing is launched on
   a verdict older than this pin: every candidate the layout holds whose verdict
   was carried rather than read here is read now, and one whose coordinate moves
   goes back through 2 and 3 — where it may displace another, which is read the
   same way. Repeat until every placed candidate carries a verdict read on this
   pass; each round reads at least one, so it ends.

A slice small enough to read here is read here; one that is not fans out to
reader subagents, each handed a sub-slice and this pin, with every conclusion
ruled back in this session.

## Capacity is reported, never reached

The capacity in the ask is a ceiling, never a target. Where fewer batches are
free than were asked for, say so plainly and name what holds each one that is
missing; nothing is added to the layout that the axes did not clear. Where the
slice is what ran out rather than the work, name the capacity that exists
outside it as its own choice for the user, not as part of this slice's layout.

## The report

The frame is
[`../../references/report-format.md`](../../references/report-format.md)'s: its
first line, and its ask block last, carrying the tracker edits the candidates
stand on and the word the layout launches on. Between them, in this order, each
section explicit even when empty:

1. **The front** — batches running, the ground each holds, what landed since the
   last reading.
2. **What moved** — premises knocked out, blockers lifted, tracker changes in
   the slice, and every disagreement the three ground sources showed.
3. **The candidates** — the columns of `wave-planning.md`'s closing table, plus
   what clears each one against the occupied ground, and what holds the ones
   held.
4. **The capacity** — how many are free, against how many were asked for.
5. **What launching needs first** — the tracker edits the candidates stand on,
   each named as the condition that releases its batch.

## After the report

- **The ledger takes the pass before anything else moves**: the pin and tracker
  moment this refresh ran on and the ground it covered — which takes the
  header's slot only where that ground was the ledger's whole slice, a narrower
  pass leaving the reading that stands there — every verdict this pass read into
  its verdicts section, the layout it produced, and what it ruled about the
  sources that disagreed.
- **Tracker edits execute on the user's word**, item by item through
  `hcb-dev:issue-tracking`; a refresh does not edit bodies on its own.
- **The layout is launched on the user's word, and only then** — the capacity in
  the ask is not that word. What they approve goes to `hcb-dev:wave-dispatch`,
  one chip per batch; the click that starts each one is the second gate and
  stays theirs, and a batch held by a tracker edit is reported, never hung.

## Reference files

- [`../../references/wave-planning.md`](../../references/wave-planning.md)
- [`../../references/wave-ledger.md`](../../references/wave-ledger.md)
- [`../../references/report-format.md`](../../references/report-format.md)
- [`../../references/issue-currency.md`](../../references/issue-currency.md)
- [`../../references/base-resolution.md`](../../references/base-resolution.md)
- [`../../references/session-comms.md`](../../references/session-comms.md)
- [`../../references/forge-docs.md`](../../references/forge-docs.md)
