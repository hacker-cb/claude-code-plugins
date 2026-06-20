import fs from "node:fs";
import path from "node:path";
import { HcbError } from "./errors.mjs";
import { lockPath } from "./paths.mjs";

/**
 * @typedef {object} LockEntry
 * @property {string} name
 * @property {boolean} [enabled]  default `true`; `false` = adopted-but-disabled (e.g. matured early-stage)
 * @property {string} [sha256]    hash of the written managed file (present for enabled rules after sync)
 */

/**
 * @typedef {object} Lock
 * @property {"hcb-dev"} managed_by
 * @property {LockEntry[]} rules
 */

/**
 * A fresh empty lock.
 *
 * @returns {Lock}
 */
export function emptyLock() {
  return { managed_by: "hcb-dev", rules: [] };
}

/**
 * Load the project adoption lock, or an empty lock if none exists yet.
 *
 * @param {string} projectDir
 * @returns {Lock}
 */
export function loadLock(projectDir) {
  const file = lockPath(projectDir);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return emptyLock();
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new HcbError(`lock is not valid JSON (${file}): ${String(e)}`);
  }
  return validateLock(data, file);
}

/**
 * Validate an already-parsed lock object.
 *
 * @param {unknown} data
 * @param {string} [where]
 * @returns {Lock}
 */
export function validateLock(data, where = "lock") {
  if (typeof data !== "object" || data === null) throw new HcbError(`${where}: must be a JSON object`);
  const o = /** @type {Record<string, unknown>} */ (data);
  if (o.managed_by !== "hcb-dev") throw new HcbError(`${where}: 'managed_by' must be "hcb-dev"`);
  if (!Array.isArray(o.rules)) throw new HcbError(`${where}: 'rules' must be an array`);
  const seen = new Set();
  const rules = o.rules.map((r, i) => {
    if (typeof r !== "object" || r === null) throw new HcbError(`${where}: rules[${i}] must be an object`);
    const e = /** @type {Record<string, unknown>} */ (r);
    if (typeof e.name !== "string" || e.name === "") throw new HcbError(`${where}: rules[${i}].name must be a non-empty string`);
    if (seen.has(e.name)) throw new HcbError(`${where}: duplicate lock entry '${e.name}'`);
    seen.add(e.name);
    /** @type {LockEntry} */
    const entry = { name: e.name };
    if (e.enabled !== undefined) {
      if (typeof e.enabled !== "boolean") throw new HcbError(`${where}: rules[${i}].enabled must be a boolean`);
      entry.enabled = e.enabled;
    }
    if (e.sha256 !== undefined) {
      if (typeof e.sha256 !== "string") throw new HcbError(`${where}: rules[${i}].sha256 must be a string`);
      entry.sha256 = e.sha256;
    }
    return entry;
  });
  return { managed_by: "hcb-dev", rules };
}

/**
 * Write the lock as pretty JSON with a trailing newline, creating its directory.
 *
 * @param {string} projectDir
 * @param {Lock} lock
 */
export function saveLock(projectDir, lock) {
  const file = lockPath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

/**
 * Is a lock entry enabled? (absence of `enabled` means enabled.)
 *
 * @param {LockEntry} entry
 * @returns {boolean}
 */
export function isEnabled(entry) {
  return entry.enabled !== false;
}

/**
 * Find a lock entry by name.
 *
 * @param {Lock} lock
 * @param {string} name
 * @returns {LockEntry | undefined}
 */
export function lockEntry(lock, name) {
  return lock.rules.find((r) => r.name === name);
}
