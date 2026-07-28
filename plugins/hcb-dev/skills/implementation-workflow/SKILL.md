---
name: implementation-workflow
description: >-
  Turn one or more tasks — free-text asks from the conversation, or GitHub/GitLab
  issue/ticket numbers — into implemented, reviewed work. Use it at the START,
  when there is something to build and no code exists yet: "сделай issue #42", "do
  these three tickets", "build this spec", "implement this and open the PRs". It
  deep-reads the tasks and the codebase, splits the work into independently
  reviewable slices (one is the normal case), forks the open architectural
  questions and the completion mode (merge locally, or a change request) to you at
  one planning gate, then runs each slice through development, review, and
  completion autonomously, closing with a per-slice report that rates incidental
  findings or says there are none. Do NOT use it for work already finished that
  only needs completing — that is `hcb-dev:shipping-workflow`, which this skill
  calls per slice; nor for driving an existing PR (`hcb-dev:github-pr-workflow`);
  nor as a diff review (`hcb-dev:multi-review`).
---

# Implementation workflow

Take one or more tasks from intake all the way to done: analysis, slicing, one
planning gate, an autonomous per-slice run, then a report. This is the front half
the other skills assume has already happened — it owns the whole-set concerns
(intake, slices, branch layout, the cross-slice report) and hands each slice's
completion to `hcb-dev:shipping-workflow`. It runs in the **main conversation**;
see *Why a skill* at the end.

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
  Reading an issue is reading a *spec*, not a mandate to do everything written in
  it: surface the actual asks and let the gate confirm scope.
- **Deep-read the codebase against the tasks** — what is affected, what is risky,
  where the genuinely-open questions are.
- **Draft a slicing.** Split the work into **independently reviewable slices** — a
  slice is a chunk that can be reviewed and completed on its own. **One slice is
  the normal case.** Keep each small enough to review and coherent enough to stand
  alone; more than one stacks, each taking the previous as its base.
- **The lower bound (Tier 0).** Trivial work — one slice, no architectural
  decisions, a couple of files — skips the gate and this whole orchestration: just
  make the edit and hand it to `hcb-dev:shipping-workflow`. The gate is for work
  worth planning; a one-line fix does not earn it.

## Phase 1 — The planning gate

The one interactive point. Present the whole plan and take a single approval,
deciding everything foreseeable at once so Phase 2 has no routine questions left.
Every fork carries a **recommendation shown first**, never a bare question, and a
project rule that fights good architecture gets flagged — see
[`../../references/architecture-decisions.md`](../../references/architecture-decisions.md).

Settle, in one gate:

- **Slice breakdown + branch layout.** Name the branches per
  [`../../references/branch-naming.md`](../../references/branch-naming.md) and show
  them in the plan; they are mechanical, so present them rather than asking. More
  than one slice stacks by giving each the previous one as its base — there is no
  feature-branch machinery to set up.
- **Architectural / implementation forks** — the choices the code cannot answer.
- **Completion mode** — `local` or `request` (default `request` if the user is
  silent and phrasing does not decide).
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
| 1 | exactly one slice | a brief inline confirm | native task-list |
| 2 | two or more slices, real forks | native plan mode | plan-doc + task-list |

From Tier 2 up, **persist the plan and the captured authorizations** and **read
them back before each handoff** — `mode` and `merge-auth` are exactly what a long
run loses to compaction, and writing them down only helps if someone reads them.
Track slice progress on the native task list; keep the plan under
`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plans`, resolving the path from the variable.
Where they cannot be recovered, **stop and re-ask** rather than defaulting — a
silent default here publishes under an authorization nobody gave.

## Phase 2 — Autonomous execution

Per slice, **in order** (slices run sequentially — they stack and depend on each
other):

1. **Cut the slice branch from the current tip of its parent** — one at a time, so
   a later slice sees the ones below it and conflicts less. Cut it under the name
   the gate showed ([`../../references/branch-naming.md`](../../references/branch-naming.md)):
   naming it right at creation is free, and it makes the normalization step
   downstream (`shipping-workflow` step 0) the no-op it is meant to be.
2. **Develop the slice** — the normal coding work; `dependency-versions` and
   `seeding-gitignore` apply exactly as they always do.
3. **Verify, then hand the slice to `hcb-dev:shipping-workflow`** — run the tests,
   or exercise the behavior where there are none; its precondition is "complete and
   verified" and it does not re-check. Thread `mode`, `parent`, and `merge-auth`
   where the gate captured one.

**Autonomy is "no routine questions", not "never pauses".** The legitimate stops
remain and are honored — this skill does not waive the downstream skills' own
safety gates:

- an **actionable** coverage gap (Phase 1's non-waivable policy);
- a local merge into the **default** branch — or one it cannot resolve as
  non-default (`slice-completion.md`);
- CI that will not go green after ~5 fix iterations (`github-pr-workflow`);
- a Critical/Important finding that needs a product/design decision;
- a git operation that would lose work on a shared branch;
- a genuinely-**unforeseen** architectural fork.

Front-loading the gate is what keeps these rare. On a slice **failure** (tests
won't pass, a blocking finding, a conflict needing a real decision): **stop**, do
**not** auto-revert the slices already completed, report the partial state, and if
later slices depended on the failed one, skip them and say so. A half-finished set
is reported as half-finished, never packaged as whole.

## Phase 3 — Report and offers

- **The report** — [`../../references/report-format.md`](../../references/report-format.md):
  per-slice outcomes, review coverage and what stayed uncovered, incidental
  findings rated by importance (or an explicit "none").
- **After a local set** — offer, never force, a change request on the landed work.
  This is the consented exit from local mode.
- **Issues output** (consent-gated, mirrored `gh` / `glab`) — offer to file
  follow-up / incidental-finding issues, and to close or link the intake issue.
  In local mode there is no change request to close it, so an issue taken in by
  number is left stale unless this offer is taken.
- **Cleanup** — after a local set that left merged-but-unpushed slice branches,
  point at `/hcb-dev:git-cleanup` (it is manual-only; suggest, don't run it).

## Why a skill — not a subagent, not a Workflow

- **Not a subagent.** Subagents do not get `Workflow`, `AskUserQuestion` or
  `EnterPlanMode`. The first means `hcb-dev:multi-review` cannot fire the built-in
  `code-review` at all, so a whole reviewer disappears from the coverage table; the
  other two mean the planning gate cannot be held with the user.
- **Not a Workflow.** The gate and the emergent forks are interactive, and the
  per-slice work is judgment, not a deterministic fan-out. Workflow stays a leaf
  where it already earns its place — `multi-review` fires the built-in
  `code-review` through it — not as the top-level driver.

## Reference files

- [`../../references/slice-completion.md`](../../references/slice-completion.md) — how a slice ends, both backends; read
  before Phase 2's handoff.
- [`../../references/architecture-decisions.md`](../../references/architecture-decisions.md) — when to ask, always with a
  recommendation, and flagging rule-vs-architecture drift; read before Phase 1.
- [`../../references/report-format.md`](../../references/report-format.md) — the Phase 3 report shape.
- [`../../references/base-resolution.md`](../../references/base-resolution.md) — resolving a base and a remote without
  guessing either name; the slice parent is handed to the reviewers and to
  completion as an explicit base.
- [`../../references/branch-naming.md`](../../references/branch-naming.md) — the shape of a branch name and the
  feature/slice layout; read before Phase 1's branch layout and Phase 2's cut.
