---
name: shipping-workflow
description: >-
  Take finished work from the working tree to an open pull request — local review
  across every available reviewer, the fixes it turns up, a coverage check, then
  the PR. Use it when the user says to ship, open a PR or MR, push this up, or get
  this merged; and use it unprompted the moment a piece of work is complete and
  verified and the tree is committable, since shipping is the default ending for
  finished work. This is the entry point for shipping and calls
  `hcb-dev:github-pr-workflow` itself as its last step, so prefer it over that
  skill whenever finished work has not been through local review yet — going
  straight to the PR driver skips the reviewers and the coverage gate this skill
  exists to enforce. Do not use it for work that is still in progress. Where a
  project forbids committing or pull requests, it still applies — it follows that
  project's rules and names the step it is skipping.
---

# Shipping workflow

Finished work ships automatically. Do not ask for confirmation; the coverage gate
below is the one exception. Work counts as ready once the change is complete and
verified — tests pass, or the behavior is confirmed — and the tree is committable.

1. **Commit the change first**, new files included — one reviewer reads only
   committed work, so a review launched over a dirty tree covers less than the
   change and trips the gate below on every ship. Where the project forbids
   committing yet, say so and expect that reviewer to come back short.
2. **Local review** — hand off to the `hcb-dev:multi-review` skill.
3. **Apply the fixes, then commit them** — that skill reports, it does not fix.
   Skip a finding only if the fix would change intended behavior, reach well
   outside the diff, or the finding is plainly wrong, and note the skip in one
   line. Do not open the change request with findings left unresolved — and do
   not leave the fixes sitting uncommitted: step 5's driver pushes *commits*, and
   a rebase with `--autostash` carries an uncommitted fix straight past the change
   request it was meant to be in.
4. **Check the coverage** — the gate below.
5. **Open the change request** — hand off to a skill that drives pull/merge
   requests if this machine has one; it usually arrives from a plugin and is
   invoked under that plugin's namespace rather than a bare name (here,
   `hcb-dev:github-pr-workflow` on GitHub). If none is installed, **push the
   branch first** —
   `GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -oBatchMode=yes -oConnectTimeout=5" git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=10 push -u <remote> <branch>`,
   which the handoff would otherwise have done for you. Resolve `<remote>` by the
   shared ladder
   ([`../../references/base-resolution.md`](../../references/base-resolution.md))
   rather than assuming `origin`: git's push routing —
   `branch.<name>.pushRemote`, then `remote.pushDefault`, then `origin`, then your
   sole remote — never the tracked `@{upstream}`, which in a fork is the base repo
   you cannot push to. **With several remotes and none of those preferred, stop and
   ask** instead of picking one: a guess here publishes the branch in someone
   else's repository, and `hcb-dev:github-pr-workflow` refuses the same case
   outright. Keep the guard as written — it extends the user's ssh setup rather
   than replacing it, and bounds a stalled transfer — so an unattended ship fails
   fast on a missing credential instead of hanging on the prompt. Then
   open it yourself (GitHub `gh pr create`,
   GitLab `glab mr create`) and say the handoff was unavailable, so nobody
   assumes a review-and-merge loop is running that isn't. Skip that push and the
   branch exists only locally, so the create command has no head to point at and
   the ship dies at its last step.

## The coverage gate

The review reports what each reviewer actually covered. A gap is a reviewer that
could not run, one that ran and covered nothing, and one that covered less than
the change or the wrong range — a nonzero file count is not proof it read *this*
change.

Two things get reported but do **not** count as gaps: a deliberate skip with a
stated reason, and a **structural** limit of the reviewer itself — one no answer
from the user could close, such as a reviewer whose base is pinned to the default
branch running in a repo whose changes target `dev` or `release/*`. Say it out
loud every time; just don't stop for it. Otherwise the gate fires on every single
ship in such a repo, demanding a confirmation that clears nothing.

With no gaps, go straight to the PR; no confirmation needed. **With a gap, stop
before the PR.** Report it, pass on whatever the review says would close it, and
ship only once the user says to. This is the single confirmation gate in this
workflow — a ship with a reviewer silently missing is exactly what it exists to
prevent.

A project's own rules outrank this one: where the repository says to commit
straight to a branch, or not to commit until asked, or not to open PRs at all,
follow that and say which step you are skipping and why.
