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

**While a round runs, the tree does not change.** A verdict reads the working tree, and one that
read a file edited since `init` is flagged in the result as read on a tree the finders did not
see.

**The agents only read because they are told to.** No sandbox holds them: what a finder or the
checker may run is what the session's permission mode lets through. Where Codex is a source, the
change and whatever Codex reads of the checkout go to its model provider as well. Whether a
round runs over code nobody here wrote, or sends a checkout to Codex, is the user's call.

## Running one

1. **Scope.** The base is the one a caller hands down, refreshed, or what
   [`base-resolution.md`](base-resolution.md) resolves, taken as that reference says; where none
   resolves the round does not open. The working tree alone takes `HEAD`. The rung is the
   caller's, `medium` where none is named. The language is the one the report is written in.
2. **Open it**, with the entry's own sources — `claude`, Claude's finders, one agent per angle of
   the rung; `security`, a finder per security angle of the rung; `codex`, one pass of the Codex
   CLI at the rung's level for it — a narrowing,
   `--narrow "<a path, or a focus>"`, where the caller gave one, and a Codex model or level the
   caller named, as `--codex-model` and `--codex-effort`. Read the answer's `warnings` before
   anything else: an untracked file named there is outside the review — say so, and offer
   `git add -N <path>`, never run it; a round with nothing to review says so, and ends there.

   ```bash
   node "<plugin root>/scripts/review-round.mjs" init --mode round --base "<base>" --rung "<rung>" --sources "<sources>" --language "<tag>"
   node "<plugin root>/scripts/review-round.mjs" add --round "<round>" --source noticed < "<candidates JSON>"
   ```

   The second line is for candidates the caller already holds — noticed while working, carried
   from an earlier pass — each with its verdict where one was made.
3. **Launch the conductor**, `hcb-dev:review:reviewer`, prompted `round <id>` alone —
   `run_in_background: false` where the Agent tool offers it — and wait for it: a subagent
   always reports its end. Where the call comes back at once, the conductor running in the
   background, wait for its completion notice; the result is never read while it runs. A
   conductor stopped by a model's limit is launched once more on another model the Agent tool
   offers, and resumes the round. Asking for it is the entry's to do: a rule admitting subagents
   only on a skill's ask is met by it.
4. **Read the result** and report from it — *Reading the result* below. One that refuses — a
   conductor that stopped with candidates it never grouped — is finished by the entry: `merge`,
   each candidate no group holds grouped alone (`units`, or `units --append` where a grouping
   exists), and `result` again. What was found reaches the report, checked no further, and its
   source's row is reported `partial` with that reason, whatever `coverage` says.

The conductor plans the round, starts Codex as a background process and one
`hcb-dev:review:finder` per angle in a single message, waits for every task in the store, groups
what was handed in, has every group it can afford checked by `hcb-dev:findings:verifier`, runs
the sweep where the rung has one, and builds the result. **A conductor launched on a round
already under way resumes it**: the tasks `wait --for tasks` still lists are the only ones
started, a round `merge` calls `grouped` is not grouped again, and one it calls `queued` is not
queued again.

**Without agents.** Where the one that should launch agents has no Agent tool, it does the
round's tasks itself instead, on a plan made with `--depth`: the Codex pass started first, in the
background, where the plan has one; then each finder task's brief, the change and the code as the
brief says — a file by its `n`, and a file's history by the path the brief gives it, read in the
same block and passed after `--` — and the candidates handed in through `add`, a secret named
where it sits and never by its value; then `wait` until the Codex task has answered, `merge`,
`units`, `queue` — which checks nothing here, and lets a carried verdict stand — and `result`.
Nothing is checked, and the result says so.

```bash
node "<plugin root>/scripts/review-round.mjs" plan --round "<round>" --depth
node "<plugin root>/scripts/review-round.mjs" codex --round "<round>"
node "<plugin root>/scripts/review-round.mjs" brief --round "<round>" --task "<task>"
node "<plugin root>/scripts/review-round.mjs" diff --round "<round>" --number "<n>"
node "<plugin root>/scripts/review-round.mjs" show --round "<round>" --number "<n>"
P="$(node "<plugin root>/scripts/review-round.mjs" brief --round "<round>" --task "<task>" | jq -r --argjson n "<n>" '.scope.files[] | select(.n == $n) | .path')"
git log --oneline -- "$P"
node "<plugin root>/scripts/review-round.mjs" wait --round "<round>" --for tasks
```

## The rung

`high` buys breadth — more angles, more candidates per angle, Codex a level higher, a larger
budget of checks, and a sweep for what the first pass missed. The rung's angles and numbers are
data in the plugin's angle catalog, read by `plan`, never chosen by the one running the round;
Codex's model and its ladder come from Codex's own catalog. For more than `high` buys, or where
a round reads thin for the ground the change covers, offer the user the built-in `/code-review`
at `xhigh`, `max` or `ultra`, typed by them, with the range spelled out as `<base>...HEAD`; never
launch it.

## What an agent's outcome becomes

| outcome | the task's status |
|---|---|
| it handed in, and said so | what the store holds — `covered`, or `partial` where every anchor it gave missed the change or it recorded a read it was refused |
| it stopped on its turn limit after handing in | what it handed in stands; `partial` |
| it returned without handing in | one reminder; still nothing — `partial` |
| a model's limit | launched again on another model, named in the status; failing again — `unavailable` |
| the account's limit | `unavailable`, the notice in the status |
| Codex answered nothing, or not in time | `unavailable`, the log's last lines or the watchdog in the status — where they name one model's limit, a round opened again with another `--codex-model` closes it |
| a verifier stopped by a model's limit | launched again on another model; failing again, its group reads `not measured — failed` |
| it was never launched, or never returned | `partial` for its source, the task named — `unavailable` where no task of that source answered |
| no agents at all | `depth` for the finders' source |

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

A `coverage-warning:` and a `run-warning:` in the result's `warnings` are read as
[`review-runs.md`](review-runs.md)'s *Reading it back* reads them.

## Reading the result

```bash
node "<plugin root>/scripts/review-round.mjs" result --round "<round>"
```

What `result` holds besides the coverage above — the findings, the refuted, the warnings — is
read as `verification.md`'s *Reading the result* reads it; a finding's `found_by` names every
source that reported it, and Codex's row names the model and level it ran at.

Report it as `## Review coverage` from `coverage` — a row per source the round was opened with,
with the round's base, its file count and its rung — and `## Findings` laid out by
`findings-table.md`, `verified by verifier` where any check ran. A finding's text is its finder's, in the round's language: pass
it on as written.
