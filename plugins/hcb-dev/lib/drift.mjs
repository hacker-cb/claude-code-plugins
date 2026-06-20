import path from "node:path";
import { loadManifest, canonBody } from "./manifest.mjs";
import { loadLock, lockEntry, isEnabled } from "./lock.mjs";
import { managedRulePath } from "./paths.mjs";
import { renderManaged } from "./render.mjs";
import { readIfExists } from "./fsutil.mjs";

/**
 * @typedef {"edited" | "missing" | "orphan"} DriftReason
 *   `edited` — on-disk content differs from re-rendered canon (local edit **or**
 *   the canon advanced since last sync); `missing` — an enabled rule has no
 *   managed file; `orphan` — a managed file exists for a rule that should be
 *   absent (disabled in the lock or dropped from canon).
 */

/**
 * @typedef {object} DriftItem
 * @property {string} name
 * @property {DriftReason} reason
 * @property {string} detail human-readable, with the project-relative path
 */

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok        no drift
 * @property {DriftItem[]} drift
 * @property {string[]} checked  enabled rules that were compared
 */

/**
 * Check a project's managed files against the plugin canon: re-render each
 * enabled rule and compare to the on-disk file. Catches local edits, canon
 * advances, missing files, and orphans.
 *
 * @param {string} pluginRoot
 * @param {string} projectDir
 * @returns {CheckResult}
 */
export function checkFiles(pluginRoot, projectDir) {
  const manifest = loadManifest(pluginRoot);
  const lock = loadLock(projectDir);
  /** @type {DriftItem[]} */ const drift = [];
  /** @type {string[]} */ const checked = [];
  const manifestNames = new Set(manifest.rules.map((r) => r.name));
  const rel = (/** @type {string} */ f) => path.relative(projectDir, f);

  for (const rule of manifest.rules) {
    const prev = lockEntry(lock, rule.name);
    const enabled = prev ? isEnabled(prev) : true;
    const file = managedRulePath(projectDir, rule.name);
    const onDisk = readIfExists(file);

    if (!enabled) {
      if (onDisk !== null) drift.push({ name: rule.name, reason: "orphan", detail: `disabled rule still has ${rel(file)}` });
      continue;
    }
    checked.push(rule.name);
    if (onDisk === null) {
      drift.push({ name: rule.name, reason: "missing", detail: `expected ${rel(file)}` });
      continue;
    }
    if (onDisk !== renderManaged(rule.name, canonBody(pluginRoot, rule))) {
      drift.push({ name: rule.name, reason: "edited", detail: `${rel(file)} differs from canon` });
    }
  }

  for (const prev of lock.rules) {
    if (!manifestNames.has(prev.name)) {
      const file = managedRulePath(projectDir, prev.name);
      if (readIfExists(file) !== null) drift.push({ name: prev.name, reason: "orphan", detail: `${rel(file)} is no longer in canon` });
    }
  }

  return { ok: drift.length === 0, drift, checked };
}
