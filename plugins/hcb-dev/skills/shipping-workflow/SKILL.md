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
per-slice step `hcb-dev:implementation-workflow` calls. Either way it is a skill,
not the host's workflow tool: a rule that limits workflows or subagents to what
the user or a skill asks for is met by the invocation and by the skills this one
calls, and skips nothing below. Steps 0–5 are identical in
both **completion modes** — `local` (merge into the parent, no forge) and
`request` (a change request) — because the mode is read only at step 6. When
driven by the orchestrator, the caller threads the completion signals as
invocation prose: `mode`, `parent`, `diff-base`, `merge-strategy` and `merge-auth`.
Standalone, they default — mode and
`parent` by the ladders in
[`../../references/slice-completion.md`](../../references/slice-completion.md),
mode ending at `request`. That reference owns the mechanics of completion; steps
0–5 below are the mode-blind front half.

0. **Normalize the branch name** — rename an auto-generated or placeholder name
   (a host session's `claude/…`, a `wip`) to the shape in
   [`../../references/branch-naming.md`](../../references/branch-naming.md),
   **first and in both modes**.
1. **Refresh the base** — what this work is ranged against and lands on: the
   threaded `diff-base` and `parent` where a caller handed them down, otherwise
   what the ladder in
   [`../../references/base-resolution.md`](../../references/base-resolution.md)
   resolves. Fetch whichever of them a remote actually carries — an orchestrated
   slice's `parent` is often a feature branch that exists nowhere else, and that
   reference says what refreshing means for one. Fetch here, because the sweep below is already
   a consumer of it and every step after that one is too. **Both modes** — what
   local completion promises is that it writes to no network (`slice-completion.md`),
   and a read leaves that promise intact.
2. **Commit the change first**, new files included — a reviewer handed a commit
   range reads only committed work, and only the one reading the working tree
   directly is exempt, so a review launched over a dirty tree covers less than the
   change and trips the gate below on every ship. Where the project forbids
   committing yet, say so and expect the range-fed reviewers to come back short.

   **Sweep what the change orphaned.** Take every path the branch deletes or
   renames — the whole range and not only this commit, with step 1's `diff-base`:
   `git diff --name-status <diff-base>...HEAD`, plus what is not committed —
   `git diff --name-status --cached` and `git diff --name-status`, two calls
   because one against `HEAD` collapses a rename staged and then renamed again —
   and search the worktree for each old name.
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
3. **Local review** — hand off to the `hcb-dev:multi-review` skill. When a
   `diff-base` was threaded in (an orchestrated slice), pass it as the explicit
   base so the review covers *this* slice's range, not the cumulative feature
   diff. Standalone, `multi-review` resolves its own base. Every reviewer
   `multi-review` picks runs, the security review's sub-tasks included; a
   reviewer left out on account of a rule about subagents is a row in the gate
   below, never a judgement call made here.
4. **Apply the fixes, then commit them** — that skill reports, it does not fix.
   A finding on the code this change wrote is not weighed against scope: it is
   in-scope work. Scope is the question only for one about anything else the
   reviewers read, and the test in
   [`../../references/fix-or-surface.md`](../../references/fix-or-surface.md)
   settles that one, carries the exits a finding of either kind can take, and owns
   the commit a fix outside this change's own scope takes. One exit is this skill's
   own: where the fix is a product or design call, stop and ask rather than
   deciding it here. A reported stale reference is step 2's sweep over again, not
   a list of lines to edit — the finding is what one reviewer happened to see.
   Do not complete with findings left unresolved — and do not leave the
   fixes sitting uncommitted: step 6 lands *commits* (a local merge takes what is
   committed; in request mode the driver's rebase with `--autostash` carries an
   uncommitted fix straight past the change request it was meant to be in).
5. **Check the coverage** — the gate below.
6. **Complete the slice by mode** — hand off to the completion contract in
   `slice-completion.md`, which owns every mechanic of both backends. `local`
   merges the slice into its `parent` with git alone, no forge and no network
   write;
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
[`../../references/architecture-decisions.md`](../../references/architecture-decisions.md).

A project's own rules outrank this one: where the repository says to commit
straight to a branch, or not to commit until asked, or not to open change requests
at all, follow that and say which step you are skipping and why. Where such a rule
fights what the work actually needs, flag it and go on following it
(`architecture-decisions.md` §3) — except where it blocks correct work outright:
a rule forbidding the commit a required fix needs leaves nothing to complete.
