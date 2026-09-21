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

A branch or base name reaches a command as data — read inside the block, or out of the answer
step 3 keeps in the git directory — and never pasted into one: git allows `$`, quotes and
backticks in a name, and pasted, any of them is shell.

## Step 1 — Where you stand

```bash
G="$(git rev-parse --git-dir)"; rm -f "$G/hcb-sync-base.json"   # a previous run's answer is not this one's
git symbolic-ref --quiet --short HEAD          # prints nothing on a detached HEAD
ls -d "$G/rebase-merge" "$G/rebase-apply" "$G/MERGE_HEAD" "$G/CHERRY_PICK_HEAD" 2>/dev/null
git status --porcelain
```

- **Detached HEAD**, or **a path listed** — no branch to bring up to date, or a rebase, merge or
  cherry-pick already in progress that is the user's to finish: stop.
- **Uncommitted work** — `--autostash` carries it, and step 6 says whether it came back.

**Then this branch's own published copy**, before any base: commits someone else pushed to this
branch are this branch's own tip, not the base's.

```bash
B="$(git symbolic-ref --quiet --short HEAD)"; echo "H=$(git rev-parse HEAD)"
R="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-base.mjs" --no-network)"; PUSH="$(printf '%s' "$R" | jq -r '.remotes.push // ""')"
if [ -z "$PUSH" ]; then printf '%s' "$R" | jq '{ranked: .remotes.ranked, pushReason: .remotes.pushReason}'; else
  git ls-remote --exit-code --heads --end-of-options "$PUSH" "refs/heads/$B" >/dev/null
  RC=$?; echo "published: exit $RC"            # 0 yes · 2 no · anything else unknown
  if [ "$RC" -eq 0 ] && git fetch --end-of-options "$PUSH" "+refs/heads/$B:refs/remotes/$PUSH/$B"; then
    git log --oneline --cherry-pick --right-only "HEAD...refs/remotes/$PUSH/$B"
    git merge-base --is-ancestor HEAD "refs/remotes/$PUSH/$B"; echo "HEAD under it: exit $?"
  elif [ "$RC" -eq 0 ]; then echo "the fetch failed: the published copy is unread"; fi
fi
```

- **No push route** — no remote at all (`ranked` empty) publishes nothing; remotes with no route
  git would push to (`pushReason` says why) leave the published copy unread.
- **Nothing listed** — go on.
- **Commits listed, `HEAD under it: exit 0`** — that is a take of its own:
  `git merge --ff-only --autostash "refs/remotes/$PUSH/$B"`, `B` and `PUSH` read as above. Steps 6
  and 7 are owed to it, from the `H` printed above, whatever the base turns out to be.
- **Commits listed, exit 1** — diverged over work this branch lacks: stop, that is the user's.
- **Any other exit, or a failed fetch** — the published copy is unread, which step 4 carries into
  the merge-or-rebase choice.

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
`landings` counts it, or where an open change request targets it: catching up with its published
copy at step 1 is the whole of a sync here, so go to step 6 where step 1 took anything, and stop.
Taking another branch into a base is a merge somebody decides. `landings.read` false, or no forge
to ask, leaves the question unread rather than answered "no" — the report says which.

Otherwise rungs 2 to 4 settle the base from those same answers. Rung 5, `@{upstream}`, names this
branch's own copy rather than a base: reaching it, stop and ask for one.

## Step 3 — Refresh it, and fix where the branch stands

One call refreshes the base, keeps the resolver's answer for the later steps, and fixes the points
[`../../references/base-delta.md`](../../references/base-delta.md) reads from — before anything is
taken, since a merge base read after the take answers the new tip:

```bash
BASE="$(cat <<'NAME'
<the name step 2 settled, alone on this line>
NAME
)"                                                # a quoted heredoc takes the name literally
ST="$(git rev-parse --git-dir)/hcb-sync-base.json"
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-base.mjs" --base "$BASE" > "$ST"; jq '{base, notes, reason}' "$ST"
REF="$(jq -r 'if .base.current and .base.sharesHistory then .base.ref else "" end' "$ST")"
if [ -n "$REF" ]; then
  echo "M=$(git merge-base HEAD "$REF") H=$(git rev-parse HEAD)"
  F="$(git merge-base --fork-point "$REF" HEAD)"; echo "F=$F"
  [ -z "$F" ] || { git merge-base --is-ancestor "$F" "$REF"; echo "F in the base: exit $?"; }
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
| `F in the base: exit 1` | the base was rewritten under this branch, and a rebase would replay what it dropped as this branch's own: stop, recommending `git rebase --onto` the base's ref from `F` |
| `F in the base`, any other exit but 0 | whether the base was rewritten is unread: stop before taking it, saying so |

## Step 4 — What there is to take, and how

- **Behind 0** — nothing arrived from the base: go to step 6 where step 1 took anything; otherwise
  report the one line, and stop.
- **Ahead 0** — `ff`: a fast-forward, nothing rewritten, and the report calls it that.
- **Otherwise** `rebase` by default, and `merge` in the three cases
  [`../../references/feature-branch.md`](../../references/feature-branch.md) draws. Where none of
  them can be read — step 1's published copy unread among them — that reference makes it a stop.

## Step 5 — Take it

```bash
HOW='<ff | rebase | merge — step 4 decided>'
REF="$(jq -r 'select(.base.current and .base.sharesHistory).base.ref' "$(git rev-parse --git-dir)/hcb-sync-base.json")"  # step 3's, current and related
case "$HOW:${REF:+ref}" in
  ff:ref)     git merge --ff-only --autostash "$REF" ;;
  rebase:ref) git rebase --autostash "$REF" ;;
  merge:ref)  git merge --autostash --no-edit "$REF" ;;
  *)          echo "nothing taken: step 3 left no ref, or step 4 no decision" ;;
esac
```

The ref, never the bare name — `base-resolution.md` says why the name fails quietly. A trivial
conflict is resolved here and the operation continued; one needing a real decision
([`../../references/architecture-decisions.md`](../../references/architecture-decisions.md) §1) is
`git rebase --abort` or `git merge --abort`, which puts the autostash back, and a stop with its
recommendation first.

## Step 6 — Read what landed, not the exit

```bash
PUBLISHED='<yes | no — what step 1 read>'
REF="$(jq -r 'select(.base.current and .base.sharesHistory).base.ref' "$(git rev-parse --git-dir)/hcb-sync-base.json" 2>/dev/null)"
git status --porcelain -b; git stash list --format='%H %gs'
[ -z "$REF" ] || git rev-list --left-right --count "$REF...HEAD"   # behind must now read 0
B="$(git symbolic-ref --quiet --short HEAD)"
PUSH="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-base.mjs" --no-network | jq -r '.remotes.push // ""')"
if [ "$PUBLISHED" = yes ] && [ -n "$B" ] && [ -n "$PUSH" ]; then
  git rev-list --left-right --count "refs/remotes/$PUSH/$B...HEAD"   # the published copy step 1 fetched
fi
```

- **Behind above 0, or an operation standing** — the take did not land: report what stands.
- **The autostash** — its sha is the one git printed as `Created autostash: <sha>`. Where git said
  it could not apply it back, the entry stands on the stash stack, which every worktree of this
  repository shares: name that sha, restore it with `git stash apply <sha>` alone — never `pop`,
  never by index — and leave the conflict markers it wrote as they are.
- **The published copy diverged** — the rebase rewrote what it holds. Publishing is
  `git push --force-with-lease`, the user's or the change-request driver's, never this skill's; on
  a set's feature branch, name the fast-forward push `feature-branch.md` owes instead.

## Step 7 — What arrived

Read each take per `base-delta.md` — step 1's from the `H` it printed, step 5's from step 3's `M`
and `H`, or from the earlier point the facts were read at where this session holds one. This
skill's depth is the mechanics and the forks: run the project's checks, restore the environment
the delta changed, and put a break the delta caused first in the report, with a recommendation,
rather than repair it. A master session only recommends `hcb-dev:wave-refresh` here.

## Report

Nothing taken is one line: the base, its tip, already current. Anything else wears the frame
[`../../references/report-format.md`](../../references/report-format.md) fixes — every fork in its
`Needs your word` block, recommendation first — over this body:

- **Base** — `<base.short>` at `<sha>`, its outcome, the remote it was read from.
- **Branch** — `<branch>` from `<H>` to `<new tip>`: a fast-forward, a rebase, or a merge and which
  case, and step 1's take where it made one; its commits of its own; each conflict resolved.
- **Tree** — clean; the uncommitted work the autostash carried back; or the autostash standing as
  `<sha>`.
- **Published** — nothing published; level; or diverged, and what publishing it would take.
- **What arrived** — `base-delta.md`'s line per kind, for each take.
