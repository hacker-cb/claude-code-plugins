import { loadLock } from "./lock.mjs";
import { checkFiles } from "./drift.mjs";

/** One-line awareness note for an adopted, in-sync project. */
const MANAGED_NOTE =
  "hcb-dev manages `.claude/rules/hcb/**` (synced from plugin canon) — to change a rule, " +
  "edit the canon and run `/hcb-dev:rules sync`; do not edit the synced files in place.";

/**
 * Build the SessionStart preamble for the rules engine. Stays quiet (`""`) for a
 * project that has not adopted hcb-dev rules (an empty lock — nothing to say).
 * For an adopted project it always states that `.claude/rules/hcb/**` is managed
 * (a one-liner when in sync) and escalates to an actionable drift report when the
 * managed files no longer match canon. SessionStart adds stdout straight to
 * context, so the in-sync case is kept to a single line.
 *
 * @param {string} pluginRoot `${CLAUDE_PLUGIN_ROOT}`
 * @param {string} projectDir project root
 * @returns {string}
 */
export function sessionStartReport(pluginRoot, projectDir) {
  const lock = loadLock(projectDir);
  if (lock.rules.length === 0) return "";
  const { ok, drift } = checkFiles(pluginRoot, projectDir);
  if (ok) return MANAGED_NOTE;
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
