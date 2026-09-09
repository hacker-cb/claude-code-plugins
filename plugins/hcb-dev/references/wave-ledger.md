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

The comment is the only form the ledger takes, so a tracker is what the role
stands on: whether the repository has one is established against the forge —
the field naming it is `forge-docs.md`'s — while the role is being assumed and
before the epic is settled, never inferred from what the epic looks like. An
epic with no umbrella issue is an umbrella not yet filed, not a repository
without a tracker. Where the answer is that there is none — the field says so,
or no forge answers for the remote at all — the role does not begin, and what
was established goes to the user in those words.

**One epic, one ledger.** The marker is searched before one is opened, and what
it finds is edited rather than joined by a second — a later wave of the same
epic continues the comment its predecessor wrote. Two comments bearing the
marker are repaired before the next chip goes up: a coordinate resolving to two
states resolves to neither.

**A refused write archives and retries, and asks nothing.** The cap announces
itself by refusing a write, never by a number carried here, and that refusal is
answered in the same step rather than reported: the oldest closed unit moves
out, and the entry is written after it. What leaves is the journal while it is
still inline, and after that a closed wave — its batches released, its gates
spent. It goes verbatim into a comment of its own marked
`<!-- wave-journal-<n> -->`, which carries no part of the ledger's own marker,
so the search above still finds one comment; it is listed in the ledger, the
last of them takes new entries, and a pointer stands where the text did. This
is bookkeeping and not a decision — it needs no permission, and it is reported
in one line once done rather than announced while it is still coming. What is
still open never leaves, and nothing is shortened to fit: a section summarised
is a section that will be believed in its summarised form. A refusal with
nothing closed left to move is the one case that stops and goes to the user.

## What it holds

What is still acted on. How it came to be known belongs to the journal, and the
test on a passage is whether deleting it changes what anyone does next.

1. **Header** — the epic, the master's name — rewritten whenever it changes —
   the current wave's base pin (`<remote>/<branch>@<sha>`), the epic's merge
   authority as the user settled it
   ([`slice-completion.md`](slice-completion.md)), when last updated.
2. **Batches** — one row each: id, topic, issues, the order's ask and terminal
   deliverable in its own words (the acceptance contract — a return is judged
   against this row, not against recall), the order's base pin, chip, the
   session's name, state, result coordinates. States:
   `planned → chipped → started → confirmed → building → completed(<mode> —
   request merged, merged locally, tracker state delivered, verdict delivered)
   → accepted → released`; a batch can instead stand at `blocked(<condition>)`
   or end at `withdrawn(<reason>)` or `failed(<what stands>)` — a state is
   advanced, never skipped silently.
3. **Decisions** — every fork settled during the epic: who asked, what was
   decided, where it is recorded (issue, change request) — the decision, not the
   case that was made for it.
4. **Standing constraints** — what no batch may violate while the epic runs: a
   change request that must not merge, a foreign stash, a pinned version. A
   return whose claims touch one of these is checked against it before either
   is believed. Each is written as the rule a batch acts on; how it came to be
   known is journal, and a constraint carrying its own derivation is where the
   ledger grows.
5. **Merge queue and gates** — the order inside the current wave, each batch
   whose authority the header's policy was narrowed for and why, which batch
   stands ready and waiting for its slot, in either mode (written the moment
   the report arrives — a restart must not lose a batch holding on the queue);
   each landing
   with whoever took it — its batch, another session, or the user — and what its
   tail left standing; and what opens each later wave.
6. **Expectations** — what is awaited from whom: unconfirmed batches, answers
   owed, mandates given with the order's authorization and not yet met.
7. **Journal** — one line per event, terse, newest last; and the account behind
   a constraint or a decision, at the length it takes. The ledger carries what
   is acted on and the journal how it was arrived at — and the journal is what
   moves out first.

## Discipline

- **Write on every event** — a chip hung, a batch confirmed, a fork settled, a
  return accepted, a constraint discovered — before the conversation moves on.
- **Read it first after any restart or compaction**, before the live registry
  is even listed: the ledger says who is expected to exist; the live registry
  only says who answers right now.
- A batch released and a wave closed are written as such; the epic's closing
  line is the ledger's last edit.
