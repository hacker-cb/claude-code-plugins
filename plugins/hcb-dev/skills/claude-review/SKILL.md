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
  # Empty covers both an unknown ref and no shared history, and the two are not
  # told apart here — unguarded either reaches the count and the target as a blank.
  MERGE_BASE="$(git merge-base "$BASE" HEAD)" || MERGE_BASE=""
  [ -n "$MERGE_BASE" ] \
    || { echo "claude review failed: $BASE is unusable as a base — unknown ref, or no history shared with HEAD"; exit 1; }
  TARGET="$MERGE_BASE...HEAD"
  COVERED=$(git diff --name-only "$MERGE_BASE...HEAD" | wc -l | tr -d ' ')
  OUTSIDE=$(git status --porcelain --untracked-files=all | wc -l | tr -d ' ')
else
  # No range exists for "the working tree", so this one target IS prose — and the
  # run may set prose aside and diff its own default range instead, which is why
  # the warning below calls the scope unfixed rather than merely baseless.
  TARGET="only the uncommitted changes in the working tree, not any commit"
  # What `git diff` shows, which is what the review reads — never `git status`,
  # which counts untracked files no diff shows (§1's reference).
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
  --allowedTools "Read,Grep,Glob,Agent,Bash(git diff *),Bash(git log *),Bash(git show *),Bash(git status *),Bash(git rev-parse *),Bash(git merge-base *),Bash(git ls-files *),Bash(git blame *)" \
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
  # envelope at all, stderr when the process itself failed. Capture the first and
  # fall back on emptiness, not on `jq`'s exit status — valid JSON missing every
  # field exits 0 printing nothing, and that silence is the case worth catching.
  echo "claude review failed:"
  DIAG=$(jq -r '[.subtype, .result,
                 ((.permission_denials // []) | if length > 0 then tostring else empty end)]
                | map(select(. != null and . != "")) | .[]' "$OUT" 2>/dev/null)
  if [ -n "$DIAG" ]; then printf '%s\n' "$DIAG"; else head -c 500 "$OUT"; fi
  tail -20 "$OUT.log"
fi
```

Where there is a base the target is a **ref range**, which fixes what the run
diffs; prose is read as advice it may set aside. The narrowing rides after the
range, separated, so it cannot be mistaken for the target. A working-tree review
has no range to give, so its scope stays advisory, and §1's reference says what an
advisory scope costs the coverage record.

Pass `description: "Claude review"` on the `Bash` call so the run is recognizable
in the task list.

## 3. Hand back the findings

The block prints its `scope:` line, any `coverage-warning:` lines, and then the
review — §1's reference owns how all three are read back.

Two things are this engine's own:

- A `run warnings:` block means the run printed to stderr while still succeeding.
  An unrecognized flag *value* degrades there rather than failing, so read it
  before trusting the level the scope line claims.
- A missing CLI, an expired login and a non-repository all land in the
  `claude review failed:` branch, where the diagnosis is whichever of the envelope,
  stdout or stderr carried it.
