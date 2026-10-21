# How a master session starts its batches

Read by the session coordinating an epic, wherever a batch goes out, comes back after a
restart, or ends. It owns the launch: the way a batch goes out, what it runs at and under,
and the calls that start, read, wake and archive it. What the order says differs by the way
it went out, and that is
[`../skills/wave-dispatch/references/wave-order.md`](../skills/wave-dispatch/references/wave-order.md)'s.
How many batches run at once is not this plugin's to bound: the host bounds what it starts, and a
launch it refuses goes to the user with the host's reason.

## The way a batch goes out

First that answers, in this order:

| way | answers when | who starts it |
|---|---|---|
| Helmhouse | this session holds `mcp__helmhouse__session_create` | this session |
| chip | this session holds the host's chip tool | the user's click |
| paste | always | the user, by hand |

The user's word overrides the way — for the epic, for one wave, or for one batch, the narrowest
standing; each lands in the ledger it belongs to ([`wave-ledger.md`](wave-ledger.md)). A way the
word names that does not answer here is not swapped for another: it goes to the user.

**Model, effort and profile.** A batch Helmhouse starts runs on the model and effort this session
runs on, under the profile `autoProfile` picks — the one with the most of its limits left among
those this session may hand work to. The user's word names another model, effort or profile, for
the epic, a wave or a batch, and it travels as `model`, `effort` or `profileId`. For a chip, a model
or effort the word names is set on the batch's session once its start report names it, where the
host offers `set_session_model` and `set_session_effort`. The start report says what the batch
actually runs at either way — a profile that does not offer the model starts it on that profile's
default — and a difference from the record goes to the user in a line.

## Before a wave's first launch

`whoami` and `profile_list`, both read-only — once before a wave's first launch, and again after a
refusal:

| field | what it settles |
|---|---|
| `whoami.sessionId` | this session's Helmhouse id — what each order's `Master:` slot carries |
| `whoami.limits`, `whoami.children` | the bounds the host puts on what this session starts, and how many of its children stand out of the archive now |
| `profile_list.autoPick` | the profile a batch would start under now |
| `profiles[].forChildren` | whether a batch may start under each profile here, and `why` not — `untrusted-folder` is the user's to give, by starting a session in this repository from Helmhouse under that profile |

Both go into the launch report. Nothing read here holds a launch back.

## Launching

`session_create`, one call per batch:

| field | value |
|---|---|
| `prompt` | the wave order, whole: it reaches the session as its first prompt |
| `title` | the batch's title, the string in backticks on the order's first line |
| `newBranch` | `<epic>-<id>` — Helmhouse makes the worktree `.claude/worktrees/<epic>-<id>` on that branch, cut from a base of its own rather than the wave's pin, which is why the order has the batch cut its own branch |
| `autoProfile` | `true`, unless the user's word names a `profileId` |
| `model`, `effort`, `profileId` | only where the user's word names them |

A batch is never launched twice: one whose row already holds a launch record, or whose title
`session_list` already shows, is read rather than launched. The call answers once the session
runs, with `sessionId`, `profileId`, `cwd` and `title`; that answer, the model and effort the batch
should run at and the moment, is its launch record, and goes into its row before anything else is
sent. A refusal starts nothing and names its reason. A branch `<epic>-<id>` that already stands is a
batch launched before, or what one left: read, never launched over. The bound on children out of the
archive is met by archiving the accepted batches first (below). Any other refusal goes to the user
as it came.

## While it runs, and after a restart

`session_status` with the record's `sessionId` reads one batch — its `status`, whether it is
`busy`, its `stopReason`, its `messagesWaiting`, and whether it is `archived`, its folder gone
(`cwdGone`) or writable (`canWrite`); `session_list` reads every batch under this session at once.
`session_wait` returns once a batch is idle, finished, waiting on an answer or failed — or once a
message reaches this session, whichever comes first. A batch whose start report never arrives is
read this way before anything is concluded about it.

Helmhouse carries its sessions across its own restart, so a batch is never launched again for
having been out of sight. One that stopped short of `accepted` runs again on a message sent with
`wake` ([`session-comms.md`](session-comms.md)): one paragraph in the epic's language, carrying the
batch's title in backticks, that its session was restored, the name of the master it reports to,
and to go on from where it stopped — reading the ledgers and its own transcript, its order among it,
before it acts. One whose `cwdGone` is `true` cannot run until its folder is back, which goes to the
user.

## Archiving it

A batch's session is archived once its row reaches `accepted`, unless the user asked to keep it or
it waits on the user: `session_archive` with the record's `sessionId`. The call waits, up to
`timeoutSeconds`, for nothing to run in that session's tree, and is refused while something still
does; Helmhouse takes the worktree away only where nothing would be lost there, and the branch only
where it was merged, and `session_unarchive` brings the session back whole. A refusal goes to the
user with its reason, and the session stays. A chip's session is archived with the host's
`archive_session`, where the host offers it; where it does not, archiving stays an ask in the
report.
