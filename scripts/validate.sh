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
errors=0
warnings=0

err()  { echo "ERROR: $*" >&2; errors=$((errors + 1)); }
warn() { echo "WARN:  $*" >&2; warnings=$((warnings + 1)); }
ok()   { echo "OK:    $*"; }

command -v jq >/dev/null 2>&1 || { echo "FATAL: jq is required but not installed." >&2; exit 2; }

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

      # naming convention: plugin names must start with hcb-
      case "$name" in
        hcb-* | "") : ;;
        *) err "plugins[$i] ('$name'): plugin name must start with 'hcb-' (repo convention)" ;;
      esac

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
            case "$pjname" in hcb-* | "") : ;; *) err "$name: plugin.json name '$pjname' must start with 'hcb-'" ;; esac

            # version: required, valid semver, and declared in plugin.json ONLY
            pjver=$(jq -r '.version // empty' "$pj")
            semver='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
            if [ -z "$pjver" ]; then
              err "$name: $pj missing 'version'"
            elif ! printf '%s' "$pjver" | grep -Eq "$semver"; then
              err "$name: version '$pjver' is not valid semver (expected e.g. 1.2.3)"
            fi
            mkver=$(jq -r ".plugins[$i].version // empty" "$MARKET")
            [ -z "$mkver" ] || err "$name: remove 'version' from the marketplace entry — it lives in plugin.json only"
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

  echo "$fm" | grep -Eq '^[[:space:]]*description[[:space:]]*:' \
    || err "skill '$base': frontmatter missing 'description'"

  fmname=$(echo "$fm" | grep -E '^[[:space:]]*name[[:space:]]*:' | head -n1 \
    | sed -E "s/^[[:space:]]*name[[:space:]]*:[[:space:]]*//; s/^[\"']//; s/[\"']$//")
  if [ -n "$fmname" ] && [ "$fmname" != "$base" ]; then
    warn "skill '$base': frontmatter name '$fmname' != directory name"
  fi

  ok "skill '$base'"
done < <(find plugins -type f -path '*/skills/*/SKILL.md' 2>/dev/null | sort)

# --- summary ----------------------------------------------------------------
echo ""
echo "Summary: $errors error(s), $warnings warning(s)."
if [ "$errors" -ne 0 ]; then
  echo "VALIDATION FAILED"
  exit 1
fi
echo "VALIDATION PASSED"
