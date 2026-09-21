---
name: sync-base
description: >-
  Check whether this branch's base has moved and, where it has, bring the branch up to date with
  it — a fast-forward where the branch has nothing of its own, a rebase by default, a merge where
  its history may not be rewritten, `--autostash` over a dirty tree — then read what arrived
  against the work in flight and say what it moves. Use when the user asks to sync or refresh a
  branch against its base: "подтяни базу", "обнови ветку от базы", "синхронизируй с мастером",
  "мы не отстали?", "pull the latest base", "rebase onto the base". Writes this worktree only and
  never pushes: a branch a rebase leaves diverged from its published copy is reported, and a
  conflict needing a real decision stops the run. Not a step inside `hcb-dev:shipping-workflow`
  or `hcb-dev:github-pr-workflow`, which take the base themselves, nor the merge of the base into
  a set's feature branch between slices of `hcb-dev:implementation-workflow`. In a master session
  it moves the checkout and leaves reading what landed to `hcb-dev:wave-refresh`.
---

# Sync with the base

Whether the base this branch stands on has moved, and where it has, taking it and reading what it
brought. This skill writes to this worktree and nothing else — no push, no change request, no
reset. Read [`../../references/invariants.md`](../../references/invariants.md) first: the remote's
answer, the resolver's outcome and git's own exit are each read for what they say.
**Paths**, substituted at invocation — use verbatim: `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}`.

## Step 1 — Where you stand

```bash
G="$(git rev-parse --git-dir)"
git symbolic-ref --quiet --short HEAD          # prints nothing on a detached HEAD
ls -d "$G/rebase-merge" "$G/rebase-apply" "$G/MERGE_HEAD" "$G/CHERRY_PICK_HEAD" 2>/dev/null
git status --porcelain
```

- **Detached HEAD**, or **a path listed** — no branch to bring up to date, or a rebase, merge or
  cherry-pick already in progress that is the user's to finish: stop.
- **Uncommitted work** — step 5's `--autostash` carries it, and step 6 says whether it came back.

**Then this branch's own published copy**, before any base: commits someone else pushed to this
branch are this branch's own tip, not the base's. What it holds that this branch carries neither
as it is nor rewritten is listed last:

```bash
# Read here, never pasted in: a branch name may carry `$` or a backtick.
B="$(git symbolic-ref --quiet --short HEAD)"
PUSH="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-base.mjs" --no-network | jq -r '.remotes.push // ""')"
if [ -z "$PUSH" ]; then echo "no push remote"; else
  git ls-remote --exit-code --heads --end-of-options "$PUSH" "refs/heads/$B" >/dev/null
  RC=$?; echo "published: exit $RC"            # 0 yes · 2 no · anything else unknown
  if [ "$RC" -eq 0 ]; then
    git fetch --end-of-options "$PUSH" "+refs/heads/$B:refs/remotes/$PUSH/$B"
    git log --oneline --cherry-pick --right-only "HEAD...refs/remotes/$PUSH/$B"
  fi
fi
```

- **Nothing listed** — go on.
- **Commits listed, and HEAD an ancestor of them** — take them first: `git merge --ff-only
  --autostash "refs/remotes/$PUSH/$B"`, with `B` and `PUSH` read as above.
- **Commits listed otherwise** — diverged over work this branch lacks: stop, that is the user's.
- **An exit neither 0 nor 2** — the remote did not answer: the published copy is unread, which
  step 4 carries into the merge-or-rebase choice.

## Step 2 — Which base

[`../../references/base-resolution.md`](../../references/base-resolution.md) owns the ladder. Its
rung 1 comes first, in this order: a base named in the invocation; the base, or the pin, of an
order this session runs under; the `parent` a caller threaded in, or a plan-doc of
`hcb-dev:implementation-workflow` records; the base a wave ledger names. A branch something names
a base for is a work branch — go to step 3.

With none, ask the forge — the one whose `gh auth status` / `glab auth status` answers. Where
neither answers, rungs 2 and 3 are skipped and the report says so; where both do, ask which.

```bash
FORGE='<gh | glab | empty where neither answers>'
B="$(git symbolic-ref --quiet --short HEAD)"
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-base.mjs" ${FORGE:+--forge "$FORGE"} | jq '{requestBase, landings, reason}'
node "${CLAUDE_PLUGIN_ROOT}/scripts/default-branch.mjs" | jq '{resolved, confirmed, name, reason}'
if [ "$FORGE" = gh ]; then gh pr list --base "$B" --state open --json number --jq length
elif [ "$FORGE" = glab ]; then glab mr list --target-branch "$B" --output json | jq length; fi
```

**This branch is itself a base** where it is the default (`resolved`, `confirmed`, `name`), where
`landings` counts it, or where an open change request targets it. Step 1 brought it to its
published copy, which is the whole of a sync here — taking another branch into a base is a merge
somebody decides: stop, saying so.

Otherwise rungs 2 to 4 settle the base from those same answers. Rung 5, `@{upstream}`, names this
branch's own copy rather than a base: reaching it, stop and ask for one.

## Step 3 — Refresh it, and fix where the branch stands

One call refreshes the base and fixes the two points
[`../../references/base-delta.md`](../../references/base-delta.md) reads from — before anything is
taken, since a merge base read after the take answers the new tip:

```bash
# Single quotes, here and below: a name git allows may carry `$` or a backtick.
BASE='<the name step 2 settled>'
J="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-base.mjs" --base "$BASE")"
printf '%s' "$J" | jq '{base, notes, reason}'
REF="$(printf '%s' "$J" | jq -r 'if .base.current and .base.sharesHistory then .base.ref else "" end')"
if [ -n "$REF" ]; then
  M="$(git merge-base HEAD "$REF")"; H="$(git rev-parse HEAD)"; echo "M=$M H=$H"
  git rev-list --left-right --count "$REF...HEAD"        # behind <TAB> ahead
fi
```

| what came back | this step |
|---|---|
| `base.current` true — `refreshed`, or `local` | go on; `local` has no remote copy, which is said once |
| `silent`, with `base.remote` null and several remotes named in `base.reason` | which one is meant is the caller's to name: ask |
| `silent` otherwise | the remote did not answer: run the call once more, and still `silent`, stop — the ref's age is unknown |
| `gone` | nobody carries that name: back to step 2, and the same name again is a stop |
| `base.sharesHistory` false, or null | refused, or unknown: stop, saying which |

## Step 4 — What there is to take, and how

- **Behind 0** — nothing arrived: report the one line and stop.
- **Ahead 0** — `git merge --ff-only --autostash "$REF"`: a fast-forward, nothing rewritten, and
  the report calls it that.
- **Otherwise** a rebase by default, and a merge in the three cases
  [`../../references/feature-branch.md`](../../references/feature-branch.md) draws. Where none of
  them can be read — step 1's published copy unread among them — that reference makes it a stop.

## Step 5 — Take it

```bash
REF='<.base.ref step 3 printed>'
git rebase --autostash "$REF"                 # feature-branch.md's cases: git merge --autostash --no-edit "$REF"
```

The ref, never the bare name — `base-resolution.md` says why the name fails quietly. A trivial
conflict is resolved here and the operation continued; one needing a real decision
([`../../references/architecture-decisions.md`](../../references/architecture-decisions.md) §1) is
`git rebase --abort` or `git merge --abort`, which puts the autostash back, and a stop with its
recommendation first.

## Step 6 — Read what landed, not the exit

```bash
REF='<.base.ref>'; PUBLISHED='<yes | no: what step 1 printed>'
git status --porcelain -b
git rev-list --left-right --count "$REF...HEAD"          # behind must now read 0
git stash list --format='%H %gs'
B="$(git symbolic-ref --quiet --short HEAD)"
PUSH="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-base.mjs" --no-network | jq -r '.remotes.push // ""')"
[ "$PUBLISHED" = yes ] && git rev-list --left-right --count "refs/remotes/$PUSH/$B...HEAD"
```

- **Behind above 0, or an operation standing** — the take did not land: report what stands.
- **The autostash** — its sha is the one git printed as `Created autostash: <sha>`. Where git said
  it could not apply it back, the entry stands on the stash stack, which every worktree of this
  repository shares: name that sha, restore it with `git stash apply <sha>` alone, and leave the
  conflict markers it wrote as they are.
- **The published copy diverged** — the rebase rewrote what it holds. Publishing is
  `git push --force-with-lease`, the user's or the change-request driver's, never this skill's; on
  a set's feature branch, name the fast-forward push `feature-branch.md` owes instead.

## Step 7 — What arrived

Read it per `base-delta.md` from step 3's `M` and `H` — or from the earlier point the facts were
read at, where this session holds one. This skill's depth is the mechanics and the forks: run the
project's checks, restore the environment the delta changed, and put a break the delta caused first
in the report, with a recommendation, rather than repair it. A master session only recommends
`hcb-dev:wave-refresh` here.

## Report

Nothing taken is one line: the base, its tip, already current. Anything else wears the frame
[`../../references/report-format.md`](../../references/report-format.md) fixes — every fork in its
`Needs your word` block, recommendation first — over this body:

- **Base** — `<base.short>` at `<sha>`, its outcome, the remote it was read from.
- **Branch** — `<branch>` from `<H>` to `<new tip>`: a fast-forward, a rebase, or a merge and which
  case; its commits of its own; each conflict resolved, by file.
- **Tree** — clean; the autostash applied back; or the autostash standing as `<sha>`.
- **Published** — nothing published; level; or diverged, and what publishing it would take.
- **What arrived** — `base-delta.md`'s line per kind.

## Never

| ❌ | ✅ |
|---|---|
| push, `--force-with-lease` included | say what publishing would take |
| `git stash pop`, a bare `git stash`, a stash named by index | `git stash apply <sha>`, the entry git named |
| `git reset --hard` or a checkout to get past a refusal or a conflict | report what stands |
| take the base by its bare name | the `.base.ref` step 3 printed |
| take a ref whose `base.current` is not true | step 3's table |

## Reference files

| file | read it |
|---|---|
| [`../../references/invariants.md`](../../references/invariants.md) | once, before the first read of anything a tool, a forge or a remote answers |
| [`../../references/base-resolution.md`](../../references/base-resolution.md) | at step 2, before any rung is weighed |
| [`../../references/feature-branch.md`](../../references/feature-branch.md) | at step 4 |
| [`../../references/architecture-decisions.md`](../../references/architecture-decisions.md) | before the first stop |
| [`../../references/base-delta.md`](../../references/base-delta.md) | at step 3, before the take, and at step 7 |
| [`../../references/report-format.md`](../../references/report-format.md) | the report's frame |
