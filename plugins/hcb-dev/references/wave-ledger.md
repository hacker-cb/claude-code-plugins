# The wave ledger — the master's durable state

Read by the session coordinating an epic's batches. The ledger is what makes
acceptance, contradiction-checking and restart recovery independent of the
session's context window: everything the coordination must not forget lives
here, not in the conversation. For a master, this file **is** the "session's
own record" that [`order-anatomy.md`](order-anatomy.md) and
[`order-return.md`](order-return.md) match tags against.

## Where it lives

One comment on the epic issue, opened when the role is assumed and edited in place from then on,
carrying the marker `<!-- wave-ledger -->` so it is found by content rather than by position.
Every order names its coordinate, so a batch reads the standing constraints itself. The epic's
*body* stays human — the wave table, the progress — and the ledger comment is the working state;
the two are not copies.

**`scripts/ledger.mjs` answers where it stands**, and is read before every write:

```text
node <plugin root>/scripts/ledger.mjs --issue <n> [--repo <owner/name>] [--forge gh|glab]
  [--host <host>] [--body-file <path>] [--limit <n>]
```

| field | what it settles |
|---|---|
| `read` | the comment feed answered. `false` is unread, never "no ledger there" |
| `ledger.found` / `.id` / `.nodeId` / `.chars` | whether one is open, which comment it is — `id` for a REST edit, `nodeId` for GraphQL — and how large it stands |
| `ledger.ambiguous` | **two comments carry the marker** — a coordinate resolving to two states resolves to neither |
| `archives[]` | one row per `<!-- wave-journal-<n> -->` comment, with its own size |
| `index.listed` / `.missing` / `.unlisted` | what the ledger says it archived, against what the issue carries |
| `write.fits` / `.headroom` | whether a body handed in `--body-file` fits under the cap, and by how much |
| `faults[]` | every one of the above that has to be repaired before the next chip goes up |
| `reason` | why nothing could be answered — a feed that did not read, or **both forges answering for this repository**, which a mirror makes ordinary and `--forge` settles |

The comment is the only form the ledger takes, so a tracker is what the role stands on: whether
the repository has one is established against the forge ([`forge-docs.md`](forge-docs.md) names
the field) while the role is being assumed and before the epic is settled, never inferred from
what the epic looks like. An epic with no umbrella issue is an umbrella not yet filed, not a
repository without a tracker. Where there is none, the role does not begin, and what was
established goes to the user in those words.

**One epic, one ledger.** Two comments bearing the marker publish **no** coordinate at all —
`found` stays false and the ids travel in the fault — and an archive nothing indexes is the same
kind of fault; both are repaired before the next chip goes up.

## Archiving — what leaves, and in what order

**The write is measured before it is made.** The cap announces itself by refusing a write
([`forge-behaviour.md`](forge-behaviour.md) carries the number measured and says GitLab's is
unmeasured), so `write.fits` is read first and the refusal stays the backstop rather than the
mechanism — and **a refusal that arrives anyway is answered in the same step**, not reported: the
oldest archivable block moves out and the entry is written again, as many times over as it takes
to fit, on whichever comment refused. All of it is bookkeeping and not a decision: it needs no
permission, and it is reported in one line once done rather than announced while it is coming.

**What may leave, in this order**: the journal while it is still inline, and after that a closed
wave — one whose batches have all ended, with anything they left standing accounted for outside
it, and whose gates are spent. What is still open never leaves, and nothing is shortened to fit:
a section summarised is a section that will be believed in its summarised form. A ledger that
will not fit with the journal already out and no wave closed is the one case that stops and goes
to the user.

**An archive is a comment, and the ledger indexes it.** What leaves goes verbatim under
`<!-- wave-journal-<n> -->`, `<n>` running as one series over journal and closed wave alike, and
a block too large for one comment takes as many as it needs. The pointer standing where the text
did is **the archive's own marker**, which is what makes the index checkable at all: the ledger's
journal section lists every archive in order, in those markers, and new journal entries go to
the most recent journal archive — never into a closed wave's snapshot, which is written once and
left. **Two writes, and they are ordered**: the archive comment first, the ledger's own edit
second, so an interruption leaves an archive nothing points at — which `index.unlisted` catches
— rather than an index naming one that was never written. A refused write to the archive taking
new entries opens the next archive and writes there instead: moving anything out of the ledger
would not free a byte of the comment that refused.

## What it holds

What is still acted on. How it came to be known belongs to the journal, and the
test on a passage is whether deleting it changes what anyone does next.

1. **Header** — the epic; the master's name, rewritten whenever it changes; the base pin the
   wave's live step was hung on (`<remote>/<branch>@<sha>`); the pin of the last whole reading of
   the slice — a capacity refresh's or a survey's — with the moment it read the tracker at and
   the ground it covered, the two halves the next refresh takes its delta from, since an issue
   closes without a commit (`hcb-dev:wave-refresh`), and a reading of less than this slice does
   not take the slot; the epic's merge authority as the user settled it
   ([`slice-completion.md`](slice-completion.md)); the plugin version this role last reconciled
   against, which is what a later **plugin** refresh diffs from and not necessarily what the
   session is running — it starts as the running version and `hcb-dev:session-plugin-refresh`
   moves it; and when last updated.
2. **Batches** — one row each: id, topic, the issues and where each now stands, the order's ask
   and terminal deliverable in its own words (the acceptance contract — a return is judged
   against this row, not against recall), the file zone its order drew, the order's base pin,
   chip, the session's name, state, result coordinates. A batch runs `planned → chipped →
   started → confirmed → building → completed(<mode> — request merged, merged locally, tracker
   state delivered, verdict delivered) → accepted`, standing at
   `blocked(<condition>)` for as long as something holds it; a state is advanced, never skipped
   silently. It **ends** in one of three, and the three carry equal weight:
   - `released` — acceptance passed, the work landed, the batch was let go;
   - `withdrawn(<reason>)` — called off, from wherever it stood;
   - `failed(<what stands>)` — it did not come off, from wherever it stood, and
     what is still standing is named.

   A rule asking whether a batch is finished says which of the three it counts,
   and answers the question it actually needs: what landed is one question, what
   has nothing outstanding is another, and `released` alone is neither.
3. **Verdicts** — one line per open issue of the epic's slice that no batch has ended: the issue,
   the verdict [`issue-currency.md`](issue-currency.md) gave it, the coordinate that verdict stood
   on, and the pin and tracker moment it was read at. A survey's reading opens it; every capacity
   refresh writes back what it re-read and reads the rest from here rather than re-deriving them
   (`hcb-dev:wave-refresh`). A line leaves when its issue does.
4. **Decisions** — every fork settled during the epic: who asked, what was decided, where it is
   recorded — the decision, not the case that was made for it.
5. **Standing constraints** — what no batch may violate while the epic runs: a
   change request that must not merge, a foreign stash, a pinned version. A
   return whose claims touch one of these is checked against it before either
   is believed. Each is written as the rule a batch acts on, together with what
   would lift it; how it came to be known is journal, and a constraint carrying
   its own derivation is where the ledger grows.
6. **Merge queue and gates** — the current wave's launch order (at once, or staged with what
   each step waits on), the merge order inside it, each batch whose authority the header's policy
   was narrowed for and why, which batch stands ready and waiting for its slot in either mode
   (written the moment the report arrives — a restart must not lose a batch holding on the
   queue); each landing with whoever took it, what its tail left standing, and what the checks on
   it showed — nothing reporting over it and a base that runs no checks are both answers, and one
   nobody has read yet is recorded as unread rather than as either; and what opens each later
   wave.
7. **Expectations** — what is awaited from whom: unconfirmed batches, answers owed, mandates
   given and not yet met. Each carries who owes it, the moment it was first asked, and whether
   work stands on it — a chip hung and not yet clicked is owed by the user, one already clicked
   is awaited from the batch. The ones the user owes are what a report's ask block prints
   ([`report-format.md`](report-format.md)), so each carries what that block prints, or the
   coordinate where that text is written. A row leaves only with its outcome — answered or met,
   deferred by the user's word, withdrawn, failed with what still stands, or overtaken — named in
   the line that drops it.
8. **Journal** — one line per event, terse, newest last; and the account behind
   a constraint or a decision, at the length it takes. The ledger carries what
   is acted on and the journal how it was arrived at — and the journal is what
   moves out first, so this section also indexes what has left: every archive in
   order, and which of them new entries are going to.

## Discipline

- **Write on every event** — a chip hung, a batch confirmed, a fork settled, a return accepted, a
  constraint discovered — before the conversation moves on.
- **Read it first after any restart or compaction**, before the live registry is even listed: the
  ledger says who is expected to exist, the registry only who answers right now.
- A batch's ending is written as such whichever of the three it is, and so is a wave closed; the
  epic's closing line is the ledger's last edit.
