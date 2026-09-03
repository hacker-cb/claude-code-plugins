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
  --model "<the model the caller named — drop the flag to take the newest Opus>" \
  --narrow "<a path, or a focus such as 'only error handling' — drop the flag for none>"
```

Start at `medium`. A caller — a person or another skill — may hand you the base,
the level, the model or a narrowing; an explicit one wins over anything resolved
here.

Inside the sandbox the run executes the reviewed repository's own code — its build,
its tests, the probe that settles a finding — which is what a review at this rung is
worth and also what makes that repository's contents something you are choosing to
trust. That choice reaches past the code: settings load the way they do in any
session, the repository's own among them, so its `.mcp.json`, its `env` block and
its `sandbox` entries reach the run as well — what the run sets for itself is a
floor those entries widen, network and filesystem alike, and a settings key whose
value is a shell command runs where the sandbox does not reach. Hooks are the
exception, switched off whatever source they come from. Writes land inside the working
directory, and §3's `tree-warning:` is what that costs; reading outside the tree
and the environment the run inherits stay open unless something among those same
settings narrows them. Weigh all of it before pointing this at a repository
nobody here wrote.

Where there is a base the script targets a **ref range**, which fixes what the run
diffs; a working-tree review has no range to give, so its scope stays prose the run
may set aside, and §1's reference says what an advisory scope costs the coverage
record.

## 3. Hand back the findings

The script prints a `started:` line as it launches the engine, and then nothing
until the run is done — §1's reference says why that line is there and what it does
not mean. What a finished run prints is the `scope:` line, any `coverage-warning:`
lines, and then the review — §1's reference owns how all three are read back.

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
- **A spent quota gets its own line**, `claude review unavailable:`, and exits 3 —
  it is neither a failure of the engine nor a review. The line carries the engine's
  own notice, and **which limit it names decides what to do next**: an account limit
  gives a reset time and nothing else closes it before then, while a *model* limit
  says to switch models — and §2 takes `--model`, so rerunning on another family
  closes the gap now rather than recording one.
- **A verdict with nothing in it is still a review.** A run that read the range and
  found nothing prints its `scope:` line like any other, with a verdict of a line or
  two beneath it, and so does one handed a working tree with nothing changed in it.
  Pass the coverage it states; what a count of zero costs that coverage is §1's
  reference's to say.
- **One case the run cannot flag for you**: a limit reached partway through comes
  back where the report belongs, under a scope line that looks complete. A review
  whose entire body is a sentence about a limit or about switching models is that
  case — record the reviewer as unavailable, whatever the line above it claims.
