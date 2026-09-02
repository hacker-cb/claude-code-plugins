#!/usr/bin/env bash
# Runs Claude Code's own reviewer over a range, and prints the coverage record the
# caller compares against, then the review. Invoked by the claude-review skill;
# every value it needs arrives as a flag, so the call site stays one plain command.
#
# Usage: claude-review.sh [--base <ref>] [--level <rung>] [--narrow <prose>]
#   --base    the ref the range starts at; omitted reviews the working tree alone
#   --level   low|medium|high|xhigh|max (default medium)
#   --model   the model to review with; omitted takes the newest Opus
#   --narrow  what narrows the review — a path, or a focus such as "only error handling"

set -u

# Named here, or its absence arrives later wearing another failure's name: the
# catalog reads as malformed, or the run envelope as an empty review.
command -v jq >/dev/null 2>&1 \
  || { echo "claude review failed: jq is not on PATH"; exit 1; }

BASE=""
LEVEL="medium"
NARROW=""
# An alias, not a version: the CLI resolves `opus` to the newest model of that
# family, so this neither ages nor needs a catalog to read — and the CLI has no
# catalog command to read one from. Opus rather than whatever the machine is set to,
# because a run inheriting a person's own model inherits that model's quota too:
# a session working on `fable` spends the quota its own review then needs, and the
# review fails on a limit that has nothing to do with the change. A caller who wants
# another model says so.
MODEL="opus"

# A flag with no value exits like any other refusal — saying so. Silent here means a
# detached run whose output file holds nothing at all, which reads as a run that
# never answered rather than one that was called wrong.
need() { [ "$2" -ge 2 ] || { echo "claude review failed: $1 needs a value"; exit 2; }; }
while [ $# -gt 0 ]; do
  case "$1" in
    --base)   need --base "$#";   BASE="$2";   shift 2 ;;
    --level)  need --level "$#";  LEVEL="$2";  shift 2 ;;
    --model)  need --model "$#";  MODEL="$2";  shift 2 ;;
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
# The model reaches the same argument string, so it takes the same guard: an alias or
# a model name carries no `--`, and anything that does is an option in disguise.
case "$MODEL" in *--*|"")
  echo "claude review failed: '$MODEL' is not a model"; exit 1 ;; esac

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

# `disableAllHooks` is what a detached run needs from this file: a `PermissionRequest`
# hook — which any enabled plugin may install, and which blocks for as long as its
# own timeout allows — meets a run with nobody to answer it, and hangs it.
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
SETTINGS="$(jq -nc --arg out "$OUT" --arg log "$OUT.log" --arg gc "$GITCOMMON" --arg gd "$GITDIR" '{
  disableAllHooks:true,
  env:{CLAUDE_CODE_RETRY_WATCHDOG:"0"},
  sandbox:{
    enabled:true, failIfUnavailable:true, allowUnsandboxedCommands:false,
    network:{strictAllowlist:true},
    filesystem:{denyWrite:([$out,$log]
      + ([$gc,$gd] | map(select(. != "") | . + "/info") | unique))}}}')" \
  || { echo "claude review failed: could not build the run settings"; exit 1; }
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
# Printed before the engine starts, and this run's only output until it finishes: the
# report below is buffered to the end, so an empty output file otherwise says both
# "never launched" and "still reading", and the caller cannot tell those apart. What
# ends the caller's wait is the record below or a failure line — never a file that
# merely stopped being empty.
echo "started: $MODEL at $LEVEL over ${BASE:-working tree}, pid $$, $(date +%H:%M:%S)"
# Settings load as they do in any session — the hooks among them switched off above,
# and everything the reviewed repository sets arriving with them, this run's own
# sandbox block included: list keys merge across sources, so what is set there is a
# floor and not a ceiling.
# What decides a call is the boundary rather than a prompt, because a prompt here has
# nobody to answer it: the sandbox runs bash inside it and approves it there, which
# is what lets the reviewer build, test and probe rather than only read; the git
# allowlist rides ahead of the classifier for the reads every review makes; and
# `auto` weighs the rest. A denial narrows the run — the coverage warning below
# reports that — and enough of them end it, which lands in the failure branch.
# The deny list is what holds this pass to reading. `--tools` reaches neither far
# enough nor deep enough on its own: it selects among the built-in tools, so the MCP
# tools of whoever runs the review stay reachable — theirs is the change request this
# run promises not to write to — and it does not reach a subagent, which carries its
# own tool set and edits the working directory under `auto` without asking. A deny
# rule holds in both places. `--strict-mcp-config` would cover the first half more
# cheaply, by starting no servers at all, but the CLI refuses it wherever an
# enterprise MCP config is present, and refuses the whole run with it.
# `CLAUDE_CODE_RETRY_WATCHDOG` is off for this run alone, whatever the settings that
# reach it say. Where the account's quota is spent, that watchdog holds the process
# until the limit resets instead of returning — which is right for an interactive
# session, whose person comes back to it, and wrong here: another session is waiting
# on this run, and hours of silence reach it as an output file that never fills,
# which reads as a hang rather than as a quota to come back to. Switched off, the
# same case arrives as the envelope below, carrying the reset time the caller can
# act on. It is set twice, in the environment and in the settings above, because
# the two are applied in an order this cannot see: measured here the environment
# wins — a run launched with the prefix reports `0` while the same run without it
# reports the settings' `1` — but a settings block applied afterwards would undo
# exactly that, and the value belongs to this run either way. Neither copy reaches
# the user's own sessions.
# stdin is closed because the run waits on it otherwise;
# stdout carries the JSON envelope, stderr its own file so a warning cannot corrupt
# the JSON read below.
CLAUDE_CODE_RETRY_WATCHDOG=0 \
claude -p "/code-review $LEVEL $TARGET${NARROW:+ — $NARROW}" \
  --model "$MODEL" --effort "$LEVEL" --output-format json \
  --permission-mode auto \
  --settings "$SETTINGS" \
  --tools "Bash,Read,Grep,Glob,Agent" \
  --allowedTools "Read,Grep,Glob,Agent,Bash(git diff *),Bash(git log *),Bash(git show *),Bash(git status *),Bash(git rev-parse *),Bash(git merge-base *),Bash(git ls-files *),Bash(git blame *)" \
  --disallowedTools "mcp__*,Edit,Write,NotebookEdit" \
  < /dev/null > "$OUT" 2> "$OUT.log"

# Before the branch below, not inside it: a run that edited the tree and then died
# still edited the tree, and that is the case the warning exists for.
[ "$BEFORE" = "$(tree_state)" ] \
  || echo "tree-warning: the run edited the working tree — read git status before anything is committed"
# A spent quota does not always arrive as an error. One class of limit comes back
# with `is_error:false` and the limit notice sitting in `.result`, which clears the
# success check below and prints as a finished review — a coverage record with a
# full file count against a run that read nothing, which is the one failure this
# whole file exists to prevent. Caught here, before that check, because everything
# after it treats the envelope as a review. Matched on the URL the CLI appends to
# these notices and on the two sentences that carry them: a bare "limit" would also
# match a review discussing one.
RESULT=$(jq -r '.result // ""' "$OUT" 2>/dev/null) || RESULT=""
case "$RESULT" in
  *cc_cli_limit_message*|*"You've hit your"*|*"You've reached your"*)
    # Not a failure of the engine, and not a review: the reset time in the notice is
    # the whole of what a caller can act on. Non-zero, so a detached run reads as
    # something other than a review — an empty verdict here is what gets mistaken
    # for a clean one.
    echo "claude review unavailable: $RESULT"
    exit 3 ;;
esac
# A successful envelope does not prove a review happened: a run killed mid-flight
# still reports success with an EMPTY result, which would print as a clean review.
if jq -e '.is_error == false and ((.result // "") | length) > 0' "$OUT" >/dev/null 2>&1; then
  # The coverage record belongs to a run that happened. Printed before the branch
  # below, it would put a file count against a run that read nothing.
  echo "scope: ${BASE:-working tree}, $COVERED files, $MODEL at $LEVEL"
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
  # `.result` leads inside the envelope, because it is the sentence a reader acts on:
  # a spent quota puts its own there while leaving `subtype` reading `success`, and
  # that word under a failure line reads as a contradiction rather than as a detail.
  echo "claude review failed:"
  DIAG=$(jq -r '[.result, .subtype,
                 ((.permission_denials // []) | if length > 0 then tostring else empty end)]
                | map(select(. != null and . != "")) | .[]' "$OUT" 2>/dev/null)
  if [ -n "$DIAG" ]; then printf '%s\n' "$DIAG"; else head -c 500 "$OUT"; fi
  tail -20 "$OUT.log"
  # Non-zero, so a detached run reads as failed rather than as a review with nothing
  # in it — the argument guards above exit non-zero for the same reason.
  exit 1
fi
