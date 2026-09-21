# Reporting to the user — one grammar, one set of blocks

Read by whatever tells the user something about a run of work. It owns how that looks: the two
kinds of message, the first line, the grammar every block obeys, the five status circles, and
the two blocks any report can carry — what was settled without the reader, and what waits on
them. Which blocks an occasion carries, and what each one holds, is
[`report-blocks.md`](report-blocks.md)'s. A change-request driver's report on one merged request
sits at a different altitude and keeps its own shape. Keep it scannable: short grouped bullets,
a small table, not an essay.

Two boundaries. What an engine hands back verbatim ([`review-runs.md`](review-runs.md)) is the
content of a block, never rewritten by this grammar. What one session sends another is
[`session-prompts.md`](session-prompts.md)'s and [`order-return.md`](order-return.md)'s — save
that a batch's own user reads those lines too, so the rule for a line below holds for them.

## Two kinds of message

- **A line** — one sentence for an event that changes nothing the reader decides: what happened,
  where it was read, and what still waits on them, named rather than counted. No heading, no
  table. It opens with a circle only where that circle is 🟡 or 🔴; no circle reads "running,
  you are not needed". 🔴 opens a line only as the lead-in to a report that follows at once, and
  two things waiting on the reader are a report, not a line.
- **A report** — the first line, then blocks. A stop that asks is a report whose ask block holds
  something blocking; it has no shape of its own.

## The first line

Bold, one line, first — nothing stands above it. It opens with the circle of the worst thing the
report holds — worst first: 🔴, 🟡, 🔵, 🟢, ⚪ — says what happened, and counts what waits on the reader, or says that nothing does.
What the report goes on to ask is never announced there as settled.

```text
**<circle> <what happened> · needs you: <n>, blocking: <m>**
**<circle> <what happened> · nothing waits on you**
```

## The grammar

- **Every block is a `##` heading**, named from the catalogue and standing in its order. No `#`,
  no rule line, no bold line standing in for a heading.
- **A block holds one element**: a bulleted list or a table. Two blocks carry a form of their
  own instead: `## Findings`, the whole of [`findings-table.md`](findings-table.md)'s, and the ask
  block, below. What fits none of them belongs to the record the session keeps.
- **`###` stands in one place**: the two groups of the ask block.
- **Bold marks four things**: the first line, a bullet's lead phrase, an ask's question, an
  ask's sub-bullet labels.
- **No bracket tags.** A category is a heading, a group, a column or a label — never `[text]`
  inside a line.
- **A block or a group with nothing in it is left out**, the ask block included — "nothing waits
  on you" is the first line's to say — save `## Findings`, whose header line says `0 after dedup`.
- **A block keeps its name** from one report to the next, in whatever language the session
  speaks.

## The five circles

| circle | means |
|---|---|
| 🟢 | fine — nothing is needed from the reader |
| 🔵 | running by itself — nothing waits on the reader |
| 🟡 | the reader's move — work goes on meanwhile |
| 🔴 | work stopped — red, blocked, failed, or held until the reader answers |
| ⚪ | out of play — planned, queued, withdrawn, not run, not applicable |

A circle stands first in a report's first line (and in a line, as above), in a table's state
column — the one saying where each row stands — and in the two ask-group headings. There it stands
**beside** the word the occasion's own vocabulary gives — a batch state of
[`wave-ledger.md`](wave-ledger.md), a `base_checks` value of
[`slice-completion.md`](slice-completion.md), a reviewer's status — never instead of it. A
source that was not read keeps the state its record gives and says `unread` in words; being
unread is no circle. A findings table's `Sev` column marks severity, not state, by
`findings-table.md`'s own. No other emoji appears, save in content carried verbatim.

## Without your word

The first block wherever it has content, above anything the reader acts on — before the first
table, chip or link. Two kinds, a bullet each: **what departed from what the reader approved**
(`<what stood>` → `<what stands now>`, and why), and **what this session settled inside the
authority it holds** — each ending in what undoes it. Neither is a question: the answer to both
is a veto, and a veto needs the item in front of the reader. A body that keeps these in rows of
its own keeps them there; what this fixes is that they reach the reader ahead of anything to act
on.

## Needs your word

Last, and the only place an ask stands — every ask in full text, never a label, a count, or a
pointer at an earlier message. Two groups, each a `###` heading: `### 🔴 Blocking` — what holds
work, in the order dependency puts them in — then `### 🟡 Can wait`. The numbering runs on
across both.

An ask is a numbered item: its question in bold, one sentence of context where it needs one,
then these sub-bullets, labelled and in this order, a label left out only where it has nothing
to say:

- **Recommend** — the choice, and what it rests on
  ([`architecture-decisions.md`](architecture-decisions.md) §2);
- **Turned down** — what it turns down, and what that would cost;
- **If unanswered** — what stops until it is answered, or that nothing does; for one standing
  behind another, which;
- **Where it is acted on** — a word here, a click, an approval on the forge, a tracker write, an
  archival, a command in the terminal;
- **Open since** — when it was first put, for one carried over.

A closing line says how an answer can be given. A click, an approval and an archival are asks
exactly as a question is: a chip nobody has clicked, or an approval the gates or the merge
authorization leave outstanding, puts something in this block. An ask leaves it only with an
outcome — answered, deferred by the reader's word (which stops it holding work), withdrawn,
failed with what still stands, or overtaken — said in the line or report that drops it. Where
the session keeps a record of what it awaits ([`wave-ledger.md`](wave-ledger.md) for a
coordinating one), the block prints that record rather than recall.

## What a report is not

The plan of what this session does next, the narration of a step under way, the account of a
mistake it made. Those belong to the record the session keeps and reach the report only as the
one bullet that changes what the reader decides.

## The shape

```markdown
**🔴 Wave 3 launched, wave 2 closed · needs you: 2, blocking: 2**

## Without your word
- **Departed from what you approved** — `w3/api` was drawn over `src/api/**`; its seam with `w3/store` moved to `src/api/store.ts`. Undo: say so, and the zone goes back.

## What happened
- **`w2/auth` merged** — at `a1b2c3d`, read on `<remote>/<default>`; checks green.

## Where it stands
| batch | issues | state | waiting on |
|---|---|---|---|
| `w3/api` | #91, #94 | 🔵 building | nothing |
| `w3/store` | #92 | 🟡 chipped | your click — chip 2h old, pin `a1b2c3d` |
| `w3/docs` | #95 | 🔴 blocked(needs rewrite) | #95's body, rewritten |
| wave 4 | #96, #97 | ⚪ not open | `w3/api` and `w3/store` merged |

## Needs your word
### 🔴 Blocking
1. **Rewrite #95's body, or drop it from wave 3?**
   - **Recommend** — rewrite it: the zone is uncontested and the batch is otherwise free.
   - **Turned down** — dropping it, which pushes the docs work behind two merges.
   - **If unanswered** — `w3/docs` does not launch.
   - **Where it is acted on** — a word here; the write goes through `hcb-dev:issue-tracking`.
2. **Click the chip for `w3/store`.**
   - **Recommend** — click it: the pin is current and nothing contends for its zone.
   - **If unanswered** — `w3/store` does not start, and wave 4 waits on its merge.
   - **Where it is acted on** — the chip.
   - **Open since** — 2 hours ago.

Answer by number; "go" takes every recommendation.
```
