import fs from "node:fs";
import path from "node:path";

/**
 * Read a file as UTF-8, or `null` if it does not exist.
 *
 * @param {string} file
 * @returns {string | null}
 */
export function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Write a file, creating parent directories as needed.
 *
 * @param {string} file
 * @param {string} content
 */
export function writeFileEnsured(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

/**
 * Delete a file if it exists.
 *
 * @param {string} file
 * @returns {boolean} `true` if a file was removed
 */
export function removeIfExists(file) {
  try {
    fs.rmSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a directory only if it is empty; a no-op otherwise (non-empty or absent).
 *
 * @param {string} dir
 */
export function pruneEmptyDir(dir) {
  try {
    fs.rmdirSync(dir);
  } catch {
    /* not empty or absent — leave it */
  }
}
