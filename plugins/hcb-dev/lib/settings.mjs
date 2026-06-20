import path from "node:path";
import { readIfExists } from "./fsutil.mjs";

/**
 * Read and parse a project's `.claude/settings.json`. Returns `null` when the
 * file is absent or unparseable — a missing settings file is a soft condition,
 * never an engine failure.
 *
 * @param {string} projectDir
 * @returns {Record<string, any> | null}
 */
export function readSettings(projectDir) {
  const raw = readIfExists(path.join(projectDir, ".claude/settings.json"));
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Which expected plugin ids are **not** enabled in `settings.enabledPlugins`?
 * Accepts both the object form (`{ "id@mp": true }`) and the array form
 * (`["id@mp"]`); a missing/garbled settings file means all are missing.
 *
 * @param {Record<string, any> | null} settings
 * @param {string[]} expected plugin ids, e.g. `["hcb-dev@hacker-cb-plugins"]`
 * @returns {string[]}
 */
export function missingPlugins(settings, expected) {
  const enabled = settings?.enabledPlugins;
  const isOn = (/** @type {string} */ id) =>
    Array.isArray(enabled) ? enabled.includes(id) : enabled?.[id] === true;
  return expected.filter((id) => !isOn(id));
}
