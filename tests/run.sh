#!/usr/bin/env bash
# Runs the review scripts against saved envelopes and checks what each one reports.
#
# The engines these scripts drive cost money, take minutes and answer differently
# every time, so what is tested here is the part that must not vary: how a run's
# envelope is classified into a review, a failure, or a reviewer that could not run,
# and what the caller is told to do about it. A stub on PATH plays the CLI.
#
# Usage: bash tests/run.sh [name-fragment ...]   # no arguments runs every case

set -u

ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
TESTS="$ROOT/tests"
SCRIPT="$ROOT/plugins/hcb-dev/skills/claude-review/scripts/claude-review.sh"
MANIFEST="$TESTS/cases/claude-review.tsv"
FIXTURES="$TESTS/fixtures/claude-review"

command -v jq >/dev/null 2>&1 || { echo "tests need jq on PATH"; exit 1; }
[ -f "$SCRIPT" ] || { echo "not found: $SCRIPT"; exit 1; }
# Without the bit, a PATH search skips the stub and finds the real CLI: the suite
# would then spend an account's quota, take minutes, and answer differently each
# run — while reporting some of it as green. Refuse instead.
[ -x "$TESTS/stub/claude" ] || {
  echo "tests/stub/claude is not executable — the real CLI would answer instead"
  exit 1; }

# The base is `HEAD` on purpose: the range is empty, so the run needs no history
# beyond the checkout it is in — a shallow CI clone included — and the count the
# record prints is not what these cases are about.
BASE=HEAD
# Fixed for the comparison in the script under test, which measures a length: that
# measurement counts bytes under a C locale and characters under a UTF-8 one, and a
# suite inheriting the caller's locale would test a different threshold per machine.
export LC_ALL=C

WORK=$(mktemp -d "${TMPDIR:-/tmp}/claude-review-tests.XXXXXX") || exit 1
trap 'rm -rf "$WORK"' EXIT INT TERM

pass=0 fail=0 skipped=0 selected=0
report_failure() {
  printf 'FAIL     %-34s %s\n' "$1" "$2"
  printf '         case: %s\n' "$3"
  fail=$((fail + 1))
}

while IFS=$(printf '\t') read -r fixture args want expect note; do
  case "${fixture:-}" in ''|'#'*) continue ;; esac
  # Every column is required. A row missing one would otherwise assert less than it
  # appears to — the empty `expect` being the dangerous one, since a substring test
  # against "" matches any output at all.
  if [ -z "${note:-}" ] || [ -z "${expect:-}" ] || [ -z "${want:-}" ] || [ -z "${args:-}" ]; then
    report_failure "${fixture}" "malformed row: five tab-separated columns are required" "${note:-}"
    continue
  fi
  if [ "$#" -gt 0 ]; then
    matched=0
    for want_name in "$@"; do
      case "$fixture" in *"$want_name"*) matched=1 ;; esac
    done
    [ "$matched" = 1 ] || { skipped=$((skipped + 1)); continue; }
  fi
  selected=$((selected + 1))

  marker="$WORK/answered"
  rm -f "$marker"
  envelope=""
  if [ "$fixture" != "-" ]; then
    envelope="$FIXTURES/$fixture.json"
    [ -f "$envelope" ] || {
      report_failure "$fixture" "no fixture at $envelope" "$note"; continue; }
  fi

  # `args` carries whatever this case adds to the invocation, so a case can pin an
  # argument guard — the only thing standing between `--narrow` and a flag that
  # would let the run edit the tree. A word shaped `NAME=value` is put in the run's
  # environment instead, which is how a case reaches the stub's optional behaviour
  # (stderr, a touched file, a non-zero exit). `-` means the standard invocation.
  extra=()
  stub_env=()
  touched=""
  if [ "$args" != "-" ]; then
    # shellcheck disable=SC2206 # deliberate: the manifest supplies separate words
    for word in $args; do
      case "$word" in
        STUB_TOUCH=repo)
          # A tree edit has to land inside the repository or the warning it is meant
          # to trigger cannot see it, so the path is made here and removed below —
          # a file left behind would be part of the next case's starting state, and
          # the case would then pass once and never again.
          touched="$ROOT/engine-probe-$$.txt"
          stub_env+=("STUB_TOUCH=$touched") ;;
        [A-Z]*=*) stub_env+=("$word") ;;
        *) extra+=("$word") ;;
      esac
    done
  fi
  out=$(env STUB_ENVELOPE="$envelope" STUB_MARKER_FILE="$marker" \
            PATH="$TESTS/stub:$PATH" ${stub_env[@]+"${stub_env[@]}"} \
            bash "$SCRIPT" --base "$BASE" --level low ${extra[@]+"${extra[@]}"} 2>&1 </dev/null)
  got=$?
  [ -z "$touched" ] || rm -f "$touched"

  if [ "$got" != "$want" ]; then
    report_failure "$fixture" "exit $got, wanted $want" "$note"
    printf '         %s\n' "$(printf '%s' "$out" | grep -v '^started:' | head -2 | tr '\n' ' ')"
    continue
  fi
  # A case naming a fixture must have been answered by the stub; one naming `-`
  # must have been refused before the engine was ever reached.
  if [ "$fixture" != "-" ] && [ ! -f "$marker" ]; then
    report_failure "$fixture" "the stub never answered — did the run reach the engine?" "$note"
    continue
  fi
  if [ "$fixture" = "-" ] && [ -f "$marker" ]; then
    report_failure "$fixture" "the engine ran, but this case must be refused before it" "$note"
    continue
  fi

  # The expectation is written out per case rather than derived from the status:
  # every failure prints the same first line, so a status implies its line and
  # checking one against the other asserts nothing. What separates the branches is
  # the advice underneath, and that is what these fragments hold.
  missing=""
  saved_ifs=$IFS
  IFS='|'
  for fragment in $expect; do
    case "$out" in *"$fragment"*) ;; *) missing="$fragment" ;; esac
  done
  IFS=$saved_ifs
  if [ -n "$missing" ]; then
    report_failure "$fixture" "exit $got as wanted, but never printed: $missing" "$note"
    continue
  fi
  pass=$((pass + 1))
done < "$MANIFEST"

if [ "$selected" = 0 ]; then
  printf '\nno case matched %s — nothing ran\n' "$*"
  exit 1
fi
if [ "$skipped" = 0 ]; then
  printf '\n%s passed, %s failed\n' "$pass" "$fail"
else
  printf '\n%s passed, %s failed, %s not selected\n' "$pass" "$fail" "$skipped"
fi
[ "$fail" = 0 ]
