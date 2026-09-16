---
name: git-cleanup
description: >-
  Manual-only. Sweep the git residue work leaves in this repository — merged and orphaned branches, stale or abandoned worktrees, dead upstream tracking. Two modes, given as the argument: (S) `session` — only the branches and worktrees this session created, run before closing it; (A) `all` — everything the repository has accumulated, other sessions' leftovers included. Deletes branches; a worktree Claude Code created for another session it reports rather than removes, because the host leases those to sessions that outlive their processes. Never edits files, never runs `git reset`, and never writes to a remote — it reads merged and open change requests through the forge CLI, but pushes, deletes and edits nothing there.
disable-model-invocation: true
argument-hint: "[session|all]"
---

# Git cleanup

Branches and worktrees only. Untracked junk in the working tree is not this
skill's business — `.gitignore` is, and `seeding-gitignore` owns that.

## Step 1 — Ground truth

```bash
git worktree list --porcelain | head -1        # 'worktree <path>' — the PRIMARY worktree
```

`PROJECT` is that primary worktree path, **not** cwd: running from inside a
worktree still means cleaning the repository as a whole.

**The default branch and its remote** are what this sweep measures everything
against, and that is a narrower question than "what should this change be diffed
against" — the base of whatever request happens to be open is not the default, and
deleting by it deletes branches merged somewhere else.
[`../../references/base-resolution.md`](../../references/base-resolution.md) owns
the wider question; this one has a script:

```bash
DB="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/default-branch.mjs")"
# BOTH flags, and each covers a different failure: `.confirmed` false may be this
# checkout's own stale pointer, `.resolved` false a name whose ref was never brought.
# A ref to READ and a name to COMPARE are two values — never derive one by trimming the
# other, which yields `remotes/origin/master` and matches nothing.
D="$(printf '%s' "$DB" | jq -r 'if .resolved and .confirmed then .ref  else "" end')"
DEF="$(printf '%s' "$DB" | jq -r 'if .resolved and .confirmed then .name else "" end')"
[ -n "$D" ] || echo "DEFAULT-UNRESOLVED: $(printf '%s' "$DB" | jq -r '.reason // (.notes | join("; "))')"
```

Empty `$D` is **DEFAULT-UNRESOLVED**, which step 4 carries through as
`"usable": false`. If there is no remote at all, ask the user — nothing local names the
default.

## Step 2 — Who is still working here

A worktree with a live session in it must not be removed, and git alone cannot tell you.
One script reads every worktree of the repository at once:

```bash
# `--repo-dir` names WHICH repository to sweep; where this run stands is read from the
# directory the command runs in, and they are two questions. `$PROJECT` for both would
# make the main worktree the one you are in — the one `worktree remove` refuses.
node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-owners.mjs" --repo-dir "$PROJECT"
```

Carry its `owner` and `blockers` into step 5, and read them **in one direction only**: a
live session proves a worktree is in use, and its absence proves nothing —
[`../../references/claude-worktrees.md`](../../references/claude-worktrees.md) owns why,
and `unsettled` is the one question it leaves you.

Two answers of its own that are not "nobody is working": `"probeFailed": true` is no
registry or records that would not read, and every worktree goes unknown then, the one
you stand in included. `"read": false` answers nothing about any worktree at all — its
`reason` names the reading that failed, and the empty lists beside it are not "none of
them are yours". Say so, and go on to the branches, which stand on their own.

## Step 3 — The mode

The argument picks it. With no argument, ask — do not guess.

| | **S — `session`** | **A — `all`** |
|---|---|---|
| Question | "what did *this* session create?" | "what has this repository accumulated?" |
| Scope | branches and worktrees created after this session started | every branch and worktree, any age |
| Typical use | before closing a session | periodic audit |

**Mode S is what you remember creating in this conversation.** That record is the
source, not a corroborating one — you were there for every branch cut and every
worktree added. A timestamp probe cannot overrule it.

Where memory is genuinely unsure about one item, list it. Mode decides *what is
listed*, never how freely anything is deleted — the risk class does that, and
step 6 puts the whole list in front of the user before a single deletion.

## Step 4 — Discovery (read-only, one call)

```bash
SCAN="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/cleanup-scan.mjs" \
  --repo-dir "$PROJECT" --default "$DEF" --default-ref "$D")"
printf '%s\n' "$SCAN"
```

It speaks both forge CLIs and picks whichever answers here; `--forge gh|glab` settles it
where both do. `--no-forge` where neither is authed.

It answers both halves and keeps them apart, because they fail apart: the git state every
worktree is in, and what proof every branch has that its work landed.

Four answers it gives that a caller reading git alone gets wrong:

- **`"usable": false`** — the base could not be read, so every branch's merge question is
  UNKNOWN. That is not "nothing is merged": nothing is deleted, everything surfaces. Drop
  both flags where step 1 left `DEFAULT-UNRESOLVED` and the same thing happens.
- **`"answered": false` beside `"asked": true`** — the forge did not reply, and a squash
  merge is invisible without it. The sweep gets NARROWER, never wider, and each branch
  carries the reason.
- **`"read": false`** — it classified nothing at all. Its `reason` names the reading that
  could not be taken, and the empty lists beside it are not an empty repository.
- **`"nameSafe": false`** — git accepts `$ ( ) ; & | ' " < >` in a branch name, and this
  one carries something a quoted template would not hold. It changes no verdict; it says
  the name reaches a command through a variable, which step 7 does for every branch
  anyway.

## Step 5 — Classification

Every branch arrives classified: `verdict` is `keep`, `delete` or `surface`, `class` is
the risk the gate routes on, and `keeps` / `unproven` carry the words the report needs.
[`references/verdicts.md`](references/verdicts.md) owns what each means.

**A worktree takes two readings, and both have to be clear.** `worktree-owners.mjs` says
whose it is, `cleanup-scan.mjs` says what git state it is in — one answering clean tells
you nothing about the other. It is removable where the first says `mayRemove`, or says
`callerDecides` and **you remember cutting it**, and the second lists no blockers. Either
one's blockers are the row's reason.

## Step 6 — The gate

Four sections in this order, each a table, and never one table with a class column — the
class is routing, and the number names no consequence a user can weigh. Skip a section
that would be empty. Every item **the mode listed** appears in exactly one of them, a
kept one included: the gate is the whole plan, not the part that deletes.

1. **Proceeding without asking — nothing is lost** (class 1): item, what it is, action.
2. **Deleting — recoverable** (class 2): item, state, how to get it back. The restore
   command carries the tip as it stands now, so the row alone undoes the deletion. A
   branch whose `freedBy` names a worktree in this same section belongs **here**, not
   among the kept: removing that worktree is what makes it deletable, and the user is
   approving both at once.
3. **Needs an explicit yes — irreversible** (class 3): item, state, what disappears —
   the files, a branch's only copy, the submodule git dir that lives in that worktree
   alone.
4. **Kept — nothing is deleted**: item, what it is, why it stays, and **repair, if any**.
   A keep promises the item survives, not that nothing touches it, so a branch whose
   `repair` is set says so in its own row.

Then ask once, over sections 2 and 3 and every `repair` cell in section 4 — a tracking
repair is class 2 like the recoverable deletions. Section 1 is the only one that proceeds
unasked. Wait for an explicit answer; a subset means only that subset.

## Step 7 — Execute, in this order

```bash
git -C "$PROJECT" worktree remove "$WT"      # 1. --force ONLY on a confirmed class-3 item:
                                             #    a dirty worktree, or one the removal
                                             #    refuses over a submodule. Plain remove
                                             #    re-checks clean now; --force does not
rm -rf "$WT"                                 # 2. approved class-3 items only
git -C "$PROJECT" worktree prune --verbose   # 3. AFTER the rm, or the entry it just
                                             #    orphaned still blocks its branch
```

`$WT` is read out of the answer, never pasted in: a path can carry anything a filesystem
allows, and the same holds for the branch names below.

**Re-take the proof here, never read it off step 4.** Step 6 waits on a human, and both
what a branch carries and what the forge says about it move while it waits. Re-run step
1's call and step 4's — in that order, and **after the worktree removals above**, which
is what turns a branch whose only keep was `freedBy` into a `delete`. Then act on the
fresh answer alone, and name in the report which `proof` each deletion stood on.

Then, per branch it still calls `delete`, with `<n>` its index in that fresh answer:

```bash
BR="$(printf '%s' "$SCAN" | jq -r --argjson i <n> '.branches[$i].name')"
# The oid the GATE's row carried — the reading taken BEFORE the wait. Both values from
# the same reading makes the comparison say nothing: a branch that moved while the gate
# waited comes back with its new tip, matches itself, and is deleted as an object nobody
# approved, under a restore command that names a different one.
APPROVED="<the oid this branch's gate row carried>"
# And the ref as it stands THIS instant: the forge reads inside the rescan take time, and
# a branch can advance inside them. `--verify -q` for the empty answer and `|| true` for
# the exit status, so a vanished ref leaves a value to test.
NOW="$(git -C "$PROJECT" rev-parse --verify -q "refs/heads/$BR" || true)"
if [ "$NOW" = "$APPROVED" ]; then
  git -C "$PROJECT" branch -D -- "$BR"
else
  echo "moved or gone while the gate waited: $BR — surface it, and ask again over its tip"
fi
```

**`-d` is not a lighter `-D`, and neither command is the proof.** `-d` re-checks against
`PROJECT`'s HEAD, or the branch's own upstream where it has one — never against the base —
so it deletes what the verdicts keep and refuses what they proved. What `-D` carries is
what no plumbing deletion has: it refuses a branch checked out in another worktree,
resolves the branch ref rather than a symref's target, and drops `branch.<name>.*` with
it. So the deletion stays `-D`, and what authorizes it is the verdict.

To remove the worktree **you are standing in**, physically leave first
(`git worktree remove` inspects the real cwd):

```bash
cd "<PROJECT>"                                 # a separate Bash call — cwd must truly change
git -C "<PROJECT>" worktree remove "$WT"
```

Then tell the user cwd moved to `PROJECT` — their old path no longer exists.

**Last, repair the tracking**, one branch at a time and only on branches that survived.
Which branches, and which of the two, is the scan's `repair` field — a branch it left
`null` needs neither, and acting on a name instead is how every surviving branch loses
its upstream on the one run that could not answer.

```bash
git -C "$PROJECT" branch --set-upstream-to="$D" -- "$BR"   # repair: set-upstream
git -C "$PROJECT" branch --unset-upstream -- "$BR"         # repair: unset-upstream
```

The second is recoverable: the next `git push -u <remote> <branch>` restores it, and the
report says so.

## Step 8 — Verify and report

Re-run discovery. Report what went, what was kept and why, and — separately —
what was surfaced and left for the user to decide. List the class-1 actions taken
without asking.

## Never

| ❌ | ✅ |
|---|---|
| remove a worktree Claude Code created, however idle it looks | report it — the lease outlives the process and is unreadable from here |
| `git worktree unlock` something Claude Code locked | leave it; the periodic sweep releases stale locks itself |
| `git submodule deinit` to get past `worktree remove`'s refusal | `--force` — a linked worktree shares `.git/config`, so the deinit unregisters the submodule for the **primary** worktree too, and the removal refuses all the same |
| `rm -rf` a path outside this repository's worktree directories | resolve it from `worktree list` / the git dir, never from a name |
| push, or delete a **remote** branch | keep the forge CLI read-only — never merge/close/edit a PR/MR |
| `git reset`, stage, commit, or edit files | git plumbing and worktree removal only |
| hardcode `~/.claude` to reach the session registry | `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` — the registry is Claude Code's own state, and it moves with the configuration |

## Edge cases

- **Detached HEAD worktree** — classify by its worktree readings alone; no branch to
  delete.
- **A branch checked out in a worktree of a *different* repository** — leave both
  alone; this skill stays within `PROJECT`.
- **Submodules** — never operate on one. Removing a worktree that contains one is
  step 7's `--force`, not a submodule operation.

## Reference files

- [`../../references/forge-behaviour.md`](../../references/forge-behaviour.md) — read it before
  acting on any check, rollup or merge setting the forge reports.
- [`../../references/invariants.md`](../../references/invariants.md) — read once,
  before the first read of anything a tool, a forge or another session answers.
- [`references/verdicts.md`](references/verdicts.md) — read at step 5; the gate
  and step 7 route on the classes it assigns.
- [`../../references/base-resolution.md`](../../references/base-resolution.md) —
  read at step 1, and again at step 7's re-resolution.
- [`../../references/claude-worktrees.md`](../../references/claude-worktrees.md) —
  read at step 2.
