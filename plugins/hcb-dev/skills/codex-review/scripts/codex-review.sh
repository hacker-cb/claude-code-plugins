#!/usr/bin/env bash
# Runs Codex's own reviewer over a range, and prints the coverage record the caller
# compares against, then Codex's report. Invoked by the codex-review skill; every
# value it needs arrives as a flag, so the call site stays one plain command.
#
# Usage: codex-review.sh [--base <ref>] [--model <slug>] [--effort <level>]
#   --base    the ref the range starts at; omitted reviews the working tree alone
#   --model   the model to review with; omitted resolves it from the catalog
#   --effort  that model's reasoning level; omitted takes xhigh, or its highest

set -u

# Named here, or its absence arrives later wearing another failure's name: the
# catalog reads as malformed, or the run envelope as an empty review.
command -v jq >/dev/null 2>&1 \
  || { echo "codex review failed: jq is not on PATH"; exit 1; }

BASE=""
MODEL=""
EFFORT=""

# A flag with no value exits like any other refusal — saying so. Silent here means a
# detached run whose output file holds nothing at all, which reads as a run that
# never answered rather than one that was called wrong.
need() { [ "$2" -ge 2 ] || { echo "codex review failed: $1 needs a value"; exit 2; }; }
while [ $# -gt 0 ]; do
  case "$1" in
    --base)   need --base "$#";   BASE="$2";   shift 2 ;;
    --model)  need --model "$#";  MODEL="$2";  shift 2 ;;
    --effort) need --effort "$#"; EFFORT="$2"; shift 2 ;;
    *) echo "codex review failed: unknown argument '$1'"; exit 2 ;;
  esac
done

# The catalog is the only authority on both — never memory, and never
# ~/.codex/config.toml, which differs from machine to machine. Read only when
# something is left to resolve: a caller who named both has said what to run, and a
# catalog that cannot be read is then not this run's problem.
if [ -z "$MODEL" ] || [ -z "$EFFORT" ]; then
  CATLOG="$(mktemp "${TMPDIR:-/tmp}/codex-catalog.XXXXXX")" && [ -n "$CATLOG" ] \
    || { echo "codex review failed: could not create a temp file under ${TMPDIR:-/tmp}"; exit 1; }
  trap 'rm -f "$CATLOG"' EXIT
  # Its own error, not a guess at one: an old CLI without the subcommand, a broken
  # config and a permissions failure are three different diagnoses, and swallowing
  # stderr turns all three into whichever one was guessed here.
  CAT="$(codex debug models 2>"$CATLOG")" \
    || { echo "codex review failed: the model catalog is unreadable"; tail -5 "$CATLOG"; exit 1; }
  printf '%s' "$CAT" | jq -e . >/dev/null 2>&1 \
    || { echo "codex review failed: the model catalog is not the JSON this expects"; exit 1; }
  # `priority` ascends from the newest frontier model, so entry 0 is the one to
  # review with. Each failure below names its own cause: they take different fixes.
  [ -n "$MODEL" ] || MODEL="$(printf '%s' "$CAT" \
    | jq -r '[.models[] | select(.visibility=="list")] | sort_by(.priority)[0].slug // empty')"
  [ -n "$MODEL" ] \
    || { echo "codex review failed: the catalog lists no model to review with"; exit 1; }
  LEVELS="$(printf '%s' "$CAT" \
    | jq -r --arg m "$MODEL" '.models[] | select(.slug==$m) | [.supported_reasoning_levels[].effort] | join(" ")')"
  [ -n "$LEVELS" ] \
    || { echo "codex review failed: '$MODEL' has no reasoning ladder in this catalog"; exit 1; }
  if [ -z "$EFFORT" ]; then
    case " $LEVELS " in
      *" xhigh "*) EFFORT="xhigh" ;;
      # The ladder ascends, so the last entry is that model's highest.
      *) EFFORT="${LEVELS##* }" ;;
    esac
  else
    # Word-by-word, not `case " $LEVELS " in *" $EFFORT "*`: the value lands inside the
    # pattern there, so a level of `*` matches every ladder and passes validation.
    ok=0
    for l in $LEVELS; do [ "$l" = "$EFFORT" ] && ok=1; done
    [ "$ok" = 1 ] \
      || { echo "codex review failed: '$EFFORT' is not a level $MODEL offers — it has: $LEVELS"; exit 1; }
  fi
fi

# Positional parameters, not an interpolated string: the scope is two arguments
# or one, and an unquoted expansion would leave that to word-splitting.
if [ -n "$BASE" ]; then
  set -- --base "$BASE"
  # Empty covers both an unknown ref and no shared history, and the two are not
  # told apart here — unguarded either reaches the count as a blank and dies
  # there, past the point where this could name what went wrong.
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

# Written outside the repository under review: a report left inside becomes an
# untracked file the next run reads as part of the change.
OUT="$(mktemp "${TMPDIR:-/tmp}/codex-review.XXXXXX")" && [ -n "$OUT" ] \
  || { echo "codex review failed: could not create a temp file under ${TMPDIR:-/tmp}"; exit 1; }
# Widened before the guard below, or that guard's exit leaves the file it just made.
trap 'rm -f "$OUT" "$OUT.log" "${CATLOG:-}"' EXIT
# Through a variable: an empty expansion inline would leave the pattern `/*`, which
# matches every absolute path and fails every run outside a repository.
TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || TOP=""
if [ -n "$TOP" ]; then
  case "$OUT" in "$TOP"/*)
    echo "codex review failed: TMPDIR is inside the repository under review"; exit 1 ;; esac
fi
# Printed before the engine starts, and this run's only output until it finishes: the
# report below is buffered to the end, so an empty output file otherwise says both
# "never launched" and "still reading", and the caller cannot tell those apart. What
# ends the caller's wait is the record below or a failure line — never a file that
# merely stopped being empty.
echo "started: codex $MODEL at $EFFORT over ${BASE:-working tree}, pid $$, $(date +%H:%M:%S)"
# `codex exec review`, not the top-level `codex review`: the latter has no `-o`,
# which is what splits the verdict from the transcript.
# `-s read-only` states the write policy here rather than inheriting it from the
# machine's own config, which this script already refuses to trust for the model:
# a review that can edit the tree it reviews is not the review this skill promises.
# It belongs to `codex exec`, before the subcommand — `review` itself refuses it.
codex exec -s read-only review "$@" -c model="$MODEL" -c model_reasoning_effort="$EFFORT" \
  -o "$OUT" > "$OUT.log" 2>&1
if [ -s "$OUT" ]; then
  # The coverage record belongs to a run that happened. Printed before this branch,
  # it would put a file count against a run that read nothing — an expired login
  # prints the same count as a finished review.
  echo "scope: ${BASE:-working tree}, $COVERED files, $MODEL at $EFFORT"
  # SEPARATE lines, never appended to the scope one.
  [ -n "$BASE" ] \
    || echo "coverage-warning: no base — the commits on this branch are NOT reviewed"
  [ "${UNTRACKED:-0}" = 0 ] \
    || echo "coverage-warning: $UNTRACKED untracked path(s) are NOT reviewed — a diff does not show them"
  [ "${ON_BASE:-0}" = 0 ] \
    || echo "coverage-warning: HEAD is at the base — this covered the working tree, not any commit"
  cat "$OUT"
else
  echo "codex review failed:"
  tail -20 "$OUT.log"
  # Non-zero, so a detached run reads as failed rather than as a review with nothing
  # in it — the argument guards above exit non-zero for the same reason.
  exit 1
fi
