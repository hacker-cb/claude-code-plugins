#!/usr/bin/env bash
# One apply run, or `runs` of them over one journal, against the stub forge in stub/.
set -u
root=$(cd "$(dirname "$0")/../../.." && pwd)
env=$STUB_ENVELOPE
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
export STUB_STATE=$work/state.json
jq '.state + {log: []}' "$env" > "$STUB_STATE"
jq '.snapshot' "$env" > "$work/snap.json"
jq '.plan' "$env" > "$work/plan.json"
# A journal line the envelope leaves without a run belongs to this run: the hash apply takes.
sum() { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi; }
run=$(cat "$work/plan.json" "$work/snap.json" | sum | cut -c1-16)
jq -r --arg run "$run" '(.journal // [])[] | .run //= $run | tojson' "$env" > "$work/journal.jsonl"
rc=0
for i in $(seq 1 "$(jq -r '.runs // 1' "$env")"); do
  echo "== run $i"
  node "$root/plugins/hcb-dev/skills/label-taxonomy/scripts/labels.mjs" apply --snapshot "$work/snap.json" \
    --plan "$work/plan.json" --journal "$work/journal.jsonl" "$@"
  rc=$?
done
echo "== writes"; jq -r '.log[]' "$STUB_STATE"
echo "== state"; jq -c '{set: [.set[].name], carriers}' "$STUB_STATE"
exit "$rc"
