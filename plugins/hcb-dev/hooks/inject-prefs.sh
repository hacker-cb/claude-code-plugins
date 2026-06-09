#!/usr/bin/env bash
#
# hcb-dev SessionStart hook: inject the developer "house style" into every
# session. Values come from this plugin's userConfig (see plugin.json), which
# Claude Code exports to plugin subprocesses as CLAUDE_PLUGIN_OPTION_<key> env
# vars. We read both the declared (lower-case) and an upper-case variant for
# robustness, and fall back to defaults so the hook works before configuration.
#
# SessionStart adds whatever a command hook prints to stdout straight into the
# session context, so this script just prints the guidance — no JSON needed.

lang_chat="${CLAUDE_PLUGIN_OPTION_lang_chat:-${CLAUDE_PLUGIN_OPTION_LANG_CHAT:-Russian}}"
lang_plans="${CLAUDE_PLUGIN_OPTION_lang_plans:-${CLAUDE_PLUGIN_OPTION_LANG_PLANS:-Russian}}"
lang_comments="${CLAUDE_PLUGIN_OPTION_lang_comments:-${CLAUDE_PLUGIN_OPTION_LANG_COMMENTS:-English}}"
lang_docs="${CLAUDE_PLUGIN_OPTION_lang_docs:-${CLAUDE_PLUGIN_OPTION_LANG_DOCS:-English}}"
use_emojis="${CLAUDE_PLUGIN_OPTION_use_emojis:-${CLAUDE_PLUGIN_OPTION_USE_EMOJIS:-true}}"

# Emojis on unless the value is explicitly falsy. Appended to the chat line so
# there's no stray blank line when disabled.
emoji_bullet=""
case "$use_emojis" in
  [Ff]alse | 0 | [Nn]o | [Oo]ff) ;;
  *) emoji_bullet=$'\n- Use emojis to keep chat friendly and engaging.' ;;
esac

cat <<EOF
# Developer house style (hcb-dev)

## Communication in chat
- Communicate in ${lang_chat}.${emoji_bullet}

## Language by scope
- Temporary plan/spec working notes (docs/**/plans, docs/**/specs, ~/.claude/plans): ${lang_plans}.
  These are temporary, per-task notes — removed once the task ships; don't link them from durable artifacts.
- Code comments: ${lang_comments}.
- Project documentation: ${lang_docs}.
- Other durable artifacts (code identifiers, commit messages): English.
EOF

exit 0
