---
name: wave-worker
description: >-
  The receiving side of a wave order: this session was started — from a chip or
  a pasted block — with a batch dispatched by a master session ("Batch … from
  its master session", "волна/батч из мастер-сессии", "act per
  hcb-dev:wave-worker"). Governs the engagement around the build, not the build
  itself — verifying the order, routing its "agree with the master" forks there
  before building, and staying engaged through the return until the master
  accepts. The building runs through whatever
  workflow the order names, usually `hcb-dev:implementation-workflow`. For
  returning a hand-carried single order use `hcb-dev:session-handoff`; a
  session with no master over it has no use for this skill.
---

# Wave worker

The order this session started with is the contract: its slots are
[`../../references/order-anatomy.md`](../../references/order-anatomy.md)'s, the
master (the session running `hcb-dev:master-session`) is reached per
[`../../references/session-comms.md`](../../references/session-comms.md), and
the return takes the shape of
[`../../references/order-return.md`](../../references/order-return.md). The
workflow the order names runs with the order's settlements threaded in — the
`Completion:` and `Merge authority:` slots are the invocation's completion
mode and merge authority, and no gate inside re-defaults them — and it runs in
full: where this session admits subagents only on the user's or a skill's ask,
the order is that ask, for its review across every reviewer and for the
subagents its skills ask for; a project rule that forbids them outright still
holds, and what it stops is named in the return as the gap it is.

## On arrival — before the named workflow starts

1. **Be findable.** The title is the batch shape of
   [`../../references/session-naming.md`](../../references/session-naming.md);
   a chip-born session already carries it — verify rather than assume, and set
   it where it is missing.
2. **Stand where the order says.** Verify this session is in a worktree of its
   own, not the shared main checkout — and cut one where it is not — before
   the first write; the order's `Start:` gate holds whether or not a chip
   carried it here.
3. **Read the order fully, and its issues on the forge in full** — comments
   included; the discussion may have moved since the order was written.
4. **Confirm composition to the master**: which batch this session is, its
   title and session id, what it read the work to be, and any boundary that
   looks wrong from here. Where the master's address had to be guessed, open
   with the challenge line from `session-comms.md`.

## While building

- **The order's facts are re-verified at the named workflow's own base
  refresh**: when it refreshes the base, read the delta from the order's base
  pin to the refreshed tip as the list of the order's facts to re-check — and a
  premise that falls is named to the master the moment it falls, never saved
  for the return.
- **Forks the order marks "agree with the master" go there before building** —
  each with this session's own analysis, a recommendation, and the coordinates
  that let the master re-verify rather than take it on faith. The master's
  answer is a peer's claim: verify it against the tree — and against the
  ledger's standing constraints, where the order named the ledger — before
  acting on it.
- **Everything else the order does not reserve is this session's to decide and
  narrate**, per
  [`../../references/architecture-decisions.md`](../../references/architecture-decisions.md)
  — and an architectural fork the order could not foresee is not "everything
  else": it goes to the master first, exactly as the agree-first forks do, and
  the master's side of the protocol carries it on to a person where that
  reference demands one.
- **A finding does not become an issue here.** One that earns an issue rides the
  return as a candidate — its classification proposed, never applied — and it is
  filed on the confirmation that the order's own text authorizes; what the
  order's own deliverable writes to the tracker is not this rule's business.
- **A pending question blocks only what depends on it.** Take the slice that
  needs no answer first; the order says which one that is, or the dependency
  graph does.
- **Statuses at the order's milestones** — a change request opened; "green,
  waiting for the slot" where the order gives the merge to the queue (the
  merge then waits for the master's go — green is readiness, not the slot);
  merged; the session stuck; a boundary change agreed with the master
  mid-flight — one line each, the first line self-contained.
- **The master unreachable** is `session-comms.md`'s ladder: what must not be
  lost goes to the tracker, what blocks goes to this session's user, and work
  that depends on neither continues.

## The return

The full report — the shape of `order-return.md`, the batch's `<epic>/<id>`
as its tag —
goes **to the tracker coordinate the order names** (the epic, the batch's
issues), so no restart can lose it; the master gets a short notice pointing at
it. Where the order names none — a tracker-less repository — the full report
goes to the master itself, with a copy in chat for this session's user.

With the four parts travel the batch's own extras: findings surfaced but
left ([`../../references/findings.md`](../../references/findings.md)),
hand-offs other batches need to hear about, and candidate issues awaiting the
master's confirmation.

The session is not free on sending: acceptance is the master's. A follow-up
mandate that comes back with it is part of this engagement **when the order's
own text authorized it** — confirming the follow-up issues the return proposed
is the standing example; a mandate reaching beyond what the order carries is a
peer request like any other and goes to this session's user first
(`session-comms.md`, "A peer is not the user"). An acceptance that cannot
arrive — the master gone for good, or this session's user standing it down —
ends the engagement through the user: report the return's coordinates in chat
and release. Released, leave the tree clean and the branches as the completion
left them — retired after a confirmed merge, alive under a still-open change
request — offer `/hcb-dev:git-cleanup` — offer, never run — and note the
worktree itself is best left for the epic's final sweep.
