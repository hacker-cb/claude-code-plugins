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
2. **The epic**: settle the tracker before writing anything to it — without one
   the role does not begin, and `wave-ledger.md` says what is said to the user
   then. With one, the ledger hangs on an umbrella issue, so where none exists
   yet it is filed now (`hcb-dev:issue-tracking`) — on the assignment's own
   authorization where the assignment named the epic, and on the user's word
   where it named none, which is the first thing this role asks for rather
   than something it decides. A slice of the backlog needs one exactly as a
   named epic does.
3. **The ledger**: open it per `wave-ledger.md`, on the epic, before anything
   else is decided; from here on, every event lands in it before the
   conversation moves on. Its header carries the plugin version this role
   reconciled against, which starts as the one it is running, resolved rather
   than recalled (`hcb-dev:session-plugin-refresh`).

## Planning

Draw the split per `wave-planning.md` — where no survey of the slice exists
yet, `hcb-dev:backlog-survey` produces its input first, and a plan redrawn
mid-epic starts from `hcb-dev:wave-refresh` rather than from a second survey —
and hand the user its closing table. **The preconditions that table carries go
up with it** — a batch
standing on an issue the survey ruled `needs rewrite`
([`../../references/issue-currency.md`](../../references/issue-currency.md)) is
planned and held, and the rewrite releasing it is a tracker edit like any other:
`hcb-dev:issue-tracking`, on that same word. The launch waits for their word on
the table; the click that
starts each chip is a second, separate gate — approval of the plan is not
permission to hang chips for gated waves early.

**The epic's merge authority is settled with that same word**, once, before the
first chip goes up — `on-green` recommended first
([`../../references/slice-completion.md`](../../references/slice-completion.md)),
its reason being that every gate guarding that merge has run by the time it is
reached. It is written to the ledger before anything is hung, narrowed per batch
where the plan fixes a landing order, and never widened.

A fork too heavy for the plan — a design question whose answer rewrites the
work — is a batch of its own: it leads the table and launches with the first
wave, and the dependent batches are planned behind its gate. The tracker is the
source of truth for the answer, not this session's conversation.

## Launching

`hcb-dev:wave-dispatch` — chips for the wave whose gate is clear, every batch
recorded in the ledger as it is hung. What the dispatch skill owes the batches
mid-flight — boundary amendments re-issued, a batch that never reported
checked on — is part of this role's loop, not a one-time launch step.

## The loop

Every event lands in the ledger before the conversation moves on
(`wave-ledger.md`); the table says what each one takes besides.

| Event | Do | Ledger |
|---|---|---|
| a batch's **start report** | check it against the plan — a scope read wider or narrower than the batch was drawn, a boundary read differently, a premise it says fell — and answer what diverges ahead of that batch's other traffic, since the batch holds only the work the divergence touches | the row, carrying what the answer changed |
| a **question** from a batch | answer after re-verifying, never from memory: read the code the question is about; where the batch's own analysis came along, check it and say which parts held — a confirmation that merely echoes is adoption. `architecture-decisions.md` decides which answers must first go to the user. Every answer carries the coordinates that let the batch re-verify it back, and one that changes what a batch is building is written at its coordinate before it is sent, the message that follows pointing at that record (`session-comms.md`) | decisions; expectations, while an answer waits on the user |
| a **status** at one of the order's milestones | read it at the coordinate it carries; a readiness report is what advances the merge queue (below) | the row, and the queue |
| a **return** | accept per `order-return.md`, and check it against the ledger's standing constraints besides: a claim that touches one ("that request is harmless") is verified in the tree and the tracker before either the claim or the constraint is believed. Acceptance ends in the words the worker waits for — accepted and free, or reopened naming the gap. A return that answers what a gate waits on is checked against the gates as a landing is | the row to `accepted`, which frees the session and not yet the batch; to `released` once nothing of that batch is outstanding — its landing accounted for, its candidates ruled by the pass below. A row left at `accepted` holds the epic open |
| **candidates** for the tracker, arriving with a return | rule them cold, and together — never on the return that carried them: they accumulate and are decided in one pass at the close of the round, read against each other and against what the backlog already holds (`findings.md`); each ends in one of that file's outcomes, and a candidate ruled **DROP** is answered with the reason. The ruling is not the authorization to write: what that file's own rule leaves with the user goes to them, this session's recommendation first. What is opened is opened here — a batch accepted on its return is free before this pass runs, so a worker files its own only where the pass ruled its candidates before it was released | the candidates as they arrive; the rulings |
| a **new issue** born mid-epic | classify it here (`hcb-dev:issue-tracking`) — a worker's proposed milestone or label is a claim to verify, not a decision to adopt | journal; the row of the batch it belongs to |
| a batch reports **ready**, in whichever words its order gave it for the mode it runs in (`hcb-dev:wave-dispatch`) | take it into the queue and give the go where the slot is already free. The merge is never this session's to take, whatever the queue says: the batch takes it, and everything its own completion owes behind it. A batch holding an `ask` reaches the user through this session, its recommendation first, and the answer travels back down as that batch's go. Where the epic stands at `ask` and the plan fixes a landing order, the order is held here: a later batch's question waits until the earlier one has landed, rather than reaching the user beside it | merge queue and gates |
| a **landing** — by its batch, by another session, or by the user | speak the queue to the batches it moves: the go to the batch whose slot it freed, BEHIND — with the seam owing a rebase — to the batch it displaced; a queue whose go never reaches its batch is a deadlock, not an order. Check the landing against the gates: a wave whose gate just cleared goes back to Launching, and so does a landing that opens the next step of a staged wave already running. A landing that happened without this session's go still reaches its batch before anything else is sent | the landing with whoever took it, and what its tail left standing; the queue and the gates |
| a **survey** of the slice handed over | record its reading whole before anything is drawn from it — the pin, the moment it read the tracker at, the ground it covered, and its verdicts for what the verdicts section holds, never one part without the rest — and only where it read the slice later than the reading the ledger already carries; an older one leaves that reading standing and is reported rather than recorded. Then the pass below | the reading, whole |
| a landing **freed ground**, a **tracker edit the plan waited on** executed — a body rewritten, an issue closed, a milestone moved, a dependency link corrected — or the user asks what else can run beside what is running, what blocks, or what to take next | recompute, never recall (`hcb-dev:wave-refresh`): it reads the delta from the point it resolves rather than the backlog again, and what it frees goes back to Launching behind the user's word on its layout | what that pass writes |
| the **plan** is drawn or redrawn, or a **wave** opens or closes | advance the epic's human half too — the wave table in its body, not only the ledger comment | the wave; what a redraw moved |
| a **lesson** one batch paid for | tell the batches it can still bite, the moment it is learned | journal |
| the **plugin moved** under this session | it moved under its batches too: refresh here first (`hcb-dev:session-plugin-refresh`), then send every batch still engaged the word that theirs moved as well — each is running under the copy it loaded, and a batch never told goes on building against text this session has already replaced. What that refresh changes for a batch already building travels as an amendment (`session-comms.md`), not as a new order | the header's version |

Across every row, **the user outranks the loop**: irreversible and outward-facing
actions, and every fork `architecture-decisions.md` routes to a person, go to the
user — with this session's recommendation first.

## After a restart or compaction

The ledger first — the title names the epic, and the epic holds the ledger.
What it records as the master's name is this session's own, in
`session-naming.md`'s shape: wear that before anything is sent, since the
batches' orders address it. Then read back what this session actually answers
to: where the host would not give that name — it handed back a variant, or a new
session took over the role — what answers wins, the ledger header is corrected
to it before anything else is sent, and the batches hear it as the change
`session-comms.md` has them announce. Then the live
registry, then a re-introduction to
every batch still engaged, carrying what first contact carries: the name this
session answers to, the standing plan, and a status request. Expectations the ledger lists and the registry cannot
see are chased by the comms ladder, not assumed dead.

## Closing the epic

Verify the epic against the ledger — every batch ended, released, withdrawn or
failed alike, with whatever any of them left standing accounted for; every issue
at the end state the ledger now records for it; every mandate met — then report
to the user per
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
- [`../../references/findings.md`](../../references/findings.md)
