#!/usr/bin/env bash
# batch-launch.mjs, run against a fake account of its own.
#
# The case's words are batch-launch.mjs's arguments. Around them the driver builds what the
# script reads from outside itself, all under a HOME of its own copied from homes/<the
# envelope's `home`>:
#   login/path    the PATH the stub login shell exports (`@root` there is this repository,
#                 `@node` a directory holding only the suite's node)
#   repo/         where the envelope says `repo: true`: a git repository of one commit, the
#                 directory the script runs in; `@pin` in an argument is its commit
#   .claude/sessions/  where it says `registry: true`: a live-session registry, empty —
#                 or holding one live session standing in the directory `occupy` names
#   running       a process elsewhere carrying the session id it names in its arguments —
#                 registered as standing in `running_in` where the envelope names one
#   holding       a process whose arguments are these words, standing in the repository —
#                 or in `holding_in`, a directory under HOME, where the envelope names one
#   branches      local branches made in the repository, at its one commit
#   running_domain  the `pidDomain` that process's registry record names, where given
#   sealed        directories under HOME made unreadable once everything stands
#   dirs          directories made once the repository stands
#   files         the envelope's `files`: each path under HOME written with its content, a
#                 JSON value as JSON
# SHELL is the stub login shell, and the envelope's `agterm` is the agtermctl stub's.
# `@home` anywhere in the envelope, or in a CLAUDE_CONFIG_DIR the case sets, is that HOME.
#
# Words that are the driver's, put in the environment by the runner:
#   PREWT=clean|dirty|host|host-commit|host-nested   the batch's worktree stands before the
#                       case, at the pin — dirty holding a change, host on the branch
#                       `--worktree` would cut, host-commit with a commit of its own there,
#                       host-nested with another worktree inside it
#   ORDER=<name>        orders/<name>.md is the script's stdin
#   PRETEXT=fixed|stale|open  before the case, the batches' texts directory under HOME holds
#                       an order for the fixed session id (fixed); that and an order 31 days
#                       old (stale); or a nudge for it, the directory open to others (open)
#   SHOW=<a,b>          after the answer, what the stubs kept: agterm-new, agterm-close,
#                       launch-argv, worktrees, trust-<directory under profiles/>, launch-dirs;
#                       and the batches' texts: texts (how many files), batch-text (theirs)
# A word's %20 is a space, %3D an `=` and %25 a % — a manifest splits its words on whitespace,
# and the runner takes a word shaped NAME=value for the environment. `@home` in a word is
# the case's HOME.
#
# The answer is printed compacted to one line, after whatever went to stderr, with HOME
# written `@home`, the repository's commit `@pin`, the cases' fixed session id `@fixed-session`,
# and every other session id `@uuid`.
set -u
sealed_dirs=()
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/batch-launch-suite.XXXXXX") || exit 125
# One spelling of it: a TMPDIR ending in `/` doubles the slash, and the masks below match text.
tmp=$(cd "$tmp" && pwd) || exit 125
holder=""
trap '[ -n "$holder" ] && kill "$holder" 2>/dev/null; [ -n "${runner_pid:-}" ] && kill "$runner_pid" 2>/dev/null; [ -n "${holding_pid:-}" ] && kill "$holding_pid" 2>/dev/null; [ "${#sealed_dirs[@]}" -gt 0 ] && chmod -R u+rwx "${sealed_dirs[@]}" 2>/dev/null; rm -rf "$tmp"' EXIT
home="$tmp/home"
mkdir -p "$home/login" || exit 125
# What a stub kept beside the marker belongs to the case that made it, not to the next.
rm -f "${STUB_MARKER_FILE:?the runner sets STUB_MARKER_FILE}".agterm-*
envelope=""
if [ -n "${STUB_ENVELOPE:-}" ]; then
  envelope="$tmp/envelope.json"
  raw=$(cat "$STUB_ENVELOPE") || exit 125
  printf '%s\n' "${raw//@home/"$home"}" > "$envelope" || exit 125
  name=$(jq -r '.home // empty' "$envelope") || exit 125
  if [ -n "$name" ]; then cp -R "$here/homes/$name/." "$home/" || exit 125; fi
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    mkdir -p "$home/$(dirname "$f")" || exit 125
    jq -r --arg f "$f" '.files[$f] | if type == "string" then . else tojson end' "$envelope" > "$home/$f" || exit 125
  done < <(jq -r '.files // {} | keys[]' "$envelope")
  while IFS= read -r link; do
    [ -n "$link" ] || continue
    mkdir -p "$home/$(dirname "$link")" && ln -s "$(jq -r --arg l "$link" '.links[$l]' "$envelope")" "$home/$link" || exit 125
  done < <(jq -r '.links // {} | keys[]' "$envelope")
fi
if [ -f "$home/login/path" ]; then
  # `@node`: a directory holding the suite's node and nothing else — what puts `node` on a
  # login PATH for a stub's shebang, without the real claude that sits beside node in an
  # nvm or Homebrew directory.
  node_dir="$tmp/node"
  mkdir -p "$node_dir" && ln -s "$(command -v node)" "$node_dir/node" || exit 125
  path=$(cat "$home/login/path") || exit 125
  # Quoted replacements: unquoted, bash 5.2 reads a `&` in either path as the match.
  path=${path//@root/"$root"}
  printf '%s\n' "${path//@node/"$node_dir"}" > "$home/login/path" || exit 125
fi

# The repository below is built under the case's own HOME, with no hook of the machine's.
export HOME="$home" GIT_CONFIG_NOSYSTEM=1
run_in="$PWD"
pin=""
if [ -n "$envelope" ] && [ "$(jq -r '.repo // false' "$envelope")" = true ]; then
  repo="$home/repo"
  { git init -q "$repo" && git -C "$repo" -c core.hooksPath=/dev/null -c user.name=suite \
      -c user.email=suite@example.invalid -c commit.gpgsign=false commit -q --allow-empty -m one; } || exit 125
  pin=$(git -C "$repo" rev-parse HEAD) || exit 125
  run_in="$repo"
  slug=$(jq -r '.slug // "t1-x1"' "$envelope")
  case "${PREWT:-}" in
    '') ;;
    host|host-commit|host-nested)
      git -C "$repo" -c core.hooksPath=/dev/null worktree add -q -b "worktree-$slug" "$repo/.claude/worktrees/$slug" HEAD || exit 125
      if [ "$PREWT" = host-commit ]; then
        git -C "$repo/.claude/worktrees/$slug" -c core.hooksPath=/dev/null -c user.name=suite \
          -c user.email=suite@example.invalid -c commit.gpgsign=false commit -q --allow-empty -m mine || exit 125
      fi
      if [ "$PREWT" = host-nested ]; then
        git -C "$repo" -c core.hooksPath=/dev/null worktree add -q --detach "$repo/.claude/worktrees/$slug/nested" HEAD || exit 125
      fi ;;
    clean|dirty)
      git -C "$repo" -c core.hooksPath=/dev/null worktree add -q --detach "$repo/.claude/worktrees/$slug" HEAD || exit 125
      if [ "$PREWT" = dirty ]; then echo x > "$repo/.claude/worktrees/$slug/stray"; fi ;;
    *) echo "drive: PREWT is clean, dirty, host, host-commit or host-nested, not '$PREWT'" >&2; exit 125 ;;
  esac
fi
if [ -n "$envelope" ] && [ -n "$pin" ]; then
  while IFS= read -r b; do
    [ -n "$b" ] || continue
    git -C "$repo" branch "$b" || exit 125
  done < <(jq -r '.branches // [] | .[]' "$envelope")
fi
# `dirs`, once the repository and its worktree stand: a directory inside one of them too.
if [ -n "$envelope" ]; then
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    mkdir -p "$home/$d" || exit 125
  done < <(jq -r '.dirs // [] | .[]' "$envelope")
fi
# `running`: a process somewhere else carrying that session, as a resume in another
# terminal does.
runner_pid=""
if [ -n "$envelope" ] && [ -n "$(jq -r '.running // empty' "$envelope")" ]; then
  node -e 'setTimeout(() => {}, 300000)' -- --resume "$(jq -r '.running' "$envelope")" & runner_pid=$!
fi
holding_pid=""
if [ -n "$envelope" ] && [ "$(jq '.holding // [] | length' "$envelope")" -gt 0 ]; then
  words=()
  while IFS= read -r w; do words+=("$w"); done < <(jq -r '.holding[]' "$envelope")
  in_dir=$(jq -r '.holding_in // empty' "$envelope")
  if [ -n "$in_dir" ]; then in_dir="$home/$in_dir"; mkdir -p "$in_dir" || exit 125; else in_dir="$run_in"; fi
  (cd "$in_dir" && exec node -e 'setTimeout(() => {}, 300000)' -- "${words[@]}") & holding_pid=$!
fi
if [ -n "$envelope" ] && [ "$(jq -r '.registry // false' "$envelope")" = true ]; then
  mkdir -p "$home/.claude/sessions" || exit 125
  occupy=$(jq -r '.occupy // empty' "$envelope")
  if [ -n "$occupy" ]; then
    sleep 300 & holder=$!
    printf '{"pid":%s,"cwd":"%s","startedAt":1}\n' "$holder" "$occupy" > "$home/.claude/sessions/$holder.json" || exit 125
  fi
  running_in=$(jq -r '.running_in // empty' "$envelope")
  if [ -n "$running_in" ] && [ -n "$runner_pid" ]; then
    jq -nc --argjson pid "$runner_pid" --arg cwd "$running_in" --arg domain "$(jq -r '.running_domain // empty' "$envelope")" \
      '{pid: $pid, cwd: $cwd, startedAt: 1} + (if $domain == "" then {} else {pidDomain: $domain} end)' \
      > "$home/.claude/sessions/$runner_pid.json" || exit 125
  fi
fi

if [ -n "$envelope" ]; then
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    chmod 000 "$home/$d" || exit 125
    sealed_dirs+=("$home/$d")
  done < <(jq -r '.sealed // [] | .[]' "$envelope")
fi

# The stubs read the envelope with HOME written in; the script's temporary directories land
# in the case's own.
mkdir -p "$tmp/tmpdir" || exit 125
texts="$home/.claude/hcb-orders"
fixed="$texts/11111111-2222-4333-8444-555555555555"
case "${PRETEXT:-}" in
  '') ;;
  fixed) { mkdir -m 700 -p "$fixed" && chmod 700 "$texts" && echo 'an order' > "$fixed/order.md"; } || exit 125 ;;
  stale)
    { mkdir -m 700 -p "$fixed" "$texts/22222222-2222-4333-8444-555555555555" \
        && chmod 700 "$texts" && echo 'an order' > "$fixed/order.md" \
        && echo 'an old order' > "$texts/22222222-2222-4333-8444-555555555555/order.md" \
        && node -e 'const t = Date.now() / 1000 - 31 * 86400; require("fs").utimesSync(process.argv[1], t, t)' \
             "$texts/22222222-2222-4333-8444-555555555555"; } || exit 125 ;;
  open) { mkdir -p "$fixed" && chmod 777 "$texts" && echo 'a nudge' > "$fixed/nudge.md"; } || exit 125 ;;
  *) echo "drive: PRETEXT is fixed, stale or open, not '$PRETEXT'" >&2; exit 125 ;;
esac
export HOME="$home" SHELL="$here/stub/login-sh" TMPDIR="$tmp/tmpdir"
if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR//@home/"$home"}"; fi
if [ -n "$envelope" ]; then export STUB_ENVELOPE="$envelope"; fi
args=()
for word in "$@"; do
  word=${word//%20/ }; word=${word//%3D/=}; word=${word//%25/%}
  word=${word//@home/"$home"}
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
    -e 's#11111111-2222-4333-8444-555555555555#@fixed-session#g' \
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
    texts) printf '@texts: '; find "$texts" -type f 2>/dev/null | wc -l | tr -d ' '; echo ;;
    batch-text) printf '@batch-text: '; find "$texts" -type f -exec cat {} + 2>/dev/null | tr '\n' ' ' | mask; echo ;;
    *) echo "drive: SHOW names nothing called '$s'" >&2; exit 125 ;;
  esac
done
# The login shell is the stand-in every probe reaches; its mark is what tells the runner
# the run got that far.
if [ -f "$home/.login-ran" ]; then touch "${STUB_MARKER_FILE:?the runner sets STUB_MARKER_FILE}"; fi
exit "$code"
