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

Two values, and every later step needs both. Shell state does not survive between
`Bash` calls, so write them down and substitute the literals — `git -C ""` is a
silent no-op against cwd, which is the one thing this step exists to prevent.

```bash
git worktree list --porcelain | sed -n '1s/^worktree //p'   # the PRIMARY worktree
```

Then read `<remote>/HEAD` in it — `symbolic-ref --short refs/remotes/<remote>/HEAD`,
with the remote resolved rather than assumed.

`PROJECT` is the primary worktree, **not** cwd: a run started inside a worktree
still cleans the repository as a whole.

The default branch is resolved by the shared ladder in
[`../../references/base-resolution.md`](../../references/base-resolution.md) —
including why a read symref can be stale, why the remote-tracking form is the one
to carry forward, and the non-interactive guard every network call needs. Two
things it cannot decide for you:

- **Carry both forms.** `<remote>/<default>` is a ref, for `branch --merged` and
  `rev-list`; the bare `<default>` is a name, for comparing against a branch name.
  Crossing them is fatal one way and silently false the other.
- **Unresolved is not "nothing is merged".** Where the default cannot be
  established — no remote, an unverifiable pointer — every branch's status becomes
  **unknown**: surface them all, delete none, say the remote was unreachable. A
  failed command's empty output is never an answer. With no remote at all, ask.

Claude Code's own directory is `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` — a documented
variable that may point anywhere. Never write `~/.claude` literally.

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

The argument picks it; with no argument, ask.

| | **S — `session`** | **A — `all`** |
|---|---|---|
| Scope | branches and worktrees this session created | everything the repository has accumulated |
| Typical use | before closing a session | periodic audit |

For mode S the source is **what you remember doing in this conversation** — that is
the answer, not a hint to be checked. Timestamps only ever confirm it and go missing
routinely: a resumed session moves its own start time forward while its worktree
keeps the original registration, so everything it made falls behind any cutoff.

Mode decides *what is listed*. It never decides how freely something is deleted —
the risk class does.

## Step 4 — Discovery (read-only, one parallel batch)

Runnable as-is — it derives the primary worktree rather than taking it on trust:

```bash
P="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
git -C "$P" worktree list --porcelain      # locked / prunable / detached, with reasons
git -C "$P" for-each-ref refs/heads/ \
    --format='%(refname:short) | %(worktreepath) | %(upstream:short) %(upstream:track)'
git -C "$P" worktree list --porcelain | sed -n 's/^worktree //p' \
  | while read -r w; do
      printf '%s: ' "$w"
      git -C "$w" status --porcelain --ignored=traditional -unormal | tr '\n' ' '; echo
    done
```

Two more need the default branch step 1 resolved, so substitute it — these are a
recipe, not a script:

```text
git -C <P> branch --merged <remote>/<default>
git -C <P> rev-list --count <remote>/<default>..<branch>     # per branch, merged or not
```

**Ask for ignored files, and use `traditional`.** `worktree remove` deletes the
directory whole, ignored files included, and a plain `status` cannot see them — so a
worktree holding only `.env.local` or a local database reads as *clean* and the gate
never names what it is about to destroy. That is the normal shape of a Claude Code
worktree: a project with a `.worktreeinclude` copies exactly such files in. Use
`traditional`, which collapses a directory to one entry; `matching` prints every
path inside it and buries the signal.

Then read the list rather than counting it. Every repo of this user carries the
`seeding-gitignore` baseline, so nearly every worktree reports something —
`.DS_Store`, a `node_modules/`. Those are regenerable noise. What matters is whether
an entry could hold something not reproducible from the repo.

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

```text
git -C <P> rev-list --count <remote>/<default>..<branch>     # 0 -> nothing to lose
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
| 1 | no data loss — `worktree prune`, which drops registrations, not files | act, then report |
| 2 | recoverable — a merged branch, a clean worktree, an upstream repair | inside the confirmed plan |
| 3 | irreversible — unmerged branch, dirty worktree, non-regenerable ignored files | explicit confirmation, with the files named |
| — | unclassifiable — a directory git does not know about | surface it; there is nothing safe to propose |

**This skill never runs `rm`.** Every removal goes through git, which refuses on its
own when work would be lost. A raw `rm -rf` has no such second opinion, and the one
case that wanted it — a directory on disk that `worktree list` does not know about —
is exactly where nothing can tell you what the directory is. `git status` inside it
does not answer either: with the `.git` file gone it walks *up* and reports the
enclosing repository, so a clean primary makes the orphan read as empty.

## Step 6 — The gate

Present one table: item, what it is, age or state, verdict, risk class. Then ask
once, naming what is irreversible and what it would destroy. Wait for an explicit
answer; a subset means only that subset.

## Step 7 — Execute, in this order

Substitute the literals step 1 resolved.

```text
git -C <P> worktree remove <path>      1. --force only if confirmed dirty
git -C <P> worktree prune --verbose    2. repo-global and unaimable
git -C <P> branch -d <branch>          3. -d re-checks "fully merged"
git -C <P> branch -D <branch>             -D only for a confirmed squash merge
```

Worktree removals come first: branch deletion fails while a worktree still holds
the branch checked out.

`worktree prune` takes no path — it sweeps every stale registration at once. That is
survivable, because it removes git's bookkeeping rather than a working tree: an entry
whose path is merely unreachable still has its files wherever they live. Say in the
report which entries went.

**Upstream repair, last and conditionally.** Re-point at `<remote>/<default>` only
when the current branch *is* the default — compare **names**, since a branch name is
never the remote-tracking form and testing against `<remote>/<default>` is false even
on the default branch. On a feature branch whose upstream no longer matches its name,
`push.default=simple` refuses `git push` outright; drop the dead upstream there and
`git push -u <remote> <current>` restores it. And where step 1 could not establish
the default, **skip the repair entirely** — with no name to compare, every branch
takes the else arm and has its tracking stripped, on precisely the run that was told
it cannot answer the question.

To remove the worktree **you are standing in**, leave first — in a separate `Bash`
call, since cwd must truly change. `git worktree remove .` from inside it succeeds
(verified on git 2.54) and takes the directory out from under you; the next command
then fails on a cwd that no longer exists.

## Step 8 — Verify and report

Re-run discovery. Report what went, what was kept and why, and — separately —
what was surfaced and left for the user to decide. List the class-1 actions taken
without asking.

## Never

| ❌ | ✅ |
|---|---|
| `git worktree unlock` something Claude Code locked | leave it; the periodic sweep releases stale locks itself |
| `rm` anything | every removal goes through git, which refuses when work would be lost |
| push, or delete a **remote** branch | keep the forge CLI read-only — never merge/close/edit a PR/MR |
| `git reset`, stage, commit, or edit files | git plumbing and worktree removal only |
| hardcode `~/.claude` | `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` |

## Edge cases

- **Not a git repository** — nothing to do; say so and stop.
- **The forge CLI offline or rate-limited mid-run** — degrade to git-only for the
  rest of the pass and downgrade every forge-derived "merged" to "surface".
- **Detached HEAD worktree** — classify by clean/dirty only; no branch to delete.
- **Worktree dir on disk but absent from `worktree list`** — a filesystem orphan.
  Surface it, touch nothing; `git status` inside it describes the enclosing
  repository, not the directory.
- **A bare primary worktree** — there is no `.git` directory; every path comes
  from `rev-parse --git-common-dir`, and an empty `find` there is a failed probe,
  not an empty repository.
- **A branch checked out in a worktree of a *different* repository** — leave both
  alone; this skill stays within `PROJECT`.
- **Submodules** — leave them alone entirely.
