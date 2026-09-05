# The wave ledger — the master's durable state

Read by the session coordinating an epic's batches. The ledger is what makes
acceptance, contradiction-checking and restart recovery independent of the
session's context window: everything the coordination must not forget lives
here, not in the conversation. For a master, this file **is** the "session's
own record" that [`order-anatomy.md`](order-anatomy.md) and
[`order-return.md`](order-return.md) match tags against.

## Where it lives

One comment on the epic issue, opened when the role is assumed and edited in
place from then on, carrying the marker `<!-- wave-ledger -->` so it is found
by content rather than by position. Every order names its coordinate, so a
batch reads the standing constraints itself. The exact list-and-edit
invocation is resolved per [`forge-docs.md`](forge-docs.md),
mirrored on both forges.

The epic's *body* stays human — the wave table, the progress — and the ledger
comment is the working state; the two are not copies of each other.

Where the repository has no tracker, the ledger is a file outside every
checkout: `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hcb-dev/ledgers/<repo>-<epic>.md`,
its `<epic>` the one fixed here per [`session-naming.md`](session-naming.md).
The fallback trades both properties away — it is machine-local and invisible
to the batches — so orders written from one say the ledger is local to the
master, and recovery ends at this machine's config directory.

## What it holds

1. **Header** — the epic, the master's title and session id, the current
   wave's base pin (`<remote>/<branch>@<sha>`), when last updated.
2. **Batches** — one row each: id, topic, issues, the order's ask and terminal
   deliverable in its own words (the acceptance contract — a return is judged
   against this row, not against recall), the order's base pin, chip, the
   session's title and session id, state, result coordinates. States:
   `planned → chipped → started → confirmed → building → completed(<mode> —
   request merged, merged locally, tracker state delivered, verdict delivered)
   → accepted → released`; a batch can instead stand at `blocked(<condition>)`
   or end at `withdrawn(<reason>)` or `failed(<what stands>)` — a state is
   advanced, never skipped silently.
3. **Decisions** — every fork settled during the epic: who asked, what was
   decided, where it is recorded (issue, change request).
4. **Standing constraints** — what no batch may violate while the epic runs: a
   change request that must not merge, a foreign stash, a pinned version. A
   return whose claims touch one of these is checked against it before either
   is believed.
5. **Merge queue and gates** — the order inside the current wave, which batch
   stands at "green, waiting for the slot" (written the moment the report
   arrives — a restart must not lose a batch holding on the queue); each landing
   with whoever took it — its batch, another session, or the user — and what its
   tail left standing; and what opens each later wave.
6. **Expectations** — what is awaited from whom: unconfirmed batches, answers
   owed, mandates given with the order's authorization and not yet met.
7. **Journal** — one line per event, terse, newest last.

## Discipline

- **Write on every event** — a chip hung, a batch confirmed, a fork settled, a
  return accepted, a constraint discovered — before the conversation moves on.
- **Read it first after any restart or compaction**, before the live registry
  is even listed: the ledger says who is expected to exist; `ListAgents` only
  says who answers right now.
- A batch released and a wave closed are written as such; the epic's closing
  line is the ledger's last edit.
