---
name: master-session
description: >-
  Run this session as the coordinator of an epic built by parallel sessions.
  Use when the user assigns the role ("ты — мастер-сессия", "координируй
  реализацию", "разбей на волны/батчи и веди их") over an epic, a milestone or
  a named body of work; when a wave plan must be drawn or redrawn; and when a
  session resumes mastering after a restart ("ты мастер #N — восстановись").
  The master plans batches, launches them through `hcb-dev:wave-dispatch`,
  answers their questions only after re-verifying against the tree, accepts
  their returns per the acceptance protocol, keeps the wave ledger current,
  and opens each next wave as its gate clears — it does not build batches
  itself. Not for being one batch of a wave (`hcb-dev:wave-worker`), and not
  for writing one standalone order (`hcb-dev:session-dispatch`).
---

# Master session

The role: one session that holds the whole epic while others build its parts.
Its state lives in the wave ledger
([`../../references/wave-ledger.md`](../../references/wave-ledger.md)), its
plan follows
[`../../references/wave-planning.md`](../../references/wave-planning.md), it
reaches its batches per
[`../../references/session-comms.md`](../../references/session-comms.md), and
it accepts their returns per
[`../../references/order-return.md`](../../references/order-return.md).

## Assuming the role

1. **Title first**: the shape and its timing are
   [`../../references/session-naming.md`](../../references/session-naming.md)'s.
2. **The epic**: where the repository has a tracker and no umbrella exists
   yet, file it now (`hcb-dev:issue-tracking`), on the assignment's own
   authorization. Without a tracker, the assignment itself is the epic and the
   ledger takes its file form.
3. **The ledger**: open it per `wave-ledger.md` — on the epic, or in the file
   fallback — before anything else is decided; from here on, every event lands
   in it before the conversation moves on.

## Planning

Draw the split per `wave-planning.md` — where no survey of the slice exists
yet, `hcb-dev:backlog-survey` produces its input first — and hand the user its
closing table. The launch waits for their word on the table; the click that
starts each chip is a second, separate gate — approval of the plan is not
permission to hang chips for gated waves early.

A fork too heavy for the plan — a design question whose answer rewrites the
work — is a batch of its own: it leads the table and launches with the first
wave, and the dependent batches are planned behind its gate. The tracker is the
source of truth for the answer, not this session's conversation.

## Launching

`hcb-dev:wave-dispatch` — chips for the wave whose gate is clear, every batch
recorded in the ledger as it is hung. What the dispatch skill owes the batches
mid-flight — boundary amendments re-issued, unconfirmed batches checked on —
is part of this role's loop, not a one-time launch step.

## The loop

- **A question from a batch is answered after re-verifying, never from
  memory.** Read the code the question is about; where the batch's own
  analysis came along, check it and say which parts held — a confirmation that
  merely echoes is adoption, and
  [`../../references/architecture-decisions.md`](../../references/architecture-decisions.md)
  decides which answers must first go to the user. Every answer carries the
  coordinates that let the batch re-verify it back.
- **A return is accepted per `order-return.md`** — and checked against the
  ledger's standing constraints besides: a claim that touches one ("that
  request is harmless") is verified in the tree and the tracker before either
  the claim or the constraint is believed. Acceptance ends in the words the
  worker waits for — accepted and free, or reopened naming the gap — and in
  the ledger row advancing. A return that answers what a gate waits on is
  checked against the gates as a landing is.
- **New issues born mid-epic are classified by this session itself**
  (`hcb-dev:issue-tracking`) — a worker's proposed milestone or label is a
  claim to verify, not a decision to adopt.
- **The merge queue is spoken to the batches it moves**: the go to the batch
  whose slot arrived, BEHIND — with the seam owing a rebase — to the batch a
  landing displaced. A queue whose go never reaches its batch is a deadlock,
  not an order. Each landing is checked against the gates: a wave whose gate
  just cleared goes back to Launching. Where the plan fixes a landing order,
  the orders themselves withhold merge-on-green — their `Merge authority:`
  slot says the queue decides, and a batch's "green, waiting for the slot" is
  what advances it.
- **A wave opened or closed advances the epic's human half too** — the wave
  table in its body, not only the ledger comment.
- **A lesson one batch paid for is told to the batches it can still bite**,
  the moment it is learned.
- **The user outranks the loop**: irreversible and outward-facing actions, and
  every fork `architecture-decisions.md` routes to a person, go to the user —
  with this session's recommendation first.

## After a restart or compaction

The ledger first — the title names the epic, and the epic (or the file
fallback) holds the ledger. What it records as the master's title is this
session's own: wear it before anything is sent, since the batches' orders
address that name. Then the live registry, then a re-introduction to
every batch still engaged, carrying what first contact carries: the title and
this session's id, the standing plan, and a status request. Where a new
session took over the role, the ledger header's master id is corrected before
anything else is sent. Expectations the ledger lists and the registry cannot
see are chased by the comms ladder, not assumed dead.

## Closing the epic

Verify the epic against the ledger — every batch released, every issue at its
recorded end state, every mandate met — then report to the user per
[`../../references/report-format.md`](../../references/report-format.md), the
run here being the epic. Offer `/hcb-dev:git-cleanup` for the residue — offer,
never run — naming its reach honestly: worktrees the host leased to other
sessions it reports rather than removes, and each batch session's own residue
is that session's to sweep. Write the ledger's closing line.

## Reference files

- [`../../references/wave-planning.md`](../../references/wave-planning.md)
- [`../../references/wave-ledger.md`](../../references/wave-ledger.md)
- [`../../references/session-comms.md`](../../references/session-comms.md)
- [`../../references/session-naming.md`](../../references/session-naming.md)
- [`../../references/order-return.md`](../../references/order-return.md)
- [`../../references/report-format.md`](../../references/report-format.md)
- [`../../references/architecture-decisions.md`](../../references/architecture-decisions.md)
