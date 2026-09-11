# Splitting an epic into batches and waves

Read by whatever partitions a body of work into parallel sessions. It owns the
vocabulary and the split method; launching what it produces is
`hcb-dev:wave-dispatch`'s, and running one batch is `hcb-dev:wave-worker`'s.

## Vocabulary

A **batch** is one session's worth of work — one chip, one worktree, one
return. A **wave** is the set of batches its **gate** — the merges or decisions
it waits on — releases: launched together, or one at a time where the plan
stages them. A wave of one is an ordinary
outcome: what earns a second batch its place beside the first is the three axes
below, all of them, never the mere absence of an edge between the two.

## The three axes

Every split is drawn on all three, and two batches stand side by side only
where each holds. Where one fails they are a chain: the later batch is planned
behind what settles the earlier one — its merge, or the decision recorded where
that batch has no merge to give — and the plan names the axis that put it
there.

- **Seams.** Each batch owns a set of files; the map of who owns what is
  written into every order's `Boundaries:`. A seam is whatever both batches
  write through, of which a shared file is the commonest shape and not the
  only one — one dispatcher they both register in, one generated artefact they
  both re-emit, one format they both encode to, each a seam with no file in
  common. Two batches may share a *component* only with an explicit per-file
  split, spelled out in both orders — and the seam named as the one place a
  rebase is expected. Two batches writing the same file, or rewriting the same
  pass of the same mechanism, are not two batches: that is one batch,
  sequential inside.
- **Dependency edges.** What blocks what, read from the issues and the tree —
  not assumed from titles. A chain with one unblocked vertex is one batch in
  that order, not a wave of three; the blocked remainder waits behind the gate
  its vertex clears. An artefact and its first consumer are an edge no issue
  needs to draw: the artefact is built by the batch that consumes it, or by the
  one merging directly ahead of that batch. Anything earlier is too early, and
  what gives it away is the harness the batch must invent to test it at all — a
  peer, a stub, a fixture standing in for a consumer that does not exist yet.
- **Blind form.** Whether each batch can be built right without seeing the
  other. A batch whose own shape is settled by what the parallel batch turns
  out to choose — the layer beneath both, the format they share, the entry
  point they both reach — is written blind and rewrites itself when that choice
  lands. It goes behind that batch however cleanly the seams and the edges
  clear it.

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
- **A guard introduced on a clean tree goes early, never last** — a batch that
  installs checks launches in the first wave, and later batches expect to go
  red on it and fix, not weaken. A guard is what those later batches must
  satisfy; what nothing downstream is measured against is an artefact, placed
  by the edge to its consumer instead.
- The merge order inside a wave is part of the plan: who merges first, who
  rebases on whom across a named seam; two green batches racing CI for the
  next slot is an acceptable order too — say which rule applies. Racing stops
  being one of the choices across a seam whose base does not require branches
  current with it: nothing at merge time reads the seam's two sides together, so
  the displaced batch owes its rebase before its own merge, not after.
- **The launch order inside a wave is part of it too**: every chip at once, or
  staged — one chip, the next hung on the landing of the one before it, once
  that landing's checks are read. Staged
  is what a wave takes wherever its batches cleared the axes only through a
  split the plan had to draw: a seam divided per file. Each step of a staged
  wave is pinned and hung once its predecessor's landing is read, not at the
  wave's open.
- A batch is planned but not launched while anything holds it — an environment
  blocker, an issue whose body was ruled `needs rewrite`; what holds it and the
  condition that releases it are written beside it.

## What a verdict past `current` does to a batch

The verdicts are [`issue-currency.md`](issue-currency.md)'s; where the issue
carrying one stands in the layout is here, so a survey and a refresh place it
the same way:

- **`needs rewrite`** — the batch is planned and **held**, with the rewrite that
  releases it written beside it. Nothing else releases it.
- **`stale`** — the issue leaves the layout; what to do with it is a tracker
  proposal, not a batch.
- **`unverifiable`** — the issue stays out of every wave, with that as the
  written reason.

A batch left holding no `current` issue is not a batch.

## What the plan hands over

A table the user approves before anything launches: batch id
([`session-naming.md`](session-naming.md)), topic, issues in
order, file zone, what it shares with whom and through which seam, its wave,
gate and launch order — plus, for every batch planned beside another, what
clears the pair on each axis that could have separated them. What was
deliberately left out goes up with it (blocked batches with conditions, work
that belongs to no wave), and the forks only the user can settle.
