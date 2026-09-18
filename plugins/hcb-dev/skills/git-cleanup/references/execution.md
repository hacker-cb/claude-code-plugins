# Executing an approved cleanup

Read by `hcb-dev:git-cleanup` at its step 7, once the gate has an explicit answer — a run whose
gate deletes nothing never reaches it. [`verdicts.md`](verdicts.md) owns the classes every line
here routes on, and every step number is the skill's.

## In this order

```bash
# One call: step 4's block at its head assigns PROJECT and SCAN. `<n>` indexes THAT answer and
# it renumbers, so the path is held against the approved one — arriving through a heredoc, the
# one form no `'` or `$(…)` breaks out of — and `jq -e` refuses an index past the end.
APPROVED_WT="$(cat <<'GATE'
<the path the gate approved>
GATE
)"
WT="$(printf '%s' "$SCAN" | jq -er --argjson i <n> '.worktrees[$i].path')" || exit 1
[ "$WT" = "$APPROVED_WT" ] || { echo "renumbered: $WT is not the approved path"; exit 1; }
git -C "$PROJECT" worktree remove "$WT"      # 1. --force ONLY on a confirmed class-3 item — a
                                             #    dirty tree, or one a submodule refuses; plain
                                             #    remove re-checks clean now, --force does not
rm -rf "$WT"                                 # 2. approved class-3 items only
git -C "$PROJECT" worktree prune --verbose   # 3. AFTER the rm, or the entry it orphaned
                                             #    still blocks its branch
```

`$WT` is read out of the answer, never pasted in: a path can carry anything a filesystem allows,
and so can the branch names below.

**Re-take the proof here, never read it off step 4.** Step 6 waits on a human, and both what a
branch carries and what the forge says about it move while it waits. Re-run step 1's call and
step 4's — in that order, and **after the worktree removals above**, which is what turns a branch
whose only keep was `freedBy` into a `delete`. Act on the fresh answer alone, naming in the
report which `proof` each deletion stood on. Per branch it still calls `delete`, `<n>` being its
index in that fresh answer:

```bash
# One call: step 1's and step 4's blocks at its head assign PROJECT, D and SCAN. `<n>` indexes
# THAT answer and renumbers; one tip can carry two branches, so the name is held too, by heredoc.
APPROVED_BR="$(cat <<'GATE'
<the branch name the gate approved>
GATE
)"
BR="$(printf '%s' "$SCAN" | jq -er --argjson i <n> '.branches[$i].name')" || exit 1
[ "$BR" = "$APPROVED_BR" ] || { echo "renumbered: $BR"; exit 1; }
APPROVED="<the oid this branch's gate row carried>"   # BEFORE the wait: one reading matches itself
NOW="$(git -C "$PROJECT" rev-parse --verify -q "refs/heads/$BR" || true)"   # empty where gone
if [ "$NOW" = "$APPROVED" ]; then
  git -C "$PROJECT" branch -D -- "$BR"
else
  echo "moved or gone while the gate waited: $BR — surface it, and ask again over its tip"
fi
```

**`-d` is not a lighter `-D`, and neither command is the proof.** `-d` re-checks against
`PROJECT`'s HEAD, or the branch's own upstream — never against the base — so it deletes what the
verdicts keep and refuses what they proved. `-D` carries what no plumbing deletion has: it
refuses a branch checked out in another worktree, resolves the branch ref rather than a symref's
target, and drops `branch.<name>.*` with it. The deletion stays `-D`; the verdict authorizes it.

To remove the worktree **you are standing in**, physically leave first (`git worktree remove`
inspects the real cwd): `cd "<PROJECT>"` as a **separate** Bash call, so cwd truly changes, then
`git -C "<PROJECT>" worktree remove "$WT"`. Then tell the user cwd moved to `PROJECT` — their
old path no longer exists.

**Last, repair the tracking**, one branch at a time and only on survivors. Which branches, and
which of the two, is the scan's `repair` field — a branch it left `null` needs neither, and
acting on a name instead is how every surviving branch loses its upstream on the one run that
could not answer.

```bash
# Same shape of call: step 4's block assigns PROJECT, D and SCAN, and BR is read out of SCAN
# as above — step 1 alone leaves SCAN empty, and the repair then runs on nothing.
git -C "$PROJECT" branch --set-upstream-to="$D" -- "$BR"   # repair: set-upstream
git -C "$PROJECT" branch --unset-upstream -- "$BR"         # repair: unset-upstream
```

The second is recoverable: the next `git push -u <remote> <branch>` restores it, and the
report says so.
