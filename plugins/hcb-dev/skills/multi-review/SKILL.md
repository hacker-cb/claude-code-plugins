---
name: multi-review
description: >-
  Review one change with every available reviewer at once — the Codex CLI, the
  built-in code-review workflow, the built-in security review — then consolidate
  their findings and report what each one actually covered. Use when the user
  asks for a review of the current change ("прогони ревью", "review this",
  "second opinion on this diff"), and before finished work is completed — merged
  locally or handed to a change request — when no shipping flow is already driving
  that handoff — a ship in progress owns the order of steps and calls this itself.
  Report-only:
  it never applies fixes; the caller decides what to do with them. Not an
  auto-trigger on every edit.
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
[`../../references/base-resolution.md`](../../references/base-resolution.md) —
first hit wins: a base
the caller named; the change request's base; the merged-base histogram; the
default branch (`<remote>/HEAD`, verified, else `ls-remote`); `@{upstream}`. The
reference owns the mechanics — remote ranking, the remote-tracking-ref form, the
non-interactive guard, the stale-pointer trap. Read it; don't re-derive them here.

Two things this skill must not let the reference's authority hide:

- **Whatever resolves is handed to the reviewers explicitly**, and an explicit
  base wins over *their own* resolution — so a lossy answer here silently
  overrides `hcb-dev:codex-review`'s more careful ladder rather than deferring to
  it. That is exactly why the reference is shared: keep the two in step by reading
  from it, not by hand-copying a rung.
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

**Risk** decides effort in the next step. The default is `high` on every ladder —
name the level, never "the middle", which lands on a different rung per reviewer.
Raise it when the change reaches past itself (public interface, shared helper,
config, schema, wire format), cannot be walked back (it writes, migrates,
publishes, or persists a format someone else reads), meets input whose shape you
do not control, has nothing else checking it (no tests that run, no types, no
compiler), removes a guard, an error path or a test, or touches paths the project
marks sensitive (`CLAUDE.md`, `CODEOWNERS`, `SECURITY.md`). Lower it only for
mechanics with no behavior change; an explicit instruction from the caller wins.

**Uncommitted work.** When `git status --short` or
`git ls-files --others --exclude-standard` shows anything belonging to the change,
offer a commit before starting, and name the price of declining: Codex and
code-review read the working tree and see the edits either way, the security
review reads a commit range and does not, and files that are not tracked at all
are invisible to every reviewer. Offer — never commit anything yourself. A refusal
is a fine answer; it just goes into the report.

## 2. Pick

Three questions per reviewer, in order:

- **Available?** If not, record `UNAVAILABLE` with the reason; do not launch it.
- **Applicable?** When the scope asks for something a reviewer cannot do, skip it
  with a recorded reason — `n/a`.
- **How hard?** Map the risk onto that reviewer's own ladder and pass the level
  explicitly — never a machine-local default, since this skill runs on other
  people's machines.

| Reviewer | Available when | Reads | Narrowing | Ladder |
|---|---|---|---|---|
| `hcb-dev:codex-review` skill | `command -v codex` | base → working tree | yes, expressed in prose | `none` `low` `medium` `high` `xhigh` |
| `code-review` workflow | the `Workflow` tool exists | `@{upstream}...HEAD` plus `git diff HEAD` unless given a target | yes, as a target argument | `high` `xhigh` `max` |
| `security-review` skill | the skill is in your skill list | commits only; base pinned to the default branch | no | none |

What that decides in practice: the security review goes `n/a` on a narrowed or
working-tree-only scope, and is mis-scoped whenever the PR targets anything but
the default branch — report that, do not hide it. The code-review workflow is the
only reviewer checking `CLAUDE.md` compliance, and its cheap levels are out of
reach: `low` and `medium` belong to the `/code-review` slash command, which only
the user can invoke, and an unknown level is not rejected — it silently becomes
`high`, with the word forwarded as the review target. The two ladders do not line
up: `max` is Claude Code's top rung and not a Codex value, so translate rather than
reuse a word.

## 3. Run

Start the detachable reviewers first so they overlap with the inline one.

- **codex-review** — invoke the `hcb-dev:codex-review` skill, passing the base, the
  effort level, and the fact that this is a pipeline run so it backgrounds the call.
- **code-review** — `Workflow({ name: "code-review", args: "<level> <base>" })`
  returns immediately and runs detached. Hand it the resolved base: left to
  itself it diffs `@{upstream}...HEAD`, which on an already-pushed branch is
  empty, and it would review nothing while the other two review the change. This
  skill is the explicit instruction authorizing that call.
- **security-review** — invoke the skill inline, last. Do not delegate it to a
  subagent to save context: that skill's value is its own filtering pass, which
  fans out sub-tasks to drop every candidate below confidence 8, and nesting eats
  the budget that pass needs — at the three-layer limit the fan-out is gone and
  what comes back is unfiltered.

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
a separate `coverage-warning:` line when it could resolve no base, or refused one
sharing no history with `HEAD` — it then reviews the working tree alone, and the
count it reports is of *those* files. Read that line, not just the number: a count
that passes the zero check while the warning says the commits were not reviewed is
`partial`, and the base is what closes it. It is deliberately its own line rather
than a tail on the scope line, so splitting `scope:` into the `Covered` and
`Effort` columns below cannot bury the warning in the effort cell.

When a reviewer fails, quote its error instead of guessing a cause. A `401` or an
auth complaint in Codex's log means `codex login`, and one line saying so beats
twenty lines of transcript.

## 5. Consolidate

Dedup by `(file, line)` **and** by mechanism — reviewers routinely anchor one root
cause at different lines, and one bug described twice reads as two. Keep whichever
write-up carries the concrete failure scenario, and rank by severity.

## 6. Report

Coverage first, as a table — one row per reviewer, what it covered before its
verdict:

| Reviewer | Covered | Effort | Result |
|---|---|---|---|
| `codex-review` | `<base>`, 3 files | high | 2 findings |
| `code-review` | `<base>`, 3 files | high | no findings |
| `security-review` | `<base>`, 1 of 3 files | — | partial: rest uncommitted |

Keep the cells short. "Covered" is always `<base>, N files`, effort gets its own
column so a level is never left implied, and "Result" is a verdict — never the
description of a finding, which belongs below the table where it can wrap freely.
A fixed-width block pretending to be a table wraps badly in a narrow window and
the columns drift apart.

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
