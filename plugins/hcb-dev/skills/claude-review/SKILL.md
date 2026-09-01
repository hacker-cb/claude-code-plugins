---
name: claude-review
description: >-
  Run a code review with Claude's own reviewer, in a separate headless session
  (`claude -p "/code-review …"`), over a range and at an effort level the caller
  fixes. Use when `hcb-dev:multi-review` runs this reviewer; when a pipeline, a
  batch worker or a subagent needs a review pinned to a range handed in and a
  coverage record handed back; or when the user asks for a cheaper, faster pass
  than the interactive command's full fan-out. Review-only: returns the findings
  verbatim and never fixes anything. For one change reviewed by several
  independent reviewers at once, use `hcb-dev:multi-review` instead. Invoke
  deliberately, when asked — not as an auto-trigger on every change.
---

# Claude review

`claude -p "/code-review …"` runs Claude Code's own reviewer in a fresh headless
session, reachable from anywhere `Bash` is, and scoped by the range it is handed
rather than by what the calling session takes the change to be.

This skill is **review-only**. Never fix what it reports — return the findings
and let the caller decide.

## 1. Before launching

[`../../references/review-runs.md`](../../references/review-runs.md) owns what
every detached review shares: resolving the base, the untracked files no diff
shows, launching in the background, and the coverage record the run hands back.
Read it first — the sections below carry only what is this engine's own.

What that base buys here: §2 hands the review the range
`merge-base(base, HEAD)...HEAD` — **the branch's commits, and nothing
uncommitted**. Whatever is not committed is named as uncovered instead, so
committing before the run is what puts it under review.

## 2. Run it

The run is one command, and everything it needs arrives as a flag:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/claude-review/scripts/claude-review.sh" \
  --base "<the ref resolved in §1 — drop the flag entirely for a working-tree review>" \
  --level "<the rung the caller named, or medium>" \
  --narrow "<a path, or a focus such as 'only error handling' — drop the flag for none>"
```

Start at `medium`. A caller — a person or another skill — may hand you the base,
the level or a narrowing; an explicit one wins over anything resolved here.

Where there is a base the script targets a **ref range**, which fixes what the run
diffs; a working-tree review has no range to give, so its scope stays prose the run
may set aside, and §1's reference says what an advisory scope costs the coverage
record.

## 3. Hand back the findings

The script prints its `scope:` line, any `coverage-warning:` lines, and then the
review — §1's reference owns how all three are read back.

Three things are this engine's own:

- A `tree-warning:` line means the run edited the tree it was reviewing — a probe
  left standing, or a fix applied against this skill's promise. The findings still
  hold; what stops holding is that the change about to be shipped is the change that
  was reviewed. Hand the line to the caller with them, and undo nothing yourself.
  Its absence proves less than its presence: what the repository ignores is outside
  the comparison, so a build directory rewritten under it stays unreported.
- A `run warnings:` block means the run printed to stderr while still succeeding —
  a degradation rather than a failure, so read it before trusting what the scope
  line claims.
- A missing CLI, an expired login and a non-repository all land in the
  `claude review failed:` branch, where the diagnosis is whichever of the envelope,
  stdout or stderr carried it.
