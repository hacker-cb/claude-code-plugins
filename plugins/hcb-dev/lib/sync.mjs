import { loadManifest, canonBody } from "./manifest.mjs";
import { loadLock, saveLock, lockEntry, isEnabled } from "./lock.mjs";
import { managedRulePath, managedRulesDir } from "./paths.mjs";
import { renderManaged } from "./render.mjs";
import { sha256 } from "./hash.mjs";
import { readIfExists, writeFileEnsured, removeIfExists, pruneEmptyDir } from "./fsutil.mjs";

/**
 * @typedef {object} SyncResult
 * @property {string[]} written    rules written or updated on disk
 * @property {string[]} unchanged  rules already byte-identical to canon
 * @property {string[]} removed    managed files deleted (disabled or dropped from canon)
 * @property {import("./lock.mjs").Lock} lock  the rewritten lock
 */

/**
 * Sync a project's managed rule files against the plugin canon. Enabled rules
 * are written into `.claude/rules/hcb/`; rules disabled in the lock (or dropped
 * from the manifest) are deleted; the lock is rewritten with fresh hashes. A new
 * canon rule auto-adopts unless the lock disables it. Idempotent.
 *
 * @param {string} pluginRoot `${CLAUDE_PLUGIN_ROOT}`
 * @param {string} projectDir project root
 * @returns {SyncResult}
 */
export function syncFiles(pluginRoot, projectDir) {
  const manifest = loadManifest(pluginRoot);
  const oldLock = loadLock(projectDir);

  /** @type {string[]} */ const written = [];
  /** @type {string[]} */ const unchanged = [];
  /** @type {string[]} */ const removed = [];
  /** @type {import("./lock.mjs").LockEntry[]} */ const newRules = [];
  const manifestNames = new Set(manifest.rules.map((r) => r.name));

  for (const rule of manifest.rules) {
    const prev = lockEntry(oldLock, rule.name);
    const enabled = prev ? isEnabled(prev) : true;
    const file = managedRulePath(projectDir, rule.name);

    if (!enabled) {
      if (removeIfExists(file)) removed.push(rule.name);
      newRules.push({ name: rule.name, enabled: false });
      continue;
    }

    const content = renderManaged(rule.name, canonBody(pluginRoot, rule));
    if (readIfExists(file) === content) {
      unchanged.push(rule.name);
    } else {
      writeFileEnsured(file, content);
      written.push(rule.name);
    }
    newRules.push({ name: rule.name, sha256: sha256(content) });
  }

  // Rules dropped from the manifest but still recorded in the old lock → delete.
  for (const prev of oldLock.rules) {
    if (!manifestNames.has(prev.name) && removeIfExists(managedRulePath(projectDir, prev.name))) {
      removed.push(prev.name);
    }
  }

  /** @type {import("./lock.mjs").Lock} */
  const lock = { managed_by: "hcb-dev", rules: newRules };
  saveLock(projectDir, lock);
  pruneEmptyDir(managedRulesDir(projectDir));
  return { written, unchanged, removed, lock };
}
