#!/usr/bin/env bash
# Runs every suite under tests/suites/ and checks what each one's script reports.
#
# The engines these scripts drive cost money, take minutes and answer differently
# every time, so what is tested here is the part that must not vary: how a run's
# envelope is classified into a review, a failure, or a reviewer that could not run,
# and what the caller is told to do about it. A stub on PATH plays the CLI.
#
# A suite is a directory under tests/suites/. Three of its five parts ARE that
# directory — `cases.tsv`, `fixtures/`, `stub/` — and `suite.conf` carries the two
# that no layout can express: the script under test, and the arguments and
# environment every case of that suite runs with. Nothing about any one suite is
# written in this file; adding a suite is adding a directory.
#
# Usage: bash tests/run.sh [--suite <name>]... [name-fragment ...]
#   --suite <name>   run only this suite; repeatable
#   name-fragment    run only cases whose name contains it; repeatable
#   no arguments     runs every case of every suite

set -u

ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
SUITES="$ROOT/tests/suites"

# Every script under test parses JSON by hand, and without jq each would fail in
# its own words several layers down. Say it once, here.
command -v jq >/dev/null 2>&1 || { echo "tests need jq on PATH"; exit 1; }

want_suites=()
want_names=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --suite)
      [ "$#" -ge 2 ] || { echo "--suite needs a value"; exit 1; }
      want_suites+=("$2"); shift 2 ;;
    # A mistyped flag would otherwise be taken for a case-name fragment, match
    # nothing, and report "nothing ran" as though the suite were empty.
    -*) echo "unknown argument '$1'"; exit 1 ;;
    *) want_names+=("$1"); shift ;;
  esac
done

# Directories, not suite.conf files: a suite that declares nothing is a suite that
# is broken, and finding them by their manifest would drop it from the run silently
# — a `suite.cfg` typo beside a full cases.tsv would leave the gate green over a
# script nobody tested.
all_suites=()
for suite_dir in "$SUITES"/*/; do
  [ -d "$suite_dir" ] || continue
  suite_dir=${suite_dir%/}
  all_suites+=("${suite_dir##*/}")
done
[ "${#all_suites[@]}" -gt 0 ] || {
  echo "no suite under tests/suites — a suite is a directory there holding suite.conf"
  exit 1; }

# Exact names, not fragments: a suite is selected deliberately, and a typo that
# silently ran a different suite than the one asked for is worse than a refusal.
for want in ${want_suites[@]+"${want_suites[@]}"}; do
  known=0
  for suite in "${all_suites[@]}"; do [ "$suite" = "$want" ] && known=1; done
  [ "$known" = 1 ] || {
    echo "no suite named '$want' — there is: ${all_suites[*]}"; exit 1; }
done

WORK=$(mktemp -d "${TMPDIR:-/tmp}/hcb-suite-tests.XXXXXX") || exit 1
trap 'rm -rf "$WORK"' EXIT INT TERM

pass=0 fail=0 skipped=0 selected=0
report_failure() {
  printf 'FAIL     %-46s %s\n' "$1" "$2"
  printf '         case: %s\n' "$3"
  fail=$((fail + 1))
}
# A suite that cannot be set up fails as a whole: it has no case to hang the
# failure on, and reporting it as "nothing ran" would read as green.
suite_failure() {
  printf 'FAIL     %-46s %s\n' "$1" "$2"
  fail=$((fail + 1))
}

suites_skipped=0
for suite in "${all_suites[@]}"; do
  if [ "${#want_suites[@]}" -gt 0 ]; then
    chosen=0
    for want in "${want_suites[@]}"; do [ "$suite" = "$want" ] && chosen=1; done
    # Counted, not merely skipped: the tally below is what a caller reads to decide
    # the gate is green, and a narrowed run that says nothing about what it left out
    # reads exactly like a whole one.
    [ "$chosen" = 1 ] || { suites_skipped=$((suites_skipped + 1)); continue; }
  fi

  dir="$SUITES/$suite"
  [ -f "$dir/suite.conf" ] || {
    suite_failure "$suite" "no suite.conf — the directory declares no script to run"
    continue; }

  suite_script="" suite_args="" unknown_key="" bad_env="" env_bad=0
  suite_env=()
  # `read key value` splits on the first run of whitespace and hands the rest of
  # the line to `value`, so `args` keeps its words and a tab or spaces both work.
  # The `|| [ -n "$key" ]` tail reads a final line that carries no newline.
  while read -r key value || [ -n "${key:-}" ]; do
    case "${key:-}" in
      ''|'#'*) ;;
      script) suite_script="${value:-}" ;;
      args)   suite_args="${value:-}" ;;
      # Checked for shape, not just for the key: `env` reaches `env(1)`, which takes
      # a first word without `=` for the program to run — so `env LC_ALL` would run
      # the script not at all and fail every case of the suite with exit 127, where
      # one line here names the typo.
      env)
        env_name=${value%%=*}
        case "${value:-}" in
          *=*) case "$env_name" in
                 ''|[0-9]*|*[!A-Za-z0-9_]*) env_bad=1 bad_env="$value" ;;
                 *) suite_env+=("$value") ;;
               esac ;;
          # The flag, not the value: a bare `env` line has nothing to quote back, and
          # storing its empty value would read as "no error" — and would erase the
          # error a malformed line above it had already recorded.
          *) env_bad=1 bad_env="${value:-}" ;;
        esac ;;
      # Silently ignoring it would make a typo look like a setting that had no
      # effect — the suite would run, wrongly, and say nothing.
      *) unknown_key="$key" ;;
    esac
  done < "$dir/suite.conf"

  [ -z "$unknown_key" ] || {
    suite_failure "$suite" "suite.conf: unknown key '$unknown_key' (known: script, args, env)"
    continue; }
  [ "$env_bad" = 0 ] || {
    suite_failure "$suite" "suite.conf: env '$bad_env' is not NAME=value"; continue; }
  [ -n "$suite_script" ] || {
    suite_failure "$suite" "suite.conf names no script"; continue; }
  script="$ROOT/$suite_script"
  [ -f "$script" ] || { suite_failure "$suite" "not found: $suite_script"; continue; }
  manifest="$dir/cases.tsv"
  [ -f "$manifest" ] || { suite_failure "$suite" "no cases.tsv beside suite.conf"; continue; }
  fixtures="$dir/fixtures"

  # A case naming `-` asserts that the run was refused before its engine, and the
  # only thing that can witness that is a stub standing where the engine would be.
  # Without one the assertion holds against a `command not found` just as happily.
  stubs="$dir/stub"
  stub_count=0 stub_unarmed=""
  for stub in "$stubs"/*; do
    # Regular files only. `[ -x ]` is true of a directory, so a stray `stub/helpers/`
    # would satisfy the count below while no stand-in engine stood anywhere — and the
    # `-` cases would then assert their refusal against a `command not found`.
    [ -f "$stub" ] || continue
    stub_count=$((stub_count + 1))
    # Without the bit, a PATH search skips the stub and finds the real CLI: the
    # suite would then spend an account's quota, take minutes, and answer
    # differently each run — while reporting some of it as green. Refuse instead.
    [ -x "$stub" ] || stub_unarmed="${stub#"$ROOT"/}"
  done
  [ "$stub_count" -gt 0 ] || {
    suite_failure "$suite" "stub/ holds no stand-in engine"; continue; }
  [ -z "$stub_unarmed" ] || {
    suite_failure "$suite" "$stub_unarmed is not executable — the real CLI would answer instead"
    continue; }

  # shellcheck disable=SC2206 # deliberate: suite.conf supplies separate words
  suite_argv=($suite_args)

  suite_pass=0 suite_fail=0 suite_selected=0 suite_rows=0
  while IFS=$(printf '\t') read -r fixture args want expect note; do
    case "${fixture:-}" in ''|'#'*) continue ;; esac
    # Rows the manifest holds, before any filter — what a suite would run if asked
    # for all of it. `suite_selected` cannot answer that: a filter legitimately
    # brings it to zero, which is how a manifest emptied by a bad merge would pass
    # as a narrowed run.
    suite_rows=$((suite_rows + 1))
    # Every column is required. A row missing one would otherwise assert less than it
    # appears to — the empty `expect` being the dangerous one, since a substring test
    # against "" matches any output at all.
    if [ -z "${note:-}" ] || [ -z "${expect:-}" ] || [ -z "${want:-}" ] || [ -z "${args:-}" ]; then
      report_failure "$suite/$fixture" "malformed row: five tab-separated columns are required" "${note:-}"
      suite_fail=$((suite_fail + 1))
      continue
    fi
    if [ "${#want_names[@]}" -gt 0 ]; then
      matched=0
      for want_name in "${want_names[@]}"; do
        case "$fixture" in *"$want_name"*) matched=1 ;; esac
      done
      [ "$matched" = 1 ] || { skipped=$((skipped + 1)); continue; }
    fi
    selected=$((selected + 1))
    suite_selected=$((suite_selected + 1))

    marker="$WORK/answered"
    rm -f "$marker"
    envelope=""
    if [ "$fixture" != "-" ]; then
      envelope="$fixtures/$fixture.json"
      [ -f "$envelope" ] || {
        report_failure "$suite/$fixture" "no fixture at ${envelope#"$ROOT"/}" "$note"
        suite_fail=$((suite_fail + 1)); continue; }
    fi

    # `args` carries whatever this case adds to the suite's own invocation, so a case
    # can pin an argument guard — the only thing standing between `--narrow` and a
    # flag that would let the run edit the tree. A word shaped `NAME=value` is put in
    # the run's environment instead, which is how a case reaches the stub's optional
    # behaviour (stderr, a touched file, a non-zero exit). `-` means nothing added.
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
    # Order is the guard, not a detail. The suite's own env comes first and the
    # case's next, so a case overrides its suite (that is how a case pins a locale of
    # its own) — and the three the runner needs come LAST, where neither can reach
    # them: a suite.conf line setting PATH would walk the stub directory off the
    # search path, and one setting STUB_MARKER_FILE would leave the marker
    # witnessing nothing, both while the suite went on reporting green.
    out=$(env ${suite_env[@]+"${suite_env[@]}"} ${stub_env[@]+"${stub_env[@]}"} \
              STUB_ENVELOPE="$envelope" STUB_MARKER_FILE="$marker" \
              PATH="$stubs:$PATH" \
              bash "$script" ${suite_argv[@]+"${suite_argv[@]}"} \
              ${extra[@]+"${extra[@]}"} 2>&1 </dev/null)
    got=$?
    [ -z "$touched" ] || rm -f "$touched"

    if [ "$got" != "$want" ]; then
      report_failure "$suite/$fixture" "exit $got, wanted $want" "$note"
      printf '         %s\n' "$(printf '%s' "$out" | grep -v '^started:' | head -2 | tr '\n' ' ')"
      suite_fail=$((suite_fail + 1)); continue
    fi
    # A case naming a fixture must have been answered by the stub; one naming `-`
    # must have been refused before the stub was ever reached.
    if [ "$fixture" != "-" ] && [ ! -f "$marker" ]; then
      report_failure "$suite/$fixture" "the stub never answered — did the run reach it?" "$note"
      suite_fail=$((suite_fail + 1)); continue
    fi
    if [ "$fixture" = "-" ] && [ -f "$marker" ]; then
      report_failure "$suite/$fixture" "the stub ran, but this case must be refused before it" "$note"
      suite_fail=$((suite_fail + 1)); continue
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
      report_failure "$suite/$fixture" "exit $got as wanted, but never printed: $missing" "$note"
      suite_fail=$((suite_fail + 1)); continue
    fi
    pass=$((pass + 1))
    suite_pass=$((suite_pass + 1))
  done < "$manifest"

  # A suite whose manifest holds nothing has lost its coverage rather than finished
  # early, and it says so — silence here is what lets a script keep a suite's name
  # while nothing is run against it.
  if [ "$suite_rows" = 0 ]; then
    suite_failure "$suite" "cases.tsv holds no case"
  elif [ "$suite_selected" -gt 0 ]; then
    if [ "$suite_fail" = 0 ]; then
      printf '%-16s %s passed\n' "$suite" "$suite_pass"
    else
      printf '%-16s %s passed, %s failed\n' "$suite" "$suite_pass" "$suite_fail"
    fi
  fi
done

cases_note=""
[ "$skipped" = 0 ] || cases_note=", $skipped not selected"
suites_note=""
if [ "$suites_skipped" != 0 ]; then
  suites_word="suites"; [ "$suites_skipped" = 1 ] && suites_word="suite"
  suites_note=" ($suites_skipped $suites_word not selected)"
fi

# "Nothing ran" is only an answer when nothing went wrong either: a suite that failed
# its setup selects no case, and reporting THAT as an unmatched filter would send the
# reader looking for a typo in their arguments instead of at the failure above.
# It carries the suite note too — `--suite x fragment` matching nothing is most often
# the narrowing, not the fragment, and a reader told only about the fragment goes
# hunting the wrong one.
if [ "$selected" = 0 ] && [ "$fail" = 0 ]; then
  if [ "${#want_names[@]}" -gt 0 ]; then
    printf '\nno case matched %s — nothing ran%s\n' "${want_names[*]}" "$suites_note"
  else
    printf '\nno case to run%s\n' "$suites_note"
  fi
  exit 1
fi
printf '\n%s passed, %s failed%s%s\n' "$pass" "$fail" "$cases_note" "$suites_note"
[ "$fail" = 0 ]
