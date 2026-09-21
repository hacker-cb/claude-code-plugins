# The blocks a report carries

Read wherever a report is written, beside [`report-format.md`](report-format.md), which fixes how
every block looks. This file owns the catalogue — the blocks a report is built from, in the order
they stand — what each one holds, and which blocks each occasion carries. The order of the
catalogue is the order of a report; no report invents a heading outside it.

## The catalogue

| block | element | what it holds |
|---|---|---|
| `## Without your word` | bullets | `report-format.md`'s |
| `## What happened` | bullets | what this session did or verified since the last report |
| `## What moved` | bullets | what this session found had changed under it — the base, the tracker, the plugin |
| `## The picture` | bullets | a standing reading of ground nothing changed — counts, milestones, the front line, and what could not be seen |
| `## Where it stands` | table | one row per unit in flight or ended — a batch, a slice, the next wave — its state and what it waits on |
| `## The plan` | table | what is proposed and not yet done — candidate batches, a layout, slices and branches, what a sweep would remove |
| `## Review coverage` | table | one row per reviewer — what it covered, at what effort, its verdict |
| `## Findings` | table | the table [`findings-table.md`](findings-table.md) fixes, its header and footer lines with it |
| `## Issues` | bullets | the issues the run settles, at their state now |
| `## What it leaves` | bullets | what the run leaves standing behind it |
| `## Needs your word` | numbered, under two `###` | `report-format.md`'s |

`What happened` is what this session did; `What moved` is what it found had changed underneath
it. A block appears at most once. `## Findings` is the one block a report carrying it never
leaves out: with nothing to show, its header line alone says `0 after dedup`, since an absent
block reads as an omission.

## What each block holds, where it needs saying

- **`What happened`** — each event with the coordinate it was verified at, and, over a merge,
  what its checks showed (`base_checks`, whose values
  [`slice-completion.md`](slice-completion.md) names). A round that closed brings its candidates
  as `## Findings`, the rows needing the reader in the ask block as well.
- **`Where it stands`, while an epic runs** — a row per batch: id, issues, state in the ledger's
  vocabulary ([`wave-ledger.md`](wave-ledger.md)), and what it waits on — nothing, its slot, the
  reader's approval, the reader's click with the chip's age and the pin it stands on, another
  batch, or the condition holding it back: a blocker, a body to rewrite, a tracker write. The
  next wave is the last row, ⚪, waiting on the gate it opens on.
- **`Where it stands`, once a run is done** — a row per slice: what it did, how it completed
  (merged locally into `<parent>`, or the change-request URL and whether it merged), what the
  checks on that merge showed (`base_checks`), and its state — done, partial or skipped. An
  epic groups its rows by wave and ends each in what the ledger records for that batch —
  `released`, `withdrawn(<reason>)` or `failed(<what stands>)`. A set that ended partway says so
  in its first line; a summary never reads as complete when it is not.
- **`Review coverage`** — each slice's `multi-review` coverage carried verbatim. A reviewer that
  could not run, ran over nothing, or ran over the wrong range is a gap, and a structural one —
  a reviewer's own fixed limitation, which no answer could close — is labelled as such. Where
  every slice was fully covered, one row says so.
- **`Findings`** — as the pass that ruled them left them, each row rated on the ladder in
  [`findings.md`](findings.md) and saying whether it was verified; a row whose outcome is the
  reader's to give stands in the ask block as well.
- **`Issues`** — closed, or still open and why: a merged slice does not say what became of the
  issue behind it.
- **`What it leaves`** — any ref a completion could not retire and why
  ([`branch-retirement.md`](branch-retirement.md)), the worktrees, the sessions this run is done
  with and which of them cannot be archived, with why — archiving the rest is an ask — an offer
  the reader turned down (`declined_offer`), and a pointer to `/hcb-dev:git-cleanup`. A
  follow-up worth filing is an ask; an offer already answered is recorded here, not put again.

## What each occasion carries

| occasion | printed by | blocks, in order |
|---|---|---|
| wave report | `hcb-dev:master-session`; the launch, `hcb-dev:wave-dispatch` | Without your word · What happened · Where it stands · Findings, where a round closed · Needs your word |
| a correction before the first chip | `hcb-dev:wave-dispatch` | Without your word |
| final report | `hcb-dev:implementation-workflow`; `hcb-dev:master-session` closing an epic | Without your word · Where it stands · Review coverage · Findings · Issues · What it leaves · Needs your word |

An occasion this table does not list, whose skill fixes a body of its own, writes that body
between the first line and the ask block.

## A final report

```markdown
**🟡 Three slices merged into `feat/export` · needs you: 1, blocking: 0**

## Where it stands
| slice | what | completion | state |
|---|---|---|---|
| `export/csv` | CSV writer | merged → `feat/export` · checks green | 🟢 done |
| `export/xlsx` | XLSX writer | merged → `feat/export` · checks green | 🟢 done |
| `export/docs` | usage page | merged → `feat/export` · checks none | 🟢 done |

## Review coverage
| reviewer | covered | effort | result |
|---|---|---|---|
| every slice | `<base>`, all files | high | 🟢 fully covered |

## Findings
**Findings — 0 after dedup · verified by none**

## Issues
- **#41** — still open: a local merge closes nothing, and the change request below would.

## Needs your word
### 🟡 Can wait
1. **Open one change request for the whole of `feat/export` into `<base>`?**
   - **Recommend** — open it: the three slices merged locally and nothing has reviewed them together.
   - **If unanswered** — nothing stops; the work stays on `feat/export`.
   - **Where it is acted on** — a word here.

Answer with a word; "go" takes the recommendation.
```
