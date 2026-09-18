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
# The semver.org grammar in full — no leading zero on a numeric identifier, prerelease
# ones included, and no empty identifier — and the same one scripts/version-gate.sh
# holds. A version this accepted and the gate did not could land with a new plugin,
# which the gate does not judge, and then stop every later change to that plugin.
NUM='(0|[1-9][0-9]*)'
PRE_ID='(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
SEMVER="^$NUM\.$NUM\.$NUM(-$PRE_ID(\.$PRE_ID)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?\$"
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
    # A verdict reached mid-file still runs END, so mark it: otherwise END adds its
    # own "!!NODESC" underneath and the caller compares a two-line string.
    function bail(msg) { print msg; bailed = 1; exit }

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
      if (rest ~ /^[|>]/) { bail("!!UNSUPPORTED (block scalar header " rest ")") }
      if (rest == "") { bail("!!NODESC") }
      sub(/^\042/, "", rest); sub(/\042$/, "", rest)   # a quoted one-liner
      sub(/^\047/, "", rest); sub(/\047$/, "", rest)
      out = rest; seen = 1; mode = 2; next
    }

    mode {
      if ($0 ~ /^[^[:space:]]/) { exit }               # next key at column 0 — block over
      line = $0
      sub(/^[[:space:]]+/, "", line); sub(/[[:space:]]+$/, "", line)
      if (line == "") {
        if (literal) { bail("!!UNSUPPORTED (blank line in a literal block)") }
        # One blank line folds to the single separator the next line already adds.
        # Two or more fold to that many newlines, which this does not model.
        if (blank++) { bail("!!UNSUPPORTED (consecutive blank lines in a folded block)") }
        next
      }
      blank = 0
      out = out (seen ? " " : "") line
      seen = 1
    }

    END {
      if (bailed) { exit }
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

              # version: required and valid semver (the repo's single version axis).
              # Matched as one string, the way the gate matches it: grep matches per
              # line, so a version carrying a newline passed on its first line alone.
              pjver=$(jq -r '.version // empty' "$pj")
              if [ -z "$pjver" ]; then
                err "$name: $pj missing 'version'"
              elif ! [[ $pjver =~ $SEMVER ]]; then
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
# Enumerated ONCE per run and replayed from the capture: three separate loops read this
# list, and three `git ls-files` over the whole tree is three times the work for one answer
# that cannot change between them.
_md_files_cache=""
md_files() {
  if [ -z "$_md_files_cache" ]; then
    if git rev-parse --git-dir >/dev/null 2>&1; then
      _md_files_cache=$(git ls-files -co --exclude-standard '*.md' | sort -u)
    else
      _md_files_cache=$(find . \( -name .git -o -path './.claude/worktrees' -o -name .worktrees -o -name node_modules \) -prune \
        -o -type f -name '*.md' -print 2>/dev/null | sed 's|^\./||' | sort)
    fi
  fi
  printf '%s\n' "$_md_files_cache"
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
  #    file it is written in, not by the link. The markdown form is per-site —
  #    a `.md` suffix on Claude Code's docs and GitHub's, `<path>/index.md` on
  #    GitLab's, whose bare `<path>.md` is refused outright.
  #
  #    Only a site that serves the form for EVERY page can have it demanded,
  #    and GitHub is not one: a page outside its page list has no markdown
  #    twin, so a demand there would leave a correct link with no spelling that
  #    passes, and this gate is offline and cannot tell the two apart. So a
  #    Claude-read GitHub link is left alone — `lychee` is what proves it
  #    resolves. The reverse direction still holds everywhere, the human branch
  #    included: a suffix in a file people click is wrong on all three sites.
  #
  #    Two trims before any of that, and their order is the whole trick. A bare
  #    autolink lends the URL its closing bracket (`<…/hooks.md>` matches
  #    through the `>`, since the opening one sits outside the match), and a
  #    sentence can add punctuation after it — `<…/hooks.md>.` carries both.
  #    Punctuation goes first: the other order strands the `>` mid-token, where
  #    the extension guard below reads `hooks.md>` as an artefact and skips the
  #    URL silently. The bracket goes only where the match holds no `<`, so a
  #    templated `<path>` keeps its own and leaves as the non-page it is.
  while IFS= read -r u; do
    [ -n "$u" ] || continue
    u=${u%%[.,;:)]}
    case "$u" in *'<'*) ;; *) u=${u%>} ;; esac
    case "$u" in *'<'*) continue ;; esac
    # A last segment carrying any extension other than the markdown one is an
    # artefact, not a page, and no markdown twin exists for it. A rule rather
    # than the list of extensions seen so far — `.png` and `.zip` are as much
    # not-a-page as `.json` is.
    case "${u##*/}" in *.md) ;; *.*) continue ;; esac
    case "$u" in https://docs.github.com/api/*) continue ;; esac
    case "$u" in https://docs.gitlab.com/*) want=/index.md ;; *) want=.md ;; esac
    if [ "$audience" = human ]; then
      case "$u" in *"$want") err "$md: '$u' — drop '$want', this file is read by people" ;; esac
    else
      case "$u" in https://docs.github.com/*) continue ;; esac
      case "$u" in *"$want") ;; *) err "$md: '$u' — use the '$want' form, this file is fetched by Claude" ;; esac
    fi
  done < <(printf '%s\n' "$body" \
    | grep -oE 'https://(code\.claude\.com/docs|docs\.github\.com|docs\.gitlab\.com)/[A-Za-z0-9./@<>_-]*' 2>/dev/null)

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

# --- the plugin root, by how a file reaches Claude ---------------------------
# Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}` where it LOADS the content — a
# SKILL.md, an agent — and nowhere else. A `references/*.md` reaches Claude through
# `Read`, verbatim, and the Bash tool's environment has no such variable, so a command
# copied out of one runs from `/`. So a by-path file names the root `<plugin root>`,
# and every skill whose links reach such a file binds that name once, in a line the
# substitution turns into the real path.
#
# Each check reads the RAW file rather than `prose()`: every violation this gate exists
# for sits inside a fenced block, which `prose()` blanks.
binding_line='**Paths**, substituted at invocation — use verbatim: `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}`.'
placeholder_re='\$\{?(CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA|CLAUDE_SKILL_DIR|CLAUDE_PROJECT_DIR|CLAUDE_SESSION_ID|CLAUDE_EFFORT)\}?'

# 1. A file Claude reads by path carries no substitution placeholder. README.md is a
#    person's file and names the mechanism freely; `commands/` is substituted content.
while IFS= read -r md; do
  [ -n "$md" ] || continue
  case "$md" in plugins/*) ;; *) continue ;; esac
  case "$md" in */SKILL.md|*/agents/*.md|*/commands/*.md|*/README.md) continue ;; esac
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    err "$md: '$hit' reaches Claude as literal text here — name the root '<plugin root>'"
  done < <(grep -oE "$placeholder_re" "$md" 2>/dev/null | sort -u)
done < <(md_files)

# 2. Substituted content names the root through the placeholder. `<plugin root>` is the
#    references' name for it, and the binding line is the one place it is written here.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    [ "$hit" = "$binding_line" ] && continue
    err "$f: '<plugin root>' outside the binding line — substituted content writes \${CLAUDE_PLUGIN_ROOT}"
  done < <(grep -F '<plugin root>' "$f" 2>/dev/null)
  # Unbraced is not substituted, and the Bash tool has no such variable either.
  grep -qE '\$(CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA|CLAUDE_SKILL_DIR|CLAUDE_PROJECT_DIR)([^A-Za-z0-9_{]|$)' "$f" 2>/dev/null \
    && err "$f: a bare \$CLAUDE_… — write \${…}, the form Claude Code substitutes"
done < <(find plugins -type f \( -path '*/skills/*/SKILL.md' -o -path '*/agents/*.md' \) 2>/dev/null | sort)

# 3. The binding stands exactly where a skill can reach a by-path file that names
#    `<plugin root>` — following relative links transitively, which is how a reader
#    gets there. Bound without reaching one is a line that instructs nothing.
norm_path() {
  awk -v p="$1" 'BEGIN {
    n = split(p, a, "/"); k = 0
    for (i = 1; i <= n; i++) {
      if (a[i] == "." || a[i] == "") continue
      if (a[i] == "..") { if (k > 0) k--; continue }
      s[++k] = a[i]
    }
    out = s[1]; for (i = 2; i <= k; i++) out = out "/" s[i]; print out
  }'
}

md_link_targets() {
  grep -o '](\([^)#[:space:]]*\.md\)' "$1" 2>/dev/null | sed 's/^](//' \
    | while IFS= read -r t; do
        case "$t" in http*|*'$'*) continue ;; esac
        norm_path "$(dirname "$1")/$t"
      done
}

while IFS= read -r skill; do
  [ -n "$skill" ] || continue
  seen=$skill; queue=$skill; reached=""
  while [ -n "$queue" ]; do
    cur=${queue%%$'\n'*}
    if [ "$cur" = "$queue" ]; then queue=""; else queue=${queue#*$'\n'}; fi
    [ -f "$cur" ] || continue
    case "$cur" in
      */references/*.md)
        [ -z "$reached" ] && grep -qF '<plugin root>' "$cur" 2>/dev/null && reached=$cur ;;
    esac
    while IFS= read -r t; do
      [ -n "$t" ] || continue
      case "$t" in plugins/*) ;; *) continue ;; esac
      printf '%s\n' "$seen" | grep -qxF -- "$t" && continue
      seen="$seen"$'\n'"$t"
      queue=${queue:+$queue$'\n'}$t
    done < <(md_link_targets "$cur")
  done
  bound=$(grep -cxF "$binding_line" "$skill" 2>/dev/null || true)
  [ -n "$bound" ] || bound=0
  if [ -n "$reached" ] && [ "$bound" -eq 0 ]; then
    err "$(basename "$(dirname "$skill")"): reaches $reached, which names '<plugin root>', and does not bind it"
  elif [ -z "$reached" ] && [ "$bound" -gt 0 ]; then
    err "$(basename "$(dirname "$skill")"): binds '<plugin root>' and reaches no file that names it"
  elif [ "$bound" -gt 1 ]; then
    err "$(basename "$(dirname "$skill")"): the binding line stands $bound times — one is the contract"
  fi
done < <(find plugins -type f -path '*/skills/*/SKILL.md' 2>/dev/null | sort)

# --- the size gate ----------------------------------------------------------
# What a skill costs a session is what it loads, and prose grows one paragraph at a
# time while every paragraph looks worth its line. These two ceilings are the gate
# against that: a `SKILL.md` is a procedure (steps, forks, what to call) and a
# reference is one subject, and neither has ever needed more than this once the
# mechanics live in a script and the measurements in a table.
#
# Two references are named exceptions, and only two. `forge-docs.md` and
# `forge-behaviour.md` are lookup tables rather than prose — the second one is
# where a measured fact goes INSTEAD of into a skill, so a ceiling on it would
# lock the very layer the rest of this gate exists to feed. They grow by rows,
# which a diff shows plainly.
skill_ceiling=200
ref_ceiling=150
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in plugins/*) ;; *) continue ;; esac
  # `git ls-files -co` lists a file deleted in the working tree and not yet committed, and
  # `wc -l` on it leaves `n` empty — which `[ "" -le 200 ]` fails as a syntax error and
  # reports as a ceiling nobody crossed.
  [ -f "$f" ] || continue
  # `wc -l` counts NEWLINES, so a file whose final line is unterminated measures one short —
  # a 201-line file passes a 200-line ceiling. `awk END{print NR}` counts records, which is
  # lines as anyone reading the file means them.
  n=$(awk 'END { print NR }' "$f")
  case "$f" in
    */SKILL.md)
      [ "$n" -le "$skill_ceiling" ] \
        || err "$f: $n lines, over the $skill_ceiling-line ceiling for a SKILL.md — move mechanics to a script, facts to references/forge-behaviour.md, or split by what a reader needs when" ;;
    */references/*.md)
      # The two exemptions are PATHS, not basenames: a `forge-docs.md` in another plugin,
      # or in a skill's own references, is an ordinary reference and takes the ceiling.
      case "$f" in
        plugins/hcb-dev/references/forge-docs.md|plugins/hcb-dev/references/forge-behaviour.md) continue ;;
      esac
      [ "$n" -le "$ref_ceiling" ] \
        || err "$f: $n lines, over the $ref_ceiling-line ceiling for a reference — a reference owns one subject; split it or move what it explains into the code that does it" ;;
  esac
done < <(md_files)

# A fenced shell block longer than this is not an example any more: it is machinery,
# and machinery belongs in a script under test. The count is the lines BETWEEN the
# fences, so the fence markers themselves are not the budget.
#
# Every spelling a shell block is written under, not just ```bash: a rule one relabel
# walks around is not a rule, and `sh`, `shell`, `zsh` and `console` all render the
# same. A block with NO language is left alone deliberately — that is how this repo
# writes a template or a transcript, which is not machinery.
#
# Read through a process substitution rather than a pipe: `... | while read` runs the
# loop in a SUBSHELL, so every `err` it calls increments a counter that dies with it —
# the gate prints its findings and reports zero errors, passing what it just caught.
fence_ceiling=15
while IFS= read -r line; do
  [ -n "$line" ] || continue
  err "$line"
done < <(
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in plugins/*) ;; *) continue ;; esac
    # Markdown fences, by their own rules rather than by a pattern that happens to fit the
    # blocks here today. An opener is three or more backticks or tildes; what closes it is a
    # run of the SAME character, at least as long, carrying nothing else. Everything between
    # is content — including a shorter fence, which is how this repo writes a template that
    # shows a bash block. Tracking only shell fences read that inner one as a real block and
    # failed the template; tracking the enclosing one is what tells them apart.
    #
    # The language is the first word of the info string, lowercased: ```Bash and
    # ```bash title="x" both render as shell, and a gate one relabel walks around is not a
    # gate. A block with no language is deliberately left alone — that is a template or a
    # transcript, not machinery.
    awk -v file="$f" -v cap="$fence_ceiling" '
      function flush(  msg) {
        if (inb && shell && n > cap)
          printf "%s:%d: a shell block of %d lines — that is machinery, and it belongs in a script with a suite\n", file, start, n
      }
      !inb && match($0, /^[[:space:]]*(`{3,}|~{3,})/) {
        fence = substr($0, RSTART, RLENGTH); sub(/^[[:space:]]*/, "", fence)
        info = substr($0, RSTART + RLENGTH); sub(/^[[:space:]]+/, "", info)
        lang = info; sub(/[[:space:]].*$/, "", lang); lang = tolower(lang)
        inb = 1; n = 0; start = NR
        shell = (lang == "bash" || lang == "sh" || lang == "shell" || lang == "zsh" || lang == "console")
        next
      }
      inb {
        # A closer is the same character, no shorter, and nothing else on the line.
        if (match($0, /^[[:space:]]*(`{3,}|~{3,})[[:space:]]*$/)) {
          close_run = $0; sub(/^[[:space:]]*/, "", close_run); sub(/[[:space:]]*$/, "", close_run)
          if (substr(close_run, 1, 1) == substr(fence, 1, 1) && length(close_run) >= length(fence)) {
            flush(); inb = 0; next
          }
        }
        n++
      }
      # An unclosed fence runs to the end of the file, and markdown reads it that way too.
      END { flush() }
    ' "$f"
  done < <(md_files)
)

# --- summary ----------------------------------------------------------------
echo ""
echo "Summary: $errors error(s), $warnings warning(s)."
if [ "$errors" -ne 0 ]; then
  echo "VALIDATION FAILED"
  exit 1
fi
echo "VALIDATION PASSED"
