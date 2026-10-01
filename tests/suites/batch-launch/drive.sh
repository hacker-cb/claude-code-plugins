#!/usr/bin/env bash
# batch-launch.mjs, run against a fake account of its own.
#
# The case's words are batch-launch.mjs's arguments. Around them the driver builds what the
# script reads from outside itself: a HOME copied from homes/<the envelope's `home`>, whose
# login/path the stub login shell exports as PATH (`@root` there is this repository, `@node`
# a directory holding only the suite's node), and
# whose aimux.json — the envelope's `aimux` — the fake aimux package answers from; SHELL is
# that stub shell. The envelope's `agterm` is the agtermctl stub's. A case refused before
# anything runs names `-` and gets an empty home.
#
# A word's %20 is a space and %25 a % — a manifest splits its words on whitespace.
#
# The answer is printed compacted to one line, after whatever went to stderr, so a case's
# fragments can name a field and its value together.
set -u
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/batch-launch-suite.XXXXXX") || exit 125
trap 'rm -rf "$tmp"' EXIT
home="$tmp/home"
mkdir -p "$home/login" || exit 125
if [ -n "${STUB_ENVELOPE:-}" ]; then
  name=$(jq -r '.home // empty' "$STUB_ENVELOPE") || exit 125
  if [ -n "$name" ]; then cp -R "$here/homes/$name/." "$home/" || exit 125; fi
  jq '.aimux // {}' "$STUB_ENVELOPE" > "$home/aimux.json" || exit 125
fi
if [ -f "$home/login/path" ]; then
  # `@node`: a directory holding the suite's node and nothing else — what puts `node` on a
  # login PATH for the fake aimux's shebang, without the real claude and aimux that sit
  # beside node in an nvm or Homebrew directory.
  node_dir="$tmp/node"
  mkdir -p "$node_dir" && ln -s "$(command -v node)" "$node_dir/node" || exit 125
  path=$(cat "$home/login/path") || exit 125
  path=${path//@root/$root}
  printf '%s\n' "${path//@node/$node_dir}" > "$home/login/path" || exit 125
fi
export HOME="$home" SHELL="$here/stub/login-sh"
args=()
for word in "$@"; do word=${word//%20/ }; args+=("${word//%25/%}"); done
node "$root/plugins/hcb-dev/scripts/batch-launch.mjs" ${args[@]+"${args[@]}"} > "$tmp/out" 2> "$tmp/err"
code=$?
cat "$tmp/err"
if [ "$code" = 0 ] && jq -c . "$tmp/out" 2>/dev/null; then :; else cat "$tmp/out"; fi
# The login shell is the stand-in every probe reaches; its mark is what tells the runner
# the run got that far.
if [ -f "$home/.login-ran" ]; then touch "${STUB_MARKER_FILE:?the runner sets STUB_MARKER_FILE}"; fi
exit "$code"
