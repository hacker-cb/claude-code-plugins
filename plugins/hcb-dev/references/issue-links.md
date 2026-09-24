# Dependencies between issues — when an edge is written, and in what

Read wherever an issue is filed, split, or found waiting on another. This file owns when a
dependency between two issues is written to the tracker, the one mechanism it goes in, and what
stands in for that mechanism where the forge carries none. It lives outside any one skill because
the graph a survey draws, a wave plan chains and a refresh diffs holds only the edges some earlier
session wrote. Hierarchy — which issue is part of which — is a mechanism of its own
(`hcb-dev:issue-tracking`), and nothing here writes it.

## When an edge is written

An edge says one issue cannot start or land before another closes. It is written:

- **on filing** — an issue that waits on one already in the tracker is filed with the edge;
- **on splitting** — children that must land in order carry the edges between them, beside the
  parent they share;
- **on reading** — a body, a comment or the tree names a blocker the tracker does not record: the
  edge is proposed, never assumed from a title;
- **off, on a change of plan** — an edge that no longer holds (the blocker split, the order
  turned, the need gone) is removed rather than left. A blocker closing asks for nothing where
  the edge is a link; where it is a body line, below.

The waiting issue is *blocked by* the other; the forge records both ends from either. Every write
is `hcb-dev:issue-tracking`'s, on the answer that skill names.

## The mechanism

**The forge's own dependency link, and nothing beside it.** A sentence in the body and a
parked-reason label ([`classification.md`](classification.md)) neither stand in for the link nor
go on with it; the parked reason keeps what the tracker cannot link — a decision, an upstream
release. A repository whose own rule or newest issues carry dependencies another way keeps it,
resolved as `classification.md` resolves a role.

The invocations are [`forge-docs.md`](forge-docs.md)'s; what a partial failure leaves is
[`forge-behaviour.md`](forge-behaviour.md)'s. Read the edges back once written — `bb` and `bl` on
each issue's line:

```bash
node "<plugin root>/scripts/issue-slice.mjs" --deep "<n>[,<n>…]"
```

## Where the forge carries none

The slice's first line lists `bb` and `bl` under `unavailable`, or the server refuses the write of
a blocking link (`forge-behaviour.md`). There the edge is a line in the waiting issue's body —
`Blocked by <reference>`, the blocker as the tracker writes it: `#<n>` in the same project, its
full path in another — and the parked-reason label where the repository has that family. The two
come off together, on a change of plan and when the blocker closes: whoever closes it finds the
issues naming it by searching the tracker for its reference. **Never a related link** — on GitLab
an epic hangs its work by one ([`wave-issue.md`](wave-issue.md)).
