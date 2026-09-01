#!/usr/bin/env bash
# Runs Claude Code's own reviewer over a range, and prints the coverage record the
# caller compares against, then the review. Invoked by the claude-review skill;
# every value it needs arrives as a flag, so the call site stays one plain command.
#
# Usage: claude-review.sh [--base <ref>] [--level <rung>] [--narrow <prose>]
#   --base    the ref the range starts at; omitted reviews the working tree alone
#   --level   low|medium|high|xhigh|max (default medium)
#   --narrow  what narrows the review — a path, or a focus such as "only error handling"

set -u

# Named here, or its absence arrives later wearing another failure's name: the
# catalog reads as malformed, or the run envelope as an empty review.
command -v jq >/dev/null 2>&1 \
  || { echo "claude review failed: jq is not on PATH"; exit 1; }

BASE=""
LEVEL="medium"
NARROW=""

# A flag with no value exits like any other refusal — saying so. Silent here means a
# detached run whose output file holds nothing at all, which reads as a run that
# never answered rather than one that was called wrong.
need() { [ "$2" -ge 2 ] || { echo "claude review failed: $1 needs a value"; exit 2; }; }
while [ $# -gt 0 ]; do
  case "$1" in
    --base)   need --base "$#";   BASE="$2";   shift 2 ;;
    --level)  need --level "$#";  LEVEL="$2";  shift 2 ;;
    --narrow) need --narrow "$#"; NARROW="$2"; shift 2 ;;
    *) echo "claude review failed: unknown argument '$1'"; exit 2 ;;
  esac
done

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
  OUTSIDE_NOTE="uncommitted path(s) are NOT reviewed — the range covers commits only"
else
  # No range exists for "the working tree", so this one target IS prose — and the
  # run may set prose aside and diff its own default range instead, which is why
  # the warning below calls the scope unfixed rather than merely baseless.
  TARGET="only the uncommitted changes in the working tree, not any commit"
  # What `git diff` shows, which is what the review reads — never `git status`,
  # which counts untracked files no diff shows.
  COVERED=$(git diff --name-only HEAD | wc -l | tr -d ' ')
  OUTSIDE=$(git ls-files --others --exclude-standard | wc -l | tr -d ' ')
  # What is uncovered here is the opposite of the based case: this mode reviews the
  # working tree, so the commits are what it misses (said below) and untracked files
  # are what the diff behind it cannot show.
  OUTSIDE_NOTE="untracked path(s) are NOT reviewed — a diff does not show them"
fi

OUT="$(mktemp "${TMPDIR:-/tmp}/claude-review.XXXXXX")" && [ -n "$OUT" ] \
  || { echo "claude review failed: could not create a temp file under ${TMPDIR:-/tmp}"; exit 1; }
# Armed before the guard below, or that guard's exit leaves the file it just made.
trap 'rm -f "$OUT" "$OUT.log"' EXIT
# The report lives outside the repository under review; inside, it becomes an
# untracked file the next run reads as part of the change. Through a variable: an
# empty expansion inline would leave the pattern `/*`, matching every absolute path.
TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || TOP=""
if [ -n "$TOP" ]; then
  case "$OUT" in "$TOP"/*)
    echo "claude review failed: TMPDIR is inside the repository under review"; exit 1 ;; esac
fi

# Where the sandbox cannot start, the CLI warns and runs unsandboxed unless
# `failIfUnavailable` says otherwise — the boundary this run promises would then be
# gone behind a warning nobody reads. `denyWrite` covers this run's own output: the
# temp directory is writable from inside the sandbox wherever `TMPDIR` is unset or
# points at a shared one, and a verdict a reviewed repository can overwrite is a
# verdict it can forge. Built with `jq`, so the paths are escaped rather than pasted.
# `info/` in both git directories rides along: `info/exclude` decides what `git
# status` shows, so a run able to write it can hide its own changes from the check
# below. The index is deliberately not denied — git rewrites it while merely reading.
GITCOMMON="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || GITCOMMON=""
GITDIR="$(git rev-parse --absolute-git-dir 2>/dev/null)" || GITDIR=""
SANDBOX="$(jq -nc --arg out "$OUT" --arg log "$OUT.log" --arg gc "$GITCOMMON" --arg gd "$GITDIR" '{sandbox:{
  enabled:true, failIfUnavailable:true, allowUnsandboxedCommands:false,
  network:{strictAllowlist:true},
  filesystem:{denyWrite:([$out,$log]
    + ([$gc,$gd] | map(select(. != "") | . + "/info") | unique))}}}')" \
  || { echo "claude review failed: could not build the sandbox settings"; exit 1; }
# What the run leaves behind, to compare against below: this pass promises to
# change nothing, and the sandbox permits writes inside the working directory.
# Content, not status codes: a file already listed as modified stays listed as
# modified however many times the run rewrites it, and a working-tree review is
# exactly where every covered file is already in that state.
# A loop, not `xargs`: an empty list must run nothing, and `git hash-object` with no
# paths reads stdin instead of exiting. Untracked content is here because neither the
# status line nor the diff carries it — the path appears identical however it changes.
tree_state() {
  # `for-each-ref`, not HEAD alone: in a linked worktree the sandbox may write to the
  # main repository's shared .git, and a moved ref there shows up nowhere else here.
  git for-each-ref --format='%(refname) %(objectname)'
  git rev-parse HEAD; git status --porcelain --untracked-files=all; git diff HEAD
  git ls-files --others --exclude-standard -z \
    | while IFS= read -r -d "" f; do printf '%s ' "$f"; git hash-object -- "$f"; done
}
BEFORE="$(tree_state)"
# --setting-sources user: the repository under review is untrusted input, and its
# own settings file carries hooks that would otherwise run as you at session start.
# The sandbox is what buys the permission mode back: sandboxed commands are approved
# by the boundary rather than by a person, and there is no person here — without it
# this mode denies every build, test and probe the reviewer reaches for, and the
# review degrades to reading. What the boundary holds shut is the network and the
# escape hatch; reading outside the tree and the environment it inherits are open
# unless the user's own settings narrow them, which is where such rules belong.
# stdin is closed because the run waits on it otherwise;
# stdout carries the JSON envelope, stderr its own file so a warning cannot corrupt
# the JSON read below.
claude -p "/code-review $LEVEL $TARGET${NARROW:+ — $NARROW}" \
  --effort "$LEVEL" --output-format json \
  --setting-sources user --permission-mode manual \
  --settings "$SANDBOX" \
  --tools "Bash,Read,Grep,Glob,Agent" \
  --allowedTools "Read,Grep,Glob,Agent,Bash(git diff *),Bash(git log *),Bash(git show *),Bash(git status *),Bash(git rev-parse *),Bash(git merge-base *),Bash(git ls-files *),Bash(git blame *)" \
  < /dev/null > "$OUT" 2> "$OUT.log"

# Before the branch below, not inside it: a run that edited the tree and then died
# still edited the tree, and that is the case the warning exists for.
[ "$BEFORE" = "$(tree_state)" ] \
  || echo "tree-warning: the run edited the working tree — read git status before anything is committed"
# A successful envelope does not prove a review happened: a run killed mid-flight
# still reports success with an EMPTY result, which would print as a clean review.
if jq -e '.is_error == false and ((.result // "") | length) > 0' "$OUT" >/dev/null 2>&1; then
  # The coverage record belongs to a run that happened. Printed before the branch
  # below, it would put a file count against a run that read nothing.
  echo "scope: ${BASE:-working tree}, $COVERED files, $LEVEL"
  # SEPARATE lines, never appended to the scope one.
  [ -n "$BASE" ] \
    || echo "coverage-warning: no base — the commits are NOT reviewed, and with no range to pin it the run may have read them anyway"
  [ "$OUTSIDE" = 0 ] \
    || echo "coverage-warning: $OUTSIDE $OUTSIDE_NOTE"
  # Its own line too, and not a coverage one: this says what the run DID, not what it
  # read. The count above was taken before the run and stops describing the tree here.
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
  # Non-zero, so a detached run reads as failed rather than as a review with nothing
  # in it — the argument guards above exit non-zero for the same reason.
  exit 1
fi
