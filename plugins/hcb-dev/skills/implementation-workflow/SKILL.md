---
name: implementation-workflow
description: >-
  Turn one or more tasks — free-text asks from the conversation, or GitHub/GitLab
  issue/ticket numbers — into implemented, reviewed work. Use it at the START,
  when there is something to build and no code exists yet: "сделай issue #42", "do
  these three tickets", "build this spec", "implement this and open the PRs". It
  slices the work, forks the architectural questions and the completion mode
  (merge locally, or a change request) to you at one planning gate, then runs each
  slice to completion autonomously. Do NOT use it for work already finished that
  only needs completing — that is `hcb-dev:shipping-workflow`, which this skill
  calls per slice; nor for driving an existing PR (`hcb-dev:github-pr-workflow`);
  nor as a diff review (`hcb-dev:multi-review`).
---

# Implementation workflow

Take one or more tasks from intake all the way to done: analysis, slicing, one
planning gate, an autonomous per-slice run, then a report. This is the front half
the other skills assume has already happened — it owns the whole-set concerns
(intake, slices, branch layout, the cross-slice report) and hands each slice's
completion to `hcb-dev:shipping-workflow`. It runs in the **main conversation**,
and it is a skill, not the host's workflow tool: a rule that limits workflows or
subagents to what the user or a skill asks for is met by the invocation that
started it and by the skills it calls, and skips nothing here.

The completion **mode** — `local` (merge each slice into its parent, no forge) or
`request` (a change request per slice) — changes only how a slice *ends*. Analysis,
slicing, development, and review are identical either way. This skill elicits the
mode once, at the gate, and threads it down; the mechanics live in
[`../../references/slice-completion.md`](../../references/slice-completion.md).

## Phase 0 — Analysis

- **Intake, forge-neutrally.** A task is free text from the conversation, or an
  issue/ticket number, or a mix. Read a number through the mirrored CLIs — GitHub
  `gh issue view <n> --json title,body,comments`, GitLab `glab issue view <n>` —
  detecting the forge from the remote and what answers there, never the hostname.
  Resolve any invocation this skill does not spell out per
  [`../../references/forge-docs.md`](../../references/forge-docs.md).
  Reading an issue is reading a *spec*, not a mandate to do everything written in
  it: surface the actual asks and let the gate confirm scope.
- **Be findable.** Where this session opened the run, title it per
  [`../../references/session-naming.md`](../../references/session-naming.md).
- **Search the backlog for the work itself** — `hcb-dev:issue-tracking`. An issue
  already covering these tasks changes the scope; one covering part of them
  changes the slicing.
- **Refresh the base before reading the code against it** — resolve it and fetch,
  per [`../../references/base-resolution.md`](../../references/base-resolution.md).
  The fetch moves the remote-tracking ref and nothing else, so the deep-read is
  still on what is checked out: read against the refreshed ref, and where the
  checkout cannot move onto it, say the tree is older and treat what the base moved
  past as unread.
- **Rule each issue task current, or not** — a number taken in is a claim about
  the tree, and it earns a verdict against the base just refreshed, per
  [`../../references/issue-currency.md`](../../references/issue-currency.md).
  Free text from the conversation is the user's own ask and takes none.
- **Deep-read the codebase against the tasks** — what is affected, what is risky,
  where the genuinely-open questions are.
- **Draft a slicing.** Split the work into **independently reviewable slices** — a
  slice is a chunk that can be reviewed and completed on its own. **One slice is
  the normal case.** Keep each small enough to review and coherent enough to stand
  alone; more than one usually stacks on a shared feature branch and the slices
  can depend on each other.
- **The lower bound (Tier 0).** Trivial work — one slice, no architectural
  decisions, a couple of files — skips the gate and this whole orchestration: just
  make the edit and hand it to `hcb-dev:shipping-workflow`. The gate is for work
  worth planning; a one-line fix does not earn it. A verdict of anything but
  `current` is never trivial, whatever the edit it implies: it carries a fork,
  and a fork is the gate.

## Phase 1 — The planning gate

The one interactive point. Present the whole plan and take a single approval,
deciding everything foreseeable at once so Phase 2 has no routine questions left.
Every fork carries a **recommendation shown first**, never a bare question, and a
project rule that fights good architecture gets flagged — see
[`../../references/architecture-decisions.md`](../../references/architecture-decisions.md).

Settle, in one gate:

- **What a non-`current` verdict changes** — an issue ruled stale, needing a
  rewrite or unverifiable is settled before the slicing that would build it:
  recommend what becomes of it — built as written, built down to the part that
  still holds, its body rewritten first, closed as already met — carrying the
  coordinate the verdict stands on. `hcb-dev:issue-tracking` writes to the
  tracker on the answer, never ahead of it.
- **Slice breakdown + branch layout** — a shared feature branch only for more than
  one slice; a single slice's parent is the base. Name both the feature branch and
  its slices per
  [`../../references/branch-naming.md`](../../references/branch-naming.md), which
  owns the feature/slice layout. Show the names in the plan; they are mechanical,
  so present them, don't ask about them.
- **Architectural / implementation forks** — the choices the code cannot answer.
- **Completion mode** — `local` or `request` (default `request` if the user is
  silent and phrasing does not decide).
- **Merge strategy** — a shown default (`--no-ff` local; squash per-slice request;
  the real choice is the final `feature → base` change request: `merge-commit` to
  keep slice history, `squash` to collapse), filtered for request mode to the
  repo's allowed methods.
- **Merge authorization** (request only) — merge-on-green as the shown default;
  approving the plan *is* the explicit authorization, threaded to the driver so
  the run does not stop to re-ask. Local completion needs none (choosing local is
  the consent; the default-branch merge is separately gated in Phase 2).
- **Coverage policy** — an **actionable** coverage gap stops the run; this is not
  waivable (a reviewer you did not know would go missing is exactly what the gate
  exists to catch). A structural gap is noted, never blocking.

**Gate weight scales by tier**, so the normal case stays light:

| Tier | Work | Gate | Persistence |
|---|---|---|---|
| 0 | trivial, 1 slice, no arch forks | none (skip) | none |
| 1 | a slice or two | a brief inline confirm | native task-list |
| 2 | multi-slice, real forks | native plan mode | plan-doc under the resolved plans dir + task-list |
| 3 | large / team / multi-session | plan mode | + an optional forge tracking issue (offer) |

For anything multi-slice, **persist the plan and the captured authorizations** so
a long autonomous run survives context compaction — track slice progress on the
native task list, and keep the plan (mode, merge authorization, strategy) in a
durable plan-doc under `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plans` (resolve the
path from the variable; never hardcode `~/.claude`).

Where this session titled itself at intake, the approved scope is what that
title settles on — `session-naming.md`'s second step.

## Phase 2 — Autonomous execution

Per slice, **in order** (slices run sequentially — they stack and depend on each
other):

1. **Cut the slice branch from the current tip of its parent** (the feature
   branch, or the base for a single slice) — not all up front, so a later slice
   sees the ones below it and conflicts less. Where that parent is the base,
   refresh it again here and take the cut point from `base-resolution.md`'s table
   — Phase 0's fetch does not still hold. The feature branch is cut the same way,
   once, before the first slice; keeping it current after that is
   `slice-completion.md`'s. Cut it under the name the gate showed
   (`branch-naming.md`).
2. **Develop the slice** — the normal coding work; `dependency-versions` and
   `seeding-gitignore` apply exactly as they always do. What the work turns up
   along the way goes through the test in
   [`../../references/findings.md`](../../references/findings.md) as it
   is noticed, here rather than at Phase 3 — what that test turns down still rides
   the slice's `incidental` output onward to the Phase 3 report.
3. **Hand the finished slice to `hcb-dev:shipping-workflow`**, threading the
   completion signals as invocation prose: `mode`, `parent`, `diff-base` (the
   commit this slice was cut from — only the orchestrator knows it),
   `merge-strategy` and `merge-auth`.

**Autonomy is "no routine questions", not "never pauses".** The legitimate stops
remain and are honored — this skill does not waive the downstream skills' own
safety gates:

- an **actionable** coverage gap (Phase 1's non-waivable policy);
- a local merge into the **default** branch — or one it cannot resolve as
  non-default (`slice-completion.md`);
- fix rounds that end with findings still open (`shipping-workflow`);
- CI that will not go green within the driver's fix-iteration budget
  (`github-pr-workflow`);
- a Critical/Important finding that needs a product/design decision;
- a genuinely-ambiguous merge strategy the gate did not settle;
- a git operation that would lose work on a shared branch;
- a genuinely-**unforeseen** architectural fork.

Front-loading the gate is what keeps these rare. On a slice **failure** (tests
won't pass, a blocking finding, a conflict needing a real decision): **stop**, do
**not** auto-revert the slices already completed, report the partial state, and if
later slices depended on the failed one, skip them and say so. A half-finished set
is reported as half-finished, never packaged as whole.

**Finishing a multi-slice set.** Once the slices are done, the set still has to
land as a whole — and this is where `local` and `request` diverge:

- **`request`** — the per-slice change requests have stacked on the feature
  branch; now open and drive the final `feature → base` change request through the
  forge driver (`hcb-dev:github-pr-workflow` on GitHub), with the gate's
  `merge-strategy` and `merge-auth`. This is **completion, not an offer** —
  request mode was chosen, so the integration change request is driven like any
  other, or the set's work is left stranded on the feature branch.
- **`local`** — the slices are already merged into the feature branch, so there is
  nothing left to drive; Phase 3 makes the whole-feature offer.

A single-slice set has no feature branch and no integration step — the one slice
completed straight onto the base in Phase 2.

## Phase 3 — Report and offers

- **The report** — [`../../references/report-format.md`](../../references/report-format.md):
  per-slice outcomes, review coverage and what stayed uncovered, incidental
  findings rated by importance (or an explicit "none").
- **After a local set** — offer, never force, **one** whole-feature
  `feature → base` change request on the feature branch. This is the consented
  exit from local mode.
- **Issues output** — the incidental findings and the follow-ups reach the user as
  proposals, per `findings.md`; `hcb-dev:issue-tracking` owns the
  tracker operations their answer authorizes. In local mode no change request
  closes the intake issue, so closing or linking it rides with that handoff or the
  issue is left stale.
- **Cleanup** — a branch retires with the merge that landed it
  ([`../../references/branch-retirement.md`](../../references/branch-retirement.md)),
  so what a run leaves is the worktrees, the older residue, and any local branch no
  merge took or retirement kept standing: point at `/hcb-dev:git-cleanup` (it is
  manual-only; suggest, don't run it).

## Reference files

- [`../../references/slice-completion.md`](../../references/slice-completion.md) —
  read before Phase 2's handoff.
- [`../../references/architecture-decisions.md`](../../references/architecture-decisions.md)
  — read before Phase 1.
- [`../../references/report-format.md`](../../references/report-format.md) — the
  Phase 3 report shape.
- [`../../references/findings.md`](../../references/findings.md) — read
  before Phase 2's development, and again before Phase 3's issues output.
- [`../../references/issue-currency.md`](../../references/issue-currency.md) —
  read at Phase 0, before anything is built on an issue.
- [`../../references/base-resolution.md`](../../references/base-resolution.md) —
  read before Phase 0's refresh and Phase 2's cut.
- [`../../references/branch-naming.md`](../../references/branch-naming.md) — read
  before Phase 1's branch layout and Phase 2's cut.
- [`../../references/forge-docs.md`](../../references/forge-docs.md) — read before
  reading a task out of an issue or writing any `gh` / `glab` invocation.
- [`../../references/session-naming.md`](../../references/session-naming.md) —
  read at Phase 0's intake, and again once Phase 1's scope is settled.
