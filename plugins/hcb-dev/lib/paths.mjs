import path from "node:path";
import { HcbError } from "./errors.mjs";

/** Project-relative directory holding hcb-managed rule files. */
export const MANAGED_RULES_DIR = ".claude/rules/hcb";

/**
 * Is `name` a safe rule name — a single path segment that cannot traverse out
 * of the managed dir? Rule names come from the manifest and the on-disk lock
 * (the latter is editable), and a name is joined into a filesystem path, so a
 * name containing a separator, a leading dot, or `..` could escape
 * `.claude/rules/hcb/` and cause an out-of-tree write/delete. Allow only
 * `[A-Za-z0-9._-]`, starting with an alphanumeric — by construction a single
 * segment with no separator and no leading dot, so `path.join` keeps it inside.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isSafeRuleName(name) {
  return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
}
/** Project-relative directory holding hcb-dev project state (lock + companions). */
export const STATE_DIR = ".claude/hcb-dev";
/** Project-relative path of the adoption lock. */
export const LOCK_FILE = `${STATE_DIR}/rules.json`;

/**
 * Absolute path of a managed rule file within a project.
 *
 * @param {string} projectDir
 * @param {string} name rule name, e.g. `"git-branches"`
 * @returns {string}
 */
export function managedRulePath(projectDir, name) {
  const file = path.join(projectDir, MANAGED_RULES_DIR, `${name}.md`);
  // Defense-in-depth: callers validate names at the manifest/lock boundary, but
  // never let a name escape the managed dir even if a future caller forgets.
  if (!isManagedRulePath(projectDir, file)) {
    throw new HcbError(`unsafe managed rule name '${name}': resolves outside ${MANAGED_RULES_DIR}`);
  }
  return file;
}

/**
 * Absolute directory holding managed rule files.
 *
 * @param {string} projectDir
 * @returns {string}
 */
export function managedRulesDir(projectDir) {
  return path.join(projectDir, MANAGED_RULES_DIR);
}

/**
 * Absolute path of the project adoption lock.
 *
 * @param {string} projectDir
 * @returns {string}
 */
export function lockPath(projectDir) {
  return path.join(projectDir, LOCK_FILE);
}

/**
 * Is `filePath` a file **inside** the project's managed-rules directory?
 * `filePath` may be absolute or relative to `projectDir`. The managed directory
 * itself (not a file under it) returns `false`. Backs the containment assert in
 * {@link managedRulePath}, so no managed write can escape the dir.
 *
 * @param {string} projectDir
 * @param {string} filePath
 * @returns {boolean}
 */
export function isManagedRulePath(projectDir, filePath) {
  if (!filePath) return false;
  const abs = path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath);
  const rel = path.relative(managedRulesDir(projectDir), abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  return true;
}
