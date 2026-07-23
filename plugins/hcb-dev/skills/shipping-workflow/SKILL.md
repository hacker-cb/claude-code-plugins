---
name: shipping-workflow
description: >-
  Take finished work from the working tree to an open pull request — local review
  across every available reviewer, the fixes it turns up, a coverage check, then
  the PR. Use it when the user says to ship, open a PR or MR, push this up, or get
  this merged; and use it unprompted the moment a piece of work is complete and
  verified and the tree is committable, since shipping is the default ending for
  finished work. Do not use it for work that is still in progress. Where a
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
3. **Apply the fixes** — that skill reports, it does not fix. Skip a finding only
   if the fix would change intended behavior, reach well outside the diff, or the
   finding is plainly wrong, and note the skip in one line. Do not open the PR
   with findings left unresolved.
4. **Check the coverage** — the gate below.
5. **Open the change request** — hand off to a skill that drives pull/merge
   requests if this machine has one; it usually arrives from a plugin and is
   invoked under that plugin's namespace rather than a bare name (here,
   `hcb-dev:github-pr-workflow` on GitHub). If none is installed, open it
   yourself — GitHub `gh pr create`, GitLab `glab mr create` — and say the
   handoff was unavailable, so nobody assumes a review-and-merge loop is running
   that isn't.

## The coverage gate

The review reports what each reviewer actually covered. A gap is a reviewer that
could not run, one that ran and covered nothing, and one that covered less than
the change or the wrong range — a nonzero file count is not proof it read *this*
change. Only a deliberate skip with a stated reason is not a gap.

With no gaps, go straight to the PR; no confirmation needed. **With a gap, stop
before the PR.** Report it, pass on whatever the review says would close it, and
ship only once the user says to. This is the single confirmation gate in this
workflow — a ship with a reviewer silently missing is exactly what it exists to
prevent.

A project's own rules outrank this one: where the repository says to commit
straight to a branch, or not to commit until asked, or not to open PRs at all,
follow that and say which step you are skipping and why.
