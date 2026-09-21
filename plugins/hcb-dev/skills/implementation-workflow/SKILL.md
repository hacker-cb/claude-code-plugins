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

Take one or more tasks from intake all the way to done: analysis, slicing, one planning gate, an
autonomous per-slice run, then a report. This is the front half the other skills assume has
happened — it owns the whole-set concerns (intake, slices, branch layout, the cross-slice report)
and hands each slice's completion to `hcb-dev:shipping-workflow`. It runs in the **main
conversation**, and it is a skill, not the host's workflow tool: a rule limiting workflows or
subagents to what the user or a skill asks for is met by the invocation that started it. The
completion **mode** — `local` (merge each slice into its parent, no forge) or `request` (a change
request per slice) — changes only how a slice *ends*; analysis, slicing, development and review
are identical either way. This skill elicits it once, at the gate, and threads it down; the
contract is [`../../references/slice-completion.md`](../../references/slice-completion.md)'s.
**Paths**, substituted at invocation — use verbatim: `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}`.

## Phase 0 — Analysis

- **Intake, forge-neutrally.** A task is free text from the conversation, or an issue number, or a
  mix. Read every number in one call, whole — the form
  [`../../references/issue-currency.md`](../../references/issue-currency.md) gives under "What is
  read", which resolves the forge from what answers rather than from the hostname; anything not
  spelled out here is [`../../references/forge-docs.md`](../../references/forge-docs.md)'s.
  Reading an issue is reading a *spec*: surface the actual asks and let the gate confirm scope.
- **Be findable.** Where this session opened the run, title it per
  [`../../references/session-naming.md`](../../references/session-naming.md).
- **Search the backlog for the work itself** — `hcb-dev:issue-tracking`. An issue already
  covering these tasks changes the scope; one covering part of them changes the slicing.
- **Refresh the base before reading the code against it**
  ([`../../references/base-resolution.md`](../../references/base-resolution.md)). Read against the
  refreshed ref, and keep its sha as the point these facts were read at; where the checkout cannot
  move onto it, say the tree is older and treat what the base moved past as unread.
- **Rule each issue task current, or not** — a number taken in is a claim about the tree and earns
  a verdict against the base just refreshed (`issue-currency.md`); free text from the
  conversation is the user's own ask and takes none.
- **Deep-read the codebase against the tasks** — what is affected, what is risky, where the open
  questions are.
- **Draft a slicing** into **independently reviewable slices**, each small enough to review and
  coherent enough to stand alone. **One slice is the normal case**; more than one stacks on a
  shared feature branch.
- **The lower bound (Tier 0).** Trivial work — one slice, no architectural decisions, a couple of
  files — skips the gate and this whole orchestration: make the edit and hand it to
  `hcb-dev:shipping-workflow`. A verdict of anything but `current` is never trivial, whatever edit
  it implies: it carries a fork, and a fork is the gate. Skipping the gate skips the **asking**,
  never the **threading** — settlements the invocation carried travel on exactly as they arrived,
  what none carried `slice-completion.md`'s ladders settle downstream, and nothing was approved
  here, so no approval is what those ladders read.

## Phase 1 — The planning gate

The one interactive point, in the weight the tier table below gives it. Where the plan goes out
as a message of its own, `## The plan` lays out the slices, the branches and each settlement
shown rather than asked ([`../../references/report-blocks.md`](../../references/report-blocks.md));
where the tier makes it a brief confirm, the forks alone stand — in the ask block either way.
Take a single approval, deciding everything foreseeable at once so Phase 2 has none left. Every fork carries a
**recommendation shown first**, and a project rule that fights good architecture gets flagged
([`../../references/architecture-decisions.md`](../../references/architecture-decisions.md)).

**A settlement the invocation carried is shown, not asked.** Where this session was started by an
order ([`../../references/order-anatomy.md`](../../references/order-anatomy.md)), its completion
mode and merge authority arrive settled: display them with the plan and act on them — re-asking
re-opens what the order closed. Everything it left open is settled here as usual.

Settle, in one gate:

- **What a non-`current` verdict changes** — the fork the rest of the plan is built on, settled
  first, the slicing shown as what the recommended answer makes (`issue-currency.md`); another
  answer re-draws the layout it invalidates before the gate closes. `hcb-dev:issue-tracking`
  writes to the tracker on the answer, never ahead of it.
- **Slice breakdown + branch layout** — a shared feature branch only for more than one slice; a
  single slice's parent is the base. Both names come from
  [`../../references/branch-naming.md`](../../references/branch-naming.md), which owns the
  layout: show them, don't ask about them.
- **Architectural / implementation forks** — the choices the code cannot answer.
- **Completion mode** — `local` or `request` (default `request` where the user is silent and
  phrasing does not decide).
- **Merge strategy** — `slice-completion.md`'s shown default, filtered in request mode to the
  repo's allowed methods.
- **Merge authorization** — `slice-completion.md`'s `merge-auth`, value and addressee both, shown
  rather than asked: `on-green` by default in both modes, the addressee the user unless an order
  above named another, and approving the plan *is* that authorization. The default-branch merge
  stays separately gated in Phase 2.
- **Coverage policy** — an **actionable** coverage gap stops the run, not waivable: a reviewer you
  did not know would go missing is what the gate exists to catch. A structural gap is noted,
  never blocking.

**Gate weight scales by tier**, so the normal case stays light.

| Tier | Work | Gate | Persistence |
|---|---|---|---|
| 0 | trivial, 1 slice, no arch forks | none (skip) — `merge-auth` falls to `slice-completion.md`'s ladder | none |
| 1 | a slice or two | a brief inline confirm | native task-list; a plan-doc where there is more than one slice |
| 2 | multi-slice, real forks | native plan mode | plan-doc under the resolved plans dir + task-list; where the work is large, shared with a team or spread over sessions, offer a forge tracking issue as well |

For anything multi-slice, **persist the plan and the captured authorizations** so a long autonomous
run survives context compaction: slice progress on the native task list, and the plan — mode, merge
authorization, strategy, Phase 0's read point, each slice's cut point as it is cut — in a durable
plan-doc under `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plans`, named per `session-naming.md`. Where this session titled itself at
intake, the approved scope is what that title settles on (`session-naming.md`'s second step).

## Phase 2 — Autonomous execution

Per slice, **in order** — slices stack and depend on each other:

1. **Cut the slice branch from the current tip of its parent** — the feature branch, or the base for
   a single slice — not all up front, so a later slice sees the ones below it and conflicts less.
   Where that parent is the base, refresh it again and take the cut point from `base-resolution.md`'s
   table. The feature branch is cut once, before the first slice, and in `request` mode published
   then; **before each later slice, bring it current** per
   [`../../references/feature-branch.md`](../../references/feature-branch.md). **Before every cut,
   read what the base brought** ([`../../references/base-delta.md`](../../references/base-delta.md);
   the first, from Phase 0's read point): a slice it already built or reshaped is a fork, not a cut.
   Cut under the name the gate showed, and record the cut point in the plan-doc.
2. **Develop the slice** — the normal coding work; `dependency-versions` and `seeding-gitignore`
   apply as always. What the work turns up goes through
   [`../../references/findings.md`](../../references/findings.md) as it is noticed, here rather
   than at Phase 3 — what that test turns down still rides the slice's `incidental` output onward.
3. **Hand the finished slice to `hcb-dev:shipping-workflow`**, threading the completion signals as
   invocation prose: `mode`, `parent`, `diff-base` (the commit this slice was cut from — only the
   orchestrator knows it), `merge-strategy`, `merge-auth` with its addressee, and `issues`, the
   ones this slice alone settles.

**Autonomy is "no routine questions", not "never pauses".** The downstream skills' own gates are
honored, not waived: an **actionable** coverage gap; a local merge into the **default** branch, or
one that cannot be resolved as non-default; fix rounds ending with findings still open; CI that
will not go green within the driver's budget; a Critical or Important finding needing a product
decision; a genuinely-ambiguous merge strategy the gate did not settle; a git operation that
would lose work on a shared branch; a genuinely-**unforeseen** architectural fork. Front-loading
the gate keeps these rare.

On a slice **failure** — tests won't pass, a blocking finding, a conflict needing a real decision
— **stop**, do **not** auto-revert the slices already completed, report the partial state, and
skip the later slices that depended on it, saying so. A half-finished set is reported as
half-finished, never packaged as whole.

**Finishing a multi-slice set** is where the modes diverge. In `request` mode the per-slice
requests have stacked on the feature branch, and the final `feature → base` request is opened and
driven through the forge driver with the gate's `merge-strategy`, `merge-auth` and the `issues`
the set settles: **completion, not an offer** — request mode was chosen, so it is driven like any
other request or the set's work is stranded on the feature branch. In `local` mode the slices are
already merged in, nothing is left to drive, and Phase 3 makes the whole-feature offer. A
single-slice set has no feature branch and no integration step.

## Phase 3 — Report and offers

- **The report** — the final report of `report-blocks.md`, in
  [`../../references/report-format.md`](../../references/report-format.md)'s grammar.
- **After a local set** — offer, never force, **one** whole-feature `feature → base` change
  request. This is the consented exit from local mode, and being an ask it stands in the report's
  block rather than beside it.
- **Issues output** — before the report `hcb-dev:findings-pass` rules every slice's `incidental`,
  invoked through the Skill tool — except in a wave's batch, whose return carries them unruled
  (`hcb-dev:wave-worker`). Its table is `## Findings`; its `proposed:` rows and the
  follow-ups stand in `## Needs your word`. In local mode no change request closes the intake issue:
  closing or linking it rides with that handoff, or the issue is left open against landed work.
- **Cleanup** — a branch retires with the merge that landed it
  ([`../../references/branch-retirement.md`](../../references/branch-retirement.md)), so a run
  leaves the worktrees, the older residue, and any local branch no merge took: point at
  `/hcb-dev:git-cleanup` (manual-only — suggest, don't run it).

## After a restart or compaction

The plan-doc and the task list are what survived, so they are read before anything rests on memory:
the plan-doc for the gate's settlements — slices, mode, `merge-strategy`, `merge-auth` with its
addressee, Phase 0's read point, each slice's cut point — and the task list for which slice is in
flight. Then the tree is read against them, and it outranks both: for each slice the plan names, the
parent's own history says whether it landed, and in `request` mode so does its request (`gh pr list
--head <slice> --state merged`). The slice in flight stands where its branch does — cut, developed,
or handed on, and `shipping-workflow`'s committed steps are resumed past while its review is run
again, a coverage record that lived only in the lost context being no record. What the task list
says and the tree does not confirm is unknown, not done. What it stands at goes to the user
through `hcb-dev:status`, invoked through the Skill tool; a title this session gave itself stands.

## Reference files

| file | read it |
|---|---|
| [`../../references/invariants.md`](../../references/invariants.md) | once, before the first read of anything a tool, a forge or another session answers |
| [`../../references/slice-completion.md`](../../references/slice-completion.md) | at Phase 0's Tier 0 call, and before Phase 2's first cut |
| [`../../references/architecture-decisions.md`](../../references/architecture-decisions.md) | before Phase 1 |
| [`../../references/issue-currency.md`](../../references/issue-currency.md) | at Phase 0, before anything is built on an issue |
| [`../../references/base-resolution.md`](../../references/base-resolution.md) | before Phase 0's refresh and Phase 2's cut |
| [`../../references/branch-naming.md`](../../references/branch-naming.md) | before Phase 1's layout and Phase 2's cut |
| [`../../references/findings.md`](../../references/findings.md) | before Phase 2's development, and again before Phase 3's issues output |
| [`../../references/report-format.md`](../../references/report-format.md), [`../../references/report-blocks.md`](../../references/report-blocks.md) | the shape of the gate's report and Phase 3's |
| [`../../references/session-naming.md`](../../references/session-naming.md) | at Phase 0's intake, and again once Phase 1's scope is settled |
| [`../../references/forge-docs.md`](../../references/forge-docs.md) | before writing any `gh` / `glab` invocation this skill does not spell out |
