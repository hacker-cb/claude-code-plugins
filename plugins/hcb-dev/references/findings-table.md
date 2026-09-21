# Showing findings — one table, each row saying whether it was verified

Read wherever findings reach a person: a review's report, a run's final report and a wave report,
a batch's return, and the pass that rules a run's candidates. It owns the one form they take there
and the column saying, row by row, whether each was verified. How a finding is rated, whether it
belongs to the work and which outcome it ends in are [`findings.md`](findings.md)'s. What a review
engine hands back stays verbatim at the engine's own boundary: it is this table's input, and the
form is laid on where findings meet a reader.

## The header line

One line above the table, standing in for a heading of its own:

```text
## Findings — <n> after dedup · verified by <what ran> · confirmed <c> · unproven <u> · not measured <m> · refuted <r>, dropped
```

`<n>` counts the rows; the refuted are counted beside them and are not rows. Where no check ran
over any of them the header says `verified by none`, and every row reads `not measured`. A run
with nothing to show still writes the line, `0 after dedup` — a missing table reads as an
omission.

## The table

```text
| # | Sev | Finding | Where | Verified | Outcome | Classification |
|---|---|---|---|---|---|---|
```

- **`#`** — the rank `findings.md` orders them by; `Critical` rows stand first, outside it.
- **`Sev`** — `Critical`, `Important` or `Minor`, that file's ladder.
- **`Finding`** — the mechanism in one line. A mechanism with several instances is one row, the
  count in the cell and the instances in its block below.
- **`Where`** — `file:line` of the first instance, or the coordinate itself where it is not a
  line: a check, a setting, an issue.
- **`Verified`** — below.
- **`Outcome`** — one of the five, with its target: `FIX`, `HAND OVER — <who holds it>`,
  `INTO #N`, `OPEN`, `DROP — <reason>`; a finding already tracked as it stands is
  `DROP — tracked as #N`. One still the reader's to give reads `proposed: <outcome>` and stands in
  the report's ask block as well — a row alone puts the decision to nobody. A review's own report
  rules nothing, and leaves this cell and the next at `—`.
- **`Classification`** — what `OPEN` would carry, or what `INTO` would change on the issue, read
  per [`classification.md`](classification.md): proposed, never applied. `—` for every other
  outcome.

A fix already made is not a row: its commit is its record. Cells stay short; whatever wraps goes
to the block below.

## Verified

| cell | what it says |
|---|---|
| `confirmed @<sha>` | a check that never saw the finder's argument reproduced the mechanism at that revision |
| `unproven @<sha>` | checked there, and neither shown nor ruled out — its block says what would settle it |
| `not measured — <why>` | no check ran over it: `batch` (its master verifies), `unreachable` (no tree this session can read carries the coordinate), or `none ran` |

**A refuted finding is not a row.** It is counted in the header and leaves the table for one line
under it — `Refuted: <finding> at <where> — <what showed it does not hold>`, one per finding — so
the reader sees what was cleared without reading it as open. Nothing the finder wrote about its
own finding fills this column.

## Under the table

A block per row that needs one, in rank order, led by its number: the failure scenario as the
finding put it; for `OPEN`, the sentence saying what it costs to never do it; for `INTO`, the
issue and what the finding adds; for `unproven`, what would settle it. A `HAND OVER` naming its
receiver and a `DROP` whose reason fits its cell take none.

## Where a row travels

A finding leaving the session that found it — in a return, a handoff, an issue body — carries its
`Verified` cell and the revision it was read at. The receiver re-checks what it is about to act on
rather than everything, and an issue opened from a row says beside its source whether the finding
was confirmed, and at which revision.
