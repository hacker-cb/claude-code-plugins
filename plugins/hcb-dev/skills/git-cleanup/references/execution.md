# Executing an approved cleanup

Read by `hcb-dev:git-cleanup` at its step 7, once the gate has an explicit answer — a run whose
gate deletes nothing never reaches it. [`verdicts.md`](verdicts.md) owns the classes every line
here routes on, and every step number is the skill's.

## In this order

```bash
git -C "$PROJECT" worktree remove "$WT"      # 1. --force ONLY on a confirmed class-3 item: a
                                             #    dirty worktree, or one the removal refuses
                                             #    over a submodule. Plain remove re-checks
                                             #    clean now; --force does not
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
BR="$(printf '%s' "$SCAN" | jq -r --argjson i <n> '.branches[$i].name')"
# The oid the GATE's row carried, read BEFORE the wait. Both values from one reading makes the
# comparison say nothing: a branch that moved comes back with its new tip and matches itself.
APPROVED="<the oid this branch's gate row carried>"
# The ref this instant. `--verify -q` for the empty answer, `|| true` for the exit status, so a
# vanished ref still leaves a value to test.
NOW="$(git -C "$PROJECT" rev-parse --verify -q "refs/heads/$BR" || true)"
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
git -C "$PROJECT" branch --set-upstream-to="$D" -- "$BR"   # repair: set-upstream
git -C "$PROJECT" branch --unset-upstream -- "$BR"         # repair: unset-upstream
```

The second is recoverable: the next `git push -u <remote> <branch>` restores it, and the
report says so.
