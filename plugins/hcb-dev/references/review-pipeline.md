# A review round — how one runs, and what it hands back

Read by whatever opens a review round. It owns the round's shape — the store, the rungs, who
runs what, what each agent's outcome becomes — and the coverage the round reports. The checker,
and when a verdict it made stands, are [`verification.md`](verification.md)'s; the table the
findings reach a reader in is [`findings-table.md`](findings-table.md)'s.

## The round

A round reviews one change: base → working tree, every tracked file, as it stood when `init`
opened it. Commits and uncommitted edits are both in it; an untracked file is not, and is named
in a `coverage-warning` with `git add -N <path>` as the way in. Everything the round holds lives
in a store outside the repository that only `review-round.mjs` writes, addressed by the id
`init` prints — never by a path.

```bash
node "<plugin root>/scripts/review-round.mjs" init --mode round --base "<ref>" --rung "<rung>" --sources "<sources>" --language "<tag>"
```

- `--sources` — who reviews: `claude`, Claude's finders, one agent per angle of the rung.
- `--language` — the language the report is written in; every finding's text is written in it
  and reaches the report as written.
- `--narrow "<a path, or a focus>"` — where the caller narrowed the review; it travels to every
  finder in prose.
- Candidates the caller already holds — noticed while working, carried from an earlier pass —
  go in before the round runs, `add --source noticed`, each with its verdict where one was made.

**While a round runs, the tree does not change.** A verdict reads the working tree, and one that
read a file edited since `init` is flagged in the result as read on a tree the finders did not
see.

## The rung

`medium` unless the caller names `high`, and an explicit word from the caller wins. `high` buys
breadth — more angles, more candidates per angle, a larger budget of checks, and a sweep for what
the first pass missed. The rung's angles and numbers are data in the plugin's angle catalog, read
by `plan`, never chosen by the one running the round. For more than `high` buys, offer the user
the built-in `/code-review` at `xhigh`, `max` or `ultra`, typed by them, with the range spelled
out as `<base>...HEAD`; never launch it.

## Who runs it

1. **The entry** opens the round, hands in what it already holds, launches
   `hcb-dev:review:reviewer` prompted `round <id>` alone — `run_in_background: false` where the
   Agent tool offers it — and waits for it: a subagent always reports its end.
2. **The conductor** plans the round, launches one `hcb-dev:review:finder` per task in a single
   message, waits for every task in the store, groups what was handed in, has every group it can
   afford checked by `hcb-dev:findings:verifier`, runs the sweep where the rung has one, and
   builds the result.
3. **The entry** reads the result and reports from it.

**Without agents.** Where the one that should launch agents has no Agent tool, it does the
round's tasks itself instead, on a plan made with `--depth`: each task's brief, the change and the
code as the brief says, the candidates handed in through `add`, then `merge`, `units` and
`result`. Nothing is checked, and the result says so.

```bash
node "<plugin root>/scripts/review-round.mjs" plan --round "<round>" --depth
node "<plugin root>/scripts/review-round.mjs" brief --round "<round>" --task "<task>"
node "<plugin root>/scripts/review-round.mjs" diff --round "<round>"
```

## What an agent's outcome becomes

| outcome | the task's status |
|---|---|
| it handed in, and said so | what the store holds — `covered`, or `partial` where every anchor it gave missed the change |
| it stopped on its turn limit after handing in | what it handed in stands; `partial` |
| it returned without handing in | one reminder; still nothing — `partial` |
| a model's limit | launched again on another model, named in the status; failing again — `unavailable` |
| the account's limit | `unavailable`, the notice in the status |
| it was never launched, or never returned | `partial` for its source, the task named |
| no agents at all | `depth` |

A candidate anchored where the change has nothing — a file the round does not carry, a line
past a file's end, an untracked file — is dropped and named, and its task carries a
`run-warning`. A task every anchor of which missed the change reviewed something else, and reads
`partial`.

## The coverage it reports

One row per source, as covered as its least covered task:

| state | the row reads |
|---|---|
| `covered` | 🟢 |
| `partial` | 🔴 `partial`, and what it missed |
| `depth` | 🔴 `partial — depth`: the tasks ran with no agents, and nothing was checked |
| `unavailable` | 🔴 `UNAVAILABLE`, with the notice |
| `nothing` | 🔴 `nothing to review` |
| `n/a` | ⚪ `n/a`, with the caller's reason |

A `coverage-warning:` in the result's `warnings` makes the round partial whatever its rows say;
a `run-warning:` does not — it says what a task did, not what it read.

## Reading the result

```bash
node "<plugin root>/scripts/review-round.mjs" result --round "<round>"
```

The result is built by the script from the store, and no model writes it:

- `coverage` — the rows above;
- `findings` — ranked by severity, each `confirmed` or `unproven` at the revision it was read at,
  or `not measured` with its reason, and `found_by` naming every source that reported it;
- `refuted` — apart, with what showed each does not hold;
- `warnings` — the coverage the round could not give.

Report it as `## Review coverage` from `coverage` and `## Findings` laid out by
`findings-table.md`, `verified by verifier` where any check ran. A finding's text is the
finder's, in the round's language: pass it on as written.
