#!/usr/bin/env bash
#
# Structural validation for the hacker-cb-plugins marketplace.
#
# Checks the marketplace manifest, every plugin's plugin.json and skills, and
# enforces the repo naming convention (plugin names must start with "hcb-").
# This is the fast, dependency-light gate used both locally and in CI.
#
# Dependencies: jq, awk, grep (all standard on CI runners).
# Usage: bash scripts/validate.sh   (run from anywhere; cd's to repo root)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MARKET=".claude-plugin/marketplace.json"
SEMVER='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
errors=0
warnings=0

err()  { echo "ERROR: $*" >&2; errors=$((errors + 1)); }
warn() { echo "WARN:  $*" >&2; warnings=$((warnings + 1)); }
ok()   { echo "OK:    $*"; }

command -v jq >/dev/null 2>&1 || { echo "FATAL: jq is required but not installed." >&2; exit 2; }

# Claude Code replaces a positional reference in skill and agent content with a
# word from the invocation arguments, so a shell or awk positional written there
# never reaches a shell as itself — it arrives as whatever the caller typed,
# leaving a block that is wrong but still looks runnable. Named variables and
# `sed` / `awk -v` do the same work and survive.
#
# NOT flagged, each for its own reason:
#   \$1     the documented escape for a literal — a price, a verbatim snippet
#   $@ $*   not substituted
#   ${VAR}  a name, not a position
#
# The whole file is scanned, not just its fenced blocks: substitution does not
# read markdown, so a comment explaining this trap is rewritten by it too.
positional_check() {
  pc_file="$1"; pc_label="$2"
  while IFS= read -r hit; do
    [ -n "$hit" ] && err "$pc_label: positional parameter in substituted content — $hit"
  done < <(awk '
    match($0, /(^|[^\\])\$\{?[0-9]/) {
      start = (RSTART > 20) ? RSTART - 20 : 1
      printf "line %d: %s%s\n", NR, (start > 1 ? "..." : ""), substr($0, start, 70)
    }' "$pc_file")
}

# The Agent Skills spec caps a skill `description` at 1024 characters, and
# nothing else counts them: `claude plugin validate` does not look at the length
# at all, so an over-long one reaches a release unremarked.
#
# Measuring it means folding the YAML scalar, and this reads the subset the repo
# actually writes rather than pretending to be a YAML parser:
#
#   description: >-        a folded block; every line break becomes one character,
#   description: |         a literal block; ditto, absent blank lines
#   description: text      a plain or quoted one-liner, continuation lines folded
#
# Anything else prints UNSUPPORTED and the caller errors, because an approximate
# count against a hard limit is worse than no count — it passes what it should
# stop. A blank line inside a literal block is the one such case: `>` folds it to
# a single newline (which the arithmetic below already gets right) while `|` keeps
# both, and guessing which by one character at exactly 1024 is not a check.
description_len() {
  # awk folds the scalar; it does NOT measure it. `length()` counts bytes, and on
  # a description full of em dashes that overreports by several characters against
  # a limit expressed in characters. The arithmetic below does the measuring.
  dl_raw=$(awk '
    NR == 1 { next }                                   # opening ---
    /^---[[:space:]]*$/ { exit }                       # closing --- ends frontmatter

    !mode && /^[[:space:]]*description[[:space:]]*:/ {
      rest = $0
      sub(/^[[:space:]]*description[[:space:]]*:[[:space:]]*/, "", rest)
      sub(/[[:space:]]+$/, "", rest)
      if (rest ~ /^[|>][-+]?$/) {                      # block scalar
        literal = (substr(rest, 1, 1) == "|")
        keep    = (rest !~ /-$/)                       # `-` strips the trailing newline
        mode = 1; next
      }
      # Anything else opening with > or | is a block scalar this does not model —
      # an explicit indentation indicator (`>-2`, `>2-`) most likely. Say so:
      # falling through would read it as a plain one-liner and measure the
      # indicator itself, reporting three characters for a full description.
      if (rest ~ /^[|>]/) { print "!!UNSUPPORTED (block scalar header " rest ")"; exit }
      if (rest == "") { print "!!UNSUPPORTED (empty value)"; exit }
      sub(/^\042/, "", rest); sub(/\042$/, "", rest)   # a quoted one-liner
      sub(/^\047/, "", rest); sub(/\047$/, "", rest)
      out = rest; seen = 1; mode = 2; next
    }

    mode {
      if ($0 ~ /^[^[:space:]]/) { exit }               # next key at column 0 — block over
      line = $0
      sub(/^[[:space:]]+/, "", line); sub(/[[:space:]]+$/, "", line)
      if (line == "") {
        if (literal) { print "!!UNSUPPORTED (blank line in a literal block)"; exit }
        next                                           # folded: the break collapses to the
      }                                                # single separator already counted
      out = out (seen ? " " : "") line
      seen = 1
    }

    END {
      if (!seen) { print "!!NODESC"; exit }
      # The chomp indicator rides on the FIRST line, not the last: command
      # substitution strips trailing newlines, so a `>` that keeps one would come
      # back indistinguishable from a `>-` that does not.
      printf "%d\n%s", (mode == 1 && keep ? 1 : 0), out
    }
  ' "$1")

  case "$dl_raw" in '!!'*) printf '%s\n' "${dl_raw#\!\!}"; return 0 ;; esac

  dl_adjust=${dl_raw%%$'\n'*}
  dl_text=${dl_raw#*$'\n'}
  # Characters, not bytes, and without depending on a UTF-8 locale being present:
  # every byte of a valid UTF-8 stream is either a character's first byte or a
  # continuation byte in 0x80-0xBF, so the difference is the character count.
  dl_bytes=$(printf '%s' "$dl_text" | wc -c | tr -d ' ')
  dl_cont=$(printf '%s' "$dl_text" | LC_ALL=C tr -dc '\200-\277' | wc -c | tr -d ' ')
  echo $(( dl_bytes - dl_cont + dl_adjust ))
}

# --- marketplace.json -------------------------------------------------------
if [ ! -f "$MARKET" ]; then
  err "$MARKET not found"
elif ! jq empty "$MARKET" 2>/dev/null; then
  err "$MARKET is not valid JSON"
else
  [ "$(jq -r '.name | type' "$MARKET")" = "string" ] || err "marketplace: 'name' must be a string"
  [ -n "$(jq -r '.owner.name // empty' "$MARKET")" ]  || err "marketplace: missing 'owner.name'"
  [ "$(jq -r '.plugins | type' "$MARKET")" = "array" ] || err "marketplace: 'plugins' must be an array"
  ok "marketplace.json: $(jq -r '.name' "$MARKET")"

  # duplicate plugin names
  dupes=$(jq -r '.plugins[].name' "$MARKET" | sort | uniq -d)
  [ -z "$dupes" ] || err "duplicate plugin names: $(echo "$dupes" | tr '\n' ' ')"

  count=$(jq '.plugins | length' "$MARKET")
  if [ "$count" -gt 0 ]; then
    for i in $(seq 0 $((count - 1))); do
      name=$(jq -r ".plugins[$i].name // empty" "$MARKET")
      srctype=$(jq -r ".plugins[$i].source | type" "$MARKET")
      src=$(jq -r ".plugins[$i].source // empty" "$MARKET")

      [ -n "$name" ]            || err "plugins[$i]: missing 'name'"
      [ "$srctype" != "null" ]  || err "plugins[$i] ($name): missing 'source'"

      # external MCP wrappers live under ./external_plugins/ and mirror the
      # claude-plugins-official layout: an upstream-named, version-less thin
      # wrapper around a third-party / own npm MCP server. They are exempt from
      # the hcb- prefix and the per-plugin-semver axis that first-party
      # ./plugins/* must satisfy.
      is_external=0
      case "$src" in ./external_plugins/*) is_external=1 ;; esac

      # naming convention: first-party plugin names must start with hcb-
      if [ "$is_external" = 0 ]; then
        case "$name" in
          hcb-* | "") : ;;
          *) err "plugins[$i] ('$name'): plugin name must start with 'hcb-' (repo convention)" ;;
        esac
      fi

      # version lives in plugin.json ONLY — never on the marketplace entry
      # (applies to every entry, regardless of source type or strict mode)
      mkver=$(jq -r ".plugins[$i].version // empty" "$MARKET")
      [ -z "$mkver" ] || err "plugins[$i] ($name): remove 'version' from the marketplace entry — it lives in plugin.json only"

      # relative-path source → validate the local plugin directory
      if [ "$srctype" = "string" ]; then
        case "$src" in
          ./*) : ;;
          *) err "plugins[$i] ($name): string source must start with './' (got '$src')"; continue ;;
        esac
        case "$src" in *..*) err "plugins[$i] ($name): source must not contain '..'" ;; esac

        dir="${src#./}"
        [ -d "$dir" ] || { err "plugins[$i] ($name): source dir '$dir' does not exist"; continue; }

        strict=$(jq -r ".plugins[$i].strict // true" "$MARKET")
        pj="$dir/.claude-plugin/plugin.json"
        if [ "$strict" != "false" ]; then
          if [ ! -f "$pj" ]; then
            err "$name: missing $pj (strict mode)"
          elif ! jq empty "$pj" 2>/dev/null; then
            err "$name: $pj is not valid JSON"
          else
            pjname=$(jq -r '.name // empty' "$pj")
            [ -n "$pjname" ] || err "$name: $pj missing 'name'"
            [ "$pjname" = "$name" ] || warn "$name: plugin.json name '$pjname' != marketplace entry '$name'"

            # first-party ./plugins/* carry the hcb- prefix and the repo's single
            # version axis; external_plugins/* wrappers are exempt from both — and
            # must NOT declare a version at all, so a wrapper can't drift into the
            # first-party versioning model.
            if [ "$is_external" = 0 ]; then
              case "$pjname" in hcb-* | "") : ;; *) err "$name: plugin.json name '$pjname' must start with 'hcb-'" ;; esac

              # version: required and valid semver (the repo's single version axis)
              pjver=$(jq -r '.version // empty' "$pj")
              if [ -z "$pjver" ]; then
                err "$name: $pj missing 'version'"
              elif ! printf '%s' "$pjver" | grep -Eq "$SEMVER"; then
                err "$name: version '$pjver' is not valid semver (expected e.g. 1.2.3)"
              fi
            else
              # external wrapper: the version is owned by the upstream npm package,
              # not this manifest — forbid a stray 'version' to keep wrappers
              # version-less (pin the package in .mcp.json instead).
              pjver=$(jq -r '.version // empty' "$pj")
              [ -z "$pjver" ] || err "$name: $pj must not declare 'version' (external wrappers are version-less; pin the package in .mcp.json)"
            fi
          fi
        fi
        [ -f "$dir/README.md" ] || warn "$name: no README.md in $dir"
        ok "plugin '$name' -> $dir"
      fi
    done
  fi
fi

# --- skills -----------------------------------------------------------------
while IFS= read -r skill; do
  [ -n "$skill" ] || continue
  d=$(dirname "$skill")
  base=$(basename "$d")

  if [ "$(head -n1 "$skill")" != "---" ]; then
    err "skill '$base': SKILL.md must start with '---' frontmatter"
    continue
  fi

  # frontmatter block = everything between the first two '---' lines
  fm=$(awk 'NR==1 { next } /^---[[:space:]]*$/ { exit } { print }' "$skill")

  if ! echo "$fm" | grep -Eq '^[[:space:]]*description[[:space:]]*:'; then
    err "skill '$base': frontmatter missing 'description'"
  else
    dlen=$(description_len "$skill")
    case "$dlen" in
      UNSUPPORTED*) err "skill '$base': cannot measure the description — $dlen; use a folded (>-) or plain scalar" ;;
      NODESC)       err "skill '$base': 'description' key present but empty" ;;
      *) [ "$dlen" -le 1024 ] \
           || err "skill '$base': description is $dlen characters, over the 1024 limit" ;;
    esac
  fi

  fmname=$(echo "$fm" | grep -E '^[[:space:]]*name[[:space:]]*:' | head -n1 \
    | sed -E "s/^[[:space:]]*name[[:space:]]*:[[:space:]]*//; s/^[\"']//; s/[\"']$//")
  if [ -n "$fmname" ] && [ "$fmname" != "$base" ]; then
    warn "skill '$base': frontmatter name '$fmname' != directory name"
  fi

  positional_check "$skill" "skill '$base'"

  ok "skill '$base'"
done < <(find plugins -type f -path '*/skills/*/SKILL.md' 2>/dev/null | sort)

# --- agents -----------------------------------------------------------------
# The other substitution site the docs name. None exist in this repo today; the
# loop is here so the first one added is covered rather than discovered later.
# `commands/` is deliberately NOT scanned: there a positional IS the feature,
# which is exactly why a shell one must not be written beside it.
while IFS= read -r agent; do
  [ -n "$agent" ] || continue
  positional_check "$agent" "agent '$(basename "$agent" .md)'"
done < <(find plugins -type f -path '*/agents/*.md' 2>/dev/null | sort)

# --- link form --------------------------------------------------------------
# Whether a link still RESOLVES is lychee's job (lychee.toml); this checks the
# shape the repo agreed on, which no link checker can see. Two of the five rules
# below live entirely in code spans — invisible to any link checker by
# construction, since a backtick is not a link.
#
# Every path is relative to the file it is written in, so each rule resolves
# candidates against that file's own directory, never against the repo root.

# Basenames of the shared references. Rules 3 and 5 apply only to these: a
# mention of `.github/dependabot.yml` or `package.json` is describing the user's
# project, not pointing at a file here, and must not be dragged into a link.
ref_names=$(find plugins -type f -path '*/references/*.md' -exec basename {} \; 2>/dev/null | sort -u)

# Every markdown file git would let you commit — tracked and not-yet-added alike.
# A plain `find .` also descends into whatever git is ignoring —
# `.claude/worktrees/`, `.worktrees/`, `node_modules/` — so a checkout with a
# stale nested worktree fails the gate on a copy of the repo that is not the one
# being validated; git will not report an ignored path at all.
#
# `-c` alone would skip a file the author has just written, which is exactly when
# they run this: the gate would pass locally and the same rules would then fail in
# CI, where the file has become tracked. `-o --exclude-standard` adds the
# untracked-but-committable ones without letting the ignored directories back in.
# The fallback prunes those by name: without a `.git` there is nothing to ask, and
# a source tree unpacked from an archive can still carry a worktree directory
# someone copied in.
md_files() {
  if git rev-parse --git-dir >/dev/null 2>&1; then
    git ls-files -co --exclude-standard '*.md' | sort -u
  else
    find . \( -name .git -o -path './.claude/worktrees' -o -name .worktrees -o -name node_modules \) -prune \
      -o -type f -name '*.md' -print 2>/dev/null | sed 's|^\./||' | sort
  fi
}

# A fenced block holds examples, not links. CLAUDE.md and CONTRIBUTING.md both
# show the convention by writing out the wrong form next to the right one, and a
# rule that reads those would fail the very file that defines it. Blank the
# fenced lines rather than dropping them, so reported line content still lines up
# with the file.
prose() { awk '/^[[:space:]]*(```|~~~)/ { f = !f; print ""; next } f { print ""; next } { print }' "$1"; }

# NOTE: every loop below reads via `< <(...)` process substitution, never
# `cmd | while`. A pipeline puts the loop in a subshell, where `err` still
# prints but its increment of $errors is discarded when the subshell exits —
# the script would report failures and then exit 0.
while IFS= read -r md; do
  [ -n "$md" ] || continue
  case "$(basename "$md")" in README.md|CONTRIBUTING.md) audience=human ;; *) audience=claude ;; esac
  body=$(prose "$md")

  # Targets linked anywhere in this file, by basename. Rule 5 reads it.
  linked=$(printf '%s\n' "$body" | grep -o ']([^)]*)' 2>/dev/null \
    | sed 's/^](//; s/)$//; s/#.*//' | sed 's|.*/||' | sort -u)

  # 1. A link text written as a path must BE the path it points at. Prose text
  #    ([MIT](LICENSE), [`hcb-dev`](plugins/hcb-dev)) is exempt: only a text
  #    containing a slash or a file extension is claiming to be a path. A
  #    `#fragment` on the target is not part of the path — deep-linking to a
  #    section is exactly what the "read this" lists encourage.
  while IFS= read -r lnk; do
    [ -n "$lnk" ] || continue
    text=${lnk#*[\`}; text=${text%%\`]*}
    tgt=${lnk##*](}; tgt=${tgt%)}
    case "$tgt" in http*|mailto:*) continue ;; esac
    case "$text" in *[/.]*) ;; *) continue ;; esac
    [ "$text" = "$tgt" ] || [ "$text" = "${tgt%%#*}" ] \
      || err "$md: link text '$text' is not its target '$tgt'"
  done < <(printf '%s\n' "$body" | grep -o '\[`[^`]*`\]([^)]*)' 2>/dev/null)

  # 2. '## Reference files' is the one list whose entire job is to send the
  #    reader elsewhere. Every entry is a link.
  while IFS= read -r line; do
    [ -n "$line" ] && err "$md: Reference files entry is not a link: $line"
  done < <(printf '%s\n' "$body" | awk '
    /^## Reference files/ { inref = 1; next }
    /^## / { inref = 0 }
    inref && /^- / && !/\]\(/ { print substr($0, 1, 60) }
  ')

  # 3. ${CLAUDE_PLUGIN_ROOT} is substituted in skill and agent content only, and
  #    a relative path already resolves everywhere — so no markdown file is ever
  #    named through it. Restricted to `.md` on purpose: a bundled *script* path
  #    is the placeholder's documented use, including inside `allowed-tools`
  #    frontmatter, and is nothing anyone would link. A `<name>` template is
  #    exempt too — CONTRIBUTING.md teaches the pattern with one, and a template
  #    names no file to link.
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    case "$hit" in *'<'*) continue ;; esac
    err "$md: '$hit' — link the file by relative path instead"
  done < <(printf '%s\n' "$body" | grep -o '\${CLAUDE_PLUGIN_ROOT}/[A-Za-z0-9._/<>-]*\.md' 2>/dev/null)

  # 4. A docs URL fetched by Claude should return raw markdown; one a person
  #    clicks should return the rendered page. Which applies is decided by the
  #    file it is written in, not by the link. Sentence punctuation is not part
  #    of a URL — without trimming it, `…/hooks.md.` reads as missing the suffix
  #    it already carries.
  while IFS= read -r u; do
    [ -n "$u" ] || continue
    u=${u%%[.,;:)]}
    case "$u" in *llms.txt) continue ;; esac
    if [ "$audience" = human ]; then
      case "$u" in *.md) err "$md: '$u' — drop '.md', this file is read by people" ;; esac
    else
      case "$u" in *.md) ;; *) err "$md: '$u' — add '.md', this file is fetched by Claude" ;; esac
    fi
  done < <(printf '%s\n' "$body" | grep -o 'https://code\.claude\.com/docs/[A-Za-z0-9./-]*' 2>/dev/null)

  # 5. A bare backticked reference is the short form for something already
  #    linked in this file. With no link anywhere in it, the reader has no way
  #    to reach the file at all. A file naming itself is not a pointer — there
  #    is nothing to link it to.
  while IFS= read -r m; do
    [ -n "$m" ] || continue
    case "$m" in '${'*) continue ;; esac   # rule 3 already owns the placeholder form
    b=${m##*/}
    [ "$b" = "$(basename "$md")" ] && continue
    printf '%s\n' "$ref_names" | grep -qxF -- "$b" || continue
    printf '%s\n' "$linked" | grep -qxF -- "$b" \
      || err "$md: '$m' is never linked in this file — link its first mention"
  done < <(printf '%s\n' "$body" | grep -o '`[^`]*\.md`' 2>/dev/null | tr -d '`' | sort -u)
done < <(md_files)

# --- summary ----------------------------------------------------------------
echo ""
echo "Summary: $errors error(s), $warnings warning(s)."
if [ "$errors" -ne 0 ]; then
  echo "VALIDATION FAILED"
  exit 1
fi
echo "VALIDATION PASSED"
