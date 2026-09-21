---
name: wave-dispatch
description: >-
  Turn a planned batch of work into launched parallel sessions — one chip per
  batch, the wave order inside, or the same order as a fenced block where chips
  are unavailable. Use when a coordinating (master) session is told to hang
  chips or launch the waves ("повесь чипы", "запусти волны/батчи в сессиях",
  "раздай работу по сессиям"), and when a hung chip goes stale and needs
  re-issuing or withdrawing. Preflight pins the base and checks what holds each
  batch — an environment blocker, an issue body a survey ruled `needs rewrite`;
  a held batch is reported with the condition that releases it, never hung. The coordinating role around it is `hcb-dev:master-session`; the
  receiving side of every order it writes is `hcb-dev:wave-worker`. For one
  ad-hoc order pasted by hand use `hcb-dev:session-dispatch`; for work already
  finished that another session receives, `hcb-dev:session-handoff`.
---

# Wave dispatch

A batch is one session's worth of work; what a wave is, and how a split was
drawn, is
[`../../references/wave-planning.md`](../../references/wave-planning.md)'s. This
skill takes batches already planned — by the coordinating session's own
analysis — and launches them. The order it
writes obeys [`../../references/session-prompts.md`](../../references/session-prompts.md),
settles every slot of [`../../references/order-anatomy.md`](../../references/order-anatomy.md),
and addresses its receiver per [`../../references/session-comms.md`](../../references/session-comms.md).
**Paths**, substituted at invocation — use verbatim: `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}`.

## Preflight — before anything is hung

- **Pin the base**: resolve it per
  [`../../references/base-resolution.md`](../../references/base-resolution.md),
  refresh it, and write the pin as `<remote>/<branch>@<sha>` — one pin, shared
  by every batch hung together. A staged wave pins again at each step, on the
  tip its predecessor's landing left.
- **Read this session's own name** as the channels show it, never assumed from
  what this session set, before it goes into the `Master:` slot
  (`session-comms.md`).
- **Check each batch's environment blockers** — an SDK that must be installed,
  a service that must answer. A batch whose blocker stands is **not hung**: it
  is reported with the blocker and the condition that unhangs it.
- **Check the bodies each batch stands on** — every issue of the wave read in
  one call, the form
  [`../../references/issue-currency.md`](../../references/issue-currency.md)
  gives under "What is read": an issue ruled `needs rewrite` whose body still
  says otherwise holds its batch exactly as the blocker above does — **not
  hung**, reported with that rewrite as the condition that releases it. Nothing
  else releases it, a verdict carried in the order included.
- **Check the round that cleared this wave's gate is closed** — returns accepted,
  candidates ruled, and the tracker writes this wave stands on executed or deferred
  by the user's word (`hcb-dev:master-session`). An epic's first wave, and ground a
  capacity pass freed, have no round to close. A batch one of those writes still
  holds is **not hung**: report it with that write as the condition releasing it.
- **A layout this preflight corrects after the user's word on it** — a zone
  redrawn, a seam found or dissolved — is corrected here, before the steps below
  read it, and goes out as its own message **before the first chip goes up**: the
  report of `Without your word` alone
  ([`../../references/report-format.md`](../../references/report-format.md)), a
  hung chip being clickable before any report arrives. The launch report carries it
  again at the top. The narrowing and the landing order a corrected seam implies
  are the steps below settling it, named in that report. A correction that moves an
  issue between batches, or changes which batches the wave holds, goes back to the
  user as an ask that **holds the wave**.
- **Settle each batch's merge authority** from the epic's policy
  ([`../../references/slice-completion.md`](../../references/slice-completion.md);
  *An authority narrows on the way down and never widens*). Narrowing to `queued`
  is **required** wherever the plan fixes a landing order: a seam shared with
  another batch, a batch standing on another's merge. An epic already at `ask` is
  **stricter** than `queued` and stays as it is — the landing order is then held by
  the order this session puts its questions in, never by trading a person's answer
  for the queue's.
- **Check what is already out**: a chip still pending for the same batch is
  withdrawn (`dismiss_task`) before a replacement goes up, and a batch already
  running in a session is not chipped again.
- **Chips go up for the wave whose gate is clear, in the number its launch order
  allows.** A staged wave hangs one, and the next only once the one before it has
  merged and the master's landing row has cleared that landing against its checks —
  a read outcome is not a cleared one. **A later wave's batch is never hung early**:
  a hanging chip invites a click, and a click before the gate starts the batch on a
  base its dependency never reached. The order's `Start:` slot says the same to a
  receiver started by hand.

## The chip

One chip per batch, through the host's chip tool (`spawn_task`):

- **title** — the batch shape of
  [`../../references/session-naming.md`](../../references/session-naming.md), as
  that reference leaves it under the titling tool's cap; the order's first line
  carries that same string.
- **tldr** — why this batch exists, one sentence for the human deciding to
  click.
- **cwd** — the repository's main checkout. The host is expected to start the
  session in a worktree of its own — the order tells the receiver to verify
  that rather than trust it.
- **prompt** — the wave order below.

The click is the user's, and its timing with it; how many batches stand
clickable at once is the plan's launch order. Say both in the launch report
rather than waiting silently.

## The wave order

One per batch, and its text is
[`references/wave-order.md`](references/wave-order.md) — the receiver carries this
plugin, but the order is what it reads before any of it, so that file is written to
be read whole rather than to point.

## While batches run

- **A boundary renegotiated with one batch is re-issued to every batch sharing
  it** — recorded at the ledger's coordinate, then sent as a one-line amendment
  naming the file and its new owner, before the asking batch builds on the
  change. The launch-time order is not the last
  word on a shared file.
- **A staged wave's next chip goes up when the one before it lands and the
  master has cleared that landing against its checks** — the preflight above is
  run again for that step alone, its own pin included. A step
  whose predecessor reached a terminal state without landing waits for nothing:
  the wave is replanned from there. A staged wave whose next step is
  never hung is a stall, not a finished launch.
- **A chip the base has moved past is withdrawn before it is read** —
  `dismiss_task` first, since a chip left hanging is clickable while the delta
  from its pin is still being verified; then re-issue on a fresh pin, and the row
  carrying it names that pin.
- **A batch whose start report never arrives is unreached**, whatever its chip
  says — check on it rather than assuming the name made contact.

## When a return arrives

Acceptance is
[`../../references/order-return.md`](../../references/order-return.md)'s, and
it ends in words the worker is waiting for: accepted — the work taken and the
session free, the batch standing at `accepted` until the master releases it — or
reopened, naming what is missing. Confirming the follow-up
issues a return proposes is part of acceptance, on the authorization the order
itself carried.

## Where chips are unavailable

The same order goes out as a fenced block for the user to paste — the delivery
form of `session-prompts.md` — one block per batch. The order already carries
what the manual path needs: the `Start:` gate, and a `Where to work` that makes
the receiver verify its worktree instead of trusting how it was launched.

## Afterwards

The launch goes to the user as a wave report (`report-format.md`), after the
correction the preflight already owed them: the
chips stand in its rows — batch id, topic, what each waits on, the boundaries it
shares and with whom — naming the plan's launch order and, for a staged wave,
which step this is and what has to land before the next chip goes up. Record each
batch beside its tag in the coordinating session's own record, per
`order-anatomy.md`. A preflight that held every batch hangs no chip, and that
report still goes out — each held batch carrying the condition that releases it.
When the plan changes, withdraw the chips it obsoleted (`dismiss_task`) and say
so.

## Reference files

- [`../../references/wave-planning.md`](../../references/wave-planning.md)
- [`../../references/session-prompts.md`](../../references/session-prompts.md)
- [`../../references/order-anatomy.md`](../../references/order-anatomy.md)
- [`../../references/order-return.md`](../../references/order-return.md)
- [`../../references/session-comms.md`](../../references/session-comms.md)
- [`../../references/session-naming.md`](../../references/session-naming.md)
- [`../../references/base-resolution.md`](../../references/base-resolution.md)
