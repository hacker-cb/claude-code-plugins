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

## Preflight — before anything is hung

- **Pin the base**: resolve it per
  [`../../references/base-resolution.md`](../../references/base-resolution.md),
  refresh it, and write the pin as `<remote>/<branch>@<sha>` — one pin, shared
  by every batch hung together. A staged wave pins again at each step, on the
  tip its predecessor's landing left.
- **Read this session's own name** — as the channels here show it, never
  assumed from what this session set — before it goes into the `Master:` slot;
  `session-comms.md` says what that slot carries where none of them names it.
- **Check each batch's environment blockers** — an SDK that must be installed,
  a service that must answer. A batch whose blocker stands is **not hung**: it
  is reported with the blocker and the condition that unhangs it.
- **Check the bodies each batch stands on**: an issue ruled `needs rewrite`
  ([`../../references/issue-currency.md`](../../references/issue-currency.md))
  whose body still says otherwise holds its batch exactly as the blocker above
  does — **not hung**, reported with that rewrite as the condition that releases
  it. Nothing else releases it, a verdict carried in the order included.
- **Check the round that cleared this wave's gate is closed** — its returns
  accepted, their candidates ruled, and the tracker writes those rulings ask for
  that this wave stands on executed or deferred by the user's word
  (`hcb-dev:master-session`). A wave no round opened — an epic's first, or ground
  a capacity pass freed — has none to close. A batch one of those writes still
  holds is **not hung**: report it with that write as the condition releasing it.
- **A layout this preflight corrects after the user's word on it** — a zone
  redrawn, a seam found or dissolved — is corrected here, before the steps below
  read it, and the correction reaches the user **before the first chip goes up**:
  a hung chip can be clicked before any report arrives. It leads the launch
  report as well
  ([`../../references/report-format.md`](../../references/report-format.md)). The
  narrowing and the landing order a corrected seam implies are the steps below
  settling it, named in that report; what goes back to the user instead of being
  hung is a correction moving an issue between batches, or changing which batches
  the wave holds.
- **Settle each batch's merge authority** from the epic's policy — which this
  session may narrow and never widen
  ([`../../references/slice-completion.md`](../../references/slice-completion.md)).
  Narrowing to `queued` is **required** wherever the plan fixes a landing
  order: a seam shared with another batch, a batch standing on another's
  merge. An epic already at `ask` is **stricter** than `queued` and stays as it
  is — the landing order is then held by the order this session puts its
  questions in, never by trading a person's answer for the queue's.
- **Check what is already out**: a chip still pending for the same batch is
  withdrawn (`dismiss_task`) before a replacement goes up, and a batch already
  running in a session is not chipped again.
- **Chips go up for the wave whose gate is clear, in the number its launch
  order allows** — a staged wave hangs one, and the next only once the one
  before it has merged and the master's landing row has cleared that landing
  against its checks — a read outcome is not a cleared one. A later wave's batch is not
  hung early — a hanging chip invites a click, and a click before the gate
  starts the batch on a base its dependency never reached. The order's `Start:`
  slot says the same to a receiver started by hand.

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

Every slot is `order-anatomy.md`'s; the wave adds boundaries, the master
contact, the reporting protocol, and the master as the addressee of the merge
authority. The receiver reads this text, not the
references — the closing steps spell themselves out.

```text
Batch `<epic>/<id> — <topic> (<issues>)`, wave <n>, dispatched from its master
session —
you did not do this work; this is your task: <the ask, in one line>. Act per
hcb-dev:wave-worker. The name in backticks above is this session's title: wear
it verbatim, whatever any channel shows this session as.

Work: <the issues, in order — what to take first and why>
What is settled: <facts with coordinates, each with how it was verified>
Not checked: <what the master left open, so you do not read it as known>

Start: <now | after <gate> — do not begin before it; it holds the reading
below as much as the building>. Once it is open, the start report described at
the end of this order goes out first, and building starts once it has.
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
Merge authority: <on-green — merge once the required gates pass | queued — the
queue decides your turn: report ready and hold, readiness not being the slot
("green, waiting for the slot" where a change request is what goes green;
"ready, waiting for the slot" in local mode) | ask — drive to ready and put the
go-ahead there>, addressed to the master below, which decides whatever this
authority or a stop above it leaves open and carries to the user what belongs
to a person — settled here too, both halves. The merge is yours to take when it
comes; narrowing what you were given is yours too, widening it never.
Decide yourself: <forks>. Agree with the master BEFORE building: <forks>.
Through the master to the user: <forks>.

Done means: <the terminal deliverable>

Don't <what would duplicate or undo another batch's work, and the tracks that
are not yours>

Master: <its name>. The wave ledger — standing constraints included — is
<its coordinate>, and it carries that name too, should this order's go stale.
Before you build, read the whole batch through — this order, the ledger, its
issues on the forge in full, the code they name — and send the master your
start report: what the work turned out to be. The name you answer to, the
scope you now read as yours — the files and the issues it touches, and what
taking it involves — the
order you will take it in, and everything that came back different from this
order: a boundary wrong from where you stand, a premise that fell, a fork nobody
foresaw. Then build: you do not wait for an answer to the report itself, and
nothing of yours rests on a divergence in it until the master answers that.
Report status when <the milestones — in request mode a change request opens;
under a queued authority, the readiness report above; the scope moving off your
start report; in either mode you land it or it lands without you; the checks on
that landing settle or your waiting on them stops first, neither of which the
landing status waits for; a word your own user gives you that touches this epic,
which the master cannot see — quoted in full and written at the coordinate this
order names, so it survives a restart; you are
stuck>, each carrying the coordinate that lets the master check it without
asking back: the change request by number and URL, a landing by its commit, its
checks by that same commit, a stall by what it waits on. An outcome you promised
is reported whichever way it came out.
Questions go to the master — the forks above, and every architectural one this
order did not foresee, before your own reading of it goes into the tree. An
answer you are still waiting for parks you and does not stop you: say in one
line what you are waiting on, then end your turn — with a wait armed that wakes
you again — because an answer may not reach you until your turn ends, and read
it at the coordinate that answer names rather than in your inbox alone; failing
that, at the ledger above and this batch's issues. Keep building
what the answer does not touch; a fork this order reserved stays reserved until
the master answers it. Silence is not unreachability, and neither is a master
shown between turns or a send the channel says it is holding: the master is
unreachable when neither registry resolves it, or when the channel itself
refuses to deliver, and so is one whose
silence outlasts your turns with nothing left to build around it. Then the
question goes to your user as a line you keep working past, never as one that
halts you until a person answers.
Last: the return per hcb-dev:wave-worker — the full report to <the tracker
coordinate — the epic, the batch's issues>, a short notice to the master.
Filing the follow-up issues your return proposes is authorized once the master
confirms them. Your session
is not free until the master accepts.
```

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
- **A chip the base has moved past is not offered as it stands** — re-verify the
  delta from its pin before it is put in front of the user again, or withdraw it
  (`dismiss_task`) and re-issue on a fresh pin; the row carrying it names the pin
  it stands on either way.
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

The launch goes to the user as a wave report (`report-format.md`) once the chips
are up — after the correction the preflight already owed them: the
chips stand in its rows — batch id, topic, what each waits on, the boundaries it
shares and with whom — naming the plan's launch order and, for a staged wave,
which step this is and what has to land before the next chip goes up. Record each
batch beside its tag in the coordinating session's own record, per
`order-anatomy.md`. When the plan changes, withdraw the chips it obsoleted
(`dismiss_task`) and say so.

## Reference files

- [`../../references/wave-planning.md`](../../references/wave-planning.md)
- [`../../references/session-prompts.md`](../../references/session-prompts.md)
- [`../../references/order-anatomy.md`](../../references/order-anatomy.md)
- [`../../references/order-return.md`](../../references/order-return.md)
- [`../../references/session-comms.md`](../../references/session-comms.md)
- [`../../references/session-naming.md`](../../references/session-naming.md)
- [`../../references/base-resolution.md`](../../references/base-resolution.md)
