---
name: git-cleanup
description: >-
  Manual-only. Sweep the git residue work leaves in this repository — merged and orphaned branches, stale or abandoned worktrees, dead upstream tracking. Two modes, given as the argument: (S) `session` — only the branches and worktrees this session created, run before closing it; (A) `all` — everything the repository has accumulated, other sessions' leftovers included. Deletes branches; a worktree Claude Code created for another session it reports rather than removes, because the host leases those to sessions that outlive their processes. Never edits files, never runs `git reset`, and never writes to a remote — it reads merged and open change requests through the forge CLI, but pushes, deletes and edits nothing there.
disable-model-invocation: true
argument-hint: "[session|all]"
---

# Git cleanup

Branches and worktrees only. Untracked junk in the working tree is not this skill's business —
`.gitignore` is, and `seeding-gitignore` owns that.

## Step 1 — Ground truth

```bash
git worktree list --porcelain | head -1        # 'worktree <path>' — the PRIMARY worktree
```

`PROJECT` is that primary worktree path, **not** cwd: running from inside a worktree still
means cleaning the repository as a whole.

**The default branch and its remote** are what this sweep measures everything against — a
narrower question than "what should this change be diffed against", since the base of whatever
request happens to be open is not the default, and deleting by it deletes branches merged
somewhere else. [`../../references/base-resolution.md`](../../references/base-resolution.md)
owns the wider question; this one has a script:

```bash
DB="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/default-branch.mjs")"
# BOTH flags, each a different failure: `.confirmed` false may be a stale local pointer,
# `.resolved` false a name whose ref was never brought. A ref to READ and a name to COMPARE are
# two values — deriving one by trimming the other yields `remotes/origin/master`, matching nothing.
D="$(printf '%s' "$DB" | jq -r 'if .resolved and .confirmed then .ref  else "" end')"
DEF="$(printf '%s' "$DB" | jq -r 'if .resolved and .confirmed then .name else "" end')"
[ -n "$D" ] || echo "DEFAULT-UNRESOLVED: $(printf '%s' "$DB" | jq -r '.reason // (.notes | join("; "))')"
```

Empty `$D` is **DEFAULT-UNRESOLVED**, which step 4 carries through as `"usable": false`. With
no remote at all, ask the user — nothing local names the default.

## Step 2 — Who is still working here

A worktree with a live session in it must not be removed, and git alone cannot tell you.
One script reads every worktree of the repository at once:

```bash
# `--repo-dir` names WHICH repository to sweep; where this run stands comes from the directory
# the command runs in, and they are two questions. `$PROJECT` for both would make the main
# worktree the one you stand in — the one `worktree remove` refuses.
node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-owners.mjs" --repo-dir "$PROJECT"
```

Carry its `owner` and `blockers` into step 5, and read them **in one direction only**: a live
session proves a worktree is in use, and its absence proves nothing —
[`../../references/claude-worktrees.md`](../../references/claude-worktrees.md) owns why, and
`unsettled` is the one question it leaves you. Two of its answers are not "nobody is working":
`"probeFailed": true` is a registry that would not read, and every worktree goes unknown then,
the one you stand in included; `"read": false` answers nothing about any worktree at all, its
`reason` naming the reading that failed and the empty lists beside it not being "none of them
are yours". Say so, and go on to the branches, which stand on their own.

## Step 3 — The mode

The argument picks it. With no argument, ask — do not guess.

| | **S — `session`** | **A — `all`** |
|---|---|---|
| Question | "what did *this* session create?" | "what has this repository accumulated?" |
| Scope | branches and worktrees created after this session started | every branch and worktree, any age |
| Typical use | before closing a session | periodic audit |

**Mode S is what you remember creating in this conversation** — the source, not a corroborating
one: you were there for every branch cut and every worktree added, and a timestamp probe cannot
overrule it. Where memory is genuinely unsure about one item, list it. Mode decides *what is
listed*, never how freely anything is deleted — the risk class does that, and step 6 puts the
whole list in front of the user before a single deletion.

## Step 4 — Discovery (read-only, one call)

```bash
SCAN="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/cleanup-scan.mjs" \
  --repo-dir "$PROJECT" --default "$DEF" --default-ref "$D")"
printf '%s\n' "$SCAN"
```

It speaks both forge CLIs and picks whichever answers here; `--forge gh|glab` settles it where
both do, `--no-forge` where neither is authed. It answers both halves and keeps them apart,
because they fail apart: the git state every worktree is in, and what proof every branch has
that its work landed. Four answers a caller reading git alone gets wrong:

- **`"usable": false`** — the base could not be read, so every branch's merge question is
  UNKNOWN. That is not "nothing is merged": nothing is deleted, everything surfaces. Dropping
  both flags where step 1 left `DEFAULT-UNRESOLVED` does the same.
- **`"answered": false` beside `"asked": true`** — the forge did not reply, and a squash merge
  is invisible without it. The sweep gets NARROWER, never wider, and each branch carries why.
- **`"read": false`** — it classified nothing at all; its `reason` names the reading that could
  not be taken, and the empty lists beside it are not an empty repository.
- **`"nameSafe": false`** — the name carries something a quoted template would not hold. It
  changes no verdict; it says the name reaches a command through a variable, which step 7 does
  for every branch anyway.

## Step 5 — Classification

Every branch arrives classified: `verdict` is `keep`, `delete` or `surface`, `class` is
the risk the gate routes on, and `keeps` / `unproven` carry the words the report needs.
[`references/verdicts.md`](references/verdicts.md) owns what each means.

**A worktree takes two readings, and both have to be clear** — `worktree-owners.mjs` for whose
it is, `cleanup-scan.mjs` for what git state it is in, one answering clean telling you nothing
about the other. It is removable where the first says `mayRemove`, or says `callerDecides` and
**you remember cutting it**, and the second lists no blockers; either one's blockers are the
row's reason.

## Step 6 — The gate

Four sections in this order, each a table, never one table with a class column — the class is
routing, and the number names no consequence a user can weigh. Skip a section that would be
empty. Every item **the mode listed** appears in exactly one of them, a kept one included: the
gate is the whole plan, not the part that deletes.

1. **Proceeding without asking — nothing is lost** (class 1): item, what it is, action.
2. **Deleting — recoverable** (class 2): item, state, how to get it back. The restore command
   carries the tip as it stands now, so the row alone undoes the deletion. A branch whose
   `freedBy` names a worktree in this same section belongs **here**, not among the kept:
   removing that worktree is what makes it deletable, and the user approves both at once.
3. **Needs an explicit yes — irreversible** (class 3): item, state, what disappears — the files,
   a branch's only copy, the submodule git dir living in that worktree alone.
4. **Kept — nothing is deleted**: item, what it is, why it stays, and **repair, if any**. A keep
   promises the item survives, not that nothing touches it.

Then ask once, over sections 2 and 3 and every `repair` cell in section 4 — a tracking repair is
class 2 like the recoverable deletions. Section 1 is the only one that proceeds unasked. Wait
for an explicit answer; a subset means only that subset.

## Step 7 — Execute, in this order

Only over what the gate actually approved, and only after it did:
[`references/execution.md`](references/execution.md) owns the order the removals go in, the
proof re-taken after the wait, and the tracking repair that comes last.

## Step 8 — Verify and report

Re-run discovery. Report what went, what was kept and why, and — separately — what was surfaced
and left for the user to decide. List the class-1 actions taken without asking.

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

- **Detached HEAD worktree** — classify by its worktree readings alone; no branch to delete.
- **A branch checked out in a worktree of a *different* repository** — leave both alone; this
  skill stays within `PROJECT`.
- **Submodules** — never operate on one. Removing a worktree that contains one is step 7's
  `--force`, not a submodule operation.

## Reference files

| file | read it |
|---|---|
| [`../../references/invariants.md`](../../references/invariants.md) | once, before the first read of anything a tool, a forge or another session answers |
| [`../../references/base-resolution.md`](../../references/base-resolution.md) | at step 1, and again at step 7's re-resolution |
| [`../../references/claude-worktrees.md`](../../references/claude-worktrees.md) | at step 2 |
| [`references/verdicts.md`](references/verdicts.md) | at step 5; the gate and step 7 route on the classes it assigns |
| [`references/execution.md`](references/execution.md) | at step 7, once the gate has its answer |
| [`../../references/forge-behaviour.md`](../../references/forge-behaviour.md) | before acting on any check, rollup or merge setting the forge reports |
