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

`codex exec review --base <ref>` takes a plain git ref and is forge-agnostic.

Use `codex exec review`, not the top-level `codex review`: the latter has no `-o`,
and the block below splits the verdict from the transcript with it.

Write the report **outside the repository under review**, per §1's reference.

Fill the three values at the top of the block — the base from §1, the model and
level from the catalog note below. Everything under them is live.

```bash
BASE="<the ref resolved in §1 — leave EMPTY for a working-tree review>"
MODEL="<top of the catalog, or the one the caller named>"
EFFORT="<xhigh, or that model's highest when it offers no xhigh>"

# Positional parameters, not an interpolated string: the scope is two arguments
# or one, and an unquoted expansion would leave that to word-splitting.
if [ -n "$BASE" ]; then
  set -- --base "$BASE"
  # Empty covers both an unknown ref and no shared history, and the two are not
  # told apart here — unguarded either reaches the count as a blank and dies
  # there, past the point where the block could name what went wrong.
  MERGE_BASE="$(git merge-base "$BASE" HEAD)" || MERGE_BASE=""
  [ -n "$MERGE_BASE" ] \
    || { echo "codex review failed: $BASE is unusable as a base — unknown ref, or no history shared with HEAD"; exit 1; }
  COVERED=$(git diff --name-only "$MERGE_BASE" | wc -l | tr -d ' ')
  # `--base` diffs, and a diff never shows untracked files — so in THIS mode they
  # are outside both the count and the review. `--uncommitted` genuinely covers
  # them, which is why the count there comes from `git status` instead.
  UNTRACKED=$(git ls-files --others --exclude-standard | wc -l | tr -d ' ')
  # Standing on the base collapses the merge-base onto HEAD: the run is then a
  # working-tree review wearing a base's scope line.
  [ "$MERGE_BASE" = "$(git rev-parse HEAD)" ] && ON_BASE=1 || ON_BASE=0
else
  set -- --uncommitted
  COVERED=$(git status --porcelain --untracked-files=all | wc -l | tr -d ' ')
  UNTRACKED=0
  ON_BASE=0
fi

OUT="$(mktemp "${TMPDIR:-/tmp}/codex-review.XXXXXX")"
codex exec review "$@" -c model="$MODEL" -c model_reasoning_effort="$EFFORT" \
  -o "$OUT" > "$OUT.log" 2>&1
# The coverage record the caller compares against.
echo "scope: ${BASE:-working tree}, $COVERED files, $MODEL at $EFFORT"
# SEPARATE lines, never appended to the scope one.
[ -n "$BASE" ] \
  || echo "coverage-warning: no base — the commits on this branch are NOT reviewed"
[ "${UNTRACKED:-0}" = 0 ] \
  || echo "coverage-warning: $UNTRACKED untracked path(s) are NOT reviewed — a diff does not show them"
[ "${ON_BASE:-0}" = 0 ] \
  || echo "coverage-warning: HEAD is at the base — this covered the working tree, not any commit"
if [ -s "$OUT" ]; then cat "$OUT"; else echo "codex review failed:"; tail -20 "$OUT.log"; fi
```

`-o` captures the verdict while the full transcript goes to the log, so stdout is
the report and nothing else. Pass `description: "Codex review"` on the `Bash`
call so the run is recognizable in the task list.

A caller — a person or another skill — may hand you the base, the model or the
effort level; each is meant to be passed in, and an explicit one wins over the
resolution here.

**Resolve the model and its ladder from the catalog on every run**, never from
memory and never from `~/.codex/config.toml`, which differs from machine to
machine. `codex debug models` prints both offline, in one call:

```bash
CAT="$(codex debug models)"
MODEL="$(printf '%s' "$CAT" | jq -r '[.models[] | select(.visibility=="list")] | sort_by(.priority)[0].slug')"
LEVELS="$(printf '%s' "$CAT" | jq -r --arg m "$MODEL" '.models[] | select(.slug==$m) | [.supported_reasoning_levels[].effort] | join(" ")')"
```

`priority` ascends from the newest frontier model, so entry 0 of that sort is the
one to review with. Take `xhigh` when `$LEVELS` offers it, otherwise that model's
highest.

## 3. Hand back the findings

The block prints its `scope:` line, any `coverage-warning:` lines, and then Codex's
report — §1's reference owns how all three are read back. The report's shape is a
one-paragraph verdict followed by findings:

```text
- [P1] Short title — /abs/path/file.js:12-14
  Why it breaks, in concrete terms.
```

A missing CLI, an expired login and a non-repository all leave `-o` empty and land
in the `codex review failed:` branch, where the log tail names which it was.
