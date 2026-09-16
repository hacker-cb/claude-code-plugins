# Retiring a branch that has landed

Read by whatever *lands* work — a local merge into a parent, or a change request
the forge reports merged. It owns what follows that merge: freeing the worktree
holding the branch, deleting it — locally, and on the remote a change request
published it to — and what the report says about each. It sits outside either
backend because the step is the same whoever drove the merge, and prose copies
drift.

It runs **as soon as the merge is confirmed**, never deferred to
`/hcb-dev:git-cleanup`: that skill is manual-only and sweeps a whole repository, so
a branch handed to it is a branch left standing indefinitely.

## The tip

Everything below measures against one commit — the state the merge produced.

**Local** — the parent that was merged into already is that state.

**Request** — the merge happened on the forge, so this repository does not carry
the commit yet. Refresh `<remote>/<base>` through
[`base-resolution.md`](base-resolution.md), which owns that fetch and what each of
its outcomes means; a base it leaves unverified stops what measures against the
tip — the HEAD move and the local deletion — rather than seeding the next branch
from a stale tip. The published ref measures against nothing here and retires
anyway (*On the remote*). The refreshed ref is the tip, carrying the merge plus
whatever else landed while the request was open, so work continued from it starts
current instead of a rebase behind.

The remote the branch was **pushed** to is pruned in a call of its own, because in
a fork it is not the one carrying the base (`base-resolution.md`, *Pushing is a
different question*), so that a tracking ref of a branch the forge already deleted
does not outlive it:

```bash
git fetch --prune <push-remote>
```

## What the reading says, and who does the acting

`scripts/retire-check.mjs` answers one question — **is this branch safe to retire, and
on which side** — and the calling **skill** invokes it (skill content is where the
plugin root is substituted; here the placeholder would stay literal text). It reads and
judges; it deletes nothing and moves no HEAD, deliberately: a deletion folded into the
reading runs before the reading is believed, and what it reports is then not what it
did.

```text
node <plugin root>/scripts/retire-check.mjs \
  --branch <name> (--tip <ref> | --pr <n>) [--push-remote <name>]
```

**Every skill that performs a retirement writes that command itself**, with the plugin
root substituted — which happens in skill content and not here, where the placeholder
would stay literal text. Three do: `github-pr-workflow` Step 6, `hcb-dev:wave-worker`
on a landing it finds already taken, and whatever drives a local completion
([`slice-completion.md`](slice-completion.md)). A skill that only *mentions* the
retirement, rather than running it, links this file and stops there.

| field | what it settles |
|---|---|
| `read` | every reading answered. `false` retires nothing, on either side |
| `measuredAgainst` | what containment measures against and what the deletion leases — **never where HEAD goes**: after a squash the request's head is not in the base at all |
| `request` | request mode: the `state` every deletion rests on, and the `headRefOid` the local proof measures against and the remote deletion leases |
| `deleteLocal` / `deleteRemote` | the two verdicts, named apart because `safe` on both sides was one word at two levels |
| `local.blockers` / `remote.blockers` | why not, in words the report can carry |
| `remote.published` | `true` still there, `false` the merge already took it, **`null` an endpoint did not answer** |
| `remote.endpoints[].has` | per push URL, because a push reaches every configured endpoint |


**The two sides are answered separately because they fail separately.** A dirty tree,
or a local tip carrying commits that never reached the request, says nothing about the
published ref — and the published ref is the one nothing else can clear afterwards.

**The published side is request mode's alone.** A local merge publishes nothing, so a
ref an earlier push left on the remote is not this step's to remove — and there is no
recorded head to lease the deletion against, which is the only thing that stops it
removing a ref that moved since.

**GitLab is read by hand**, the script speaking `gh` alone: take the state and the head
the same way, and the rest of this file holds unchanged.

```bash
glab mr view <n> --output json | jq -r '"\(.state) \(.sha)"'
```

Three readings the answer is built on, each of which a caller doing this by hand gets
wrong:

- **`git branch -d` is not the proof.** With an upstream set, git tests containment
  against that upstream rather than against the tip, so a branch pushed at some earlier
  point passes whether or not the merge landed — measured, with git saying so out loud:
  `deleting branch 'feature' that has been merged to 'refs/remotes/origin/feature', but
  not yet merged to HEAD` ([`forge-behaviour.md`](forge-behaviour.md)). Delete with `-D`
  once `local.safe` says so.
- **A squash leaves no ref-level proof at all.** `merge-base --is-ancestor` answers no
  however completely the work landed, so `local.contained` is false and the confirmed
  merge this step follows is what landed it. The report says which of the two it was.
- **A silent endpoint prints what a deleted branch prints.** `published: null` is
  neither: leave the branch standing and report that endpoint as unknown.

A head that advanced on the forge alone — a base update taken there, a suggestion
committed in the web UI — is not an object this repository carries, so the script
fetches it by its id before measuring, and says `containment is unknown` rather than
`unmerged` where it could not.

## Free the branch, then delete it

**An uncommitted change stops both halves of this section** — do not switch, do not
delete, and say the local branch is still there. `local.dirty` is that answer, and it
gates the HEAD move as much as the deletion: switching with work in the tree carries it
onto another commit. What is published is a separate question and answered above either
way.

Git refuses to delete a branch that is checked out, so HEAD moves off it first — and
only where **this** worktree holds it, which `local.heldBy` answers. **HEAD moves onto
the refreshed base**, never onto `measuredAgainst`: `<remote>/<base>` brought current
through [`base-resolution.md`](base-resolution.md) carries the merge plus whatever else
landed while the request was open, so work continued from it starts current instead of a
rebase behind — and a base that reference leaves unverified stops the HEAD move and the
local deletion rather than seeding the next branch from a stale tip. First hit wins:

1. **The parent is available here** — it exists locally, no other worktree holds it, and
   it fast-forwards to the tip. `git switch <parent>` unless HEAD already stands on it;
   then `git merge --ff-only <tip>` where it trails. Anything else about it — no local
   branch of that name, a name that resolves ambiguously, commits of its own the tip
   does not carry — falls to 2 rather than stopping the retirement.
2. **Otherwise** — `git switch --detach <tip>`. Detached is the ordinary state between
   tasks.

Then, and only on the matching verdict. `noRefProof` is the one judgement left with the
caller, and **only in local mode**: git cannot tell a squash from work that never
landed, while the caller has just confirmed the merge and knows its strategy. In request
mode there is no such judgement — containment is measured against the head the request
recorded, which a squash does not move, so `contained: false` there is commits that
never reached the request.

```bash
git branch -D <branch>                       # local.safe
# The full refname on both halves, never the bare one: it is ambiguous where a tag
# shares the name, and reaches that tag where the branch is already gone. The lease is
# the recorded head — the branch can have moved since, and the remote refuses where the
# two disagree.
git push --force-with-lease="refs/heads/<branch>:<head>" <push-remote> \
  --delete "refs/heads/<branch>"             # remote.safe
```

**A branch under a change request that is still open stays** — that request's head is
this ref, and what a reviewer asks for next has nowhere to land without it. So does one
the user asked to keep.

A refused lease means the published ref is not what the request recorded — ahead of it,
or rewritten behind it, and the refusal does not say which. Keep the branch, read what
the remote actually carries, and report that rather than a guess. A deletion rule
refusing the push leaves it published, and the report is the end of that:
`/hcb-dev:git-cleanup` writes to no remote, so nothing sweeps it afterwards.

## The report

One line, always: which branch went, on each side it stood, and where HEAD
stands now — naming the commit wherever it is detached, so a later commit
does not land unreachable. Where a ref stayed, name the reason: another worktree
holds it, the tree is dirty, a change request on it is still open, its tip carries
commits the merge never took, the remote ref is no longer the head the request
recorded, the remote did not answer, or a deletion rule refused the push.

## Never

| ❌ | ✅ |
|---|---|
| leave a landed branch to `/hcb-dev:git-cleanup` | retire it here; the manual sweep is for what earlier work left behind |
| hand a refused remote deletion to that sweep instead | say it in the report — it writes to no remote, so nothing picks that branch up afterwards |
| ask the merge command to retire a ref for you | merge, confirm, then retire — a deletion folded into the merge runs before the confirmation, and what it reports is not what it did |
| let a deletion command decide whether the work landed | prove containment first — against the tip locally, against the recorded head on a request; no proof, no deletion |
| move the HEAD of a worktree you do not hold | report it; that worktree belongs to another session |
| retire the branch that was merged **into** | a parent, and the default branch, are never the branch being retired |
