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
(step 5) adds its own, mode-specific: a stop before merging into the default
branch, and the consent-gated post-merge offer. Work counts as ready once the
change is complete and verified — tests pass, or the behavior is confirmed — and
the tree is committable.

This skill runs either standalone (a bare "ship this" on finished work) or as the
per-slice step `hcb-dev:implementation-workflow` calls. Steps 0–4 are identical in
both **completion modes** — `local` (merge into the parent, no forge) and
`request` (a change request) — because the mode is read only at step 5. When
driven by the orchestrator, the caller threads the completion signals as
invocation prose: `mode`, `parent`, `diff-base`, `merge-strategy`, `merge-auth`,
and `defer-offer` (the coverage *policy* is not one of them — an actionable gap
always stops, a fixed invariant, not a threaded value). Standalone, they default —
mode by the
ladder in
[`../../references/slice-completion.md`](../../references/slice-completion.md)
(ending at `request`, so behavior matches before this skill grew a second mode),
and `parent` = the base. That reference owns the mechanics of completion; steps
0–4 below are the mode-blind front half.

0. **Normalize the branch name** — rename an auto-generated or placeholder name
   (a host session's `claude/…`, a `wip`) to the shape in
   [`../../references/branch-naming.md`](../../references/branch-naming.md) —
   which also defines what counts as auto-generated and leaves a name that
   already describes the change alone. It comes **first and in both modes** because this is the cheapest the
   rename ever gets — the branch is typically still unpushed, so it is a bare
   `git branch -m` touching no network — and because both doors it beats shut
   later: a name under an open change request cannot be fixed at all, and a
   `local` completion's `--no-ff` merge writes the branch name into the parent's
   history permanently. Do not rename a branch someone else has pulled, or one
   whose change request is already open; the reference lists those cases.
1. **Commit the change first**, new files included — one reviewer reads only
   committed work, so a review launched over a dirty tree covers less than the
   change and trips the gate below on every ship. Where the project forbids
   committing yet, say so and expect that reviewer to come back short.
2. **Local review** — hand off to the `hcb-dev:multi-review` skill. When a
   `diff-base` was threaded in (an orchestrated slice), pass it as the explicit
   base so the review covers *this* slice's range, not the cumulative feature diff.
   The cumulative diff is a *superset* — it covers this slice **and** the
   already-merged slices below it — so it slips past the coverage gate (the gate
   catches a review that covered *less* than the change or the wrong range, not one
   that covered *more*) while wasting review on landed work and muddying which
   findings belong to this slice. The `diff-base` is what keeps coverage aligned to
   the slice. Standalone, `multi-review` resolves its own base.
3. **Apply the fixes, then commit them** — that skill reports, it does not fix.
   Skip a finding only if the fix would change intended behavior, reach well
   outside the diff, or the finding is plainly wrong, and note the skip in one
   line. Do not complete with findings left unresolved — and do not leave the
   fixes sitting uncommitted: step 5 lands *commits* (a local merge takes what is
   committed; in request mode the driver's rebase with `--autostash` carries an
   uncommitted fix straight past the change request it was meant to be in).
4. **Check the coverage** — the gate below.
5. **Complete the slice by mode** — hand off to the completion contract in
   [`../../references/slice-completion.md`](../../references/slice-completion.md)
   — the mode picks the backend; nothing in steps 0–4 changes:
   - **`local`** — merge the slice into its `parent` with `git`, no forge and no
     network, `--no-ff` by default so the slice stays a revertible boundary.
     Merging into a feature branch is autonomous; merging into the **default
     branch** — or one it cannot resolve as non-default — stops and asks first.
     Then offer — never force — a change request on the landed work, unless
     `defer-offer` is set (the orchestrator makes one whole-feature offer instead).
   - **`request`** — detect the forge (by the remote and what answers there, never
     the hostname) and hand to its change-request driver — `hcb-dev:github-pr-workflow`
     on GitHub, the mirrored `glab` path on GitLab until `gitlab-mr-workflow`
     exists — passing `parent` as the base plus `merge-strategy` and `merge-auth`.
     A gate-captured `merge-auth` is the driver's explicit authorization; absent
     it, the driver falls back to its **own** authorization rule — which still
     treats the user's own "ship it" / "get this merged" as authorization and
     stops to ask only when neither is present, so a standalone ship behaves
     exactly as it did before this skill grew a mode. If no driver is installed,
     push
     the branch and open the change request inline (mirrored `gh` / `glab`). **With
     several remotes and none preferred, stop and ask** rather than publishing in
     someone else's repository.

   The reference owns every mechanic — parent resolution, the default-branch gate,
   forge detection, the guarded push and inline fallback, the offer arbitration —
   read it rather than re-deriving them here.

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

With no gaps, go straight to completion; no confirmation needed. **With an
actionable gap, stop before completing.** Report it, pass on whatever the review
says would close it, and complete only once the user says to. This holds in
**both modes**: a *local* merge with a reviewer silently missing is just as
unreviewed as a change request would be — the gate is mode-blind because the
danger is. This is the review-coverage confirmation gate, the one the front half
(steps 0–4) turns on; local completion can add its own later (a default-branch
merge, the post-merge offer). When `implementation-workflow` drives the run
autonomously, this stop is one of its legitimate interrupts, not something the
autonomy waives.

A project's own rules outrank this one: where the repository says to commit
straight to a branch, or not to commit until asked, or not to open change requests
at all, follow that and say which step you are skipping and why.
