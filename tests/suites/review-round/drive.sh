#!/usr/bin/env bash
# review-round.mjs, driven the way a round drives it.
#
# A subcommand cannot be tested alone: `add` needs the round `init` left, `task` the
# queue `queue` wrote. So a case is a chain — steps separated by the word `++`, `@round`
# in a step being the id the preceding `init` printed — run inside a TMPDIR of its own,
# where the round lives. Only the LAST step's answer is printed, compacted to one line,
# so a case's fragments (and its `NOT:` ones above all) speak about that step alone; an
# earlier step that fails is printed and ends the chain with its own exit code, since a
# setup step failing must fail the case rather than be stepped over.
#
# Helpers this driver handles itself:
#   @write <path> <word>   a step: "<word>\n" into that file of the scratch repository
#   @store <path> <word>   a step: "<word>\n" into that file of the round's work
#                          directory — a file another process is still writing;
#                          `@file:<name>` in place of the word copies inputs/<name> there
#   @file:<name>           a word: a copy of inputs/<name>, every `@blob:<path>` in it
#                          replaced by the scratch repository's blob of <path>
#   @empty                 a word: the empty string, which a manifest cannot write
#   @lit:<text>            a word: <text> with %20 read as a space and %25 as %, for a
#                          path a manifest's word splitting would cut
#   @show <name>           a step: prints what a stub kept beside its marker as <name> —
#                          the codex stub's codex-stdin, codex-schema, codex-argv
#   INSIDE_REPO=1          environment: TMPDIR is put inside the scratch repository
#   ROUNDS_ROOT=<kind>     environment: $TMPDIR/hcb-review is there before the case — as a
#                          `link` to another directory, a directory anyone can write
#                          (`open`) or one anyone can read (`read`) — what someone sharing
#                          the temp directory could have made first; or, as `stale`, a
#                          proper one holding r-00000001 opened eight days ago and
#                          r-00000002 opened now
#
# In the answer printed at the end, the scratch repository's short shas come back as
# `@head7` and `@base7`: a case cannot know either, and a snapshot is exactly what some of
# them are about.
set -u
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
script="$root/plugins/hcb-dev/scripts/review-round.mjs"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/review-round-suite.XXXXXX") || exit 125
trap 'rm -rf "$tmp"' EXIT
# What a stub kept beside the marker belongs to the case that made it, not to the next.
rm -f "${STUB_MARKER_FILE:?the runner sets STUB_MARKER_FILE}".codex-*

repo=""
# The scratch repository is the git stub's to build, on the first git call of the case —
# so a case refused before git must never get here, or the stub runs where it must not.
scratch() {
  [ -n "$repo" ] && return 0
  repo=$(git rev-parse --show-toplevel) || { echo "drive: the stub built no repository" >&2; exit 125; }
}
if [ "${INSIDE_REPO:-}" = 1 ]; then
  scratch
  mkdir -p "$repo/.tmp"
  export TMPDIR="$repo/.tmp"
else
  export TMPDIR="$tmp"
fi
case "${ROUNDS_ROOT:-}" in
  '') ;;
  link) { mkdir "$tmp/elsewhere" && ln -s "$tmp/elsewhere" "$TMPDIR/hcb-review"; } || exit 125 ;;
  open) { mkdir "$TMPDIR/hcb-review" && chmod 777 "$TMPDIR/hcb-review"; } || exit 125 ;;
  read) { mkdir "$TMPDIR/hcb-review" && chmod 755 "$TMPDIR/hcb-review"; } || exit 125 ;;
  stale)
    { mkdir -m 700 "$TMPDIR/hcb-review" \
        && mkdir "$TMPDIR/hcb-review/r-00000001" "$TMPDIR/hcb-review/r-00000002" \
        && echo '{}' > "$TMPDIR/hcb-review/r-00000001/request.json" \
        && echo '{}' > "$TMPDIR/hcb-review/r-00000002/request.json" \
        && node -e 'const t = Date.now() / 1000 - 8 * 86400; require("fs").utimesSync(process.argv[1], t, t)' \
             "$TMPDIR/hcb-review/r-00000001/request.json"; } || exit 125 ;;
  *) echo "drive: ROUNDS_ROOT is link, open, read or stale, not '$ROUNDS_ROOT'" >&2; exit 125 ;;
esac

steps=()
current=""
for word in "$@"; do
  if [ "$word" = "++" ]; then steps+=("$current"); current=""; else current="${current:+$current }$word"; fi
done
steps+=("$current")

round=""
count=${#steps[@]}
for ((n = 0; n < count; n++)); do
  set -f
  # shellcheck disable=SC2206 # deliberate: a case's words carry no spaces
  words=(${steps[n]})
  set +f
  if [ "${words[0]}" = "@write" ]; then
    scratch
    printf '%s\n' "${words[2]}" > "$repo/${words[1]}"
    continue
  fi
  if [ "${words[0]}" = "@show" ]; then
    kept="${STUB_MARKER_FILE:?}.${words[1]}"
    [ -f "$kept" ] || { echo "drive: nothing kept as ${words[1]}"; exit 1; }
    # JSON compacted, as the answers are, so a case can quote a whole array on one line.
    if jq -e . "$kept" >/dev/null 2>&1; then jq -c . "$kept"; else cat "$kept"; fi
    [ "$n" = $((count - 1)) ] && exit 0
    continue
  fi
  if [ "${words[0]}" = "@store" ]; then
    [ -n "$round" ] || { echo "drive: @store before any init" >&2; exit 125; }
    mkdir -p "$(dirname "$TMPDIR/hcb-review/$round/${words[1]}")" || exit 125
    case "${words[2]}" in
      @file:*) cp "$here/inputs/${words[2]#@file:}" "$TMPDIR/hcb-review/$round/${words[1]}" || exit 125 ;;
      *) printf '%s\n' "${words[2]}" > "$TMPDIR/hcb-review/$round/${words[1]}" ;;
    esac
    continue
  fi
  args=()
  for w in "${words[@]}"; do
    case "$w" in
      @round) args+=("$round") ;;
      @empty) args+=("") ;;
      @lit:*) lit=${w#@lit:}; lit=${lit//%20/ }; args+=("${lit//%25/%}") ;;
      @file:*)
        src="$here/inputs/${w#@file:}"
        dst="$tmp/input.$n.json"
        cp "$src" "$dst" || exit 125
        while IFS= read -r token; do
          scratch
          blob=$(git hash-object -- "${token#@blob:}") || exit 125
          sed -i.bak "s|$token\"|$blob\"|g" "$dst" && rm -f "$dst.bak"
        done < <(grep -o '@blob:[^"]*' "$dst" | sort -u)
        args+=("$dst") ;;
      *) args+=("$w") ;;
    esac
  done
  out=$(node "$script" "${args[@]}" 2>&1)
  code=$?
  if [ "${words[0]}" = init ] && [ "$code" = 0 ]; then round=$(printf '%s' "$out" | jq -r '.round // empty'); fi
  if [ "$code" != 0 ] || [ "$n" = $((count - 1)) ]; then
    # Only where the case names a fixture: a case refused before git must not reach the stub.
    if [ -n "${STUB_ENVELOPE:-}" ]; then
      scratch
      head7=$(git rev-parse --short=7 HEAD 2>/dev/null) && out=${out//$head7/@head7}
      base7=$(git rev-parse --short=7 base 2>/dev/null) && out=${out//$base7/@base7}
    fi
    if printf '%s' "$out" | jq -e . >/dev/null 2>&1; then printf '%s' "$out" | jq -c .; else printf '%s\n' "$out"; fi
    exit "$code"
  fi
done
