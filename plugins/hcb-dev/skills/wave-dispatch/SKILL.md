---
name: wave-dispatch
description: >-
  Turn a planned batch of work into launched parallel sessions — one chip per
  batch, the wave order inside, or the same order as a fenced block where chips
  are unavailable. Use when a coordinating (master) session is told to hang
  chips or launch the waves ("повесь чипы", "запусти волны/батчи в сессиях",
  "раздай работу по сессиям"), and when a hung chip goes stale and needs
  re-issuing or withdrawing. Preflight pins the base and checks each batch's
  environment blockers; a blocked batch is reported with its unblock condition,
  never hung. The coordinating role around it is `hcb-dev:master-session`; the
  receiving side of every order it writes is `hcb-dev:wave-worker`. For one
  ad-hoc order pasted by hand use `hcb-dev:session-dispatch`; for work already
  finished that another session receives, `hcb-dev:session-handoff`.
---

# Wave dispatch

A batch is one session's worth of work; a wave is the set of batches launched
together once its gate clears. This skill takes batches already planned — by
the coordinating session's own analysis — and launches them. The order it
writes obeys [`../../references/session-prompts.md`](../../references/session-prompts.md),
settles every slot of [`../../references/order-anatomy.md`](../../references/order-anatomy.md),
and addresses its receiver per [`../../references/session-comms.md`](../../references/session-comms.md).

## Preflight — before anything is hung

- **Pin the base**: resolve it per
  [`../../references/base-resolution.md`](../../references/base-resolution.md),
  refresh it, and write the pin as `<remote>/<branch>@<sha>` — one pin, shared
  by every batch of the wave.
- **Check each batch's environment blockers** — an SDK that must be installed,
  a service that must answer. A batch whose blocker stands is **not hung**: it
  is reported with the blocker and the condition that unhangs it.
- **Check what is already out**: a chip still pending for the same batch is
  withdrawn (`dismiss_task`) before a replacement goes up, and a batch already
  running in a session is not chipped again.
- **Chips go up for the wave whose gate is clear.** A later wave's batch is not
  hung early — a hanging chip invites a click, and a click before the gate
  starts the batch on a base its dependency never reached. The order's `Start:`
  slot says the same to a receiver started by hand.

## The chip

One chip per batch, through the host's chip tool (`spawn_task`):

- **title** — the batch shape of
  [`../../references/session-naming.md`](../../references/session-naming.md).
- **tldr** — why this batch exists, one sentence for the human deciding to
  click.
- **cwd** — the repository's main checkout. The host is expected to start the
  session in a worktree of its own — the order tells the receiver to verify
  that rather than trust it.
- **prompt** — the wave order below.

The click is the user's: how many batches run in parallel, and when, is their
call. Say so in the launch report rather than waiting silently.

## The wave order

Every slot is `order-anatomy.md`'s; the wave adds boundaries, the master
contact, and the reporting protocol. The receiver reads this text, not the
references — the closing steps spell themselves out.

```text
Batch `<epic>/<id> — <topic> (<issues>)`, wave <n>, dispatched from its master
session —
you did not do this work; this is your task: <the ask, in one line>. Act per
hcb-dev:wave-worker.

Work: <the issues, in order — what to take first and why>
What is settled: <facts with coordinates, each with how it was verified>
Not checked: <what the master left open, so you do not read it as known>

Start: <now | after <gate> — do not begin before it>
Where to work: your own worktree, and only it — the main checkout is shared
with other sessions. Verify you are in a worktree of your own before the first
write; where you are not, cut your own worktree from <the base | the branch
batch `<epic>/<id>` is building on, where this batch stacks on it>. <Or: no
checkout is touched.>
Base pin: <remote>/<branch>@<sha> — the commit these facts were verified on.
The delta from the pin to the tip you read these facts against is the list to
re-verify, before anything of yours rests on them. Do not build on the pin.
<Or: no base pin — these facts are the tracker's, and you re-verify them
there.> An issue among them you rule against the code at its own coordinates
before anything of yours rests on it, and never against what its body says:
anything short of the issue still being true of the tree — outrun, misleading,
or not checkable from where you stand — is a premise that fell. It goes to the
master the moment it does, and nothing is built on that issue until the master
answers.

Boundaries: <the files this batch owns; each component shared with another
batch and how the files split; what is not yours to touch>

Run this through <the process — /hcb-dev:implementation-workflow where there is
something to build, in full: its local review across every reviewer and the
subagents its skills ask for are part of the ask; a batch with nothing to build
names what runs instead>. <Plus <domain methodology> — mandatory.> <checks> must
pass.
Completion: <mode> — settled here, so don't ask.
Merge authority: <on green | the master's go — the queue decides your turn:
report "green, waiting for the slot" and hold; green is readiness, not the
slot> — settled here too.
Decide yourself: <forks>. Agree with the master BEFORE building: <forks>.
Through the master to the user: <forks>.

Done means: <the terminal deliverable>

Don't <what would duplicate or undo another batch's work, and the tracks that
are not yours>

Master: <its title>, session id <session-id>. The wave ledger — standing
constraints included — is <its coordinate; or: local to the master>. On start, confirm
your composition to it and name your own title and session id. Report status
when <the milestones — in request mode a change request opens and "green,
waiting for the slot"; in either mode you land it or it lands without you; you
are stuck>.
Questions go to the master; master unreachable — to your user in chat, and
keep working on what does not depend on the answer.
Last: the return per hcb-dev:wave-worker — the full report to <the tracker
coordinate — the epic, the batch's issues; or: no tracker here — return in
full to the master>, a short notice to the master. Filing the follow-up issues
your return proposes is authorized once the master confirms them. Your session
is not free until the master accepts.
```

## While batches run

- **A boundary renegotiated with one batch is re-issued to every batch sharing
  it** — a one-line amendment naming the file and its new owner, sent before
  the asking batch builds on the change. The launch-time order is not the last
  word on a shared file.
- **A batch that never confirms its composition is unreached**, whatever its
  chip says — check on it rather than assuming the title made contact.

## When a return arrives

Acceptance is
[`../../references/order-return.md`](../../references/order-return.md)'s, and
it ends in words the worker is waiting for: accepted — the batch closed, the
session free — or reopened, naming what is missing. Confirming the follow-up
issues a return proposes is part of acceptance, on the authorization the order
itself carried.

## Where chips are unavailable

The same order goes out as a fenced block for the user to paste — the delivery
form of `session-prompts.md` — one block per batch. The order already carries
what the manual path needs: the `Start:` gate, and a `Where to work` that makes
the receiver verify its worktree instead of trusting how it was launched.

## Afterwards

Report the launch to the user as a table — batch id, topic, chip, boundaries
shared with whom — with the launch-order advice the plan implies (which batch
must not go last, which pair is best together). Record each batch beside its
tag in the coordinating session's own record, per `order-anatomy.md`. When the
plan changes, withdraw the chips it obsoleted (`dismiss_task`) and say so.

## Reference files

- [`../../references/session-prompts.md`](../../references/session-prompts.md)
- [`../../references/order-anatomy.md`](../../references/order-anatomy.md)
- [`../../references/order-return.md`](../../references/order-return.md)
- [`../../references/session-comms.md`](../../references/session-comms.md)
- [`../../references/session-naming.md`](../../references/session-naming.md)
- [`../../references/base-resolution.md`](../../references/base-resolution.md)
