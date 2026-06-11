#!/usr/bin/env bash
#
# Render a DBML schema to an ER diagram: SVG always, PNG when possible.
#
# Pipeline: @softwaretechnik/dbml-renderer (DBML -> SVG, graphviz compiled to
# WASM — no native graphviz needed) + @resvg/resvg-js (SVG -> PNG, uses system
# fonts). Both install on first run into a per-user cache and are reused after,
# so only the first run needs network access.
#
# Usage:
#   render-dbml.sh -i schema.dbml [-o OUTDIR] [-w WIDTH] [--svg-only]
#
#   -i, --input     DBML file (required)
#   -o, --outdir    output directory (default: directory of the input file)
#   -w, --width     PNG width in px (default: 2400)
#       --svg-only  skip PNG rasterization
#
# Prints "SVG: <path>" and "PNG: <path>" on success.
# Requirements: node >= 18, npm.

set -euo pipefail

INPUT=""
OUTDIR=""
WIDTH=2400
SVG_ONLY=0

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    -i|--input)  INPUT="$2";  shift 2 ;;
    -o|--outdir) OUTDIR="$2"; shift 2 ;;
    -w|--width)  WIDTH="$2";  shift 2 ;;
    --svg-only)  SVG_ONLY=1;  shift ;;
    -h|--help)   usage; exit 0 ;;
    *) echo "ERROR: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -n "$INPUT" ] || { echo "ERROR: -i <schema.dbml> is required" >&2; exit 2; }
[ -f "$INPUT" ] || { echo "ERROR: input file not found: $INPUT" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { echo "ERROR: node is required (>= 18)" >&2; exit 2; }
command -v npm  >/dev/null 2>&1 || { echo "ERROR: npm is required" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Renderer deps live in a per-user cache, not the plugin directory: installed
# plugins must be treated as read-only, and the cache survives plugin updates.
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/hcb-diagrams/dbml-renderer"
mkdir -p "$CACHE"

if [ ! -x "$CACHE/node_modules/.bin/dbml-renderer" ] || [ ! -d "$CACHE/node_modules/@resvg/resvg-js" ]; then
  echo "Installing renderer dependencies into $CACHE (first run only)..." >&2
  (
    cd "$CACHE"
    [ -f package.json ] || npm init -y >/dev/null 2>&1
    npm install --no-audit --no-fund --loglevel=error \
      "@softwaretechnik/dbml-renderer@^1.0.31" \
      "@resvg/resvg-js@^2.6.2" 1>&2
  )
fi

base="$(basename "$INPUT")"
base="${base%.*}"
if [ -z "$OUTDIR" ]; then
  OUTDIR="$(cd "$(dirname "$INPUT")" && pwd)"
else
  mkdir -p "$OUTDIR"
  OUTDIR="$(cd "$OUTDIR" && pwd)"
fi

SVG="$OUTDIR/$base.svg"
PNG="$OUTDIR/$base.png"

"$CACHE/node_modules/.bin/dbml-renderer" -i "$INPUT" -o "$SVG"
echo "SVG: $SVG"

[ "$SVG_ONLY" -eq 1 ] && exit 0

if DBML_RENDER_CACHE="$CACHE" node "$SCRIPT_DIR/svg-to-png.mjs" "$SVG" "$PNG" "$WIDTH"; then
  echo "PNG: $PNG"
else
  echo "WARN: PNG rasterization failed — the SVG above is still valid; pass --svg-only to skip PNG" >&2
fi
