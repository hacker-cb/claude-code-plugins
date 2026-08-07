# Retiring a branch that has landed

Read by whatever *lands* work — a local merge into a parent, or a change request
the forge reports merged. It owns what follows that merge: freeing the worktree
holding the branch, deleting the branch, and what the report says about both. It
sits outside either backend because the step is the same whoever drove the merge,
and prose copies drift.

It runs **as soon as the merge is confirmed**, never deferred to
`/hcb-dev:git-cleanup`: that skill is manual-only and sweeps a whole repository, so
a branch handed to it is a branch left standing indefinitely.

## The tip

Everything below measures against one commit — the state the merge produced.

**Local** — the parent that was merged into already is that state.

**Request** — the merge happened on the forge, so this repository does not carry
the commit yet. Refresh `<remote>/<base>` through
[`base-resolution.md`](base-resolution.md), which owns that fetch and what each of
its outcomes means; a base it leaves unverified stops this step rather than
seeding the next branch from a stale tip. The refreshed ref is the tip, carrying
the merge plus whatever else landed while the request was open, so work continued
from it starts current instead of a rebase behind.

The tracking ref of the branch the forge deleted at merge goes in a call of its
own, against the remote the branch was **pushed** to — in a fork, not the one
carrying the base (`base-resolution.md`, *Pushing is a different question*):

```bash
git fetch --prune <push-remote>
```

## Free the branch

Git refuses to delete a branch that is checked out, so HEAD moves off it first —
and only where **this** worktree is the one holding it. Another worktree's branch
is not yours to move ([`claude-worktrees.md`](claude-worktrees.md)): report it and
leave it standing. An uncommitted change stops both halves — do not switch, do not
delete, and say the branch is still there.

First hit wins:

1. **The parent is available here** — it exists locally, no *other* worktree holds
   it, and it fast-forwards to the tip. `git switch <parent>` unless HEAD already
   stands on it, which is where a synchronous merge command leaves this worktree;
   then `git merge --ff-only <tip>` where it trails. Anything else about it — no
   local branch of that name, a name that resolves ambiguously, commits of its own
   the tip does not carry — falls to 2 rather than stopping the retirement.
2. **Otherwise** — `git switch --detach <tip>`. Detached is the ordinary state
   between tasks, and the next task leaves it the way every task starts: a fresh
   branch cut from that tip, by whoever cuts branches in that flow.

## Delete it

A ref that is already gone — the merge command took the local one along with the
remote — leaves only the HEAD question above and the line in the report. A branch
under a change request that is still open stays too: that request's head is this
ref, and what a reviewer asks for next has nowhere to land without it.

**`git branch -d` is not the proof.** With an upstream set, git tests containment
against that upstream instead of HEAD, so a branch pushed at some earlier point
passes the check whether or not the merge landed. Produce the proof below, then
delete with `-D`.

**Local** — the branch is contained in the tip:

```bash
git merge-base --is-ancestor refs/heads/<branch> <tip>   # exit 0: the tip holds it
```

Where the strategy collapsed the branch's commits, no ref-level check can show
them: the confirmed merge this step follows is what landed them, and that is the
proof.

**Request** — the forge holds it: the request is merged, and the head it recorded
contains the local tip.

```bash
# GitHub
gh pr view <n> --json state,headRefOid --jq '"\(.state) \(.headRefOid)"'
# GitLab
glab mr view <n> --output json | jq -r '"\(.state) \(.sha)"'
```

A head that advanced on the forge alone — a base update taken there, a review
suggestion committed through the web UI — is not an object this repository carries,
and the check below reads it as unknown rather than as unmerged. Fetch it by its id
first, from the remote the branch was pushed to:

```bash
git fetch <push-remote> <head>
```

Merged, with `git merge-base --is-ancestor refs/heads/<branch> <head>` true, means
every local commit reached the request: `git branch -D <branch>`. Equality is one
way that holds, and a head built *on* the local tip is another. A tip carrying
commits that head does not is work which never got there: keep the branch and say
what sits on it.

Either proof is a **precondition**, not a formality: without one, the branch
stays.

The branch on the remote is a separate question: the change-request driver asks for
its deletion at merge, and local mode writes to no remote at all.

## The report

One line, always: which branch went, and where HEAD stands now — naming the commit
wherever it is detached, so a later commit does not land unreachable. Where the
branch stayed, name the reason: another worktree holds it, the tree is dirty, a
change request on it is still open, or its tip carries commits the merge never
took.

## Never

| ❌ | ✅ |
|---|---|
| leave a landed branch to `/hcb-dev:git-cleanup` | retire it here; the manual sweep is for what earlier work left behind |
| let a deletion command decide whether the work landed | prove containment first — against the tip locally, against the recorded head on a request; no proof, no deletion |
| move the HEAD of a worktree you do not hold | report it; that worktree belongs to another session |
| retire the branch that was merged **into** | a parent, and the default branch, are never the branch being retired |
