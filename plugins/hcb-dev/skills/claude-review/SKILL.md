---
name: claude-review
description: >-
  Run a code review with Claude's own reviewer, in a separate headless session
  (`claude -p "/code-review …"`), at an effort level the caller picks. Use when
  `hcb-dev:multi-review` runs this reviewer; when a pipeline, a batch worker or a
  subagent needs a review where the interactive `/code-review` command cannot be
  reached; or when the user asks for a cheaper, faster pass than that command's
  full fan-out. Review-only: returns the findings verbatim and never fixes
  anything. For one change reviewed by several independent reviewers at once, use
  `hcb-dev:multi-review` instead. Invoke deliberately, when asked — not as an
  auto-trigger on every change.
---

# Claude review

`claude -p "/code-review …"` runs Claude Code's own reviewer in a fresh headless
session, which is reachable from anywhere `Bash` is — including a subagent, where
the interactive command and the review workflow are both out of reach.

This skill is **review-only**. Never fix what it reports — return the findings
and let the caller decide.

## 1. Pick the base

Review against a base ref. §3 hands the review the range
`merge-base(base, HEAD)...HEAD` — **the branch's commits, and nothing
uncommitted**. Whatever is not committed is named as uncovered instead, so
committing before the run is what puts it under review.

**Resolve it by the shared ladder** —
[`../../references/base-resolution.md`](../../references/base-resolution.md) owns
all of it: the rungs, which remote answers which question, and the rule that a
base sharing no history with `HEAD` is not a base.
Resolve first, then hand the result to §3.

Being on the default branch is fine: the merge-base collapses to `HEAD`, and the
range is empty — which §4 reports as covering nothing, never as a clean review.

**Handed no base, §3 reviews the working tree alone** and prints a
`coverage-warning:` line; no committed work is reviewed. §4 reports that as
partial coverage.

## 2. Check for untracked files first

The review reads `git diff`, and `git diff` never shows untracked files, so
brand-new files are silently invisible to it:

```bash
git ls-files --others --exclude-standard
```

If that lists anything belonging to the change, say so up front and offer
`git add -N <file>`, which makes them visible without staging their contents.
Don't run it yourself — touching the index is the user's call.

## 3. Run it

One rung drives two separate things, and both matter: as the command's argument
it sets how many angles hunt and how many findings come back, and as `--effort`
it sets how hard the reviewer thinks. Pass it in both places, never one — left
off `--effort`, the run inherits whatever the surrounding environment carries and
the rung silently stops controlling cost. `claude --help` lists the ladder the
flag accepts.

Start at `medium`. A caller — a person or another skill — may hand you the base,
the level or a narrowing; an explicit one wins over anything resolved here.

Fill the three values at the top of the block. Everything under them is live.

```bash
BASE="<the ref resolved in §1 — leave EMPTY for a working-tree review>"
LEVEL="<the rung the caller named, or medium>"
NARROW="<what narrows the review — a path, or a focus such as 'only error handling'; EMPTY for none>"

# Both values reach an argument string the command parses for flags — `--fix` alone
# turns a review that promises to change nothing into one that edits the tree, and
# `--comment` into one that writes to a change request. The level is checked against
# the ladder; the narrowing is prose, so `--` is refused wherever it appears, which
# covers every option the command takes without rejecting an ordinary hyphen — and
# anywhere rather than after a space, since a tab or a newline separates a word just
# as well, and a guard keyed to one separator is one the others walk past.
case "$LEVEL" in low|medium|high|xhigh|max) ;;
  *) echo "claude review failed: '$LEVEL' is not a rung"; exit 1 ;; esac
case "$NARROW" in *--*)
  echo "claude review failed: the narrowing may not contain an option"; exit 1 ;; esac

if [ -n "$BASE" ]; then
  # Empty means no shared history, which base-resolution.md refuses as a base —
  # unguarded it would reach both the count and the target as a blank.
  MERGE_BASE="$(git merge-base "$BASE" HEAD)" || MERGE_BASE=""
  [ -n "$MERGE_BASE" ] \
    || { echo "claude review failed: $BASE shares no history with HEAD"; exit 1; }
  TARGET="$MERGE_BASE...HEAD"
  COVERED=$(git diff --name-only "$MERGE_BASE...HEAD" | wc -l | tr -d ' ')
  OUTSIDE=$(git status --porcelain --untracked-files=all | wc -l | tr -d ' ')
else
  # No range exists for "the working tree", so this one target IS prose — and the
  # run may set prose aside and diff its own default range instead, which is why
  # the warning below calls the scope unfixed rather than merely baseless.
  TARGET="only the uncommitted changes in the working tree, not any commit"
  # What `git diff` shows, which is what the review reads — never `git status`,
  # which counts untracked files the review cannot see (§2).
  COVERED=$(git diff --name-only HEAD | wc -l | tr -d ' ')
  OUTSIDE=$(git ls-files --others --exclude-standard | wc -l | tr -d ' ')
fi

OUT="$(mktemp "${TMPDIR:-/tmp}/claude-review.XXXXXX")"
# --setting-sources user: the repository under review is untrusted input, and its
# own settings file carries hooks that would otherwise run as you at session start.
# stdin is closed because the run waits on it otherwise; stdout carries the JSON
# envelope, stderr its own file so a warning cannot corrupt the JSON read below.
claude -p "/code-review $LEVEL $TARGET${NARROW:+ — $NARROW}" \
  --effort "$LEVEL" --output-format json \
  --setting-sources user --permission-mode manual \
  --tools "Bash,Read,Grep,Glob,Agent" \
  --allowedTools "Read,Grep,Glob,Agent,Bash(git *)" \
  < /dev/null > "$OUT" 2> "$OUT.log"

# The coverage record the caller compares against: the range HANDED to the run.
echo "scope: ${BASE:-working tree}, $COVERED files, $LEVEL"
# SEPARATE lines, never appended to the scope one.
[ -n "$BASE" ] \
  || echo "coverage-warning: no base — the commits are NOT reviewed, and with no range to pin it the run may have read them anyway"
[ "$OUTSIDE" = 0 ] \
  || echo "coverage-warning: $OUTSIDE uncommitted path(s) are NOT reviewed — the range covers commits only"
# A successful envelope does not prove a review happened: a run killed mid-flight
# still reports success with an EMPTY result, which would print as a clean review.
if jq -e '.is_error == false and ((.result // "") | length) > 0' "$OUT" >/dev/null 2>&1; then
  # A denial does not void the run — it narrows it, and a narrowed run is partial.
  # The fallback keeps a failed count from printing a warning with a blank number.
  DENIED=$(jq -r '(.permission_denials // []) | length' "$OUT" 2>/dev/null) || DENIED=0
  [ "${DENIED:-0}" = 0 ] \
    || echo "coverage-warning: $DENIED tool call(s) were denied — the run read less than the range"
  jq -r '.result' "$OUT"
  # `if`, not `[ … ] && { … }`: as the last command of the branch that form exits
  # non-zero whenever stderr was empty, marking every clean review as a failure.
  if [ -s "$OUT.log" ]; then echo "run warnings:"; cat "$OUT.log"; fi
else
  # Three places the diagnosis can be, and the run picks which: the envelope when
  # it failed inside a successful process, stdout when what came back was not an
  # envelope at all, stderr when the process itself failed. Print all three, or a
  # non-JSON stdout leaves `jq` silent under its own redirect and nothing is said.
  echo "claude review failed:"
  jq -r '[.subtype, .result, (.permission_denials | tostring)] | map(select(. != null and . != "")) | .[]' \
    "$OUT" 2>/dev/null || head -c 500 "$OUT"
  tail -20 "$OUT.log"
fi
```

Where there is a base the target is a **ref range**, which fixes what the run
diffs; prose is read as advice it may set aside. The narrowing rides after the
range, separated, so it cannot be mistaken for the target. A working-tree review
has no range to give, so its scope stays advisory — §4 says what that costs the
coverage record.

Write the report **outside the repository under review**: a file left inside
becomes an untracked file the review then reads as part of the change.

Run it with `Bash(run_in_background: true)`, whoever asked and however small the
diff looks — read inline, the call is killed on the tool's own limit, and the
kill takes the block's `scope:` line and its `claude review failed:` branch with
it, so the run comes back as neither a review nor a named failure. Pass
`description: "Claude review"` on the `Bash` call so the run is recognizable in
the task list.

The finished task's output is the report: collect it when the task completes and
take it through §4 before answering. Detached is how it runs, not permission to
answer without it.

## 4. Hand back the findings

The block prints a `scope:` line — base, file count and level — and then the
review itself. Return the review **verbatim** — no paraphrase, no summary, no
commentary around it.

**The `scope:` line states the range handed to the run, not what it read.** The
count comes from git in this shell; the review builds its own diff from the target
and reports neither the range it used nor the files it opened. So read the findings
against the range before passing the count on: findings anchored in files outside
it, or a "no findings" verdict on a range whose files the write-up never once
names, mean the run scoped itself somewhere else. That is `partial` — say what the
count claims and what the review actually spoke about.

Check the scope line before passing either on:

- `0 files` means nothing was reviewed. Report that as coverage of zero, never as
  a clean review.
- A `coverage-warning:` line names ground the count does not cover: the working
  tree reviewed with no base, paths left uncommitted beside one, or tool calls the
  run was denied. The number and the findings are real; what the warning names is
  not among them. Report it as partial coverage and say which case it was.
- A `run warnings:` block means the run printed to stderr while still succeeding —
  an unknown flag value degrades there rather than failing, so read it before
  trusting the level in the scope line.

A missing CLI, an expired login and a non-repository all land in the
`claude review failed:` branch, where the tail names which it was. Pass that line
through as the result, the same as anything else the run refuses on, rather than
working around it.
