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
| `## Where it stands` | table | one row per unit the report tracks — a batch, a slice, an issue, the next wave — its state and what it waits on |
| `## The plan` | table | what is proposed and not yet done — candidate batches, a layout, slices, branches and the settlements a gate shows, what a sweep would remove and what it keeps |
| `## Review coverage` | table | one row per source — what it covered, at what effort, and the result `multi-review` classified |
| `## Findings` | table | the table [`findings-table.md`](findings-table.md) fixes, its header and footer lines with it |
| `## Issues` | bullets | the issues the run settles, at their state now — an epic's own issue and its waves', being structure, are not among them |
| `## What it leaves` | bullets | what the run leaves standing behind it |
| `## Needs your word` | numbered, under the groups it has | `report-format.md`'s |

`What happened` is what this session did; `What moved` is what it found had changed underneath
it. A block appears at most once, and `## Without your word` stands first in any report that has
something for it, whatever its occasion — the rows below name the rest. `## Findings` is never
left out of a report carrying it: with nothing, its header alone says `0 after dedup`.

## What each block holds, where it needs saying

- **`What happened`** — each event with the coordinate it was verified at, and over a merge what
  its checks showed (`base_checks`, whose values [`slice-completion.md`](slice-completion.md)
  names). A round that closed brings its candidates as `## Findings`, the rows needing the reader
  in the ask block as well.
- **`Where it stands`, while an epic runs** — a row per batch: id, issues, state in the ledger's
  vocabulary ([`wave-ledger.md`](wave-ledger.md)), and what it waits on — nothing, its slot, the
  reader's approval, the reader's click with the chip's age and the pin it stands on, another
  batch, or the condition holding it back: a blocker, a body to rewrite, a tracker write. The
  next wave is the last row, ⚪, waiting on the gate it opens on.
- **`Where it stands`, once a run is done** — a row per slice: what it did, how it completed
  (merged locally into `<parent>`, or the change-request URL and whether it merged), what the
  checks on that merge showed (`base_checks`), and its state — done, partial or skipped. An epic
  groups its rows by wave, each ending in what the ledger records for that batch — `released`,
  `withdrawn(<reason>)`, `failed(<what stands>)`. A set that ended partway says so in its first
  line; a summary never reads as complete when it is not.
- **`Where it stands`, in a status** — a row per unit the epic or the run holds, the ended ones
  among them where nothing is still going: a batch as above, a slice at what its branch and its
  parent's history make it, in a batch its own build, request and return; each says when it was
  read, and one the tree does not confirm reads unknown.
- **`Review coverage`** — `multi-review`'s own rows, unfolded, the slice in a column of its own
  where a run has several, each as [`review-pipeline.md`](review-pipeline.md) classifies it.
- **`Issues`** — closed, or still open and why: a merged slice does not say what became of its issue.
- **`What it leaves`** — any ref a completion could not retire and why
  ([`branch-retirement.md`](branch-retirement.md)), the worktrees, the sessions this run is done
  with and which cannot be archived, with why — archiving the rest is an ask — an offer the
  reader turned down (`declined_offer`), and a pointer to `/hcb-dev:git-cleanup`. An offer
  already answered is recorded here, not put again.

## What each occasion carries

| occasion | blocks, in order |
|---|---|
| a wave report, while an epic runs | What happened · Where it stands · Findings, where a round closed · Needs your word |
| a correction before the first chip of a wave | Without your word, alone |
| the final report, once a run is done | Where it stands · Review coverage · Findings · Issues · What it leaves · Needs your word |
| a capacity pass over a running epic | What moved · Where it stands · The plan · Needs your word |
| a survey of a slice of the backlog | The picture · Where it stands · The plan · Needs your word |
| a plugin this session moved under | What happened · What moved · Needs your word |
| a branch taken up to a base that moved | What happened · What moved · Needs your word |
| a pass that ruled a run's findings | Findings · Needs your word |
| a status asked for | The picture, where a source did not answer or a fault stands · Where it stands · Needs your word |
| a review of one change | Review coverage · Findings · Needs your word |
| a coverage gate that stopped a completion | Review coverage · Needs your word |
| a planning gate | The plan, where the tier makes it a message of its own · Needs your word |
| a change request merged | What happened · Findings · Issues · What it leaves · Needs your word |
| a sweep's gate | The plan · Needs your word |
| a sweep done | What happened · What it leaves · Needs your word |

A slice completed as a change request prints two reports: the driver's, and the run's final one.

## A wave report

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
| `w3/store` | #92 | 🔴 chipped | your click — chip 2h old, pin `a1b2c3d` |
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
   - **Where it is acted on** — the chip, hung 2 hours ago.

Answer by number; "go" takes every recommendation.
```

## A final report

```markdown
**🟡 Two slices merged into `feat/export` · needs you: 1, blocking: 0**

## Where it stands
| slice | what | completion | state |
|---|---|---|---|
| `export/csv` | CSV writer | merged → `feat/export` · checks green | 🟢 done |
| `export/docs` | usage page | merged → `feat/export` · checks none | 🟢 done |

## Review coverage
| slice | source | covered | effort | result |
|---|---|---|---|---|
| `export/csv` | `claude` | `<base>`, 4 files | high | 🟢 no findings |
| `export/csv` | `security` | `<base>`, 4 files | high | 🟢 no findings |
| `export/csv` | `codex` | `<base>`, 4 files | xhigh | 🟢 no findings |

## Findings
**Findings — 0 after dedup · verified by none · confirmed 0 · unproven 0 · not measured 0 · refuted 0, dropped**

## Issues
- **#41** — still open: a local merge closes nothing, and the change request below would.

## What it leaves
- **Worktrees** — both slices' worktrees stand; `/hcb-dev:git-cleanup` sweeps them.

## Needs your word
### 🟡 Can wait
1. **Open one change request for the whole of `feat/export` into `<base>`?**
   - **Recommend** — open it: both merged locally and nothing has reviewed them together.
   - **If unanswered** — nothing stops; the work stays on `feat/export`.
   - **Where it is acted on** — a word here.

Answer with a word; "go" takes the recommendation.
```
