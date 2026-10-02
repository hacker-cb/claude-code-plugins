---
name: wave-dispatch
description: >-
  Turn a planned batch of work into launched parallel sessions — each started by
  this session in a terminal session of its own where its terminal answers, as a
  chip where the host offers one, or as a fenced block to paste where neither
  does; the wave order inside. Use when a coordinating (master) session is told
  to launch the waves or hang chips ("запусти волны/батчи", "повесь чипы",
  "раздай работу по сессиям"), and when a batch that went out goes stale and
  needs re-issuing or withdrawing. Preflight pins the base and checks
  what holds each batch — an environment blocker, an issue body a survey ruled
  `needs rewrite`; a held batch is reported with the condition that releases it,
  never sent out. The coordinating role around it is `hcb-dev:master-session`;
  the receiving side of every order it writes is `hcb-dev:wave-worker`. For one
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
and addresses its receiver per [`../../references/session-comms.md`](../../references/session-comms.md);
how a batch goes out is [`../../references/batch-launch.md`](../../references/batch-launch.md)'s.
**Launch settings**, substituted at invocation — use verbatim, quotes included: `--model-config '${user_config.batch_model}' --effort-config '${user_config.batch_effort}' --profiles '${user_config.batch_profiles}' --ceiling-5h '${user_config.batch_ceiling_5h}' --ceiling-7d '${user_config.batch_ceiling_7d}'`.
**Paths**, substituted at invocation — use verbatim: `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}`.

## Preflight — before any batch goes out

- **Pin the base**: resolve it per
  [`../../references/base-resolution.md`](../../references/base-resolution.md),
  refresh it, and write the pin as `<remote>/<branch>@<sha>` — in `local` mode the
  local parent holding its remote copy, as `<branch>@<sha>` — one pin, shared
  by every batch sent out together. A staged wave pins again at each step, on the
  tip its predecessor's landing left.
- **Read this session's own name** as the channels show it, never assumed from
  what this session set, before it goes into the `Master:` slot
  (`session-comms.md`); the `Session group:` slot takes the group the epic's
  ledger header records, and the order names three coordinates — the epic's
  ledger, this wave's ledger, and the wave's issue its returns go to
  ([`../../references/epic-structure.md`](../../references/epic-structure.md)),
  all three standing before any batch goes out — save the wave an epic still in
  format 1 is finishing, which runs on its one ledger
  ([`../../references/epic-migration.md`](../../references/epic-migration.md)).
- **Check each batch's environment blockers** — an SDK that must be installed,
  a service that must answer. A batch whose blocker stands **does not go out**: it
  is reported with the blocker and the condition that releases it.
- **Check the bodies each batch stands on** — every issue of the wave read in
  one call, the form
  [`../../references/issue-currency.md`](../../references/issue-currency.md)
  gives under "What is read": an issue ruled `needs rewrite` whose body still
  says otherwise holds its batch exactly as the blocker above does — **not
  sent out**, reported with that rewrite as the condition that releases it. Nothing
  else releases it, a verdict carried in the order included.
- **Check the round that cleared this wave's gate is closed** — returns accepted,
  candidates ruled, and the tracker writes this wave stands on executed or deferred
  by the user's word (`hcb-dev:master-session`). An epic's first wave, and ground a
  capacity pass freed, have no round to close. A batch one of those writes still
  holds **does not go out**: report it with that write as the condition releasing it.
- **A layout this preflight corrects after the user's word on it** — a zone
  redrawn, a seam found or dissolved — is corrected here, before the steps below
  read it, and goes out as its own message **before the first batch goes out**: the
  report of `Without your word` alone
  ([`../../references/report-format.md`](../../references/report-format.md)), a
  launched batch acting, and a hung chip being clickable, before any report arrives. The launch report carries it
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
- **Settle the way each batch goes out**, its model and effort, and for aimux
  its profile (`batch-launch.md`). The first launch of a wave is
  previewed with `--dry-run`, its answer in the launch report.
- **Check what is already out**: a chip still pending for the same batch is
  withdrawn (`dismiss_task`) before a replacement goes up, a batch whose session
  this session launched is `check`ed rather than launched again, and a batch
  already running in a session is not sent out twice.
- **Batches go out for the wave whose gate is clear, in the number its launch
  order allows.** A staged wave sends one, and the next only once the one before it
  has merged and the master's landing row has cleared that landing against its
  checks — a read outcome is not a cleared one. **A later wave's batch never goes
  out early**: a hanging chip invites a click, a launch starts the batch at once,
  and either before the gate starts it on a base its dependency never reached. The
  order's `Start:` slot says the same to a receiver started by hand.

## Launching

One way per batch, as the preflight settled it:

- **In a terminal session of this session's own** — `launch` per `batch-launch.md`. Its
  `record` goes into the batch's row before anything else is sent.
- **As a chip**, through the host's chip tool (`spawn_task`): **title** the batch
  shape of [`../../references/session-naming.md`](../../references/session-naming.md)
  under the titling tool's cap, the order's first line carrying the same string;
  **tldr** why this batch exists, one sentence for the human deciding to click;
  **cwd** the repository's main checkout — the host starts the session in a worktree
  of its own, which the order has the receiver verify; **prompt** the wave order.
  The click is the user's, and its timing with it — say so in the launch report.
- **By hand**, where neither answers: the same order as a fenced block, one per
  batch, the delivery form of `session-prompts.md` — its row `chipped`, as a chip's is.

## The wave order

One per batch, and its text is
[`references/wave-order.md`](references/wave-order.md) — the receiver carries this
plugin, but the order is what it reads before any of it, so that file is written to
be read whole rather than to point.

## While batches run

- **A boundary renegotiated with one batch is re-issued to every batch sharing
  it** — recorded in the wave's ledger, then sent as a one-line amendment
  naming the file and its new owner, before the asking batch builds on the
  change. The launch-time order is not the last
  word on a shared file.
- **A staged wave's next batch goes out when the one before it lands and the
  master has cleared that landing against its checks** — the preflight above is
  run again for that step alone, its own pin included. A step
  whose predecessor reached a terminal state without landing waits for nothing:
  the wave is replanned from there. A staged wave whose next step never
  goes out is a stall, not a finished launch.
- **A chip the base has moved past is withdrawn before it is read** —
  `dismiss_task` first, since a chip left hanging is clickable while the delta
  from its pin is still being verified; then re-issue on a fresh pin, and the row
  carrying it names that pin.
- **A batch whose start report never arrives is unreached**, whatever its chip
  or its launch says — `check` a launched one, ask after a chip, rather than
  assuming the name made contact.

## When a return arrives

Acceptance is
[`../../references/order-return.md`](../../references/order-return.md)'s, and
it ends in words the worker is waiting for: accepted — the work taken and the
session free, the batch standing at `accepted` until the master releases it — or
reopened, naming what is missing. Confirming the follow-up
issues a return proposes is part of acceptance, on the authorization the order
itself carried.

## Afterwards

The launch goes to the user as a wave report
([`../../references/report-blocks.md`](../../references/report-blocks.md)), after the
correction the preflight already owed them: the batches stand in its `## Where it stands`
rows, each naming its topic, the way it went out, and the boundaries it shares and with whom — naming the plan's launch order and, for a staged wave,
which step this is and what has to land before the next batch goes out. Record each
batch beside its tag in the coordinating session's own record, per
`order-anatomy.md`. A preflight that held every batch sends none out, and that
report still goes out — each held batch carrying the condition that releases it.
When the plan changes, withdraw the chips it obsoleted (`dismiss_task`) and say
so.

## Reference files

- [`../../references/wave-planning.md`](../../references/wave-planning.md)
- [`../../references/batch-launch.md`](../../references/batch-launch.md)
- [`../../references/session-prompts.md`](../../references/session-prompts.md)
- [`../../references/order-anatomy.md`](../../references/order-anatomy.md)
- [`../../references/order-return.md`](../../references/order-return.md)
- [`../../references/session-comms.md`](../../references/session-comms.md)
- [`../../references/session-naming.md`](../../references/session-naming.md)
- [`../../references/base-resolution.md`](../../references/base-resolution.md)
- [`../../references/report-blocks.md`](../../references/report-blocks.md)
