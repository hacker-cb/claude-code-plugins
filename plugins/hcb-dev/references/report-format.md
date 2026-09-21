# Reporting to the user — one grammar, one set of blocks

Read by whatever tells the user something about a run of work. It owns how that looks: the two
kinds of message, the first line, the grammar every block obeys, the five status circles, and
the two blocks any report can carry — what was settled without the reader, and what waits on
them. Which blocks an occasion carries, and what each one holds, is
[`report-blocks.md`](report-blocks.md)'s, which writes out a wave report and a final report. Keep it scannable: short grouped bullets, a small table, not
an essay.

Two boundaries. What an engine hands back verbatim ([`review-runs.md`](review-runs.md)) is the
content of a block, never rewritten here. What one session sends another is
[`session-prompts.md`](session-prompts.md)'s and [`order-return.md`](order-return.md)'s — save
a batch's own user, who reads those lines and is owed the rule for a line below.

## Two kinds of message

- **A line** — one sentence for an event that changes nothing the reader decides: what happened,
  where it was read, and what still waits on them, named rather than counted. No heading, no
  table. It opens with a circle only where that circle is 🟡 or 🔴, no circle reading "running,
  you are not needed"; 🔴 only as the lead-in to a report following at once, and two things
  waiting on the reader are a report, not a line.
- **A report** — the first line, then blocks. A stop that asks is a report whose ask block holds
  something blocking; it has no shape of its own.

## The first line

Bold, one line, first — nothing stands above it but the line that led into it. It opens with the
circle of the worst the report holds — worst first: 🔴, 🟡, 🔵, 🟢, ⚪, a blocking ask counting as
🔴 and one that can wait as 🟡 — says what happened, and counts what waits on the reader, or says
that nothing does.
What the report goes on to ask is never announced there as settled.

```text
**<circle> <what happened> · needs you: <n>, blocking: <m>**
**<circle> <what happened> · nothing waits on you**
```

## The grammar

- **Every block is a `##` heading**, named from the catalogue and standing in its order. No `#`,
  no rule line, no bold line standing in for a heading outside a form below.
- **A block holds one element**: a bulleted list or a table. Two blocks carry a form of their
  own instead: `## Findings`, the whole of [`findings-table.md`](findings-table.md)'s, and the ask
  block, below. What fits none of them belongs to the record the session keeps.
- **`###` stands in one place**: the two groups of the ask block.
- **Bold marks**: the first line, a bullet's lead phrase, an ask's question, an ask's
  sub-bullet labels, and the lines a form of its own carries — `findings-table.md`'s header and
  footer among them.
- **No bracket tags.** A category is a heading, a group, a column or a label — never `[text]`
  inside a line.
- **A block or a group with nothing in it is left out**, the ask block included — "nothing waits
  on you" is the first line's to say — save `## Findings`, which a report whose occasion carries
  it prints even empty, its header line saying `0 after dedup`.
- **A block keeps its name** from one report to the next, in whatever language the session
  speaks.

## The five circles

| circle | means |
|---|---|
| 🟢 | nothing is owed on it — done, or cleared to go ahead |
| 🔵 | in flight, moving without the reader |
| 🟡 | the reader's move — work goes on meanwhile |
| 🔴 | work stopped — red, blocked, failed, or held until the reader answers |
| ⚪ | out of play — planned, queued, withdrawn, not run, not applicable |

A circle stands first in a report's first line (and in a line, as above), in a table's state
column — the one saying where each row stands — and in the two ask-group headings. There it
stands **beside** the word the occasion's vocabulary gives — a batch state of
[`wave-ledger.md`](wave-ledger.md), a slice's, a reviewer's status — never instead of it. A source
that was not read keeps the state its record gives and says `unread` in words: being unread is no
circle. A column whose header names what else its circle marks — a findings table's `Sev`, by
`findings-table.md`'s own; a sweep's consequence — marks that, and sets nothing in the first
line; no other emoji appears, save in content carried verbatim.

## Without your word

The first block wherever it has content, above anything the reader acts on — before the first
table, chip or link. Two kinds, a bullet each: **what departed from what the reader approved**
(`<what stood>` → `<what stands now>`, and why), and **what this session settled inside the
authority it holds** — each ending in what undoes it. Neither is a question: the answer to both
is a veto, and a veto needs the item in front of the reader.

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
authorization leave outstanding, belongs here. An ask leaves only with an outcome — answered,
deferred by the reader's word (which stops it blocking), withdrawn, failed with what still
stands, or overtaken — said in the line or report that drops it. Where the session records what
it awaits (`wave-ledger.md` for a coordinating one), the block prints that
record rather than recall.

## What a report is not

The plan of what this session does next, the narration of a step under way, the account of a
mistake it made — those reach it only as the one bullet that changes what the reader decides.
