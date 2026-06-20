import { createHash } from "node:crypto";

/**
 * Lowercase hex SHA-256 of a UTF-8 string. Used to record and compare the
 * content of managed rule files (drift detection).
 *
 * @param {string} text
 * @returns {string} 64-char lowercase hex digest
 */
export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
