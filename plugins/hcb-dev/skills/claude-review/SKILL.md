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
every detached review shares; read it first — below is only this engine's own.

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
  --model "<the model the caller named — drop the flag to let the script resolve one>" \
  --narrow "<a path, or a focus such as 'only error handling' — drop the flag for none>"
```

Start at `medium`. A caller — a person or another skill — may hand you the base,
the level, the model or a narrowing; an explicit one wins over anything resolved
here.

The run is read-only: its sandbox denies writes to the working tree and both git
directories, nothing outside that sandbox is approved, and the file-editing tools are
off — so it changes nothing in the repository, uncommitted work included. It still
runs commands, but a build, a test or a probe that has to write into the tree fails
there: a finding that needs one of those to settle is the calling session's to check
before acting on it. Started outside a git working tree it refuses to run.

Settings still load the way they do in any session, the repository's own among them,
so its `env` block and its `sandbox` entries reach the run as well — they can widen
what the run reads, where it connects and what it writes outside the repository, never
the repository itself — and a settings key whose value is a shell command runs where
the sandbox does not reach. Hooks are the exception, switched off whatever source they
come from, and so are MCP servers: the run starts none, since a headless run would
otherwise load the repository's own `.mcp.json` without asking and a server's command
runs outside the sandbox. Where an enterprise MCP configuration forbids that, the run
is refused rather than started carrying them, and §3's failure line says so. Reading outside the tree and the environment the run
inherits stay open unless something among those same settings narrows them. Weigh all
of it before pointing this at a repository nobody here wrote.

Where there is a base the script targets a **ref range**, which fixes what the run
diffs; a working-tree review has no range to give, so its scope stays prose the run
may set aside, and §1's reference says what an advisory scope costs the coverage
record.

## 3. Hand back the findings

The script prints a `started:` line as it launches the engine, and then nothing
until the run is done.

What is this engine's own:

- A `run warnings:` block means the run printed to stderr while still succeeding —
  a degradation rather than a failure, so read it before trusting what the scope
  line claims.
- **Every failure prints `claude review failed:`** and exits non-zero — that line,
  not an empty file, is what says the run is over.
- **A spent quota gets its own line**, `claude review unavailable:`, and exits 3.
  Read which limit the notice names; §2 takes `--model`.
- **A verdict with nothing in it is still a review.** A run that read the range and
  found nothing prints its `scope:` line like any other, with a verdict of a line or
  two beneath it, and so does one handed a working tree with nothing changed in it —
  and so does one cut short after writing it, under a warning that it may be
  incomplete. Pass the coverage it states; what a count of zero costs that coverage is
  §1's reference's to say.
- **One case the run cannot flag for you**: a limit reached partway through comes
  back where the report belongs, under a scope line that looks complete. A review
  whose entire body is a sentence about a limit or about switching models is that
  case — record the reviewer as unavailable, whatever the line above it claims.
