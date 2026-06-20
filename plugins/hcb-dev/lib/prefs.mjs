/**
 * Render the developer "house style" preamble injected at SessionStart. Values
 * come from this plugin's `userConfig` (see plugin.json), which Claude Code
 * exports to plugin subprocesses as `CLAUDE_PLUGIN_OPTION_<key>` env vars. Both
 * the declared lower-case key and an upper-case variant are read for robustness,
 * with defaults so the hook works before any configuration. Pure over `env` so
 * it is unit-testable; `hooks/inject-prefs.mjs` is the thin process wrapper.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function renderHouseStyle(env) {
  const pref = (/** @type {string} */ lower, /** @type {string} */ upper, /** @type {string} */ dflt) =>
    env[`CLAUDE_PLUGIN_OPTION_${lower}`] ?? env[`CLAUDE_PLUGIN_OPTION_${upper}`] ?? dflt;

  const langChat = pref("lang_chat", "LANG_CHAT", "Russian");
  const langPlans = pref("lang_plans", "LANG_PLANS", "Russian");
  const langComments = pref("lang_comments", "LANG_COMMENTS", "English");
  const langDocs = pref("lang_docs", "LANG_DOCS", "English");
  const langIssues = pref("lang_issues", "LANG_ISSUES", "Russian");
  const useEmojis = pref("use_emojis", "USE_EMOJIS", "true");

  // Emojis on unless explicitly falsy; the bullet carries its own leading
  // newline so the chat line has no stray blank line when disabled.
  const emojiBullet = /^(false|0|no|off)$/i.test(useEmojis)
    ? ""
    : "\n- Use emojis to keep chat friendly and engaging.";

  return `# Developer house style (hcb-dev)

Personal defaults at low priority — apply them only when nothing more specific
does. Project instructions (e.g. CLAUDE.md), conventions already established in
the repo, and explicit requests in the conversation all take precedence over the
preferences below.

## Communication in chat
- Communicate in ${langChat}.${emojiBullet}

## Language by scope
- Temporary plan/spec working notes (docs/**/plans, docs/**/specs, ~/.claude/plans): ${langPlans}.
  These are temporary, per-task notes — removed once the task ships; don't link them from durable artifacts.
- Code comments: ${langComments}.
- Project documentation: ${langDocs}.
- GitHub / GitLab issues (titles, descriptions, comments): ${langIssues}.
- Other durable artifacts (code identifiers, commit messages): English.
`;
}
