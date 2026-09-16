# Verdicts — what each one means, and the risk class of each

Read by `hcb-dev:git-cleanup` at its step 5. The classification itself is
`scripts/cleanup-scan.mjs`'s and arrives with the scan; this owns what each verdict
promises, where the two readings meet, and the risk classes the gate routes on. Every
step number below is the skill's.

## Branches

| `verdict` | what it promises | class |
|---|---|---|
| `keep` | it survives this run. **Not** that nothing touches it — a `repair` still runs | none |
| `delete` | its work is proven landed: `proof` says by which reading, `git` for containment in the base and `forge` for a merge commit the base carries — the only way a squash shows at all | 2 |
| `surface` | no proof, and `unproven` says which kind is missing. It stands, and the user decides | 3 |

**A keep outranks a proof**, whatever else matched: an open request on the tip, the
default branch, a branch checked out in a worktree. `keeps` names which.

**`repair` is what a surviving branch still needs.** `set-upstream` where the default
branch does not point at the base; `unset-upstream` where an upstream is `[gone]`, since a
ref that no longer exists is not an upstream and `git branch -d` silently measures
containment against it. Both are class 2 — the next `git push -u <remote> <branch>`
restores what the second drops, and the report says so.

## Worktrees

Two readings, and both have to be clear — one answering cleanly says nothing about the
other:

| reading | what it answers |
|---|---|
| `worktree-owners.mjs` | whose it is. `mayRemove` is yours with nothing in the way; `callerDecides` turns on the one thing no probe can know — **did you cut it**, which is your own memory of this conversation |
| `cleanup-scan.mjs` | the git state it is in: dirty, a submodule or a git directory for one, a `prunable` entry whose path does not answer. Any `blockers` entry keeps it |

A `prunable` entry whose path is simply gone has nothing left to destroy, and it takes
`worktree prune` (class 1) rather than a removal. One whose whole path is *unreachable*
does not: an unmounted volume looks identical to a deleted worktree, and pruning strands
the work it still holds — class 3.

A worktree found on disk but absent from `worktree list` is a filesystem orphan: class 1
where `git status` in it is empty, class 3 otherwise — it is still someone's working tree.

## Risk classes decide the gate, whatever the mode

| Class | Meaning | Gate |
|---|---|---|
| 1 | no data loss — `worktree prune` of a reachable `prunable` entry | act, then report |
| 2 | recoverable — a merged branch, a clean worktree, a tracking repair | inside the confirmed plan |
| 3 | irreversible — unmerged branch, dirty worktree, **any working-tree file** | explicit confirmation, always |

Anything that deletes a file someone could still want is class 3, whichever reading
routed it there. An `rm -rf` is never class 1.
