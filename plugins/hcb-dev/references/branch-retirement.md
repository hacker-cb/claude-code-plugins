# Retiring a branch that has landed

Read by whatever *lands* work — a local merge into a parent, or a change request
the forge reports merged. It owns what follows that merge: freeing the worktree
holding the branch, deleting it — locally, and on the remote a change request
published it to — and what the report says about each. It sits outside either
backend because the step is the same whoever drove the merge.

It runs **as soon as the merge is confirmed**, never deferred to
`/hcb-dev:git-cleanup`: that skill is manual-only and sweeps a whole repository, so
a branch handed to it is a branch left standing indefinitely.

## Two commits, not one

**Where HEAD goes** is `<landing>` — the state the work landed on, current. Locally
that is the parent merged into. On a request the merge happened on the forge, so this
repository does not carry it yet: refresh `<remote>/<base>` through
[`base-resolution.md`](base-resolution.md), which owns that fetch and what each of its
outcomes means, and a base it leaves unverified stops the HEAD move and the local
deletion rather than seeding the next branch from a stale one. The refreshed ref carries
the merge plus whatever else landed while the request was open, so work continued from it
starts current instead of a rebase behind.

**What containment measures against** is `measuredAgainst`, and on a request it is not
`<landing>` — it is the head the request RECORDED, which after a squash is in no branch
at all. It is what the remote deletion leases, too. Locally the two are one commit, which
is how one word for both survived this long.

The remote the branch was **pushed** to is pruned in a call of its own, because in
a fork it is not the one carrying the base (`base-resolution.md`, *Pushing is a
different question*), so that a tracking ref of a branch the forge already deleted
does not outlive it:

```bash
git fetch --prune <push-remote>
```

## What the reading says, and who does the acting

`scripts/retire-check.mjs` answers one question — **is this branch safe to retire, and
on which side**. It reads and judges; it deletes nothing and moves no HEAD, deliberately:
a deletion folded into the reading runs before the reading is believed, and what it
reports is then not what it did.

```text
node "<plugin root>/scripts/retire-check.mjs" \
  --branch <name> (--tip <ref> | --pr <n>) [--push-remote <name>]
```

| field | what it settles |
|---|---|
| `read` | every reading answered. `false` retires nothing, on either side |
| `measuredAgainst` | what containment measures against and what the deletion leases — **never where HEAD goes**: after a squash the request's head is not in the base at all |
| `request` | request mode: the `state` every deletion rests on, the `headRefOid` the local proof measures against and the remote deletion leases, and the `headRepo` that head lives in |
| `deleteLocal` / `deleteRemote` | the two verdicts, named apart because `safe` on both sides was one word at two levels. Each is **something to delete, and nothing in the way** — every reason to refuse is a blocker, so no other field is a second gate |
| `local.blockers` / `remote.blockers` | why not, in words the report can carry |
| `local.callerDecides` | `deleteLocal: false` on the one refusal the caller may overrule, and **only that one**: `false` the moment anything else is in the way too |
| `remote.published` | `true` still there, `false` the merge already took it, **`null` an endpoint did not answer** |
| `remote.endpoints[].has` | per push URL, because a push reaches every configured endpoint |

**GitLab is read by hand**, the script speaking `gh` alone: take the state and the head
the same way, and the rest of this file holds unchanged.

```bash
glab mr view <n> --output json | jq -r '"\(.state) \(.sha)"'
```

Four readings it is built on, each of which a caller doing this by hand gets wrong, and
each a row in [`forge-behaviour.md`](forge-behaviour.md):

- **`git branch -d` is not the proof** — with an upstream set it tests containment
  against that upstream, so a branch pushed earlier passes whether the merge landed or
  not. Delete with `-D`, once `deleteLocal` says so.
- **A squash leaves no ref-level proof at all**, so `local.contained` is false however
  completely the work landed — which is what `local.callerDecides` is for.
- **A branch name is not unique across forks**, so a second request on this ref is told
  from a contributor's same-named one by identity, never by the name.
- **A silent endpoint prints what a deleted branch prints.** `published: null` is
  neither: leave the branch standing and report that endpoint as unknown.

## Free the branch, then delete it

**An uncommitted change stops both halves of this section** — do not switch, do not
delete, and say the local branch is still there. `local.dirty` is that answer, and it
gates the HEAD move as much as the deletion: switching with work in the tree carries it
onto another commit. What is published is a separate question and answered above either
way.

Git refuses to delete a branch that is checked out, so HEAD moves off it first — and
only where **this** worktree holds it, which `local.heldBy` answers. **HEAD moves onto
`<landing>`, never onto `measuredAgainst`** — on a request those are two commits, and the
second is not in the base at all after a squash. First hit wins:

1. **The parent is available here** — it exists locally, no other worktree holds it, and
   it fast-forwards to `<landing>`. `git switch <parent>` unless HEAD already stands on
   it; then `git merge --ff-only <landing>` where it trails. Anything else about it — no
   local branch of that name, a name that resolves ambiguously, commits of its own
   `<landing>` does not carry — falls to 2 rather than stopping the retirement.
2. **Otherwise** — `git switch --detach <landing>`. Detached is the ordinary state
   between tasks.

Then, and only on the matching verdict — or on `local.callerDecides`, the one refusal a
caller may overrule and **only in local mode**: git cannot tell a squash from work that
never landed, while the caller has just confirmed the merge and knows its strategy.
Request mode has no such judgement, containment being measured there against the head the
request recorded, which a squash does not move.

```bash
git branch -D <branch>                       # deleteLocal
# The full refname on both halves, never the bare one: it is ambiguous where a tag
# shares the name, and reaches that tag where the branch is already gone. The lease is
# the recorded head — the branch can have moved since, and the remote refuses where the
# two disagree.
git push --force-with-lease="refs/heads/<branch>:<head>" <push-remote> \
  --delete "refs/heads/<branch>"             # deleteRemote, leased on request.headRefOid
```

**A branch the user asked to keep stays**, whatever the verdict says.

A refused lease means the published ref is not what the request recorded — ahead of it,
or rewritten behind it, and the refusal does not say which. Keep the branch, read what
the remote actually carries, and report that rather than a guess. A deletion rule
refusing the push leaves it published, and the report is the end of that:
`/hcb-dev:git-cleanup` writes to no remote, so nothing sweeps it afterwards.

## The report

One line, always: which branch went, on each side it stood, and where HEAD stands now —
naming the commit wherever it is detached, so a later commit does not land unreachable.
Where a ref stayed, the reason is its side's `blockers`, already in words the report can
carry; a lease the remote refused is the one reason no blocker holds, because it happens
after the reading.

## Never

| ❌ | ✅ |
|---|---|
| leave a landed branch to `/hcb-dev:git-cleanup` | retire it here; the manual sweep is for what earlier work left behind |
| hand a refused remote deletion to that sweep instead | say it in the report — it writes to no remote, so nothing picks that branch up afterwards |
| ask the merge command to retire a ref for you | merge, confirm, then retire — a deletion folded into the merge runs before the confirmation, and what it reports is not what it did |
| retire the branch that was merged **into** | a parent, and the default branch, are never the branch being retired |
