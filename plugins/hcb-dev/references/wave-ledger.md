# The wave ledgers — the master's durable state

Read by the session coordinating an epic's batches. The ledgers make acceptance,
contradiction-checking and restart recovery independent of its context window: what the coordination
must not forget lives here — for a master, the "session's own record"
[`order-anatomy.md`](order-anatomy.md) and [`order-return.md`](order-return.md) match tags against.

## Where they live

Each is one comment, opened with its issue and edited in place, carrying `<!-- wave-ledger -->`
([`epic-structure.md`](epic-structure.md)): **the epic's** on the umbrella — what holds for the
whole epic — and **a wave's** on that wave's issue ([`wave-issue.md`](wave-issue.md)) — what runs in
it. Every order names both, so a batch reads the standing constraints and its own row itself. The
issues' *bodies* stay human; the ledgers are the working state, never copies of them.

**Their shape.** The marker is the first line, `<!-- wave-ledger-format: 2 -->` the second, and
every section below opens with `<!-- wave-section: <name> -->`, the name the one in bold there,
spelled in English whatever language the rest is written in. The epic's is kept under 64 KiB, a
wave's under 128 KiB. A ledger with no format line is format 1 ([`epic-migration.md`](epic-migration.md)).

**`scripts/ledger.mjs` answers where it stands, and makes every write.** It is read before a
write, and a ledger is written only through it — never by a hand-made edit:

```text
node "<plugin root>/scripts/ledger.mjs" --issue <n> [--repo <owner/name>] [--forge gh|glab]
  [--host <host>] [--body-file <path>] [--limit <bytes>] [--me <login>] [--check]
  [--budget <bytes>] [--write | --append-archive <file>] [--was <digest>] [--dump <path>]
```

| field | what it settles |
|---|---|
| `read` | the comment feed answered. `false` is unread, never "no ledger there" |
| `ledger.found` / `.id` / `.nodeId` / `.bytes` / `.mine` / `.digest` | whether one is open, which comment it is — `id` for a REST edit, `nodeId` for GraphQL — how large it stands, whose it is — `mine` is three-valued, `null` being *not attributable* rather than somebody else's — and which version of its text was read |
| `ledger.ambiguous` | **two comments carry the marker** — a coordinate resolving to two states resolves to neither, whoever wrote them |
| `archives[]` | one row per `<!-- wave-journal-<n> -->` comment, with its own size |
| `index.listed` / `.missing` / `.unlisted` | what the ledger says it archived, against what the issue carries |
| `format` | the stored ledger's format against the one written now, and its `kind` — `epic`, `wave`, or `null` where its sections make it neither |
| `lint[]` | with `--check`: what the text says is wrong with its shape — its first line, sections, budget, entries too long, struck or broken up by headings. Advisory: nothing in it holds a chip |
| `write.fits` / `.headroom` / `.budget` | whether the body handed in fits under the cap and by how many bytes, and the budget it is kept under — sizes in `bytes`, `chars` / `utf16` only beside them |
| `write.wrote` / `.moved` / `.ran` / `.archived` / `.account` | with `--write` or `--append-archive`: `true` once every write read back as meant; `false` where the run refused before writing anything — a fault standing, a body not in the shape; `null` where a write did not read back — **unsettled**: read the issue before writing again, and a journal line standing in an archive and in the ledger both leaves the body; each act taken; each archive written; the archive holding the account |
| `faults[]` | every one of the above that has to be repaired before the next chip goes up |
| `reason` | why nothing could be answered or written — a feed that did not read, a `404` saying the issue is not there (or not visible to this token), **both forges answering for this repository** (which `--forge` settles), a body not opening with the marker, or a ledger over the cap with its journal out |

`--dump <path>` puts the stored ledger in a file to edit; `--write --body-file` puts it back, never
over a ledger other than the one whose `--was <digest>` the read answered; after a write that moved
journal lines out, dump again before the next edit. Only a ledger of ours is written, and only while
no fault stands save two: an archive of ours it does not list yet, which the write indexes, and one
it lists that no comment carries, which leaves the index once the body handed in no longer names it.
`--append-archive <file>` adds an account to the archive, moving nothing else, and answers its link.

**One issue, one ledger.** The marker is an HTML comment, free for anyone to write and invisible in
either UI, so each marked comment travels with whose it is: a lone foreign one says so instead of
passing as this session's state, and two publish **no** coordinate whoever wrote them — a tie-break
would drop the older ledger. An archive nothing indexes is the same fault, repaired before the chip.

## Archiving

**The journal leaves on its own.** Where a body is over its budget, `--write` moves the journal's
oldest entries, verbatim, into the archive it opened itself — `<!-- wave-journal-<n> -->`, then
`<!-- wave-journal-kind: journal -->` — and opens the next under a number no archive holds, writes
every archive before the ledger, and rewrites the journal's index line to name them all. It is
bookkeeping, not a decision: it needs no permission, and it is reported in one line once done.
Nothing else leaves and nothing is shortened to fit — a closed wave is a closed issue, its ledger
standing on it: a ledger over the cap with its journal out stops and goes to the user.

## What they hold

What is still acted on. How it came to be known belongs to the journal, and the test on a passage is
whether deleting it changes what anyone does next.

**The epic's**, in this order:
1. **header** — the epic; the master's name, rewritten whenever it changes; the waves, a line each —
   the wave, its issue, its state — one closed before waves had issues naming where its record
   stands; the pin of the last whole reading of the slice — a capacity refresh's or a survey's —
   with the moment it read the tracker at, the link to the graph a refresh leaves in a comment of
   its own and that graph's digest (`hcb-dev:wave-refresh` owns both) and the ground it covered:
   what the next refresh takes its delta from, since an issue closes without a commit and a link
   moves without either; a lesser reading does not take the slot; the epic's merge authority as the
   user settled it ([`slice-completion.md`](slice-completion.md)); the plugin version this role last
   reconciled against, which is what a later **plugin** refresh diffs from and not necessarily what
   the session is running — it starts as the running version and `hcb-dev:session-plugin-refresh`
   moves it; the session group (`epic-structure.md`); and when last updated.
2. **verdicts** — one line per open issue of the epic's slice that no batch has ended: the issue,
   the verdict [`issue-currency.md`](issue-currency.md) gave it, the coordinate that verdict stood
   on, and the pin and tracker moment it was read at. A survey's reading opens it; every capacity
   refresh writes back what it re-read and reads the rest from here rather than re-deriving them
   (`hcb-dev:wave-refresh`). A line leaves when its issue does.
3. **decisions** — every fork settled during the epic, one entry each: the question, the answer, who
   settled it and when, and the link to where the case for it is written — never the case.
4. **constraints** — what no batch may violate while the epic runs: a change request that must not
   merge, a foreign stash, a pinned version — never a workflow's own policy (`order-anatomy.md`). A
   return whose claims touch one of these is checked against it before either is believed. One entry
   each: the rule a batch acts on, what lifts it, and the link to how it came to be known. A lifted
   one leaves, a journal line saying so.
5. **expectations** — what the user owes, a chip hung and not yet clicked among it: what a report's
   ask block prints ([`report-format.md`](report-format.md)), so each carries that text or the
   coordinate where it is written.
6. **journal**, below.

**A wave's**, in this order:
1. **header** — the wave, its issue and the epic's; the base pin its live step was hung on
   (`<remote>/<branch>@<sha>`); and when last updated.
2. **batches** — one row each: id, topic, the issues and where each now stands, the order's ask and
   terminal deliverable in its own words (the acceptance contract — a return is judged against this
   row, not against recall), the file zone its order drew, the order's base pin, chip, the session's
   name, state, result coordinates. A batch runs `planned → chipped → started → confirmed → building
   → completed(<mode> — request merged, merged locally, tracker state delivered, verdict delivered)
   → accepted`, standing at `blocked(<condition>)` for as long as something holds it; a state is
   advanced, never skipped silently. It **ends** in one of three, and the three carry equal weight:
   - `released` — acceptance passed, the work landed, the batch was let go;
   - `withdrawn(<reason>)` — called off, from wherever it stood;
   - `failed(<what stands>)` — it did not come off, from wherever it stood; what stands is named.

   A rule asking whether a batch is finished says which of the three it counts, and answers the
   question it actually needs: what landed is one question, what has nothing outstanding is
   another, and `released` alone is neither.
3. **queue** — the merge queue and gates: the wave's launch order (at once, or staged with what each
   step waits on), the merge order inside it, each batch whose authority the epic's policy was
   narrowed for and why, which batch stands ready and waiting for its slot in either mode (written
   the moment the report arrives — a restart must not lose a batch holding on the queue); each
   landing with whoever took it, what its tail left standing, and what the checks on it showed —
   `covered`, nothing reporting over it and a base that runs no checks are all answers, and one
   nobody has read yet is recorded as unread rather than as either; and what opens the next wave.
4. **expectations** — what its batches owe: unconfirmed batches, statuses and answers owed, mandates
   given and not yet met.
5. **answers** — every answer that changes what a batch builds, written here before it is sent, the
   message pointing at it: the batch, the question, the answer, and the coordinates that let the
   batch re-verify it.
6. **candidates** — a line per finding a return carries unfixed, as it arrives: the batch; the
   claim, its severity, every instance's coordinate and the revision, what shows it, the verdict it
   came with, the outcome proposed; then `hcb-dev:findings-pass`'s verdict and ruling. It leaves
   refuted, or with its ruling carried out.
7. **journal**, below.

**An expectation** carries who owes it, the moment it was first asked, and whether work stands on
it, and leaves only with its outcome — answered or met, deferred by the user's word, withdrawn,
failed with what still stands, or overtaken — named in the line that drops it. **The journal** is
one line per event, terse, newest last; an account at any length goes to the archive
(`--append-archive`) and the entry it belongs to links it. Its first line is the index of every
archive, in their markers, which `--write` keeps.

## Discipline

- **Write on every event** — a chip hung, a batch confirmed, a fork settled, a return accepted, a
  constraint discovered — before the conversation moves on.
- **Read them first after any restart or compaction** — the epic's, then each open wave's
  (`epics.mjs --epic`, `epic-structure.md`) — before the live registry is even listed: the
  ledgers say who is expected to exist, the registry only who answers right now.
- A batch's ending is written as such whichever of the three it is; a wave's closing line is its
  ledger's last edit, and the epic's closing line the epic's.
