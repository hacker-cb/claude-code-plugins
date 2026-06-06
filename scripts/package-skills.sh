#!/usr/bin/env bash
#
# Package every skill into a standalone "<skill-name>.skill" archive under dist/.
#
# A ".skill" file is simply a zip of the skill directory (containing SKILL.md
# and any supporting files), with the directory at the archive root — the same
# format Claude.ai expects on "Upload skill" and that anthropic's
# package_skill.py produces. Junk files are excluded.
#
# Dependencies: zip, find.
# Usage: bash scripts/package-skills.sh   (run from anywhere; cd's to repo root)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v zip >/dev/null 2>&1 || { echo "FATAL: zip is required but not installed." >&2; exit 2; }

DIST="$ROOT/dist"
mkdir -p "$DIST"

count=0
while IFS= read -r skillmd; do
  [ -n "$skillmd" ] || continue
  skilldir=$(dirname "$skillmd")
  name=$(basename "$skilldir")
  parent=$(dirname "$skilldir")
  out="$DIST/$name.skill"

  rm -f "$out"
  ( cd "$parent" && zip -r -q "$out" "$name" \
      -x '*.DS_Store' '*/__pycache__/*' '*.pyc' '*/node_modules/*' )

  files=$(cd "$parent" && find "$name" -type f | wc -l | tr -d ' ')
  echo "packaged: dist/$name.skill ($files files)"
  count=$((count + 1))
done < <(find plugins -type f -path '*/skills/*/SKILL.md' 2>/dev/null | sort)

echo ""
echo "Done: $count skill(s) packaged into dist/"
