# Executing an approved cleanup

Read by `hcb-dev:git-cleanup` at its step 7, once the gate has an explicit answer — a run whose
gate deletes nothing never reaches it. [`verdicts.md`](verdicts.md) owns the classes every line
here routes on, and every step number is the skill's.

## In this order

```bash
# One Bash call with step 4's block at its head — it assigns PROJECT and SCAN, and the shell
# keeps neither between calls. `<n>` indexes THIS answer, which renumbers as items go, so the
# path it lands on is held against the one the gate approved before anything is removed:
# `jq -e` refuses an index past the end rather than handing back the string `null` to delete.
WT="$(printf '%s' "$SCAN" | jq -er --argjson i <n> '.worktrees[$i].path')" \
  || { echo "no worktree at index <n> in this answer — re-read it and ask again"; exit 1; }
[ "$WT" = '<the path the gate approved>' ] \
  || { echo "the answer renumbered: $WT is not the approved path — ask again over it"; exit 1; }
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
# One Bash call, step 1's block and step 4's re-run at its head: they assign PROJECT, D and SCAN.
# `<n>` indexes THIS answer, which renumbers; two branches cut from one commit share a tip, so
# the name is held against the approved one as well as the oid.
BR="$(printf '%s' "$SCAN" | jq -er --argjson i <n> '.branches[$i].name')" \
  || { echo "no branch at index <n> in this answer — re-read it and ask again"; exit 1; }
[ "$BR" = '<the branch name the gate approved>' ] || { echo "renumbered: $BR"; exit 1; }
# The oid the GATE's row carried, read BEFORE the wait — one reading for both matches itself.
APPROVED="<the oid this branch's gate row carried>"
# The ref this instant: `--verify -q` for the empty answer, `|| true` so a vanished ref tests.
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
# Same shape of call: PROJECT and D from step 1's block, BR read out of SCAN as above.
git -C "$PROJECT" branch --set-upstream-to="$D" -- "$BR"   # repair: set-upstream
git -C "$PROJECT" branch --unset-upstream -- "$BR"         # repair: unset-upstream
```

The second is recoverable: the next `git push -u <remote> <branch>` restores it, and the
report says so.
