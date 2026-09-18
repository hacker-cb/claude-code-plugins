#!/usr/bin/env bash
#
# Version gate: every plugin a change touches must land with a version above the one
# its base carries — the base as it is NOW, not as it was when the branch forked.
#
# Claude Code keys its plugin cache on the version, and skips an update whose version
# matches the installed one: content merged without a bump never reaches anyone who
# already has that version ("Version management" in
# https://code.claude.com/docs/en/plugins-reference.md).
#
# Both what a change touches and the version it lands with are read off the MERGE of
# head into base, never off the head alone:
#   - two pull requests that each bump 1.0.1 -> 1.0.2 merge cleanly one after the
#     other, since git takes an identical edit on both sides as one — and the second
#     lands its content under a version users already have. Against the base after the
#     first merged, the second one's 1.0.2 is above nothing.
#   - a branch whose base moved on carries the base's OLD copy of every plugin it never
#     touched; a diff of base against head would count those as changes, and as
#     version downgrades.
#   - a branch stacked on another that was squash-merged still carries that one's
#     commits; a diff from the merge base would count its changes as this branch's own.
#
# Only a plugin whose plugin.json names a version on the base is held to this. One
# without a version is versioned by commit and updates on any change — the
# external_plugins/* wrappers are that by design.
#
# Pure git over objects already here: the caller fetches both sides. Nothing from the
# head is checked out or run, which is what lets CI evaluate a fork's pull request with
# a token that writes statuses.
#
# Usage: bash scripts/version-gate.sh --base <rev> --head <rev>
# Exit:  0 every changed plugin is bumped
#        1 one is not, or head does not merge cleanly into base
#        2 called wrong
#        3 could not evaluate — a revision or the base's manifest is unreadable
# The last line opens `verdict: `, in ASCII and short enough for a commit status.

set -uo pipefail
# `[[ < ]]` collates in the current locale; prerelease identifiers compare as ASCII.
export LC_ALL=C

MARKET=.claude-plugin/marketplace.json
# The semver.org grammar in full: no leading zero on a numeric identifier, prerelease
# ones included, and no empty identifier. semver_gt below leans on the first — it
# compares numbers as digit strings, which a leading zero would make lie.
NUM='(0|[1-9][0-9]*)'
PRE_ID='(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
SEMVER="^$NUM\.$NUM\.$NUM(-$PRE_ID(\.$PRE_ID)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?\$"

base="" head=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --base|--head)
      [ "$#" -ge 2 ] && [ -n "$2" ] || { echo "$1 needs a value"; exit 2; }
      if [ "$1" = --base ]; then base=$2; else head=$2; fi
      shift 2 ;;
    *) echo "unknown argument '$1'"; exit 2 ;;
  esac
done
[ -n "$base" ] && [ -n "$head" ] || {
  echo "usage: bash scripts/version-gate.sh --base <rev> --head <rev>"; exit 2; }

cannot() { echo "verdict: could not evaluate - $*"; exit 3; }

command -v jq >/dev/null 2>&1 || cannot "jq is not on PATH"
base_sha=$(git rev-parse -q --verify "$base^{commit}") || cannot "'$base' is not a commit here"
head_sha=$(git rev-parse -q --verify "$head^{commit}") || cannot "'$head' is not a commit here"
side() { if [ "$2" = "$3" ]; then echo "$1    $3"; else echo "$1    $2 ($3)"; fi; }
side base "$base" "$base_sha"
side head "$head" "$head_sha"

# Status 1 is a conflict, anything above it a merge that could not run at all. A
# conflicted tree still gets written, but a version line inside conflict markers is not
# a version, and GitHub will not merge it either — so the verdict waits for the fix.
merged=$(git merge-tree --write-tree --no-messages --name-only "$base_sha" "$head_sha")
case $? in
  0) merged=${merged%%$'\n'*}; echo "merge   clean" ;;
  1) echo "merge   conflicts in:"
     printf '%s\n' "$merged" | sed '1d; s/^/          /'
     echo "verdict: conflicts with the base - bring the base in, and this runs again"
     exit 1 ;;
  *) cannot "git merge-tree could not merge head into base" ;;
esac
echo

# `name<TAB>source` for every marketplace entry, the source left empty where it is not
# a path in this repository (github, url, npm...) and so versioned elsewhere.
entries() {
  git show "$1:$MARKET" 2>/dev/null | jq -r '.plugins[]? | [.name,
    (if (.source | type) == "string" and (.source | startswith("./")) then .source else "" end)]
    | @tsv'
}
# The version a plugin.json names, empty when it names none or is not there; fails
# only when the file is there and does not parse.
version_at() {
  git cat-file -e "$1:$2/.claude-plugin/plugin.json" 2>/dev/null || return 0
  git show "$1:$2/.claude-plugin/plugin.json" | jq -r '.version // empty | tostring'
}
source_in() { printf '%s\n' "$2" | awk -F'\t' -v n="$1" '$1 == n { print $2; hit = 1; exit } END { exit !hit }'; }

# Semver precedence (semver.org, item 11): the core numerically, then a release above
# its own prereleases, then prerelease identifiers one at a time — numeric ones
# numerically and below alphanumeric ones, which compare as ASCII — with a shorter run
# of equal identifiers below a longer one. Build metadata never counts.
#
# Numbers compare as digit strings, never as shell integers: semver puts no bound on a
# field, and bash arithmetic overflows past 2^63. With no leading zero (SEMVER), the
# longer string is the larger number and equal lengths compare as ASCII.
num_gt() { [ "${#1}" -gt "${#2}" ] || { [ "${#1}" -eq "${#2}" ] && [[ $1 > $2 ]]; }; }
semver_gt() {
  local a=${1%%+*} b=${2%%+*} a_pre="" b_pre="" x y i
  local -a ac bc ap bp
  case $a in *-*) a_pre=${a#*-}; a=${a%%-*} ;; esac
  case $b in *-*) b_pre=${b#*-}; b=${b%%-*} ;; esac
  IFS=. read -ra ac <<<"$a"; IFS=. read -ra bc <<<"$b"
  for i in 0 1 2; do
    [ "${ac[i]}" = "${bc[i]}" ] && continue
    num_gt "${ac[i]}" "${bc[i]}"; return
  done
  [ -z "$a_pre" ] && [ -n "$b_pre" ] && return 0
  [ -z "$b_pre" ] && return 1
  IFS=. read -ra ap <<<"$a_pre"; IFS=. read -ra bp <<<"$b_pre"
  for ((i = 0; i < ${#ap[@]} && i < ${#bp[@]}; i++)); do
    x=${ap[i]} y=${bp[i]}
    if [[ $x =~ ^[0-9]+$ && $y =~ ^[0-9]+$ ]]; then
      [ "$x" = "$y" ] || { num_gt "$x" "$y"; return; }
    elif [[ $x =~ ^[0-9]+$ ]]; then return 1
    elif [[ $y =~ ^[0-9]+$ ]]; then return 0
    elif [[ $x > $y ]]; then return 0
    elif [[ $x < $y ]]; then return 1
    fi
  done
  [ "${#ap[@]}" -gt "${#bp[@]}" ]
}

base_entries=$(entries "$base_sha") || cannot "$MARKET on the base is missing or does not parse"
[ -n "$base_entries" ] || cannot "the base lists no plugin in $MARKET"
# The merge's manifest is the change's: one that does not parse is the change's to fix.
merged_entries=$(entries "$merged") || {
  echo "verdict: $MARKET is missing or does not parse after the merge"; exit 1; }

failures=() bumped=()
report() { printf '%-18s %s\n' "$1" "$2"; }
fail() { report "$1" "FAIL  $2"; failures+=("$1 $2"); }

while IFS=$'\t' read -r name src; do
  [ -n "$name" ] || continue
  if ! merged_src=$(source_in "$name" "$merged_entries"); then
    report "$name" "removed"; continue
  fi
  if [ -z "$src" ] || [ -z "$merged_src" ]; then
    report "$name" "not a path in this repository - versioned where it lives"; continue
  fi
  dir=${src#./} merged_dir=${merged_src#./}
  base_ver=$(version_at "$base_sha" "$dir") || cannot "$dir/.claude-plugin/plugin.json on the base does not parse"
  if [ -z "$base_ver" ]; then
    report "$name" "unversioned - updates follow the commit"; continue
  fi
  # Tree ids, not a path diff: equal content is equal wherever the plugin now sits.
  if [ "$(git rev-parse -q --verify "$base_sha:$dir")" = "$(git rev-parse -q --verify "$merged:$merged_dir")" ]; then
    report "$name" "unchanged ($base_ver)"; continue
  fi
  if ! merged_ver=$(version_at "$merged" "$merged_dir"); then
    fail "$name" "changed, and its plugin.json does not parse"
  elif [ -z "$merged_ver" ]; then
    fail "$name" "changed, and drops its version (base has $base_ver)"
  elif ! [[ $merged_ver =~ $SEMVER ]]; then
    fail "$name" "changed, and '$merged_ver' is not semver"
  elif ! [[ $base_ver =~ $SEMVER ]]; then
    cannot "$name on the base carries '$base_ver', which is not semver"
  elif semver_gt "$merged_ver" "$base_ver"; then
    report "$name" "bumped $base_ver -> $merged_ver"; bumped+=("$name $merged_ver")
  else
    fail "$name" "changed, but $merged_ver is not above base $base_ver"
  fi
done <<<"$base_entries"

while IFS=$'\t' read -r name _; do
  [ -n "$name" ] || continue
  source_in "$name" "$base_entries" >/dev/null || report "$name" "new - nothing to be above"
done <<<"$merged_entries"

echo
if [ "${#failures[@]}" -gt 0 ]; then
  verdict=$(printf '%s; ' "${failures[@]}")
  echo "verdict: ${verdict%; }"
  exit 1
fi
if [ "${#bumped[@]}" -gt 0 ]; then
  verdict=$(printf '%s, ' "${bumped[@]}")
  echo "verdict: ok - bumped ${verdict%, }"
else
  echo "verdict: ok - no versioned plugin changed"
fi
