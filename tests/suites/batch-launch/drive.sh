#!/usr/bin/env bash
# batch-launch.mjs, run against a fake account of its own.
#
# The case's words are batch-launch.mjs's arguments. Around them the driver builds what the
# script reads from outside itself, all under a HOME of its own copied from homes/<the
# envelope's `home`>:
#   login/path    the PATH the stub login shell exports (`@root` there is this repository,
#                 `@node` a directory holding only the suite's node)
#   aimux.json    the envelope's `aimux`, which the fake aimux package answers from
#   repo/         where the envelope says `repo: true`: a git repository of one commit, the
#                 directory the script runs in; `@pin` in an argument is its commit
#   .claude/sessions/  where it says `registry: true`: a live-session registry, empty —
#                 or holding one live session standing in the directory `occupy` names
#   files         the envelope's `files`: each path under HOME written with its content, a
#                 JSON value as JSON
# SHELL is the stub login shell, and the envelope's `agterm` is the agtermctl stub's.
# `@home` anywhere in the envelope is that HOME.
#
# Words that are the driver's, put in the environment by the runner:
#   PREWT=clean|dirty   the batch's worktree stands before the case, at the pin — dirty
#                       holding a change
#   ORDER=<name>        orders/<name>.md is the script's stdin
#   SHOW=<a,b>          after the answer, what the stubs kept: agterm-new, agterm-close,
#                       launch-argv, worktrees, trust-<profile>, launch-dirs
# A word's %20 is a space and %25 a % — a manifest splits its words on whitespace.
#
# The answer is printed compacted to one line, after whatever went to stderr, with HOME
# written `@home`, the repository's commit `@pin`, and every session id `@uuid`.
set -u
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/batch-launch-suite.XXXXXX") || exit 125
holder=""
trap '[ -n "$holder" ] && kill "$holder" 2>/dev/null; rm -rf "$tmp"' EXIT
home="$tmp/home"
mkdir -p "$home/login" || exit 125
# What a stub kept beside the marker belongs to the case that made it, not to the next.
rm -f "${STUB_MARKER_FILE:?the runner sets STUB_MARKER_FILE}".agterm-*
envelope=""
if [ -n "${STUB_ENVELOPE:-}" ]; then
  envelope="$tmp/envelope.json"
  sed "s#@home#$home#g" "$STUB_ENVELOPE" > "$envelope" || exit 125
  name=$(jq -r '.home // empty' "$envelope") || exit 125
  if [ -n "$name" ]; then cp -R "$here/homes/$name/." "$home/" || exit 125; fi
  jq '.aimux // {}' "$envelope" > "$home/aimux.json" || exit 125
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    mkdir -p "$home/$(dirname "$f")" || exit 125
    jq -r --arg f "$f" '.files[$f] | if type == "string" then . else tojson end' "$envelope" > "$home/$f" || exit 125
  done < <(jq -r '.files // {} | keys[]' "$envelope")
  while IFS= read -r link; do
    [ -n "$link" ] || continue
    mkdir -p "$home/$(dirname "$link")" && ln -s "$(jq -r --arg l "$link" '.links[$l]' "$envelope")" "$home/$link" || exit 125
  done < <(jq -r '.links // {} | keys[]' "$envelope")
  for d in $(jq -r '.dirs // [] | .[]' "$envelope"); do mkdir -p "$home/$d" || exit 125; done
fi
if [ -f "$home/login/path" ]; then
  # `@node`: a directory holding the suite's node and nothing else — what puts `node` on a
  # login PATH for the fake aimux's shebang, without the real claude and aimux that sit
  # beside node in an nvm or Homebrew directory.
  node_dir="$tmp/node"
  mkdir -p "$node_dir" && ln -s "$(command -v node)" "$node_dir/node" || exit 125
  path=$(cat "$home/login/path") || exit 125
  # Quoted replacements: unquoted, bash 5.2 reads a `&` in either path as the match.
  path=${path//@root/"$root"}
  printf '%s\n' "${path//@node/"$node_dir"}" > "$home/login/path" || exit 125
fi

run_in="$PWD"
pin=""
if [ -n "$envelope" ] && [ "$(jq -r '.repo // false' "$envelope")" = true ]; then
  repo="$home/repo"
  { git init -q "$repo" && git -C "$repo" -c user.name=suite -c user.email=suite@example.invalid \
      commit -q --allow-empty -m one; } || exit 125
  pin=$(git -C "$repo" rev-parse HEAD) || exit 125
  run_in="$repo"
  slug=$(jq -r '.slug // "t1-x1"' "$envelope")
  case "${PREWT:-}" in
    '') ;;
    clean|dirty)
      git -C "$repo" worktree add -q --detach "$repo/.claude/worktrees/$slug" HEAD || exit 125
      if [ "$PREWT" = dirty ]; then echo x > "$repo/.claude/worktrees/$slug/stray"; fi ;;
    *) echo "drive: PREWT is clean or dirty, not '$PREWT'" >&2; exit 125 ;;
  esac
fi
if [ -n "$envelope" ] && [ "$(jq -r '.registry // false' "$envelope")" = true ]; then
  mkdir -p "$home/.claude/sessions" || exit 125
  occupy=$(jq -r '.occupy // empty' "$envelope")
  if [ -n "$occupy" ]; then
    sleep 300 & holder=$!
    printf '{"pid":%s,"cwd":"%s","startedAt":1}\n' "$holder" "$occupy" > "$home/.claude/sessions/$holder.json" || exit 125
  fi
fi

# The stubs read the envelope with HOME written in; the script's temporary directories land
# in the case's own.
mkdir -p "$tmp/tmpdir" || exit 125
export HOME="$home" SHELL="$here/stub/login-sh" TMPDIR="$tmp/tmpdir"
if [ -n "$envelope" ]; then export STUB_ENVELOPE="$envelope"; fi
args=()
for word in "$@"; do
  word=${word//%20/ }; word=${word//%25/%}
  args+=("${word//@pin/$pin}")
done
input=/dev/null
if [ -n "${ORDER:-}" ]; then input="$here/orders/$ORDER.md"; fi
(cd "$run_in" && node "$root/plugins/hcb-dev/scripts/batch-launch.mjs" ${args[@]+"${args[@]}"} < "$input") \
  > "$tmp/out" 2> "$tmp/err"
code=$?

mask() {
  local real_home
  real_home=$(cd "$home" && pwd -P)
  sed -e "s#$real_home#@home#g" -e "s#$home#@home#g" ${pin:+-e "s#$pin#@pin#g"} \
    -e 's#[0-9a-f]\{8\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{12\}#@uuid#g'
}
mask < "$tmp/err"
if [ "$code" = 0 ] && jq -c . "$tmp/out" > "$tmp/compact" 2>/dev/null; then mask < "$tmp/compact"; else mask < "$tmp/out"; fi
IFS=, read -r -a shows <<< "${SHOW:-}"
for s in ${shows[@]+"${shows[@]}"}; do
  case "$s" in
    agterm-new|agterm-close) printf '@%s: ' "$s"; tr '\n' ' ' < "${STUB_MARKER_FILE:?}.$s" 2>/dev/null | mask; echo ;;
    launch-argv) printf '@launch-argv: '; cat "$home/launch-argv" 2>/dev/null | mask; echo ;;
    worktrees) printf '@worktrees: '; git -C "$home/repo" worktree list --porcelain 2>/dev/null | tr '\n' ' ' | mask; echo ;;
    trust-*) printf '@%s: ' "$s"; jq -c '.' "$home/profiles/${s#trust-}/.claude.json" 2>/dev/null | mask; echo ;;
    launch-dirs) printf '@launch-dirs: '; ls -d "$TMPDIR"/hcb-batch-* 2>/dev/null | wc -l | tr -d ' '; echo ;;
    *) echo "drive: SHOW names nothing called '$s'" >&2; exit 125 ;;
  esac
done
# The login shell is the stand-in every probe reaches; its mark is what tells the runner
# the run got that far.
if [ -f "$home/.login-ran" ]; then touch "${STUB_MARKER_FILE:?the runner sets STUB_MARKER_FILE}"; fi
exit "$code"
