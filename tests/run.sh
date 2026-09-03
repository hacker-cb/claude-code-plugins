#!/usr/bin/env bash
# Runs the review scripts against saved envelopes and checks what each one reports.
#
# The engines these scripts drive cost money, take minutes and answer differently
# every time, so what is tested here is the part that must not vary: how a run's
# envelope is classified into a review, a failure, or a reviewer that could not run.
# A stub on PATH plays the CLI and prints the envelope the case names.
#
# Usage: bash tests/run.sh [name-fragment ...]   # no arguments runs every case

set -u

ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
TESTS="$ROOT/tests"
SCRIPT="$ROOT/plugins/hcb-dev/skills/claude-review/scripts/claude-review.sh"
MANIFEST="$TESTS/cases/claude-review.tsv"

command -v jq >/dev/null 2>&1 || { echo "tests need jq on PATH"; exit 1; }
[ -f "$SCRIPT" ] || { echo "not found: $SCRIPT"; exit 1; }

# The base is `HEAD` on purpose: the range is empty, so the run needs no history
# beyond the checkout it is in — a shallow CI clone included — and the count the
# record prints is not what these cases are about.
BASE=HEAD

# What each status must say for itself. A case that ends on the right number
# through the wrong branch says the wrong thing, and that is worth failing.
line_for() {
  case "$1" in
    0) echo "scope:" ;;
    1) echo "claude review failed:" ;;
    3) echo "claude review unavailable:" ;;
  esac
}

pass=0 fail=0 skipped=0
while IFS=$(printf '\t') read -r fixture want note; do
  case "${fixture:-}" in ''|'#'*) continue ;; esac
  if [ "$#" -gt 0 ]; then
    matched=0
    for want_name in "$@"; do
      case "$fixture" in *"$want_name"*) matched=1 ;; esac
    done
    [ "$matched" = 1 ] || { skipped=$((skipped + 1)); continue; }
  fi

  envelope="$TESTS/fixtures/claude-review/$fixture.json"
  [ -f "$envelope" ] || {
    printf 'MISSING  %-34s no fixture at %s\n' "$fixture" "$envelope"
    fail=$((fail + 1)); continue; }

  # stdin closed: the manifest is this loop's stdin, and a run that read from it
  # would swallow the remaining cases.
  out=$(STUB_ENVELOPE="$envelope" PATH="$TESTS/stub:$PATH" \
        bash "$SCRIPT" --base "$BASE" --level low 2>&1 </dev/null)
  got=$?

  if [ "$got" != "$want" ]; then
    printf 'FAIL     %-34s exit %s, wanted %s — %s\n' "$fixture" "$got" "$want" "$note"
    printf '         %s\n' "$(printf '%s' "$out" | grep -v '^started:' | head -1)"
    fail=$((fail + 1)); continue
  fi
  expected_line=$(line_for "$want")
  case "$out" in
    *"$expected_line"*) pass=$((pass + 1)) ;;
    *)
      printf 'FAIL     %-34s exit %s but never printed "%s" — %s\n' \
        "$fixture" "$got" "$expected_line" "$note"
      fail=$((fail + 1)) ;;
  esac
done < "$MANIFEST"

[ "$skipped" = 0 ] && printf '\n%s passed, %s failed\n' "$pass" "$fail" \
                   || printf '\n%s passed, %s failed, %s not selected\n' "$pass" "$fail" "$skipped"
[ "$fail" = 0 ]
