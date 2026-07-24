---
name: git-cleanup
description: >-
  Manual-only. Sweep the git residue work leaves in this repository — merged and orphaned branches, stale or abandoned worktrees, dead upstream tracking. Two modes, given as the argument: (S) `session` — only the branches and worktrees this session created, run before closing it; (A) `all` — everything the repository has accumulated, including other sessions' leftovers. Never edits files, never runs `git reset`, and never writes to a remote — it reads merged and open change requests through the forge CLI, but pushes, deletes and edits nothing there.
disable-model-invocation: true
argument-hint: "[session|all]"
---

# Git cleanup

Branches and worktrees only. Untracked junk in the working tree is not this
skill's business — `.gitignore` is, and `seeding-gitignore` owns that.

## What Claude Code already cleans up

Do not duplicate or fight these — they run on their own:

- **Exiting an interactive worktree session.** A clean, unnamed session's
  worktree and branch are removed automatically; a named one, or one holding
  work, prompts first.
- **The periodic sweep** removes worktrees Claude created for **subagents and
  background sessions** once they are older than `cleanupPeriodDays`, skipping
  any that still hold work. It **never** removes a `--worktree` worktree.
- **`git worktree lock` while an agent runs.** The sweep releases a lock left by
  a session whose process exited; it never releases a lock set by hand.

What is left over for this skill: `--worktree` and desktop-session worktrees, the
worktrees of `-p` runs (which have no exit prompt at all), anything the sweep
skipped because it held work — and **branches**, which the sweep never touches.

## Step 1 — Ground truth

```bash
git worktree list --porcelain | head -1        # 'worktree <path>' — the PRIMARY worktree
```

`PROJECT` is that primary worktree path, **not** cwd: running from inside a
worktree still means cleaning the repository as a whole.

```bash
git -C "$PROJECT" symbolic-ref --short refs/remotes/<remote>/HEAD   # -> <remote>/<default>
```

Never assume `main`/`master`/`dev`, and never assume the remote is `origin`.
Both names — and the traps in that one `symbolic-ref` line — belong to the shared
ladder in
[`../../references/base-resolution.md`](../../references/base-resolution.md)
(`${CLAUDE_PLUGIN_ROOT}/references/base-resolution.md`): how to rank the remotes
that exist, why a read symref can be stale, why the remote-tracking form is the
only safe one to carry forward. Read it; the two blocks below are that reference
applied to this sweep.

- `symbolic-ref` **reads** the pointer without dereferencing it, so after a
  forge-side default-branch rename it keeps printing the old name with status 0.
  Verify the ref it names still exists; if not, ask the remote afresh, through the
  non-interactive guard — this sweep runs unattended and an auth-walled remote
  would otherwise hang it:

- carry the default forward **as the remote-tracking ref** `<remote>/<default>`,
  never the bare name — the reference explains why (`branch --merged`/`rev-list`
  below go fatal on a bare name in a clone with no local default branch), and why
  that ref must be *materialised and re-verified* before any consumer runs.

  ```bash
  # Every network call: no prompts, bounded stalls, and the user's own ssh setup
  # left intact — a multi-account `core.sshCommand`/`GIT_SSH_COMMAND` must survive,
  # or a repo that pushes fine by hand starts failing "Permission denied".
  gitq() {
    GIT_TERMINAL_PROMPT=0 \
    GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -oBatchMode=yes -oConnectTimeout=5" \
      git -C "$PROJECT" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=10 "$@"
  }

  D="<remote>/<default>"
  git -C "$PROJECT" rev-parse --verify -q "$D^{commit}" >/dev/null 2>&1 || {
    h="$(gitq ls-remote --symref <remote> HEAD 2>/dev/null \
         | awk '$1=="ref:" && $3=="HEAD" { sub(/^refs\/heads\//,"",$2); print $2; exit }')"
    # An unreachable or auth-walled remote returns nothing. Never build `<remote>/`
    # from an empty name — a bogus ref makes every consumer below fatal.
    [ -n "$h" ] && D="<remote>/$h" || D=""
  }

  # Materialise it: a clone that only fetched feature branches has no such ref yet.
  if [ -n "$D" ] && ! git -C "$PROJECT" rev-parse --verify -q "$D^{commit}" >/dev/null 2>&1; then
    gitq fetch --quiet <remote> "${D#*/}"
  fi

  # RE-VERIFY. The fetch can fail unnoticed (remote gone since ls-remote, auth
  # wall, network) or write only FETCH_HEAD under a narrowed refspec, as a
  # --single-branch clone has. An unchecked D is then a dangling ref: consumers
  # die with "not a valid object name", or — far worse — the empty output of a
  # failed `branch --merged` reads as "nothing is merged" and a `rev-list` count
  # of 0 routes a branch to delete. Fall into the unresolved path instead.
  if [ -n "$D" ] && ! git -C "$PROJECT" rev-parse --verify -q "$D^{commit}" >/dev/null 2>&1; then
    D=""
  fi
  [ -n "$D" ] || echo "DEFAULT-UNRESOLVED"
  DEF="${D#*/}"   # bare name — ONLY for comparing against a branch name, never as a ref
  ```

  A `DEFAULT-UNRESOLVED` result is not "nothing is merged" — it is "the merge
  question cannot be answered". Every branch's status becomes **unknown**: surface
  them all, delete none, and say the remote was unreachable. Never read a failed
  command's empty output as an answer.

If there is no remote at all, ask the user — nothing local names the default.

Claude Code's own directory is `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` — the
variable is documented and may point anywhere. Never write `~/.claude` literally.

## Step 2 — Who is still working here

A worktree with a live session in it must not be removed, and git alone cannot
tell you: desktop and `--worktree` sessions do **not** lock their worktree, so a
busy one looks idle in `worktree list`.

The live-session registry answers it. Each file is one running session; the file
exists only while it runs:

```bash
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
[ -d "$CFG/sessions" ] || echo "REGISTRY-ABSENT"      # not the same as "nobody is working"
for f in "$CFG"/sessions/*.json; do
  [ -e "$f" ] || continue                             # unmatched glob stays literal
  pid=${f##*/}; pid=${pid%.json}
  kill -0 "$pid" 2>/dev/null || continue              # a file can outlive its session
  # One line per file, so a pretty-printed registry still matches. Never filter by
  # process name: an npm-installed Claude Code reports `node`, and a live session
  # read as dead is exactly the mistake that costs someone their work.
  tr -d '\n' < "$f" | grep -o '"cwd" *: *"[^"]*"' | head -1
done
```

**This format is internal and undocumented — treat it as a hint, never as a
guarantee.** An empty result is ambiguous by itself, so separate the two cases
before using it: `REGISTRY-ABSENT`, or a `cwd` line count of zero while session
files exist, both mean the probe failed. Say so once and treat **every** worktree
but the current one as *possibly occupied* — surface them, remove none. Only a
working probe that lists live sessions licenses a removal.

A worktree is occupied when a live session's `cwd` **is that worktree's path, or
lies anywhere beneath it** — a session that has stepped into a subdirectory is
still working in the worktree. Compare in that direction only: the worktree is
the ancestor, never the descendant. Erring toward "occupied" is free; erring the
other way destroys someone's work.

## Step 3 — The mode

The argument picks it. With no argument, ask — do not guess.

| | **S — `session`** | **A — `all`** |
|---|---|---|
| Question | "what did *this* session create?" | "what has this repository accumulated?" |
| Scope | branches and worktrees created after this session started | every branch and worktree, any age |
| Typical use | before closing a session | periodic audit |

The primary source for mode S is **what you remember doing in this conversation**.
Confirm it against git, anchored on the session's own start time:

```bash
# Self-contained: shell state does not survive from one Bash call to the next.
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
ms=$(grep -o '"startedAt" *: *[0-9]*' "$CFG/sessions/${CLAUDE_PID:-$PPID}.json" 2>/dev/null \
     | grep -o '[0-9]*$' | head -1)   # one value, whatever else the file grows
if [ -n "$ms" ]; then
  ANCHOR=$(( ms / 1000 - 300 ))   # epoch MILLIseconds -> seconds, minus a grace window
  echo "ANCHOR=$ANCHOR"
else
  echo "NO-ANCHOR"                # never reach the arithmetic: empty is 0, i.e. 1969
fi
```

Three traps live in those few lines. `startedAt` is **milliseconds** while
everything below is seconds — pass it through raw and the cutoff lands tens of
thousands of years out, matching nothing. An **empty** `ms` is silently `0` in
bash arithmetic, so letting an unreadable registry reach the `$(( ))` would yield
`-300`, i.e. 1969, and mode `session` would quietly widen to every branch and
worktree in the repository — hence the `if`, which skips the arithmetic rather
than guessing. And the **grace window** matters because a worktree and its branch
are created a second or two *before* the process that runs in them; with zero
grace your own worktree hides from you.

`NO-ANCHOR` costs you the git-side confirmation, not the run: skip the two
commands below, say the timestamps were unavailable, and work from the session
record you already have.

```bash
git -C "$PROJECT" reflog show --date=unix "<branch>" | tail -1   # 'branch: Created from …'
# Date the worktree by its `commondir`, written once at registration. The
# directory's own mtime is last-activity — every commit rewrites `index` inside
# it — so it would attribute a busy neighbouring session's worktree to this one.
# And use --git-common-dir, not "$PROJECT/.git": inside a worktree .git is a
# file, and with a bare primary there is no .git directory at all.
find "$(git -C "$PROJECT" rev-parse --path-format=absolute --git-common-dir)/worktrees" \
     -maxdepth 2 -name commondir -newermt "@$ANCHOR"
```

These timestamps only ever **confirm** what you remember; they never overrule it,
and an empty result is not evidence that this session created nothing. Whenever
a session is resumed or its process restarts, `startedAt` moves forward while the
worktree keeps its original registration time, so everything the session made
falls behind the anchor and the `find` legitimately comes back empty. Say the
git-side confirmation was unavailable — on `NO-ANCHOR`, on an empty result, or on
any disagreement — and go with your own record of the session.

Mode decides *what is listed*. It never decides how freely something is deleted —
the risk class does.

## Step 4 — Discovery (read-only, one parallel batch)

```bash
git -C "$PROJECT" worktree list --porcelain     # locked / prunable / detached, with reasons
git -C "$PROJECT" for-each-ref refs/heads/ \
    --format='%(refname:short) | %(worktreepath) | %(upstream:short) %(upstream:track)'
git -C "$PROJECT" branch --merged "<remote>/<default>"
git -C "$PROJECT" rev-list --count "<remote>/<default>..<branch>"   # per branch, merged or not
git -C "<each worktree path>" status --porcelain -unormal   # clean vs dirty — nothing else reports it
```

`for-each-ref` gives branch → worktree → upstream → `[gone]` in one pass; prefer
it over parsing `branch -vv`. `worktree list` never mentions modified or
untracked files, so without that per-worktree `status` there is no clean/dirty
signal at all and step 5 cannot tell a removable worktree from one holding work.

**Squash-merged branches look unmerged to git.** When the repo is on a hosted
forge and that forge's CLI is authed, close the gap read-only:

```bash
# GitHub
gh pr list --state merged --json headRefName --limit 200   # -> safe to delete
gh pr list --state open   --json headRefName --limit 200   # -> keep, in flight
# GitLab — no built-in --jq, and `mr list` already defaults to open
glab mr list --merged --output json --per-page 100 | jq -r '.[].source_branch'   # -> safe to delete
glab mr list          --output json --per-page 100 | jq -r '.[].source_branch'   # -> keep, in flight
```

Both CLIs answer with **branch names only**, and a name is not an identity: a
merged `fix/login` may have come from a fork, or the local branch of that name
may have been recreated since with fresh commits. So a forge "merged" is a
candidate, not a verdict — confirm the local branch carries nothing of its own:

```bash
git -C "$PROJECT" rev-list --count "<remote>/<default>..<branch>"    # 0 -> nothing to lose
```

Non-zero means the local branch has commits the merge does not contain: surface
it as class 3 instead of deleting it.

Without a forge CLI, a branch outside `--merged <remote>/<default>` has **unknown** merge
status: surface it, never delete it.

## Step 5 — Classification

**Worktrees** — occupancy first, git state second.

| Signal | Verdict |
|---|---|
| primary worktree | never touch |
| the current session's own worktree | never remove from inside it — see step 7 |
| path is a live session's `cwd`, or occupancy unknown | keep — someone may be working there |
| `locked` | keep — Claude Code locks a worktree while its agent runs |
| `prunable`, and its path's parent directory exists | `worktree prune` (class 1) |
| `prunable` because the whole path is unreachable | surface (class 3) — an unmounted volume looks identical to a deleted worktree, and pruning strands the work it still holds |
| clean, its branch merged, unoccupied | `remove` (class 2) |
| uncommitted or untracked changes | surface (class 3) — never `--force` unasked |
| on disk but absent from `worktree list` | a filesystem orphan: class 1 only if `git status` in it is empty, otherwise surface (class 3) — it is still someone's working tree |
| its branch has an open change request | keep |

**Branches**

| Signal | Verdict |
|---|---|
| the default branch, or checked out in a worktree you are keeping | never delete |
| checked out in a worktree being removed in this same run | delete after that worktree is gone — this is the common case, not an exception |
| in `branch --merged <remote>/<default>` | delete (class 2) |
| the forge says `MERGED` **and** `rev-list --count <remote>/<default>..<b>` = 0 | delete (class 2) — only the forge knows about a squash merge |
| the forge says `MERGED` but the branch has its own commits | surface (class 3) — same name, different work |
| `[gone]` upstream **and** merged | delete (class 2) |
| `[gone]` upstream, **not** merged | surface (class 3) — may hold the only copy |
| the forge CLI says its PR/MR is `OPEN` | keep |
| no upstream, `rev-list --count <remote>/<default>..<b>` = 0 | delete (class 2) — nothing to lose |
| no upstream, unique commits | surface (class 3) |

**Risk classes** decide the gate, whatever the mode:

| Class | Meaning | Gate |
|---|---|---|
| 1 | no data loss — `worktree prune` of a reachable `prunable` entry | act, then report |
| 2 | recoverable — a merged branch, a clean worktree, an upstream repair | inside the confirmed plan |
| 3 | irreversible — unmerged branch, dirty worktree, **any working-tree file** | explicit confirmation, always |

Anything that deletes a file someone could still want is class 3, whichever
table routed it there. An `rm -rf` is never class 1.

## Step 6 — The gate

Present one table: item, what it is, age or state, verdict, risk class. Then ask
once, naming what is irreversible and what it would destroy. Wait for an explicit
answer; a subset means only that subset.

## Step 7 — Execute, in this order

```bash
git -C "$PROJECT" worktree remove "<path>"         # 1. --force only if confirmed dirty
rm -rf "<orphan-worktree-dir>"                     # 2. approved class-3 items only
git -C "$PROJECT" worktree prune --verbose         # 3. AFTER the rm, or the entry it just
                                                   #    orphaned still blocks its branch
git -C "$PROJECT" branch -d "<branch>"             # 4. -d, so git re-checks "fully merged"
git -C "$PROJECT" branch -D "<branch>"             #    -D only for a confirmed squash merge
# 5. repair tracking — re-point at <remote>/<default> ONLY when <current> IS the
#    default branch. On a feature branch whose upstream no longer matches its name,
#    git's default push.default=simple refuses `git push` outright, leaving it
#    unpushable; there, drop the dead upstream instead and
#    `git push -u <remote> <current>` restores it.
#    if/else, never `test && A || B`: that runs B when A itself fails, so a
#    set-upstream-to against a dangling <remote>/<default> would strip the default
#    branch's tracking outright — the opposite of the repair, in exactly the case
#    this step is for.
#    Compare against $DEF, the BARE name from step 1 — a branch name is never the
#    remote-tracking form, so testing <current> against "<remote>/<default>" is
#    false even on the default branch and would unset its tracking instead of
#    repairing it. Refs go in --set-upstream-to; names go in the comparison.
#    And skip the whole repair when step 1 said DEFAULT-UNRESOLVED: with $DEF
#    empty the comparison is false for EVERY branch, so the else arm would strip
#    upstreams wholesale on exactly the run that was told it cannot answer the
#    question. Unknown means touch nothing.
if [ -z "$DEF" ]; then
  echo "skipping upstream repair — default branch unresolved"
elif [ "<current>" = "$DEF" ]; then
  git -C "$PROJECT" branch --set-upstream-to="$D" "<current>"
else
  git -C "$PROJECT" branch --unset-upstream "<current>"
fi
```

Order matters twice over. Branch deletion fails while a worktree still has the
branch checked out, and `worktree prune` must come *after* any manual `rm -rf` —
prune first and the deleted directory's registration is still there, so the
`branch -d` behind it fails with "used by worktree at …".

`branch -d` refuses a branch that is not fully merged, which is a free second
opinion on every classification derived from a forge listing or from `[gone]`.
Reach for `-D` only where the merge is genuinely invisible to git — a squash
merge already confirmed by `rev-list --count` — and say so when you do.

To remove the worktree **you are standing in**, physically leave first
(`git worktree remove` inspects the real cwd):

```bash
cd "<PROJECT>"                                 # a separate Bash call — cwd must truly change
git -C "<PROJECT>" worktree remove "<old-cwd>"
```

Then tell the user cwd moved to `PROJECT` — their old path no longer exists.

## Step 8 — Verify and report

Re-run discovery. Report what went, what was kept and why, and — separately —
what was surfaced and left for the user to decide. List the class-1 actions taken
without asking.

## Never

| ❌ | ✅ |
|---|---|
| remove a worktree without checking occupancy | live session `cwd`, or unknown → keep |
| `git worktree unlock` something Claude Code locked | leave it; the periodic sweep releases stale locks itself |
| delete an unmerged branch, or one whose status is unknown | surface it, let the user decide |
| `--force` a dirty worktree unasked | skip it, report it |
| `rm -rf` a path outside this repository's worktree directories | resolve it from `worktree list` / the git dir, never from a name |
| push, or delete a **remote** branch | keep the forge CLI read-only — never merge/close/edit a PR/MR |
| `git reset`, stage, commit, or edit files | git plumbing and worktree removal only |
| hardcode `~/.claude` | `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` |
| assume `main`/`master`/`dev`, or that the remote is `origin` | read `<remote>/HEAD`, verify it resolves, else `ls-remote` |
| compare against a bare `<default>` | use the remote-tracking ref `<remote>/<default>` — a bare name is fatal with no local default branch |

## Edge cases

- **Not a git repository** — nothing to do; say so and stop.
- **The forge CLI offline or rate-limited mid-run** — degrade to git-only for the
  rest of the pass and downgrade every forge-derived "merged" to "surface".
- **Detached HEAD worktree** — classify by clean/dirty only; no branch to delete.
- **Worktree dir on disk but absent from `worktree list`** — a filesystem orphan.
  Run `git status` inside it first: empty means `rm -rf` then `prune`; anything
  else means it still holds work, so surface it as class 3 and touch nothing.
- **A bare primary worktree** — there is no `.git` directory; every path comes
  from `rev-parse --git-common-dir`, and an empty `find` there is a failed probe,
  not an empty repository.
- **A branch checked out in a worktree of a *different* repository** — leave both
  alone; this skill stays within `PROJECT`.
- **Submodules** — leave them alone entirely.
