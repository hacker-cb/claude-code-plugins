#!/usr/bin/env bash
#
# hcb-dev SessionStart hook: inject the developer "house style" into every
# session. Values come from this plugin's userConfig (see plugin.json), exported
# by Claude Code as CLAUDE_PLUGIN_OPTION_* env vars; defaults below keep the hook
# working even before the plugin is configured.
#
# SessionStart adds whatever a command hook prints to stdout straight into the
# session context, so this script just prints the guidance — no JSON needed.

lang_chat="${CLAUDE_PLUGIN_OPTION_lang_chat:-Russian}"
lang_plans="${CLAUDE_PLUGIN_OPTION_lang_plans:-Russian}"
lang_comments="${CLAUDE_PLUGIN_OPTION_lang_comments:-English}"
lang_docs="${CLAUDE_PLUGIN_OPTION_lang_docs:-English}"
use_emojis="${CLAUDE_PLUGIN_OPTION_use_emojis:-true}"

emoji_line=""
if [ "$use_emojis" = "true" ]; then
  emoji_line="- Use emojis to keep chat friendly and engaging."
fi

cat <<EOF
# Developer house style (hcb-dev)

## Communication in chat
- Communicate in ${lang_chat}.
${emoji_line}

## Language by scope
- Temporary plan/spec working notes (docs/**/plans, docs/**/specs, ~/.claude/plans): ${lang_plans}.
  These are temporary, per-task notes — removed once the task ships; don't link them from durable artifacts.
- Code comments: ${lang_comments}.
- Project documentation: ${lang_docs}.
- Other durable artifacts (code identifiers, commit messages): English.
EOF

exit 0
