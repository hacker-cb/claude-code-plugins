---
name: git-cleanup
description: >-
  Manual-only. Sweep the git residue work leaves in this repository — merged and orphaned branches, stale or abandoned worktrees, dead upstream tracking. Two modes, given as the argument: (S) `session` — only the branches and worktrees this session created, run before closing it; (A) `all` — everything the repository has accumulated, including other sessions' leftovers. Never edits files, never touches a remote, never runs `git reset`.
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
git -C "$PROJECT" symbolic-ref --short refs/remotes/origin/HEAD    # -> origin/<main>
```

Never assume `main`/`master`/`dev`. If `origin/HEAD` is unset, ask.

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
for f in "$CFG"/sessions/*.json; do
  pid=${f##*/}; pid=${pid%.json}
  ps -p "$pid" -o comm= 2>/dev/null | grep -q claude || continue   # PIDs get reused
  grep -o '"cwd":"[^"]*"' "$f"
done
```

**This format is internal and undocumented — treat it as a hint, never as a
guarantee.** Degrade explicitly: if `$CFG/sessions/` is missing, empty, or shaped
differently than expected, say so once, and treat **every** worktree other than
the current one as *possibly occupied* — surface them, delete none.

A worktree is occupied when its path is, or contains, a live session's `cwd`.

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
grep -o '"startedAt":[0-9]*' "$CFG/sessions/${CLAUDE_PID:-$PPID}.json"   # epoch ms
```

Subtract a grace window of a few minutes: the worktree and its branch are created
**a second or two before** the process that runs in them, so a zero grace hides
your own worktree from you. `startedAt` is the start of the current **process**,
not of the conversation — after a resume the session is older than its anchor, so
trust your memory over the timestamp where the two disagree. Then:

```bash
git -C "$PROJECT" reflog show --date=unix "<branch>" | tail -1   # 'branch: Created from …'
find "$PROJECT/.git/worktrees" -maxdepth 1 -newermt "@<anchor>"  # worktree registration time
```

If the registry file is unreadable, fall back on your own memory of the session
and say that the timestamps could not be confirmed.

Mode decides *what is listed*. It never decides how freely something is deleted —
the risk class does.

## Step 4 — Discovery (read-only, one parallel batch)

```bash
git -C "$PROJECT" worktree list --porcelain     # locked / prunable / detached, with reasons
git -C "$PROJECT" for-each-ref refs/heads/ \
    --format='%(refname:short) | %(worktreepath) | %(upstream:short) %(upstream:track)'
git -C "$PROJECT" branch --merged "<main>"
git -C "$PROJECT" rev-list --count "<main>..<branch>"   # per branch without an upstream
```

`for-each-ref` gives branch → worktree → upstream → `[gone]` in one pass; prefer
it over parsing `branch -vv`.

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

Without a forge CLI, a branch outside `--merged <main>` has **unknown** merge
status: surface it, never delete it.

## Step 5 — Classification

**Worktrees** — occupancy first, git state second.

| Signal | Verdict |
|---|---|
| primary worktree | never touch |
| the current session's own worktree | never remove from inside it — see step 7 |
| path is a live session's `cwd` | keep — someone is working there right now |
| `locked` | keep — Claude Code locks a worktree while its agent runs |
| `prunable` | `worktree prune` (class 1) |
| clean, its branch merged, unoccupied | `remove` (class 2) |
| uncommitted or untracked changes | surface (class 3) — never `--force` unasked |
| its branch has an open change request | keep |

**Branches**

| Signal | Verdict |
|---|---|
| `<main>`, or checked out in any worktree | never delete |
| in `branch --merged <main>` | delete (class 2) |
| the forge CLI says its PR/MR is `MERGED` | delete (class 2) — only the forge knows this |
| `[gone]` upstream **and** merged | delete (class 2) |
| `[gone]` upstream, **not** merged | surface (class 3) — may hold the only copy |
| the forge CLI says its PR/MR is `OPEN` | keep |
| no upstream, `rev-list --count <main>..<b>` = 0 | delete (class 2) — nothing to lose |
| no upstream, unique commits | surface (class 3) |

**Risk classes** decide the gate, whatever the mode:

| Class | Meaning | Gate |
|---|---|---|
| 1 | no data loss — `worktree prune` of `prunable` entries | act, then report |
| 2 | recoverable — a merged branch, a clean worktree, an upstream repair | inside the confirmed plan |
| 3 | irreversible — unmerged branch, dirty worktree | explicit confirmation, always |

## Step 6 — The gate

Present one table: item, what it is, age or state, verdict, risk class. Then ask
once, naming what is irreversible and what it would destroy. Wait for an explicit
answer; a subset means only that subset.

## Step 7 — Execute, in this order

```bash
git -C "$PROJECT" worktree prune --verbose         # 1. reconcile the registry first
git -C "$PROJECT" worktree remove "<path>"         # 2. --force only if confirmed dirty
rm -rf "<orphan-worktree-dir>"                     # 3. dirs left by crashed agents
git -C "$PROJECT" branch -D "<branch>"             # 4. after its worktree is gone
# 5. repair tracking — re-point at origin/<main> ONLY when <current> IS <main>. On a
#    feature branch whose upstream no longer matches its name, git's default
#    push.default=simple refuses `git push` outright, leaving it unpushable; there,
#    drop the dead upstream instead and `git push -u origin <current>` restores it.
[ "<current>" = "<main>" ] \
  && git -C "$PROJECT" branch --set-upstream-to=origin/<main> <current> \
  || git -C "$PROJECT" branch --unset-upstream <current>
```

Branch deletion fails while a worktree still has it checked out — hence the
order. To remove the worktree **you are standing in**, physically leave first
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
| push, or delete a **remote** branch | keep the forge CLI read-only — never merge/close/edit a PR/MR |
| `git reset`, stage, commit, or edit files | git plumbing and worktree removal only |
| hardcode `~/.claude` | `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` |
| assume `main`/`master`/`dev` | read `origin/HEAD` |

## Edge cases

- **Not a git repository** — nothing to do; say so and stop.
- **The forge CLI offline or rate-limited mid-run** — degrade to git-only for the
  rest of the pass and downgrade every forge-derived "merged" to "surface".
- **Detached HEAD worktree** — classify by clean/dirty only; no branch to delete.
- **Worktree dir on disk but absent from `worktree list`** — a filesystem orphan:
  `rm -rf` the directory, then `prune`.
- **A branch checked out in a worktree of a *different* repository** — leave both
  alone; this skill stays within `PROJECT`.
- **Submodules** — leave them alone entirely.
