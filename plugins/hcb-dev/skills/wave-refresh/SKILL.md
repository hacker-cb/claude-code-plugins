---
name: wave-refresh
description: >-
  Recompute what parallel work can safely start right now: pin and re-read the
  base, measure the ground the running batches hold, take the delta since the
  last refresh, rule the candidates that clear it, and say how many batches are
  actually free — then hang them. Use when a coordinating session is asked
  "что ещё можно взять параллельно", "что блокирует", "что делать дальше",
  "какая следующая волна", "освежи и спланируй заново", or is handed a capacity
  ("до N батчей"); and after a landing frees ground. Differential by
  construction — it reads the delta and the occupied ground, where
  `hcb-dev:backlog-survey` reads every issue of a slice from scratch; use that
  one where no ledger and no survey exist yet. Not the launcher
  (`hcb-dev:wave-dispatch`, which this calls), and not re-reading a moved plugin
  (`hcb-dev:session-plugin-refresh`).
---

# Wave refresh

What can start right now, recomputed against the tree rather than against the
plan drawn when the wave opened. The split it produces is
[`../../references/wave-planning.md`](../../references/wave-planning.md)'s, each
issue's verdict is
[`../../references/issue-currency.md`](../../references/issue-currency.md)'s,
what it hangs goes out through `hcb-dev:wave-dispatch`, and the role around it
is `hcb-dev:master-session`.

**Differential by construction.** This pass reads two things: the ground the
running batches hold, and the delta since the last refresh. A slice that has
neither — no ledger, no prior survey — has nothing to take a delta from, and is
surveyed rather than refreshed (`hcb-dev:backlog-survey`); say so instead of
reading the backlog whole under this skill's name.

## What the ask carries

The **capacity** — how many batches the user can start — and the **slice**:
the epic, the milestone, everything open. Where the ask names neither, the slice
is the epic this session coordinates, and the capacity is what the report
concludes rather than a number handed in.

## The base, and how it is read

Resolve and refresh it per
[`../../references/base-resolution.md`](../../references/base-resolution.md),
then pin it as `<remote>/<branch>@<sha>`: the pin every fact of this pass stands
on, and the pin the orders carry.

**Every read of this pass goes through that ref, never through a working tree** —
the ground below, the delta, and every coordinate a verdict rests on alike.
`base-resolution.md` carries the mechanics.

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

A request reaching past its zone, a row with no session, a session with no row:
each goes to the user, and until it is settled the **widest** reading of the
three is the ground the axes below are measured against.

## The delta since the last refresh

From the pin the last refresh recorded to the pin taken now: what landed in the
base, what closed in the tracker, and which premises those landings moved. That
delta is the re-verification list — not the slice, which is what makes this pass
cheap. Where no prior pin exists, the delta runs from the oldest pin the live
batches' orders carry, and the report says that is what it ran from.

A premise a landing knocked out — an issue whose blocker is now closed, whose
coordinate moved, whose defect is gone — carries its verdict into the layout:
what a verdict past `current` does to a batch is `wave-planning.md`'s, and the
tracker edit that releases a held batch is `hcb-dev:issue-tracking`'s, on the
user's word.

## Ruling the candidates

Ground first, verdict second — the cheaper test eliminates more:

1. **Ground.** A path named in an issue body is a claim about where the work
   lands, not the fact: one cited as an example is not ground. Establish each
   candidate's real ground at the coordinates the defect stands on, read on the
   base. A candidate colliding with occupied ground is not free this round —
   `wave-planning.md` places it behind whatever holds that ground, and the
   report names the batch it now waits on.
2. **Verdict.** `issue-currency.md`, on the survivors alone.
3. **The three axes.** `wave-planning.md`, each survivor against the occupied
   ground and against every other survivor.

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

In this order, each section explicit even when empty:

1. **The front** — batches running, the ground each holds, what landed since the
   last refresh.
2. **What moved** — premises knocked out, blockers lifted, issues closed under
   the epic, and every disagreement the three ground sources showed.
3. **The candidates** — the columns of `wave-planning.md`'s closing table, plus
   what clears each one against the occupied ground, and what holds the ones
   held.
4. **The capacity** — how many are free, against how many were asked for.
5. **What launching needs first** — the tracker edits the candidates stand on,
   each named as the condition that releases its batch.

## After the report

- **Tracker edits execute on the user's word**, item by item through
  `hcb-dev:issue-tracking`; a refresh does not edit bodies on its own.
- **Chips go up through `hcb-dev:wave-dispatch`.** A capacity named in the ask
  authorizes hanging up to that many; the click that starts each one stays the
  user's, and a batch held by a tracker edit is reported, never hung.
- **The ledger takes the pass**: the pin this refresh ran on, the new batch rows
  with the ground each was given, and what the pass ruled about the rows that
  disagreed.

## Reference files

- [`../../references/wave-planning.md`](../../references/wave-planning.md)
- [`../../references/wave-ledger.md`](../../references/wave-ledger.md)
- [`../../references/issue-currency.md`](../../references/issue-currency.md)
- [`../../references/base-resolution.md`](../../references/base-resolution.md)
- [`../../references/session-comms.md`](../../references/session-comms.md)
- [`../../references/forge-docs.md`](../../references/forge-docs.md)
