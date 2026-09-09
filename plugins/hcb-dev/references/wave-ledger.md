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
answered in the same step rather than reported — by which comment refused. A
refused **ledger** write moves the oldest archivable block out and writes the
entry again, as many times over as it takes to fit. Two things are archivable,
in this order: the journal while it is still inline, and after that a closed
wave — one whose batches have all ended, with anything they left standing
accounted for outside it, and whose gates are spent. A refused write to the
**journal archive** taking new entries opens the next archive and writes there
instead — moving anything out of the ledger would not free a byte of the comment
that refused. All of it is bookkeeping and not a decision: it needs no
permission, and it is reported in one line once done rather than announced while
it is still coming. What is still open never leaves, and nothing is shortened to
fit — a section summarised is a section that will be believed in its summarised
form. A refused ledger write with nothing archivable left, the journal already
out and no wave closed, is the one case that stops and goes to the user.

**An archive is a comment, and the ledger indexes it.** What leaves goes
verbatim under the marker `<!-- wave-journal-<n> -->`, which carries no part of
the ledger's own marker, so the search above still finds one comment; `<n>` runs
as one series over journal and closed wave alike, and a block too large for a
single comment takes as many as it needs. A pointer stands where the text did,
the ledger's journal section lists every archive in order, and new journal
entries go to the most recent journal archive — never into a closed wave's
snapshot, which is written once and left. Opening an archive is two writes and
they are ordered — the comment first, the ledger's own edit second — whether a
block is moving out of the ledger or a refused write is rotating into a fresh
archive, so an interruption leaves an archive nothing points at rather than an
index naming one that was never written. An archive the ledger does not list is
then the same fault as a second ledger marker: repaired before the next chip
goes up, by reading that list against what the epic carries.

## What it holds

What is still acted on. How it came to be known belongs to the journal, and the
test on a passage is whether deleting it changes what anyone does next.

1. **Header** — the epic, the master's name — rewritten whenever it changes —
   the base pin the wave's live step was hung on (`<remote>/<branch>@<sha>`),
   the epic's merge authority as the user settled it
   ([`slice-completion.md`](slice-completion.md)), when last updated.
2. **Batches** — one row each: id, topic, issues, the order's ask and terminal
   deliverable in its own words (the acceptance contract — a return is judged
   against this row, not against recall), the order's base pin, chip, the
   session's name, state, result coordinates. A batch runs
   `planned → chipped → started → confirmed → building → completed(<mode> —
   request merged, merged locally, tracker state delivered, verdict delivered)
   → accepted`, standing at `blocked(<condition>)` for as long as something
   holds it; a state is advanced, never skipped silently. It **ends** in one of
   three, and the three carry equal weight:
   - `released` — acceptance passed, the work landed, the batch was let go;
   - `withdrawn(<reason>)` — called off, from wherever it stood;
   - `failed(<what stands>)` — it did not come off, from wherever it stood, and
     what is still standing is named.

   A rule asking whether a batch is finished says which of the three it counts,
   and answers the question it actually needs: what landed is one question, what
   has nothing outstanding is another, and `released` alone is neither.
3. **Decisions** — every fork settled during the epic: who asked, what was
   decided, where it is recorded (issue, change request) — the decision, not the
   case that was made for it.
4. **Standing constraints** — what no batch may violate while the epic runs: a
   change request that must not merge, a foreign stash, a pinned version. A
   return whose claims touch one of these is checked against it before either
   is believed. Each is written as the rule a batch acts on, together with what
   would lift it; how it came to be known is journal, and a constraint carrying
   its own derivation is where the ledger grows.
5. **Merge queue and gates** — the current wave's launch order (at once, or
   staged with what each step waits on), the merge order inside it, each batch
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
   moves out first, so this section also indexes what has left: every archive in
   order, and which of them new entries are going to.

## Discipline

- **Write on every event** — a chip hung, a batch confirmed, a fork settled, a
  return accepted, a constraint discovered — before the conversation moves on.
- **Read it first after any restart or compaction**, before the live registry
  is even listed: the ledger says who is expected to exist; the live registry
  only says who answers right now.
- A batch's ending is written as such whichever of the three it is, and so is a
  wave closed; the epic's closing line is the ledger's last edit.
