# The feature branch a set of slices shares

Read by whatever cuts, moves or lands on the branch a multi-slice set is built on — the
orchestrator between slices, and the change-request driver before the final integration
request. It owns how that branch takes a base that moved, and the three cases in which **any**
branch takes its base by merge rather than by rebase. What a slice does when it lands is
[`slice-completion.md`](slice-completion.md)'s.

## Keeping it current

Where the base moves while a set is in flight, the feature branch takes it **by merge,
never by rebase** — the section below says why its history cannot be rewritten. From the
worktree that holds it (`git worktree list --porcelain` names it; a branch another session
holds is not moved): bring it to its remote tip first where one exists
(`git merge --ff-only <remote>/<feature>`), then `git merge <remote>/<base>` into it, then
in `request` mode push it fast-forward — the remote copy is what the next slice's request
diffs against. A slice itself rebases onto the feature branch, as any branch onto its
parent.

**When, and by whom**: the orchestrator, before each slice after the first is cut — it cut
the feature branch, and in `request` mode published it then, the first slice's request
needing it on the remote. Then the request driver once more before the final
`feature → base` request, by its own re-sync step. A slice never moves the feature branch:
its landing is onto it, not onto the base.

## A branch that is merged, never rebased

Three cases; each takes its base by merge, and the report says which:

- **Shared** — something is built on the branch's current tip: another
  contributor's commits on it, a change request **other than the branch's own**
  that stacks on it or targets it, or — a set's feature branch — a slice still
  open against it or already cut from it. The branch's own request is not one of
  these: it heads the branch and stacks on nothing. Once every slice has landed
  and its request is closed, nothing shares a feature branch, though the last
  case below still holds for it.
- **A history carrying a merge whose content is in neither parent** — a rebase
  drops the merge, and a resolution living only there goes silently with it:

  ```bash
  # Non-empty combined diff = a merge that wrote something of its own → merge, not rebase.
  for m in $(git rev-list --merges "<base>..HEAD"); do
    [ -n "$(git show --format= "$m")" ] && echo "$m carries content of its own"
  done
  ```
- **A set's feature branch**, whichever mode — the section above.

Where none of the three can be read — a remote that does not answer, a tip
nobody here can vouch for — that is a stop, never a guess.
