# The wave order — the text a batch session is started with

Written by `hcb-dev:wave-dispatch`, one per batch, and carried either as a chip's
prompt or as a fenced block the user pastes
([`../../../references/session-prompts.md`](../../../references/session-prompts.md)).

Every slot is
[`../../../references/order-anatomy.md`](../../../references/order-anatomy.md)'s;
the wave adds boundaries, the master contact, the reporting protocol, and the
master as the addressee of the merge authority.

**The receiver reads this text, not the references** — it may be a session with no
plugin at all. That is why the closing steps spell themselves out instead of
pointing, and why rules stated elsewhere in this plugin are restated here in full:
the duplication is the delivery mechanism, not drift.

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

