# Splitting an epic into batches and waves

Read by whatever partitions a body of work into parallel sessions. It owns the
vocabulary and the split method; launching what it produces is
`hcb-dev:wave-dispatch`'s, and running one batch is `hcb-dev:wave-worker`'s.

## Vocabulary

A **batch** is one session's worth of work — one chip, one worktree, one
return. A **wave** is the set of batches launched together once its **gate** —
the merges or decisions it waits on — has cleared.

## The two axes

Every split is drawn on both, and a batch earns its place only when it holds on
each:

- **File zones.** Each batch owns a set of files; the map of who owns what is
  written into every order's `Boundaries:`. Two batches may share a *component*
  only with an explicit per-file split, spelled out in both orders — and the
  seam named as the one place a rebase is expected. Two batches writing the
  same file, or rewriting the same pass of the same mechanism, are not two
  batches: that is one batch, sequential inside.
- **Dependency edges.** What blocks what, read from the issues and the tree —
  not assumed from titles. A chain with one unblocked vertex is one batch in
  that order, not a wave of three; the blocked remainder waits behind the gate
  its vertex clears.

## Composing a batch

- Size it to one session: a coherent theme, a handful of issues, not a shard
  per issue and not a milestone in one bite.
- Order the issues inside it, and say what to take first and why — the
  reproduced defect before the design question, the unblocked vertex before
  the dependents, the slice that waits on no answer before the ones that do.
- Name the design forks up front, each with its addressee — the worker, the
  master, the user — so the planning gate downstream never rediscovers them.
- An investigation is a batch like any other when its deliverable is recorded
  tracker state or a verdict; say so in the order's deliverable slot.

## Gating the waves

- A wave's gate is named in the plan: which merges, which decisions open it.
- **A guard introduced on a clean tree goes early, never last.** The window in
  which a new gate finds zero violations closes with the first merge that
  could violate it — a batch that installs checks launches in the first wave,
  and later batches expect to go red on it and fix, not weaken.
- The merge order inside a wave is part of the plan: who merges first, who
  rebases on whom across a named seam; two green batches racing CI for the
  next slot is an acceptable order too — say which rule applies.
- A batch whose environment blocker stands is planned but not launched; the
  blocker and its unhang condition are written beside it.

## What the plan hands over

A table the user approves before anything launches: batch id
([`session-naming.md`](session-naming.md)), topic, issues in
order, file zone, what it shares with whom, its wave and gate — plus what was
deliberately left out (blocked batches with conditions, work that belongs to
no wave) and the forks only the user can settle.
