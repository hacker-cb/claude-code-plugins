# Resolving the base branch and its remote

Read by anything in this plugin that needs a base to diff against, a default
branch to reason about, or a remote to push to. It lives here, not in any one
skill, because prose copies drift: a fix lands in some and the rest go on saying
something else. Which skills read it is not listed here — the links pointing at
this file are that record, and the map for humans lives in
[`../README.md`](../README.md).

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

# Picking ONE remote outright is a different question: take a preferred name, else
# a lone remote whatever it is called. Never `remotes_ranked | head -1` here — with
# two remotes named `alice` and `bob` that silently takes whichever sorts first.
# Empty means "cannot tell", which is an answer; stop and ask.
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
   is still there, frozen at its last known commit, and it passes. The base is
   then merely older than the real one; the history is shared, so a review widens
   rather than breaks, and a prune fixes it. Deliberately not re-checked over the
   network, which would cost a round trip on every single run to catch that. A
   run scoped to a branch the repo no longer has is this case:
   `git remote set-head <remote> --auto`.

   Absent or dead, ask the remote — it is the only thing that knows:
   ```bash
   git ls-remote --symref <remote> HEAD \
     | sed -n 's|^ref:[[:space:]]*refs/heads/\([^[:space:]]*\)[[:space:]]*HEAD$|\1|p' | head -1
   # raw: "ref: refs/heads/<name>\tHEAD" plus a sha line
   ```
   Pair the bare name with the remote you asked. Never fall back to a list of
   popular names.

   **Parse it with `sed`, not `awk`.** The obvious `awk '$1=="ref:"'` cannot be
   written in a skill: Claude Code substitutes a positional reference in skill
   and agent content with a word from the invocation arguments, so awk's field
   references arrive replaced and the program silently compares the wrong things.
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

**A bare name where a ref belongs is loud.** A clone that only ever checked out
feature branches has no local default branch at all, and there both

```bash
git branch --merged <default>              # fatal: not a valid object name
git rev-list --count <default>..<branch>   # fatal: unknown revision
```

die outright, taking the whole step with them.

**A ref where a name belongs is quiet, and that is the direction that costs work.**
`git switch <remote>/<name>` does refuse — `fatal: a branch is expected, got remote
branch` — but `git checkout <remote>/<name>` exits 0 and detaches HEAD behind a
note that reads like routine output. A `git merge` run from there also exits 0,
writing the merge commit onto the detached HEAD while the branch it was meant to
land on never moves: the run reports work merged into a parent that is unchanged,
and the commit becomes unreachable as soon as anything else is checked out.
Comparisons go the same way: `[ "$cur" = "<remote>/<default>" ]` is false while
standing on the default branch — test `$cur` against the bare name.

The remote-tracking ref is not guaranteed present either: a clone that fetched
only feature branches has no `<remote>/<default>` until you fetch it. Materialise
it before any consumer runs, and **never compose a ref from an empty name** — an
unreachable remote returns nothing, and `<remote>/` is a bogus ref that makes
every consumer fatal. An unresolved default is "the question cannot be answered",
not "nothing matched": say so and treat what depended on it as unknown.

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
