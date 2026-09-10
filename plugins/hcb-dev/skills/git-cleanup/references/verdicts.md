# Verdicts — worktrees, branches, and the risk class of each

Read by `hcb-dev:git-cleanup` at its step 5. It owns the two classification
tables and the risk classes the gate routes on; the discovery that feeds them
(step 4) and the re-proof that authorizes a deletion (step 7) stay in the skill,
and every step number below is the skill's.

**Worktrees** — occupancy first, git state second.

| Signal | Verdict |
|---|---|
| primary worktree | never touch |
| the current session's own worktree | removable — its lease-holder is the one asking — but never from inside it: see step 7 |
| path is a live session's `cwd` | keep — someone is working there |
| **another** worktree the host made — a `claude/…` branch, or a directory in the host's own worktree dir — **that is still on disk** | **surface, never remove** — its lease survives the process and is unreadable from here ([`../../../references/claude-worktrees.md`](../../../references/claude-worktrees.md)). A registration whose directory is already gone is not this case: nothing is left to destroy, so it falls to the `prunable` rows below |
| `locked` | keep — Claude Code locks a worktree while its agent runs |
| `prunable`, and its path's parent directory exists | `worktree prune` (class 1) |
| `prunable` because the whole path is unreachable | surface (class 3) — an unmounted volume looks identical to a deleted worktree, and pruning strands the work it still holds |
| clean, its branch merged, and **this session cut it** | `remove` (class 2) |
| a populated submodule, or a `modules` directory in its admin dir | surface (class 3) — the removal takes whatever history that git dir holds, and nothing here proves it empty |
| uncommitted or untracked changes | surface (class 3) — never `--force` unasked |
| on disk but absent from `worktree list` | a filesystem orphan: class 1 only if `git status` in it is empty, otherwise surface (class 3) — it is still someone's working tree |
| its branch has an open change request | keep |

**Branches**

| Signal | Verdict |
|---|---|
| the default branch, or checked out in a worktree you are keeping | never delete |
| checked out in a worktree being removed in this same run | delete after that worktree is gone — this is the common case, not an exception |
| in `branch --merged "$D"` | delete (class 2) |
| a merged request carries the branch tip, its merge commit is in `$D`, and no request on that tip is open | delete (class 2) — only the forge knows about a squash merge |
| a merged request carries the tip, and its merge commit is not in `$D` | surface (class 3) — it landed somewhere the base does not carry |
| no merged request carries the tip | surface (class 3) — the branch moved past every request, or the forge never had it |
| the merge commit is a commit this repository does not have, or `$D` is empty | surface (class 3) — unknown, which is not "not merged" |
| `[gone]` upstream **and** merged | delete (class 2) |
| `[gone]` upstream, **not** merged | surface (class 3) — may hold the only copy |
| the forge CLI says its PR/MR is `OPEN` | keep |
| no upstream, `$D` non-empty, and `rev-list --count "$D..refs/heads/<branch>"` = 0 | delete (class 2) — nothing to lose |
| no upstream, unique commits | surface (class 3) |

**Rows overlap.** An open request keeps the branch whatever else matched. A
surface row beats a delete row **within the same proof** — the forge's unknown row
stops the forge's own delete, and says nothing about a branch git itself proved
merged, which `branch --merged` settles without the forge answering at all. A
branch reaching a delete row by no row of its own — the worktree row above is the
case — is deleted only by what step 7 will still prove.

**Risk classes** decide the gate, whatever the mode:

| Class | Meaning | Gate |
|---|---|---|
| 1 | no data loss — `worktree prune` of a reachable `prunable` entry | act, then report |
| 2 | recoverable — a merged branch, a clean worktree, an upstream repair | inside the confirmed plan |
| 3 | irreversible — unmerged branch, dirty worktree, **any working-tree file** | explicit confirmation, always |

Anything that deletes a file someone could still want is class 3, whichever
table routed it there. An `rm -rf` is never class 1.
