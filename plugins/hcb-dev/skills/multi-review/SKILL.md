---
name: multi-review
description: >-
  Review one change with several independent reviewers at once — the Codex CLI,
  the built-in code-review workflow, the built-in security review — then
  consolidate their findings and report what each one actually covered. Use when
  the user asks for a review of the current change ("прогони ревью", "review
  this", "second opinion on this diff"), and before finished work is completed —
  merged locally or handed to a change request — unless
  `hcb-dev:shipping-workflow` is already driving that handoff and calls this
  itself. Report-only: it never applies fixes; the caller decides what to do with
  them. Not an auto-trigger on every edit.
---

# Multi-review

Runs several independent reviewers over one change and returns a single write-up:
the consolidated findings, plus a line per reviewer stating what it covered. The
reviewers disagree about what "the change" even is, and that disagreement is where
coverage silently disappears — most of this skill exists to keep it visible.

Report-only. Never fix what comes back; hand findings and coverage to the caller.

## 1. Scope

**Kind.** Default is the change itself. Two variations are available on request:
narrowed (a path, or a focus such as "only error handling") and working-tree-only
("just what I changed since the last commit"). A request to audit existing code —
"look through the whole directory", "check every component" — is *not* a change:
each reviewer builds a diff and reviews nothing when that diff is empty. Say so
and stop, rather than quietly reviewing the last commit instead.

**Base.** Resolve it by the shared ladder in
[`../../references/base-resolution.md`](../../references/base-resolution.md),
which owns all of it — the rungs and their order, remote ranking, the
remote-tracking-ref form, the stale-pointer trap. Read it; don't re-derive any of
it here.

Two things this skill must not let the reference's authority hide:

- **Whatever resolves is handed to the reviewers explicitly**, and an explicit
  base wins over any resolution they would do themselves — so a lossy answer here
  is the last word, with nothing downstream to catch it.
- **Confirm the base shares history with `HEAD` before passing it on** —
  `git merge-base <base> HEAD` non-empty (the reference explains why an unrelated
  base is worse than none). Empty → don't pass it, and **don't quietly fall to
  `@{upstream}`**: on an already-pushed branch that range is near-empty, so every
  reviewer returns a small nonzero count, the zero-file check passes, and the
  coverage gate records no gap while most of the branch went unread. Say the base
  could not be resolved, review the working tree alone, and record `partial` with
  the commits left unread. If nothing resolves at all, ask before launching anyone.

**Range.** Base → working tree, so one pass covers the branch's commits together
with the uncommitted edits sitting on top of them.

**Risk** decides effort in the next step. Always name the level — never "the
middle", which lands on a different rung per reviewer.

`codex-review` starts at **`xhigh`** — it resolves its own model and ladder, so
pass a level and let it place that level; risk mostly moves it *down*.

`code-review` runs at **`high`**, always — risk never moves it. Pass `xhigh` or
`max` only where the user named one in this run, never off your own reading of
the change; what risk decides for this reviewer is whether it runs at all, in the
next step.

Treat the change as high-risk when it reaches past itself (public interface,
shared helper, config, schema, wire format), cannot be walked back (it writes,
migrates, publishes, or persists a format someone else reads), meets input whose
shape you do not control, has nothing else checking it (no tests that run, no
types, no compiler), removes a guard, an error path or a test, or touches paths
the project marks sensitive (`CLAUDE.md`, `CODEOWNERS`, `SECURITY.md`). High risk
holds `codex-review` at its start and argues for the fan-out; mechanics with no
behavior change lower the one and skip the other. An explicit instruction from
the caller wins.

**Uncommitted work.** When `git status --short` or
`git ls-files --others --exclude-standard` shows anything belonging to the change,
offer a commit before starting, and name the price of declining: Codex and
code-review read the working tree and see the edits either way, the security
review reads a commit range and does not, and files that are not tracked at all
are invisible to every reviewer. Offer — never commit anything yourself. A refusal
is a fine answer; it just goes into the report.

## 2. Pick

Four questions per reviewer, in order:

- **Available?** If not, record `UNAVAILABLE` with the reason; do not launch it.
- **Applicable?** When the scope asks for something a reviewer cannot do, skip it
  with a recorded reason — `n/a`.
- **Worth its cost on this change?** They do not cost the same, and the expensive
  one is not owed a run just for existing — see *What each run costs* below. A
  skip here is `n/a` with the reason in its row, same as any other.
- **At what level?** Pass the level Scope fixed for that reviewer explicitly —
  never a machine-local default, since this skill runs on other people's
  machines.

| Reviewer | Available when | Reads | Narrowing | Ladder |
|---|---|---|---|---|
| `hcb-dev:codex-review` skill | `command -v codex` | base → working tree | yes, expressed in prose | whatever the resolved model declares — it reads its own from the catalog |
| `code-review` workflow | the `Workflow` tool exists | `@{upstream}...HEAD` plus `git diff HEAD` unless given a target | yes, as a target argument | `high` — `xhigh` / `max` only where the user names one |
| `security-review` skill | the skill is in your skill list | commits only; base pinned to the default branch | no | none |

What that decides in practice: the security review goes `n/a` on a narrowed or
working-tree-only scope, and `n/a` again where the change alters nothing that
anything executes. The code-review workflow's cheap levels are out of reach:
`low` and `medium` belong to the `/code-review` slash command, which only the
user can invoke, and an unknown level is not rejected — it silently becomes
`high`, with the word forwarded as the review target.

**That last one is your judgement about behaviour, never a list of extensions.**
Ask what now runs differently, not what the files are called. A `SKILL.md`, a
workflow, a `.sh`, a `dependabot.yml` are all instructions something obeys — this
plugin is markdown an agent executes. And prose is not automatically inert: a
credential pasted into an example, or a command a reader will copy and run, is
exactly what the security review is for. `n/a` only when the honest answer to *what
behaves differently now* is "nothing" — and say that reason in the row, since `n/a`
is the one status the coverage gate does not treat as a gap.

### What each run costs

| Reviewer | A run costs | Earns it when |
|---|---|---|
| `codex-review` | one pass by one reviewer, a minute or two | always, while it is installed — it is the floor the other two build on |
| `code-review` | a fan-out of agents, and by far the longest of the three | the change has more than one place to be wrong — it spans files that interact, or moves a convention others follow. Documentation is squarely its business: it is the only reviewer reading `CLAUDE.md` compliance |
| `security-review` | inline, plus its own filtering pass | something now executes differently (above) |

**Size is a signal, not a threshold.** Two thousand lines of regenerated fixture
hide less than twenty inside an auth check. Ask what the change could be
concealing, never how much of it there is — no line counts, no file counts. A
single self-contained edit whose whole surface fits in one reading is covered by
one pass; breadth is what the fan-out is for, so give it something wide.

## 3. Run

Start the detachable reviewers first so they overlap with the inline one.

- **codex-review** — invoke the `hcb-dev:codex-review` skill, passing the base, the
  effort level, and the fact that this is a pipeline run so it backgrounds the call.
- **code-review** — `Workflow({ name: "code-review", args: "high <base>" })`
  returns immediately and runs detached. `high` is the level unless the user
  named another in this run. Hand it the resolved base: left to
  itself it diffs `@{upstream}...HEAD`, which on an already-pushed branch is
  empty, and it would review nothing while the other two review the change. This
  skill is the explicit instruction authorizing that call.
- **security-review** — invoke the skill inline, last. Do not delegate it to a
  subagent to save context: subagents have neither the `Agent` nor the `Task`
  tool, so the skill's own filtering pass — parallel sub-tasks dropping every
  candidate below confidence 8 — silently does not run, and what comes back is
  unfiltered.

## 4. Collect

Take two things from each reviewer: what it covered — base and file count, from
that reviewer's own output — and its findings. Never carry one reviewer's count
across to another's row; a borrowed number is how a reviewer that read nothing
gets recorded as having read the change.

**Zero files covered is not a pass.** Decide it by the count, never by matching a
reviewer's wording: each phrases an empty review differently, and Codex phrases it
differently again between `--base` and `--uncommitted`.

**Less than the change is not a pass either.** A reviewer that ran against the
wrong base, or over only the committed half while the rest sat in the working
tree, covered a nonzero number of the wrong files. That is `partial`, and it
counts as a gap — say what it missed.

**A nonzero count can still mean the commits went unread.** `codex-review` prints
a `coverage-warning:` line when it reviewed the working tree alone; the count is
then of *those* files. Read that line as well as the number — a count that passes
the zero check under such a warning is `partial`, and a base is what closes it.

When a reviewer fails, quote its error instead of guessing a cause.

## 5. Consolidate

Dedup by `(file, line)` **and** by mechanism — reviewers routinely anchor one root
cause at different lines, and one bug described twice reads as two. Keep whichever
write-up carries the concrete failure scenario, and rank by severity.

## 6. Report

Coverage first, as a table — one row per reviewer, what it covered before its
verdict:

| Reviewer | Covered | Effort | Result |
|---|---|---|---|
| `codex-review` | `<base>`, 3 files | xhigh | 2 findings |
| `code-review` | `<base>`, 3 files | high | no findings |
| `security-review` | `<base>`, 1 of 3 files | — | partial: rest uncommitted |

Keep the cells short. "Covered" is always `<base>, N files`, effort gets its own
column so a level is never left implied, and "Result" is a verdict — never the
description of a finding, which belongs below the table where it can wrap freely.

Four statuses, kept apart deliberately: `UNAVAILABLE` — the reviewer could not
run; `n/a` — it was deliberately not run, and why; `nothing to review` — it ran
and covered zero files; `partial` — it ran but covered less than the change, or
the wrong range. Everything except `n/a` is a gap in coverage — with one
distinction the caller needs: a `partial` forced by a reviewer's **own structural
limit**, rather than by anything about this change, is not something anyone can
act on. The security review is the standing example: its base is pinned to the
default branch, so it is mis-scoped in every repo whose changes target `dev` or
`release/*`. Report that as `partial (structural)` with the reason, so a shipping
flow can tell it apart from a gap that is still worth closing.

Then the findings, and nothing else: no fixes, no patches, no offer to apply them.

When the change is about to be completed — merged locally or handed to a change
request — say the gaps out loud before the handoff rather than burying them under
the findings. Whoever is completing the work decides what to do about them, but a
completion with a reviewer silently missing is exactly what the coverage lines
exist to prevent.
