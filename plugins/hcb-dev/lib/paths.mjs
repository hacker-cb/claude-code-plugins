import path from "node:path";

/** Project-relative directory holding hcb-managed rule files. */
export const MANAGED_RULES_DIR = ".claude/rules/hcb";
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
  return path.join(projectDir, MANAGED_RULES_DIR, `${name}.md`);
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
 * itself (not a file under it) returns `false`. Used by the PreToolUse guard.
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
