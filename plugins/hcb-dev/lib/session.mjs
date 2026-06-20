import { loadLock } from "./lock.mjs";
import { checkFiles } from "./drift.mjs";

/**
 * Build the SessionStart preamble for the rules engine. Stays quiet (`""`) when
 * the project has not adopted hcb-dev rules (an empty lock — nothing to nag
 * about) or when every adopted managed file is in sync; emits a short,
 * actionable note only when adopted rules have drifted from canon. SessionStart
 * adds stdout straight to context, so silence is the default to avoid noise.
 *
 * @param {string} pluginRoot `${CLAUDE_PLUGIN_ROOT}`
 * @param {string} projectDir project root
 * @returns {string}
 */
export function sessionStartReport(pluginRoot, projectDir) {
  const lock = loadLock(projectDir);
  if (lock.rules.length === 0) return "";
  const { ok, drift } = checkFiles(pluginRoot, projectDir);
  if (ok) return "";
  return [
    "# hcb-dev managed rules — drift detected",
    "",
    "The project's hcb-managed rules under `.claude/rules/hcb/` no longer match the plugin canon:",
    "",
    ...drift.map((d) => `- ${d.name} (${d.reason}): ${d.detail}`),
    "",
    "Run `/hcb-dev:rules sync` to reconcile. Never hand-edit files under `.claude/rules/hcb/`.",
  ].join("\n");
}
