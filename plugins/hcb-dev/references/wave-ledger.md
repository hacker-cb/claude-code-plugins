# The wave ledger — the master's durable state

Read by the session coordinating an epic's batches. The ledger is what makes acceptance,
contradiction-checking and restart recovery independent of the session's context window:
everything the coordination must not forget lives here, not in the conversation. For a master,
this file **is** the "session's own record" that [`order-anatomy.md`](order-anatomy.md) and
[`order-return.md`](order-return.md) match tags against.

## Where it lives

One comment on the epic issue, opened when the role is assumed and edited in place from then on,
carrying the marker `<!-- wave-ledger -->`, found by content ([`epic-structure.md`](epic-structure.md)).
Every order names its coordinate, so a batch reads the standing constraints itself. The epic's
*body* stays human — the wave table, the progress — and the ledger comment is the working state;
the two are not copies.

**Its shape.** The marker is the first line, `<!-- wave-ledger-format: 2 -->` the second, and every
section below opens with `<!-- wave-section: <name> -->`, the name the one in bold there, spelled
in English whatever language the rest is written in. A ledger with no format line is format 1.

**`scripts/ledger.mjs` answers where it stands, and makes every write.** It is read before a
write, and a ledger is written only through it — never by a hand-made edit:

```text
node "<plugin root>/scripts/ledger.mjs" --issue <n> [--repo <owner/name>] [--forge gh|glab]
  [--host <host>] [--body-file <path>] [--limit <bytes>] [--me <login>] [--check]
  [--budget <bytes>] [--write | --append-archive <file>] [--dump <path>]
```

| field | what it settles |
|---|---|
| `read` | the comment feed answered. `false` is unread, never "no ledger there" |
| `ledger.found` / `.id` / `.nodeId` / `.bytes` / `.mine` / `.digest` | whether one is open, which comment it is — `id` for a REST edit, `nodeId` for GraphQL — how large it stands, whose it is — `mine` is three-valued, `null` being *not attributable* rather than somebody else's — and which version of its text was read |
| `ledger.ambiguous` | **two comments carry the marker** — a coordinate resolving to two states resolves to neither, whoever wrote them |
| `archives[]` | one row per `<!-- wave-journal-<n> -->` comment, with its own size |
| `index.listed` / `.missing` / `.unlisted` | what the ledger says it archived, against what the issue carries |
| `format` | the stored ledger's format against the one written now |
| `lint[]` | with `--check`: what the text says is wrong with its shape — sections, budget, entries too long, struck or broken up by headings. Advisory: nothing in it holds a chip |
| `write.fits` / `.headroom` / `.budget` | whether the body handed in fits under the cap and by how many bytes, and the budget it is kept under — sizes in `bytes`, `chars` / `utf16` only beside them |
| `write.wrote` / `.moved` / `.ran` / `.archived` | with `--write` or `--append-archive`: `true` once every write read back as meant; `false` where the run refused before writing anything — a fault standing, a body not in the shape; `null` where a write did not read back — **unsettled**: read the issue before writing again; each act taken; each archive written |
| `faults[]` | every one of the above that has to be repaired before the next chip goes up |
| `reason` | why nothing could be answered or written — a feed that did not read, a `404` saying the issue is not there (or not visible to this token), **both forges answering for this repository** (which `--forge` settles), a body not opening with the marker, or a ledger over the cap with its journal out |

`--dump <path>` puts the stored ledger in a file to edit; `--write --body-file` puts it back, with
`--was <digest>` — the one that read answered — so a ledger that moved in between is never
overwritten; after a write that moved journal lines out, dump again before the next edit. Only a
ledger of ours is written, and only while no fault stands save an archive of ours it does not list
yet, which the write indexes. `--append-archive <file>` adds an account — the long reasoning behind
a decision or a constraint — to the archive and answers its link for the entry to cite.

The comment is the only form the ledger takes, so a tracker is what the role stands on: whether
the repository has one is established against the forge ([`forge-docs.md`](forge-docs.md) names
the field) while the role is being assumed and before the epic is settled, never inferred from
what the epic looks like. An epic with no umbrella issue is an umbrella not yet filed, not a
repository without a tracker. Where there is none, the role does not begin, and what was
established goes to the user in those words.

**One epic, one ledger.** The marker is an HTML comment, free for anyone to write and invisible in
either UI, so each marked comment travels with whose it is: a lone foreign one says so instead of
passing as this session's state, and two publish **no** coordinate whoever wrote them — a tie-break
would drop the older ledger. An archive nothing indexes is the same fault, repaired before the chip.

## Archiving — the script's, and one case the master's

**The journal leaves on its own.** Where a body is over its budget, `--write` moves the journal's
oldest entries, verbatim, into the archive it opened itself — `<!-- wave-journal-<n> -->`, then
`<!-- wave-journal-kind: journal -->` — and opens the next under a number no archive holds, writes
every archive before the ledger, and rewrites the journal's index line to name them all. It is
bookkeeping, not a decision: it needs no permission, and it is reported in one line once done.

**What else may leave is judged, not measured**: a closed wave — one whose batches have all ended,
with anything they left standing accounted for outside it, and whose gates are spent — moves by
hand, verbatim, under the next archive number, archive first and ledger second. What is still
open never leaves, and nothing is shortened to fit. A ledger over the cap with its journal out and
no wave closed is the one case that stops and goes to the user.

## What it holds

What is still acted on. How it came to be known belongs to the journal, and the
test on a passage is whether deleting it changes what anyone does next.

1. **header** — the epic; the master's name, rewritten whenever it changes; the base pin the
   wave's live step was hung on (`<remote>/<branch>@<sha>`); the pin of the last whole reading of
   the slice — a capacity refresh's or a survey's — with the moment it read the tracker at, the
   link to the graph a refresh leaves in a comment of its own and that graph's digest
   (`hcb-dev:wave-refresh` owns both) and the ground it covered: what the next refresh takes its
   delta from, since an issue closes without a commit and a link moves without either; a lesser
   reading does not take the slot; the epic's merge authority as the user settled it
   ([`slice-completion.md`](slice-completion.md)); the plugin version this role last reconciled
   against, which is what a later **plugin** refresh diffs from and not necessarily what the
   session is running — it starts as the running version and `hcb-dev:session-plugin-refresh`
   moves it; the session group (`epic-structure.md`); and when last updated.
2. **batches** — one row each: id, topic, the issues and where each now stands, the order's ask
   and terminal deliverable in its own words (the acceptance contract — a return is judged
   against this row, not against recall), the file zone its order drew, the order's base pin,
   chip, the session's name, state, result coordinates. A batch runs `planned → chipped →
   started → confirmed → building → completed(<mode> — request merged, merged locally, tracker
   state delivered, verdict delivered) → accepted`, standing at `blocked(<condition>)` for as
   long as something holds it; a state is advanced, never skipped silently. It **ends** in one of
   three, and the three carry equal weight:
   - `released` — acceptance passed, the work landed, the batch was let go;
   - `withdrawn(<reason>)` — called off, from wherever it stood;
   - `failed(<what stands>)` — it did not come off, from wherever it stood; what still stands is named.

   A rule asking whether a batch is finished says which of the three it counts, and answers the
   question it actually needs: what landed is one question, what has nothing outstanding is
   another, and `released` alone is neither.
3. **verdicts** — one line per open issue of the epic's slice that no batch has ended: the issue,
   the verdict [`issue-currency.md`](issue-currency.md) gave it, the coordinate that verdict stood
   on, and the pin and tracker moment it was read at. A survey's reading opens it; every capacity
   refresh writes back what it re-read and reads the rest from here rather than re-deriving them
   (`hcb-dev:wave-refresh`). A line leaves when its issue does.
4. **decisions** — every fork settled during the epic, one entry each: the question, the answer,
   who settled it and when, and the link to where the case for it is written — never the case.
5. **constraints** — what no batch may violate while the epic runs: a change request that must
   not merge, a foreign stash, a pinned version — never a workflow's own policy
   (`order-anatomy.md`). A return whose claims touch one of these is checked against it before
   either is believed. One entry each: the rule a batch acts on, what lifts it, and the link to
   how it came to be known. A lifted one leaves, a journal line saying so.
6. **queue** — the merge queue and gates: the current wave's launch order (at once, or staged with what
   each step waits on), the merge order inside it, each batch whose authority the header's policy
   was narrowed for and why, which batch stands ready and waiting for its slot in either mode
   (written the moment the report arrives — a restart must not lose a batch holding on the
   queue); each landing with whoever took it, what its tail left standing, and what the checks on
   it showed — `covered`, nothing reporting over it and a base that runs no checks are all answers, and one
   nobody has read yet is recorded as unread rather than as either; and what opens each later
   wave.
7. **expectations** — what is awaited from whom: unconfirmed batches, answers owed, mandates
   given and not yet met. Each carries who owes it, the moment it was first asked, and whether
   work stands on it — a chip hung and not yet clicked is owed by the user, one already clicked
   is awaited from the batch. The ones the user owes are what a report's ask block prints
   ([`report-format.md`](report-format.md)), so each carries what that block prints, or the
   coordinate where that text is written. A row leaves only with its outcome — answered or met,
   deferred by the user's word, withdrawn, failed with what still stands, or overtaken — named in
   the line that drops it.
8. **journal** — one line per event, terse, newest last; an account at any length goes to the
   archive (`--append-archive`) and the entry it belongs to links it. Its first line is the index
   of every archive, in their markers, which `--write` keeps.
9. **candidates** — a line per finding a return carries unfixed, as it arrives: the batch; the claim,
   its severity, every instance's coordinate and the revision, what shows it, the verdict it came
   with, the outcome proposed; then `hcb-dev:findings-pass`'s verdict and ruling. It leaves refuted, or with its ruling carried out.

## Discipline

- **Write on every event** — a chip hung, a batch confirmed, a fork settled, a return accepted, a
  constraint discovered — before the conversation moves on.
- **Read it first after any restart or compaction**, before the live registry is even listed: the
  ledger says who is expected to exist, the registry only who answers right now.
- A batch's ending is written as such whichever of the three it is, and so is a wave closed; the
  epic's closing line is the ledger's last edit.
