---
description: Sync or check this project's hcb-dev managed rules (.claude/rules/hcb/) against the plugin canon.
argument-hint: '[sync|check]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`ARGS="$ARGUMENTS"; node "${CLAUDE_PLUGIN_ROOT}/bin/hcb-rules" ${ARGS:-check}`

The block above is the output of the hcb-dev rules engine for this repository.

- **`sync`** writes/updates/removes managed rule files under `.claude/rules/hcb/`
  and rewrites the adoption lock `.claude/hcb-dev/rules.json`. New canon rules
  auto-adopt; rules disabled in the lock are removed.
- **`check`** (the default with no argument) reports drift without writing. A
  non-zero exit means managed files diverge from canon.

Relay the outcome to the user concisely. Never hand-edit files under
`.claude/rules/hcb/` — they are owned by the hcb-dev plugin. To change a rule,
edit its canon in the plugin (`plugins/hcb-dev/rules/canonical/`) and re-run
`/hcb-dev:rules sync`.
