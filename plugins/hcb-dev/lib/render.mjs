/**
 * The single-line banner placed at the top of every managed rule file. It is
 * part of the rendered file compared on `check`, so altering or dropping it
 * registers as drift.
 *
 * @param {string} name rule name
 * @returns {string}
 */
export function managedHeader(name) {
  return `<!-- MANAGED by hcb-dev (canonical/${name}.md) — do not edit; run /hcb-dev:rules sync. -->`;
}

/**
 * Render the full managed-file content: header, a blank line, the canon body
 * (trailing whitespace trimmed), and exactly one final newline. Pure and
 * idempotent — re-rendering the same canon yields byte-identical output.
 *
 * @param {string} name
 * @param {string} body canon source body
 * @returns {string}
 */
export function renderManaged(name, body) {
  return `${managedHeader(name)}\n\n${body.replace(/\s+$/, "")}\n`;
}
