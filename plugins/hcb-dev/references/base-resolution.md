# Resolving the base branch and its remote

Read by anything in this plugin that needs a base to diff against, a default
branch to reason about, or a remote to push to. It lives here, not in any one
skill, because prose copies drift: a fix lands in some and the rest go on saying
something else.

The one rule everything below serves: **never guess a name.** `master`, `main`,
`dev`, `develop`, `trunk` — every repo picks its own, and `origin` is the same
kind of guess. A guess that *resolves* is not a guess that is *right*: it
resolves to the wrong base, or the wrong repository, and the run reports a
plausible-looking scope line while covering something else entirely.

## Pick the remote before the branch

`origin` is as hardcoded as `main` is. A repo may have a single remote under
another name, and in a fork checkout `origin` is your own copy while `upstream`
carries the real base. Rank the remotes that actually exist:

```bash
# upstream and origin first, then every other remote; existing only, deduped.
# Use this to *probe* remotes — try each until one carries the ref you want.
remotes_ranked() {
  for r in upstream origin; do git remote | grep -qx -- "$r" && echo "$r"; done
  git remote | grep -vxE 'upstream|origin'
}

# Picking ONE remote outright is a different question: a preferred name, else a lone
# remote whatever it is called. Never `remotes_ranked | head -1` here — with remotes
# `alice` and `bob` it silently takes whichever sorts first. Empty means stop and ask.
REMOTE="$(for r in upstream origin; do git remote | grep -qx -- "$r" && { echo "$r"; break; }; done)"
[ -n "$REMOTE" ] || { [ "$(git remote | grep -c .)" = 1 ] && REMOTE="$(git remote)"; }
```

`grep -qx` and `grep -vxE` match whole lines, so a remote named `origin2` or
`my-upstream` is neither mistaken for the real thing nor dropped from the tail.

Where several remotes exist and none is preferred, **stop and ask** rather than
taking the first alphabetically. For a read that costs a wrong review; for a push
it can publish a branch in someone else's repository.

## Pushing is a different question

The remote you *read* a base from is not the one you *write* a branch to: in a
fork the base is in `upstream`, which you cannot push to. For a push, use git's
own routing — `branch.<name>.pushRemote`, then `remote.pushDefault`, then
`origin`, then a lone remote whatever its name — and never `@{upstream}`, which in
a fork points at the canonical repo. Ambiguity stops here too, and for the higher
stake of the two.

## The ladder — first hit wins

1. **A base the caller named.** An explicit base always wins.

2. **The base of the open change request.** Both CLIs answer with a *bare branch
   name*, so pair it with whichever remote actually carries that branch — take
   the first ref that exists, in `remotes_ranked` order:
   ```bash
   # GitHub
   gh pr view --json baseRefName -q .baseRefName
   # GitLab
   glab mr view --output json | jq -r .target_branch
   ```

3. **Where this repo's changes actually land.** A review usually runs *before*
   the change request exists, so rung 2 comes back empty — and the default branch
   is the wrong guess in any repo whose changes target `dev`, `develop`,
   `release/*`. Look, don't assume:
   ```bash
   # GitHub
   gh pr list --state merged --limit 10 --json baseRefName -q '.[].baseRefName' | sort | uniq -c
   # GitLab
   glab mr list --merged --output json | jq -r '.[].target_branch' | sort | uniq -c
   ```
   If one non-default base dominates, use it and name it in the report. The
   winner is a bare branch name too — normalize it exactly as rung 2 does.

4. **The repo default branch**, in two steps that answer different questions.

   `git symbolic-ref --short refs/remotes/<remote>/HEAD` hands back a ready
   `<remote>/<name>`, but it only *reads* the pointer without dereferencing it:
   after the forge renames its default branch this keeps printing the old name
   with status 0 forever. Verify the ref it names still exists before trusting
   it.

   That check catches a pointer at a **deleted** ref, not one at a
   **stale-but-present** one — before a `fetch --prune` the old `<remote>/<name>`
   is still there and passes. The base is then merely older than the real one, so
   a review widens rather than breaks. A run scoped to a branch the repo no longer
   has is this case: `git remote set-head <remote> --auto`.

   Absent or dead, ask the remote — it is the only thing that knows:
   ```bash
   git ls-remote --symref <remote> HEAD \
     | sed -n 's|^ref:[[:space:]]*refs/heads/\([^[:space:]]*\)[[:space:]]*HEAD$|\1|p' | head -1
   # raw: "ref: refs/heads/<name>\tHEAD" plus a sha line
   ```
   Pair the bare name with the remote you asked. Never fall back to a list of
   popular names.

   **Parse it with `sed`, not `awk`** — awk's field references are rewritten where
   a skill is substituted, so the program silently compares the wrong things.
   `head -1` rather than a bare `q`, which would quit on the first *input* line
   whether or not it matched — the symref line is not guaranteed to be first.

5. **`@{upstream}`** — last resort. When the branch tracks its own remote
   counterpart this narrows the range to unpushed commits only.

## What every rung owes the caller: a ref, and the name beside it

A resolved default gets used two ways, and they want opposite forms:

| the consumer wants | form | examples |
|---|---|---|
| a **ref** to read | `<remote>/<default>` | `diff`, `merge-base`, `rev-list`, `branch --merged`, `--set-upstream-to` |
| a **name** to become, merge into, or compare | bare `<default>` | `git switch`, `git merge`'s destination, `[ "$cur" = "$default" ]` |

Hand on **both** — the ref, and `${ref#*/}` beside it — because each direction of
the mistake fails differently and only one of them tells you.

**A bare name where a ref belongs is loud** — in a clone that never checked out the
default, `git branch --merged <default>` and `git rev-list <default>..<branch>` die
outright, taking the whole step with them.

**A ref where a name belongs is quiet, and that is the direction that costs work.**
`git checkout <remote>/<name>` exits 0 and detaches HEAD, and a `git merge` from
there exits 0 too — writing onto the detached HEAD while the branch it was meant to
land on never moves. Comparisons go the same way: `[ "$cur" = "<remote>/<default>" ]`
is false while standing on the default branch — test `$cur` against the bare name.

The remote-tracking ref is not guaranteed present either: a clone that fetched
only feature branches has no `<remote>/<default>` until you fetch it. Materialise
it before any consumer runs, and **never compose a ref from an empty name** — an
unreachable remote returns nothing, and `<remote>/` is a bogus ref that makes
every consumer fatal. An unresolved default is "the question cannot be answered",
not "nothing matched": say so and treat what depended on it as unknown.

## A resolved name is not a current ref

The ladder answers *which* base; it says nothing about *when*. `<remote>/<base>`
holds whatever the last fetch left there, so a branch cut from it, a range diffed
against it and a merge landing on it can all be built on a base the remote moved
past days ago. Refresh it before any consumer reads it:

```bash
# The explicit refspec, not a bare `<base>`: where the remote's configured refspec
# does not cover it, the bare form updates FETCH_HEAD alone and never writes
# `<remote>/<base>`, which is what every consumer reads.
git fetch <remote> "+refs/heads/<base>:refs/remotes/<remote>/<base>"
```

Three outcomes, and only one of them means current:

- **The fetch succeeded.** The ref is the remote's tip — whether or not it moved;
  "already up to date" is this outcome, not a separate one.
- **The remote did not answer.** That is "the age is unknown", not "no new
  commits": the local ref stays standing and every consumer reads it without
  complaint, so a run treating this as success reports a branch current with a base
  nothing checked. Say the base is unverified and treat what depended on its
  freshness as unknown.
- **`couldn't find remote ref`.** Where the base was resolved *from* that remote,
  the branch has been renamed or deleted since: re-resolve it by the ladder — rung
  4's `git remote set-head <remote> --auto` is what retires the pointer, and a
  refspec-restricted fetch prunes nothing — rather than carrying one at a branch
  nobody has. Where the base never had a remote counterpart — a local-only parent,
  a repo with no remote — nothing is missing: it is as current as it can be, and
  saying so once is the whole step.

A consumer that only **reads** the base brings nothing over: it reads against
the ref, and a claim it makes about the tree names the revision it was read at.
The checkout it stands in is older than that ref — what the base moved past is
unread, not absent.

Then bring the local side to what arrived:

| the consumer | what refreshing means |
|---|---|
| cutting a new branch | cut from the **ref**, `<remote>/<base>` — unless the local branch is *ahead* of it, which is exactly what a local completion leaves behind (it merges and never pushes): that work is the parent, so cut from the branch and say the remote does not carry it |
| landing a merge on the base | `git merge --ff-only <remote>/<base>` **where the base itself is checked out** — from the branch you happen to stand on it fast-forwards *that* instead, quietly, and which worktree holds the base is [`slice-completion.md`](slice-completion.md)'s. A refusal means the base carries commits the remote does not — work to report, never something to reset away |
| a branch already cut | a rebase or a merge, and which one depends on what is built on its tip — the skill doing it owns that call |

## A base with no shared history is not a base

Confirm `git merge-base <base> HEAD` is non-empty before using it. Empty means a
shallow clone (`clone --depth 1`, `actions/checkout` at default depth) fetched
neither side's ancestry, or the ref is genuinely unrelated. Diffing against it is
worse than not diffing at all: it reports the base's own files as deletions the
branch never made, and a reviewer dutifully files findings about them. Refuse
such a base and say why.

Watch what that does to a coverage count: "unknown" is neither zero nor a number,
so it slips past both a zero-file check and a count gate.

## When nothing resolves, ask

With no remote there is nothing to derive a default branch *from*, and any local
guess is the same hardcoded name wearing a disguise. Say what is missing and ask,
naming the cost concretely — "no remote, so I can't tell what this branch was cut
from: give me a base, or this covers only the working tree and leaves 3 commits
unread."
