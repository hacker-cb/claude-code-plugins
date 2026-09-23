# Verifying a finding — the one checker, and when its verdict stands

Read by whatever has findings checked. It owns how a candidate reaches the plugin's one checker,
`hcb-dev:findings:verifier`, what that checker is handed and hands back, and when a verdict already
made stands in place of a new check. The `Verified` column the verdicts end up in is
[`findings-table.md`](findings-table.md)'s; the rating, the scope test and the outcomes are
[`findings.md`](findings.md)'s.

## The store

Candidates, groups and verdicts live in a round's work directory outside the repository, and only
`review-round.mjs` writes there: every write is checked against
[`../schemas/candidates.json`](../schemas/candidates.json),
[`../schemas/verdict.json`](../schemas/verdict.json) and
[`../schemas/result.json`](../schemas/result.json), and refused with the errors that say what to
fix. A round is addressed by the short id `init` prints — never by its path.

```bash
node "<plugin root>/scripts/review-round.mjs" init --mode pass --tree "<worktree, or the ref the claims are read on>" --language "<the report's language, as a tag>"
node "<plugin root>/scripts/review-round.mjs" add --round "<round>" --source "<carrier>" < "<candidates JSON>"
node "<plugin root>/scripts/review-round.mjs" merge --round "<round>"
node "<plugin root>/scripts/review-round.mjs" units --round "<round>" < "<groups JSON>"
node "<plugin root>/scripts/review-round.mjs" queue --round "<round>" --budget "<n>"
node "<plugin root>/scripts/review-round.mjs" wait --round "<round>" --for verdicts
node "<plugin root>/scripts/review-round.mjs" result --round "<round>"
```

A review round opens the same store with `--mode round` and fills it from its finders; from `merge`
on, the steps are the ones below.

## Handing candidates in

- **One `add` per carrier** — a review's result, a batch's return, a handed-over table — each claim
  in the candidate shape, and each carrier under a task name of its own: `--source` gives the
  default, `--task` another, and a second `add` under a name already taken is refused. A finding that already carries a verdict hands it over whole, in its
  `verdict` field, so it can stand without a new check.
- **The tree a pass reads is the caller's to name.** A coordinate that tree does not carry is kept
  and marked unreachable: unread, never refuted, and it reaches the result as
  `not measured — unreachable`.
- **Candidate text travels as written.** The claim is the finder's own `summary`; nothing is
  reworded on the way in, and a candidate lacking a concrete failure scenario is not one to submit.
- **Every carrier is in before the grouping.** Once `units` has run, `add` refuses: a carrier
  that arrives later goes into the next pass. One accepted while `units` was running belongs to no
  group, and `result` stops until the round is grouped again.

## Grouping

`merge` lists every accepted candidate by id. Group them by the key
`findings.md` fixes — one defect at one coordinate, or one mechanism anchored at
several — and hand the grouping to `units`: every candidate in exactly one group, the lead being the
member whose failure scenario is the most concrete. The group is rated by its most severe member
and checked by its lead's claim, so only the lead's carried verdict can stand for it. Distinct
defects sharing a cause stay apart here; joining them is a reading of the verdicts, after the
checks.

Group once and queue once: a second `units` drops the queue and every verdict recorded, and a
second `queue` drops the verdicts — both start the checks over.

## Launching the checks

`queue` orders the groups — every `Critical` first — and says which the budget cut. Then:

- **One `hcb-dev:findings:verifier` per queued group**, handed `round <id>, unit <U>` and nothing
  else — the checker takes the claim from the store, where who found it, how sure they were and how
  severe they called it are withheld. Up to ten launches in one message; where the Agent tool offers
  `run_in_background`, pass `false`.
- **Then wait with `wait --for verdicts`** — one blocking call per window, given the Bash tool's
  ten-minute maximum as its timeout, since the window outlasts the tool's own default. Repeat it
  until it says complete or its `since_start_s` reaches the ceiling [`review-runs.md`](review-runs.md)
  sets. Never poll, sleep or start a watcher in its place.
- **Only the store counts.** A checker's closing line is a receipt, not a verdict; a group still
  without one at the ceiling is `not measured — failed`, and the next pass checks it.
- **The checks run the plugin's script.** In the `default` permission mode its first call asks once,
  and an answer given for the session covers every check. Where nobody can answer, no verdict is
  recorded: say the verification was unavailable, never read the silence as a result.

## What a verdict says

| verdict | means | carries |
|---|---|---|
| `confirmed` | the checker points at the line and at the input or state that makes it fail as claimed | the evidence it read |
| `unproven` | the mechanism is real or plausible, the trigger not shown | `settle` — the read or the command that would decide it |
| `refuted` | the code does not say that, a guard stops it, or it cannot happen | `refuted_because`, with the evidence that shows it |

The checker only reads: it never runs the code under review, its build or its tests. A finding only
a run could decide stays `unproven`, and running its `settle` is the job of the session holding the
work, where a fix hangs on the answer.

## When a verdict stands

`queue` reuses a carried verdict in place of a new check where it is `confirmed` or `unproven`, its
evidence read the finding's own file, **every** file its evidence read still has the blob
recorded — on the tree this store reads, the working tree through `git hash-object`, a ref through
`git rev-parse <ref>:<path>` — with each quote standing at the lines it names, and every file it
found absent is absent still. Any one file changed, gone or come into being, and the group is
checked again. `refuted` never stands: it
released work, and a finding that comes back is checked again. A verdict names the revision it
read — the commit the store opened on, `+wt` where anything it read on the working tree differs
from it — and a reused one keeps that revision.

**A finding leaving the session keeps its verdict whole.** Where a row travels on — a return, a
handoff, a ledger entry — the verdict from `result.json`, evidence and blobs included, goes with it,
so the pass that reads it later can let it stand rather than check it again.

## The budget

`--budget` is the caller's: a review round's comes with its rung, a pass keeps its own rule. Every
`Critical` is queued before the budget applies; where the `Critical` groups alone do not fit, `queue`
says so and queues none of them — the caller stops rather than rule a severe finding unverified.
What the budget cut reaches the result as `not measured — budget`.

## Reading the result

`result` builds `result.json` from the store — no model writes it: the findings ranked by severity,
each `confirmed`, `unproven` or `not measured` with its reason, the refuted apart, and the warnings.
Its reasons are the ones `findings-table.md` names — `budget`, `unreachable`, `failed`, `depth`, `none ran` —
and a finding whose verdict was reused says so.
