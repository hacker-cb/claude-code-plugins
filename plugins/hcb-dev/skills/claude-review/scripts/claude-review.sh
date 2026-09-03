#!/usr/bin/env bash
# Runs Claude Code's own reviewer over a range, and prints the coverage record the
# caller compares against, then the review. Invoked by the claude-review skill;
# every value it needs arrives as a flag, so the call site stays one plain command.
#
# Usage: claude-review.sh [--base <ref>] [--level <rung>] [--model <name>] [--narrow <prose>]
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
# another model says so, and a deployment that does not carry this family falls back
# rather than failing every run — the fallback is passed below, and the scope line
# reports whichever model actually answered, so a fallback is never silent.
MODEL="opus"
# A family, like the one above, not a version: the CLI resolves it, and a run on a
# deployment entitled to neither still fails — visibly, in the branch that names the
# engine's own words.
FALLBACK="sonnet"

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
# The model reaches an argv slot of its own rather than that string, so nothing it
# holds is parsed as a flag — the guard is here because a value that looks like one
# is a caller error worth naming rather than passing on, and because the slot it
# lands in is one flag away from the ones above.
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
# The run publishes its own pid below, so a caller can stop it — and stopping it must
# stop the engine too. On EXIT alone the temp files went and the child lived on,
# spending an account's quota on a review whose output nobody could read any more.
ENGINE_PID=""
stop_engine() {
  [ -z "$ENGINE_PID" ] || kill "$ENGINE_PID" 2>/dev/null || true
}
trap 'stop_engine; rm -f "$OUT" "$OUT.log"' EXIT
trap 'stop_engine; rm -f "$OUT" "$OUT.log"; exit 130' INT
trap 'stop_engine; rm -f "$OUT" "$OUT.log"; exit 143' TERM
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
  # One `hash-object` for every untracked file, not one process per file: this runs
  # twice per review, and spawning it per path put minutes into a tree that merely
  # has an un-ignored build directory in it.
  git ls-files --others --exclude-standard -z \
    | tr '\0' '\n' \
    | { paths=$(cat); [ -z "$paths" ] || { printf '%s\n' "$paths"
        printf '%s\n' "$paths" | git hash-object --stdin-paths; }; }
}
# Positional parameters, not an interpolated string: a fallback naming the family
# already requested is not a fallback, and dropping the flag is what says so.
# Everything the flag parsing above read is consumed by now, so `$@` is free.
set -- --model "$MODEL"
[ "$FALLBACK" = "$MODEL" ] || set -- "$@" --fallback-model "$FALLBACK"
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
  "$@" --effort "$LEVEL" --output-format json \
  --permission-mode auto \
  --settings "$SETTINGS" \
  --tools "Bash,Read,Grep,Glob,Agent" \
  --allowedTools "Read,Grep,Glob,Agent,Bash(git diff *),Bash(git log *),Bash(git show *),Bash(git status *),Bash(git rev-parse *),Bash(git merge-base *),Bash(git ls-files *),Bash(git blame *)" \
  --disallowedTools "mcp__*,Edit,Write,NotebookEdit" \
  < /dev/null > "$OUT" 2> "$OUT.log" &
ENGINE_PID=$!
wait "$ENGINE_PID"
ENGINE_PID=""

# Before the branch below, not inside it: a run that edited the tree and then died
# still edited the tree, and that is the case the warning exists for.
[ "$BEFORE" = "$(tree_state)" ] \
  || echo "tree-warning: the run edited the working tree — read git status before anything is committed"
# An envelope that was never written is its own case, and reaches none of the checks
# below: every one of them reads a field, and a file with no fields answers each the
# same way a healthy run would. Whatever the engine managed to say went to stderr.
[ -s "$OUT" ] || {
  echo "claude review failed: the run wrote no envelope"
  tail -20 "$OUT.log"; exit 1; }

RESULT=$(jq -r '.result // ""' "$OUT" 2>/dev/null) || RESULT=""
# The error subtypes have no `result` field at all — their schema carries `errors`
# instead — so without this a run that ended on its turn limit or its budget prints
# its failure line above an empty quotation. What comes from there is a diagnosis and
# never a report, which the flag below keeps the shape test from forgetting.
FROM_ERRORS=0
if [ -z "$(printf '%s' "$RESULT" | tr -d '[:space:]')" ]; then
  RESULT=$(jq -r '(.errors // []) | join("\n")' "$OUT" 2>/dev/null) || RESULT=""
  [ -z "$RESULT" ] || FROM_ERRORS=1
fi
# Lowercased for matching only — `$RESULT` prints as the engine wrote it. The same
# notice arrives capitalised in one message and not in another, and a pattern that
# tracks case would decide a caller's next move on a capital letter.
LOWER=$(printf '%s' "$RESULT" | tr '[:upper:]' '[:lower:]')
# And the same text with everything that moves a notice off its own first character
# taken off the front, because an anchor is worthless against a start that shifts.
# Three things do that, and all three are the CLI's own doing rather than the
# notice's: leading whitespace, the `API Error:` preamble it puts in front of a
# relayed refusal, and the JSON body it relays that refusal inside. The repository's
# own captured envelopes carry the second (`Failed to authenticate. API Error: 403`)
# and the third, so neither is hypothetical.
NOTICE=$RESULT
case "$LOWER" in
  *"api error:"*)
    NOTICE=$(printf '%s' "$NOTICE" | sed -e 's/.*[Aa][Pp][Ii] [Ee]rror:[[:space:]]*//') ;;
esac
case "$NOTICE" in
  *'{'*'"message"'*)
    unwrapped=$(printf '%s' "$NOTICE" \
      | sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    [ -z "$unwrapped" ] || NOTICE=$unwrapped ;;
esac
# The status code the preamble leaves behind, then the whitespace in front of the
# sentence itself.
NOTICE=$(printf '%s' "$NOTICE" | sed -e 's/^[0-9][0-9][0-9][[:space:]]*//' \
                                    -e 's/^[[:space:]]*//' -e 's/^[·:-][[:space:]]*//')
LOWER_NOTICE=$(printf '%s' "$NOTICE" | tr '[:upper:]' '[:lower:]')
# The same text with every space gone, for the emptiness tests alone: a result of
# blanks and newlines is a run that said nothing, and `-n` on the raw string would
# call it a review with an empty body.
SAID=$(printf '%s' "$RESULT" | tr -d '[:space:]')

# Did a model say anything at all? `modelUsage` bills every call the run made — the
# main loop, each subagent, each helper — while `usage` is documented as the main
# agent loop alone. `/code-review` runs as a local slash command whose own reviewers
# work outside that loop, so `usage.output_tokens` reads 0 on every run of this
# script, a full report and a dead engine alike, and only `modelUsage` tells those
# apart. Empty means no model produced a word, which makes everything in `.result`
# the CLI's own writing: a notice, an error, never a review.
SPOKE=0
jq -e '[(.modelUsage // {})[] | .outputTokens // 0] | add // 0 | . > 0' "$OUT" >/dev/null 2>&1 && SPOKE=1
# Why the query loop ended, taken from the CLI's own closed set of reasons rather
# than from anything phrased at the point of failure. Unset is not a missing field:
# the schema states the loop was bypassed, which is what a local slash command does.
TERMINAL=$(jq -r '.terminal_reason // ""' "$OUT" 2>/dev/null) || TERMINAL=""
# The CLI sorts those reasons into failures and endings, and the split is followed
# rather than re-invented: a run stopped at its turn limit, by a hook, or by an abort
# has whatever it wrote, while a run that hit an API error or filled its context has
# nothing to stand on. Cut short is not the same as broken — the first still reports,
# under the warning below. The reasons in neither list — a deferred tool, a turn sent
# to the background, a clean finish — are endings that cost the report nothing, and
# they earn no warning.
LOOP_FAILED=0
LOOP_CUT=0
case "$TERMINAL" in
  blocking_limit|rapid_refill_breaker|prompt_too_long|image_error|model_error|api_error|\
  malformed_tool_use_exhausted|budget_exhausted|structured_output_retry_exhausted|\
  tool_deferred_unavailable|turn_setup_failed) LOOP_FAILED=1 ;;
  aborted_streaming|aborted_tools|stop_hook_prevented|hook_stopped|max_turns) LOOP_CUT=1 ;;
esac
# The HTTP status behind an API error, where the envelope carries one. It narrows
# what kind of refusal it was and never names it on its own: a rate limit is a 429
# and so is a spent allowance, while a spent balance is rejected as a plain 400, and
# an unusable login is a 401 or a 403. Which is why the branch below reads the notice
# first and falls back on the status only where the notice named no limit.
STATUS=$(jq -r '.api_error_status // ""' "$OUT" 2>/dev/null) || STATUS=""
ERRORED=0; jq -e '.is_error == true' "$OUT" >/dev/null 2>&1 && ERRORED=1

# A text that CITES a notice rather than being one: the citation is marked, and the
# CLI's own notices carry no marks. The comparison is against `$NOTICE`, after the
# JSON body has been unwrapped — a payload's own quotation marks are the CLI's, not a
# reviewer's, and reading them as a citation is what let a wrapped limit notice pass
# for a throttle.
cites_a_notice() {
  case "$NOTICE" in *'`'*|*'"'*) return 0 ;; esac
  return 1
}
# The fragments the CLI writes into its own notices and a review never writes: an
# instruction to run a command, or the phrase that precedes one. Matched anywhere,
# because a notice can open with the model's name and so reach no anchor at all.
# "Switch to another model" is deliberately absent — a review recommending a larger
# model writes exactly that sentence, and this repository's own script advises it.
says_cli_notice() {
  # A review that quotes one of these fragments marks the quotation — backticks for a
  # literal, quotation marks around a sentence — and reviews of THIS file quote them
  # constantly, since the fragments are written a few lines below. The CLI's own
  # notices carry neither mark, so their presence is what separates the two. The test
  # is against `$NOTICE`, whose JSON unwrapping has already removed the payload's own
  # quotation marks: those belong to the CLI, not to a reviewer citing it.
  cites_a_notice && return 1
  case "$LOWER_NOTICE" in
    *"requires usage credits"*|*"/model to switch models"*|*"switch models with /model"*|\
    *"run /usage-credits"*|*"required for long context"*) return 0 ;;
  esac
  return 1
}
# The openings, in one place because they are asked about from two. A notice opens
# with itself; a verdict opens with the verdict, whatever it goes on to discuss. Each
# is the notice as far as it is fixed, never the words it starts with: a review of the
# seat-type branch opens "your seat type validation is correct", and an anchor stopping
# at "your seat type" would file that as an allowance. Both spellings of the org one,
# because the CLI writes "your org is out of usage" in one message and "your
# organization is out of usage credits" in another.
says_notice_opening() {
  # Same veto as the fragments above — asymmetry between the two would mean one
  # predicate reading a citation as a notice while its neighbour reads it correctly.
  cites_a_notice && return 1
  case "$LOWER_NOTICE" in
    "you've hit your"*|"you've reached your"*|"you're out of"*|\
    "you have hit your"*|"you have reached your"*|"you are out of"*|\
    "your org is out of usage"*|"your organization is out of usage"*|\
    "your organization's usage credit cap"*|\
    "your usage allocation has been disabled"*|"your seat type doesn't include"*|\
    "your group's usage limit is set to"*|\
    "this service is disabled for your org"*|\
    "usage limit reached"*|"usage limits reached"*) return 0 ;;
  esac
  return 1
}
# The CLI announcing an error of its own, which is not a report however long it runs.
# Read off the normalised text, so the preamble it is looking for cannot be pushed
# out of reach by another preamble in front of it.
announces_an_api_error() {
  cites_a_notice && return 1
  case "$LOWER" in "api error:"*|"error: api error"*|*". api error:"*) return 0 ;; esac
  case "$LOWER_NOTICE" in "connection refused"*|"failed to authenticate"*) return 0 ;; esac
  return 1
}

# What separates a report from a notice where the fields cannot: a review at any rung
# comes back long and in several lines, and every notice these engines emit is a
# sentence or two, whatever it says. Shape, not wording.
looks_like_a_report() {
  # Bytes via `wc -c`, never `${#RESULT}`: the latter counts bytes under a C locale
  # and characters under a UTF-8 one, so the same envelope crossed the threshold on
  # one machine and not on another. And measured on the text with its whitespace
  # removed, so a wall of blank lines cannot reach the length of a report.
  [ "$(printf '%s' "$SAID" | wc -c | tr -d ' ')" -ge 400 ] || return 1
  [ "$(printf '%s\n' "$RESULT" | wc -l | tr -d ' ')" -ge 5 ]
}

# The two phrase sets, as predicates rather than branches, because the same question
# is asked from two places and a list that exists twice drifts apart. They are read
# after the verdict above, so what they pick is the answer a caller acts on — wait for
# a reset, run it again, or treat the engine as broken — and each stays narrow enough
# that a verdict reaching them by mistake is quoted rather than recorded as a limit.
says_transient() {
  case "$LOWER" in
    *"rate limit"*|*rate_limit*|*"per-minute"*|*temporarily*|*overloaded*) return 0 ;;
  esac
  return 1
}
# Certain: the notice named itself, by an opening the CLI writes or a fragment only it
# writes. Kept apart from the phrases below because this answer outranks a transient
# reading — an account limit whose sentence happens to carry "rate limit" is still an
# account limit, and running it again walks into the same wall.
says_quota_certainly() {
  says_cli_notice || says_notice_opening
}
says_quota() {
  says_quota_certainly && return 0
  cites_a_notice && return 1
  case "$LOWER" in
    # The few phrases specific enough to match anywhere. A bare "quota" is not among
    # them, nor "usage limit" alone: a review of THIS repository writes both, and
    # anything reaching this point has already failed to be a review, so a verdict
    # arriving here by some other route is quoted back rather than filed as a limit
    # nobody hit.
    *"out of usage credits"*|*"out of extra usage"*|*"usage limit reached"*|\
    *"usage limit has been reached"*|*"spend limit"*|*"credit balance"*|\
    *"usage credit cap"*|*"add funds"*|*"disabled by your admin"*|\
    *"reached your specified"*|*"usage limits"*|*"quota exceeded"*|\
    *"quota has been exceeded"*) return 0 ;;
  esac
  return 1
}

# The context filled, said in words rather than by a reason code. Read from both
# branches: an overflow that arrives as an API error is the same overflow, and the
# advice that closes it — a narrower range — is the same advice.
says_context_full() {
  cites_a_notice && return 1
  case "$LOWER_NOTICE" in
    *"too large"*|*exceeds*|*"context window"*|*"token limit"*|*"prompt is too long"*) return 0 ;;
  esac
  return 1
}
# Did a review happen? Three facts the envelope states outright — a model spoke, the
# loop did not fail, the result is not blank — and none of them is a phrase anyone has
# to keep in step with the CLI. A run that ended badly can still have written its
# report before it did, and that report is worth keeping, so shape overrides the
# verdict in the one direction where nothing is lost by it.
REVIEWED=0
if [ "$SPOKE" = 1 ] && [ "$LOOP_FAILED" = 0 ] && [ "$ERRORED" = 0 ] && [ -n "$SAID" ] \
   && [ "$FROM_ERRORS" = 0 ]; then
  REVIEWED=1
elif [ "$FROM_ERRORS" = 0 ] && looks_like_a_report; then
  # Shape rescues two runs the fields above throw away: one that wrote its report and
  # then ended badly, and one whose counters say nothing useful — the schema allows a
  # zeroed `modelUsage` on a crash and after a mid-session clear, and a report is
  # worth more than the counter that failed to record it. What it must not rescue is
  # text no model wrote — and a diagnosis out of `.errors` is exactly that, so it is
  # excluded here. An error the CLI announces, and a notice of any length, are caught
  # by the demotion below instead: one place, read by both branches.
  REVIEWED=1
fi

# The one gap the structure above cannot close, held shut by the text itself. A quota
# that runs out MID-RUN leaves every structural fact reading healthy — models were
# billed, the loop is intact, `is_error` is false — while `.result` carries the notice
# where the report belongs. The two predicates above are what catches it, and they
# match differently on purpose: an opening is anchored, because a review addresses its
# reader as "your" and "your usage of jq" is a finding, while a machine fragment is
# matched anywhere, because a notice can open with the model's own name and reach no
# anchor at all. Both are vetoed by a marked citation, which is the other half of the
# same problem: reviews of this file quote these very phrases. A miss here is the last
# fail-open left — narrow, and named in the skill rather than papered over with a
# wider match.
if [ "$REVIEWED" = 1 ]; then
  # No length bound here: what these match is the vendor's own text, and a review
  # that cites any of it marks the citation, which every predicate vetoes. A notice
  # that grows past any threshold is still a notice.
  # `says_quota` and not merely its certain half: the looser phrases are the ones an
  # org, seat or group notice arrives under, and reading them only in the exit-code
  # block left every one of those printing as a review. The other two say the same
  # thing about a different refusal — a filled context, an error the CLI announces —
  # and a refusal is not a report whichever of the three names it.
  if says_quota || says_context_full || announces_an_api_error; then REVIEWED=0; fi
fi

# Everything below decides what a caller should DO about a run that did not review.
# Whether coverage happened is settled above and never revisited here.
fail() {
  echo "claude review failed:"
  # Nothing to quote means the envelope is the only diagnosis there is, and stderr is
  # routinely empty in exactly that case. Here rather than in one branch of one
  # helper: every path that reports a failure can arrive with an empty result.
  if [ -n "$SAID" ]; then printf '%s\n' "$RESULT"; else head -c 500 "$OUT"; echo; fi
  [ "$#" -eq 0 ] || printf '%s\n' "$1"
  tail -20 "$OUT.log"
  exit 1
}
# A refusal that named nothing still refused: the caller is told which limit it was
# where the engine said so, and told that it did not where the engine kept silent —
# never handed a bare colon beneath a line that asks them to read the notice.
unavailable() {
  if [ -n "$SAID" ]
    then printf 'claude review unavailable: %s\n' "$RESULT"
    else printf '%s\n' "claude review unavailable: the run was refused for a limit it did not name"; fi
  exit 3
}
# Where the loop never ran, the envelope has no reason to give and no status to read:
# an error raised inside a local slash command leaves `is_error` false and
# `terminal_reason` unset, exactly as a healthy review does. Phrases are the last
# thing left, and they are reached only here — under a verdict already made, where
# the worst a miss costs is `failed:` in place of `unavailable:`.
diagnose_by_words() {
  # A notice that named itself comes first of all, outranking a transient reading of
  # words it happens to contain.
  says_quota_certainly && unavailable
  # Then transient, ahead of the looser quota phrases: one of these notices denies
  # being a usage limit in a sentence that contains the words, and the phrase list
  # would take it.
  says_transient && fail "(transient — re-running the same command is the fix)"
  says_context_full && fail "(the range does not fit — narrow it, or review it in parts)"
  says_quota && unavailable
  [ -n "$SAID" ] || fail "(the run ended without producing anything)"
  if [ -n "$TERMINAL" ] && [ "$TERMINAL" != completed ]
    then fail "(the run ended on $TERMINAL before it could report)"
    else fail; fi
}

if [ "$REVIEWED" = 0 ]; then
  case "$TERMINAL" in
    # The loop ran and the API refused it. The status narrows what kind of refusal
    # that was, but it does not name it on its own: a spent balance arrives as a 400
    # like any other rejected request, so the notice is read first and the status
    # only advises where it said nothing about a limit.
    api_error)
      # Same order as the words-only path: a notice that named itself, then transient,
      # then the looser phrases. Transient first would send a real account limit —
      # whose sentence often carries "rate limit" — back into the same wall, and the
      # loose phrases first would take a throttle that denies being a limit in words
      # containing one.
      says_quota_certainly && unavailable
      says_transient && fail "(transient — re-running the same command is the fix)"
      says_quota && unavailable
      says_context_full && fail "(the range does not fit — narrow it, or review it in parts)"
      case "$STATUS" in
        # A 429 the notice did not explain is ordinary throttling as readily as a
        # spent allowance — "Too Many Requests" and an empty body reach here — and
        # the two errors are not equally cheap: a caller told to retry loses a
        # minute, one told the reviewer is gone drops it from the coverage.
        429) fail "(transient — re-running the same command is the fix)" ;;
        401|403) fail "(the login this run inherited is not usable — check the CLI's own auth)" ;;
        400) fail "(the request was rejected — a range too large for the model is the usual cause)" ;;
        5??) fail "(the API was unavailable — re-running the same command is the fix)" ;;
        *) fail ;;
      esac ;;
    # The context filled, by any of the three names the CLI has for it. Waiting never
    # closes this one — but the notice is read first all the same: the CLI files a
    # spent allowance under `blocking_limit` too, and telling its caller to narrow the
    # range is both wrong and unactionable.
    blocking_limit|prompt_too_long|rapid_refill_breaker)
      says_quota && unavailable
      says_transient && fail "(transient — re-running the same command is the fix)"
      fail "(the range does not fit the context — narrow it, or review it in parts)" ;;
    # Everything else: the loop was bypassed, ended clean, or stopped short without
    # failing, and in each case the notice is all there is to go on.
    *) diagnose_by_words ;;
  esac
fi

# Past the branch above, a review happened.
# The model asked for, not one picked out of the bill: `modelUsage` aggregates the
# main loop with every subagent and helper call, and nothing in the envelope ties a
# model to the result — so naming the biggest spender would assert what cannot be
# read. What the bill can say is that the family asked for is not on it, which is
# the case worth a line.
echo "scope: ${BASE:-working tree}, $COVERED files, $MODEL at $LEVEL"
BILLED=$(jq -r '(.modelUsage // {}) | keys | join("+")' "$OUT" 2>/dev/null) || BILLED=""
case "${BILLED:-none}" in
  none|*"$MODEL"*) ;;
  *) echo "run-warning: no $MODEL among the models billed ($BILLED) — the fallback may have answered" ;;
esac
# SEPARATE lines, never appended to the scope one.
[ -n "$BASE" ] \
  || echo "coverage-warning: no base — the commits are NOT reviewed, and with no range to pin it the run may have read them anyway"
[ "$OUTSIDE" = 0 ] \
  || echo "coverage-warning: $OUTSIDE $OUTSIDE_NOTE"
# A coverage line, not a run one: a report salvaged from a run that ended badly can be
# cut off mid-finding, and nothing in it says where it stopped — a review has no syntax
# to check completeness against. What the caller can act on is knowing the count above
# describes the range handed in rather than how far the report got. A failed loop is
# not the only way to get here: a run cut off at its turn limit or by a hook stops
# just as mid-sentence, and a run that merely deferred a tool did not stop at all.
if [ "$ERRORED" = 1 ] || [ "$LOOP_FAILED" = 1 ] || [ "$LOOP_CUT" = 1 ]; then
  echo "coverage-warning: the run did not finish cleanly and its report may be cut short — the findings stand, the count may not"
fi
# Its own line too, and not a coverage one: this says what the run DID, not what it
# read. The count above was taken before the run and stops describing the tree here.
# A denial does not void the run — it narrows it, and a narrowed run is partial.
# The fallback keeps a failed count from printing a warning with a blank number.
DENIED=$(jq -r '(.permission_denials // []) | length' "$OUT" 2>/dev/null) || DENIED=0
[ "${DENIED:-0}" = 0 ] \
  || echo "coverage-warning: $DENIED tool call(s) were denied — the run read less than the range"
printf '%s\n' "$RESULT"
# `if`, not `[ … ] && { … }`: as the last command of the branch that form exits
# non-zero whenever stderr was empty, marking every clean review as a failure.
if [ -s "$OUT.log" ]; then echo "run warnings:"; cat "$OUT.log"; fi
# The generic failure branch is gone: every path that is not a review now exits above,
# under the reason it exits for. What used to reach here without one — an envelope
# with no fields, a body that was not an envelope at all — is the "" arm and the
# no-envelope guard.
