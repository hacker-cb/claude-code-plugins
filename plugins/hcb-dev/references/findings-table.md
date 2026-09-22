# Showing findings — one table, each row saying whether it was verified

Read wherever findings reach a person: a review's report, a run's final report and a wave report,
a batch's return, and the pass that rules a run's candidates. It owns the one form they take there
and the column saying, row by row, whether each was verified. How a finding is rated, whether it
belongs to the work and which outcome it ends in are [`findings.md`](findings.md)'s. What a review
engine hands back stays verbatim at the engine's own boundary: it is this table's input, and the
form is laid on where findings meet a reader.

## The header line

One line above the table, bold rather than a heading, so it stands the same inside a report's
section as on its own:

```text
**Findings — <n> after dedup · verified by <what ran> · confirmed <c> · unproven <u> · not measured <m> · refuted <r>, dropped**
```

`<n>` counts the rows, and so do the verdicts beside it — a mechanism once, under the verdict its
row carries; the refuted are counted beside them and are not rows. `<what ran>` is `verifier` where
the shared checker ([`verification.md`](verification.md)) ran, a verdict it let stand counting under
its own name. Where no check ran over any of them the header says `verified by none`, and every row
reads `not measured — none ran`. A run
with nothing to show still writes the line, `0 after dedup` — a missing table reads as an
omission.

## The table

```text
| # | Sev | Finding | Where | Verified | Outcome | Classification |
|---|---|---|---|---|---|---|
```

- **`#`** — the rank `findings.md` orders them by; `Critical` rows stand first, outside it.
- **`Sev`** — `🔴 Critical`, `🟠 Important` or `⚪ Minor`, that file's ladder, the mark beside the
  word; here the circles rank severity and not state, and the footer counts the bare words.
- **`Finding`** — the mechanism in one line. A mechanism with several instances is one row, the
  count in the cell and the instances in its block below.
- **`Where`** — `file:line` of the first instance, or the coordinate itself where it is not a
  line: a check, a setting, an issue.
- **`Verified`** — below.
- **`Outcome`** — with its target: `HAND OVER — <the work that takes it>`, `INTO #N`, `OPEN` or
  `DROP — <reason>`; a finding already tracked as it stands is `DROP — tracked as #N`, and one a
  *Worth remembering* question ended names that question as its reason, as one the work of another
  row takes names `DROP — carried by row <n>`. One still the reader's to
  give reads `proposed: <outcome>` and stands in the report's ask block as well — a row alone puts
  the decision to nobody. `—` only where nothing proposed or ruled it: a review's
  own report, whose rows also read `not measured — none ran`, and a pass that reached no tracker,
  whose rows stay observations with the reason in their blocks. A row no check measured keeps the
  proposal it arrived with, and an `unreachable` one is handed to whoever holds a tree carrying its
  coordinate.
- **`Classification`** — what `OPEN` would carry, or what `INTO` would change on the issue, read
  per [`classification.md`](classification.md): proposed, never applied. `—` for every other
  outcome.

`FIX` is settled where the finding is found, and a fix made is not a row: its commit is its
record. Cells stay short; whatever wraps goes to the block below.

## The footer line

One line under the table, bold like the header, counting the rows by severity and by outcome:

```text
**Total — Critical <critical> · Important <important> · Minor <minor> · OPEN <open> · INTO <into> · HAND OVER <hand-over> · DROP <drop>**
```

A mechanism's or a gate's row counts once, however many instances it carries; a `proposed:` row counts under the
outcome it proposes, and a row whose outcome is `—` under none. Every term stays, a zero included.
A table of `0 after dedup` has no footer.

## Verified

| cell | what it says |
|---|---|
| `confirmed @<sha>` | a check that never saw the finder's argument reproduced the mechanism at that revision — `+wt` after the sha where something it read differs from that commit, edited or never committed |
| `unproven @<sha>` | checked there, and neither shown nor ruled out — its block says what would settle it |
| `not measured — <why>` | no check ran over it: `batch` (its master verifies), `unreachable` (no tree this session can read carries the coordinate), `budget` (the pass stopped short of it), `depth` (the round ran without agents, so nothing checked it), `base` (the tree to read it on did not resolve at all, resolved stale, gone or otherwise not current, or shares no history with the claim), `failed` (the check itself was refused, unavailable, or never answered), or `none ran` |

A mechanism's cell carries the least verdict among its instances — `unproven` where any instance
is — and its block carries each instance's own. A verdict let stand rather than made again keeps
the revision it was made at, and its block says it was reused.

**A refuted finding is not a row.** It is counted in the header and leaves the table for one line
under the footer — `Refuted: <finding> at <where> @<sha> — <what showed it does not hold>`, one
each — so the reader sees what was cleared without reading it as open. Nothing the finder wrote
about its own finding fills this column.

## Under the table

After the `Refuted:` lines, a block per row that needs one, in rank order, led by its number: the
failure scenario as the finding put it; for a mechanism, its instances, each with its coordinate
and its own verdict and revision; for `OPEN`, the sentence saying what it costs to never do it; for
`INTO`, the issue and what the finding adds; for `DROP` ended by a *Worth remembering* question,
the answer that ended it; for `unproven`, what would settle it. A `HAND OVER` naming its receiver and any
other `DROP` whose reason fits its cell take none; the units the hand-overs gather into are named
once, under the last of them.

## Where a row travels

A finding leaving the session that found it — in a return, a handoff, an issue body — carries its
`Verified` cell and the revision it was read at — a mechanism's row, each instance's as well — and,
where a check ran, the verdict itself with the blobs of what it read, so the next pass can let it
stand (`verification.md`). The receiver re-checks what it is about to act on
rather than everything, and an issue opened from a row says beside its source whether the finding
was confirmed, and at which revision.
