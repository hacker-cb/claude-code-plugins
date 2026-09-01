---
name: codex-review
description: >-
  Run a code review with Codex — OpenAI's coding agent — over the current
  branch, using its own non-interactive reviewer (`codex exec review`). Use when
  the user or a pipeline asks for a "codex review", or wants a second opinion on
  a change from an engine other than Claude. Review-only: returns Codex's
  findings verbatim and never fixes anything. Invoke deliberately, when asked —
  not as an auto-trigger on every change.
---

# Codex review

`codex exec review` is Codex's built-in reviewer, running non-interactively in a
read-only sandbox. It needs `codex` on `PATH` and a live `codex login`.

This skill is **review-only**. Never fix what it reports — return the findings
and let the caller decide.

## 1. Before launching

[`../../references/review-runs.md`](../../references/review-runs.md) owns what
every detached review shares: resolving the base, the untracked files no diff
shows, launching in the background, and the coverage record the run hands back.
Read it first — the sections below carry only what is this engine's own.

What that base buys here: `--base` diffs `merge-base(base, HEAD)` against the
**working tree**, so a single pass covers the branch's commits *and* uncommitted
edits to tracked files. Handed no base, §2 reviews `--uncommitted` instead —
staged, unstaged and untracked — which is the one mode that does see untracked
files, and covers no committed work.

## 2. Run it

The run is one command, and everything it needs arrives as a flag:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/codex-review/scripts/codex-review.sh" \
  --base "<the ref resolved in §1 — drop the flag entirely for a working-tree review>" \
  --model "<the model the caller named — drop the flag to take the catalog's newest>" \
  --effort "<the level the caller named — drop the flag to take xhigh, or the model's highest>"
```

A caller — a person or another skill — may hand you the base, the model or the
effort level; each is meant to be passed in, and an explicit one wins over what
the script resolves. The model and its ladder come from the catalog on every run,
never from memory and never from `~/.codex/config.toml`, which differs from
machine to machine.

## 3. Hand back the findings

The script prints its `scope:` line, any `coverage-warning:` lines, and then Codex's
report — §1's reference owns how all three are read back. The report's shape is a
one-paragraph verdict followed by findings:

```text
- [P1] Short title — /abs/path/file.js:12-14
  Why it breaks, in concrete terms.
```

Every failure lands in a `codex review failed:` branch carrying the engine's own
error — the catalog's when the run never reached the reviewer, the log tail when
it did and came back with nothing.
