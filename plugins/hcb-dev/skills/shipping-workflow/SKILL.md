---
name: shipping-workflow
description: >-
  Take one finished slice to completion — local review across every reviewer, the
  fixes it turns up, a coverage check, then completion by mode: merged locally into
  its parent branch, or an open change request. Use it when the user says to ship,
  finish, open a PR or MR, get this merged, or merge it locally without a PR; and
  use it unprompted the moment a piece of work is complete, verified, and
  committable. Request mode hands the final step to a change-request driver
  (`hcb-dev:github-pr-workflow` on GitHub); local mode merges into the parent
  itself. Prefer it over the PR driver when finished work has not been reviewed
  locally yet — entering the driver directly skips the reviewers and the coverage
  gate this skill enforces. For work not yet built — a task or issue to implement
  from scratch — start from `hcb-dev:implementation-workflow`, which calls this
  skill per slice. Not for work still in progress; where a project forbids
  committing or change requests, it still applies and names the step it skips.
---

# Shipping workflow

Finished work completes automatically. Do not ask for confirmation; the coverage
gate below is the one exception in the shared front half — local completion
(step 6) adds its own, mode-specific: a stop before merging into the default
branch, and the consent-gated post-merge offer. Work counts as ready once the
change is complete and verified — tests pass, or the behavior is confirmed — and
the tree is committable.

This skill runs either standalone (a bare "ship this" on finished work) or as the
per-slice step `hcb-dev:implementation-workflow` calls. Steps 0–5 are identical in
both **completion modes** — `local` (merge into the parent, no forge) and
`request` (a change request) — because the mode is read only at step 6. When
driven by the orchestrator, the caller threads the completion signals as
invocation prose: `mode`, `parent`, `diff-base`, `merge-strategy` and `merge-auth`
(the coverage *policy* is not one of them — an actionable gap always stops, a
fixed invariant, not a threaded value). Standalone, they default — mode and
`parent` by the ladders in
[`../../references/slice-completion.md`](../../references/slice-completion.md),
mode ending at `request`. That reference owns the mechanics of completion; steps
0–5 below are the mode-blind front half.

0. **Normalize the branch name** — rename an auto-generated or placeholder name
   (a host session's `claude/…`, a `wip`) to the shape in
   [`../../references/branch-naming.md`](../../references/branch-naming.md),
   **first and in both modes**. That reference defines what counts as
   auto-generated, leaves a name that already describes the change alone, and
   lists the cases where the rename is off the table.
1. **Commit the change first**, new files included — one reviewer reads only
   committed work, so a review launched over a dirty tree covers less than the
   change and trips the gate below on every ship. Where the project forbids
   committing yet, say so and expect that reviewer to come back short.

   **Sweep what the change orphaned.** Take every path the branch deletes or
   renames — the whole range, `git diff --name-status <base>...HEAD` plus what is
   staged now, not only this commit — and search the worktree for each old name.
   Search every file type, not the ones you edited: what stays behind otherwise is
   the citation in a config comment, the sentence in the docs, the stale header
   inside the renamed file. Vendored trees are out, and so is any other worktree's
   checkout — those are someone else's tree, not yours to edit.

   Rule on each hit before touching it: a migration path, a compatibility alias, a
   test asserting the old name and a changelog entry are all still true. A tracked
   generated file is fixed by re-running its generator. Run this again whenever a
   later step deletes or renames something of its own.

   Where the change alters a process the repository *documents*, there is no name
   to search for: re-read the files describing how the repository works rather
   than what its code does, and correct what the change made false — under
   [`../../references/architecture-decisions.md`](../../references/architecture-decisions.md)
   §4, which governs any sentence reporting how something is configured.
2. **Refresh the base** — the branch this work is ranged against and lands on: the
   threaded `parent` / `diff-base` where a caller handed them down, otherwise what
   the ladder in
   [`../../references/base-resolution.md`](../../references/base-resolution.md)
   resolves. Fetch it before either happens, per that reference. **Both modes** — a
   stale base costs the same either way: the review below reads a range the base
   has already moved past, and the fixes get written against it. It is a read, so
   local mode's no-network property is untouched — that is about what completion
   *writes*.
3. **Local review** — hand off to the `hcb-dev:multi-review` skill. When a
   `diff-base` was threaded in (an orchestrated slice), pass it as the explicit
   base so the review covers *this* slice's range, not the cumulative feature
   diff. Standalone, `multi-review` resolves its own base.
4. **Apply the fixes, then commit them** — that skill reports, it does not fix.
   Skip a finding only if the fix would change intended behavior, reach well
   outside the diff, or the finding is plainly wrong. A skipped one is then
   *surfaced*, not merely noted —
   [`../../references/surfacing-findings.md`](../../references/surfacing-findings.md)
   owns what that means. A reported stale reference is step 1's sweep over again,
   not a list of lines to edit — the finding is what one reviewer happened to see.
   Do not complete with findings left unresolved — and do not leave the
   fixes sitting uncommitted: step 6 lands *commits* (a local merge takes what is
   committed; in request mode the driver's rebase with `--autostash` carries an
   uncommitted fix straight past the change request it was meant to be in).
5. **Check the coverage** — the gate below.
6. **Complete the slice by mode** — hand off to the completion contract in
   `slice-completion.md`, which owns every mechanic of both backends. `local`
   merges the slice into its `parent` with git alone, no forge and no network;
   `request` hands to the forge's change-request driver
   (`hcb-dev:github-pr-workflow` on GitHub), passing `parent` as the base plus
   `merge-strategy` and `merge-auth`. Nothing in steps 0–5 changes with the mode.

## The coverage gate

The review reports what each reviewer actually covered, with the coverage status
already classified. Two of those statuses reach you closed: `n/a`, a deliberate
skip with a stated reason, and `partial (structural)`, a limit of the reviewer
itself that no answer from the user could lift. Say both out loud every time;
neither stops the ship. Everything else is an **actionable** gap.

With no gaps, go straight to completion; no confirmation needed. **With an
actionable gap, stop before completing.** Report it, pass on whatever the review
says would close it, and complete only once the user says to. This holds in
**both modes**: a *local* merge with a reviewer silently missing is just as
unreviewed as a change request would be — the gate is mode-blind because the
danger is. When `implementation-workflow` drives the run autonomously, this stop
is one of its legitimate interrupts, not something the autonomy waives.

Every stop this skill takes — this gate, step 6's default-branch merge, several
remotes with none preferred — carries your recommended option **first**, per
[`../../references/architecture-decisions.md`](../../references/architecture-decisions.md),
which also draws the line the autonomy above follows: act on what is mechanical
and reversible, stop on what cannot be walked back.

A project's own rules outrank this one: where the repository says to commit
straight to a branch, or not to commit until asked, or not to open change requests
at all, follow that and say which step you are skipping and why. Where such a rule
fights what the work actually needs, flag it and go on following it
(`architecture-decisions.md` §3) — except where it blocks correct work outright:
a rule forbidding the commit a required fix needs leaves nothing to complete.
