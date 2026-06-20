import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Make a fresh unique temp directory. The caller writes a fixture tree into it.
 *
 * @returns {string} absolute path
 */
export function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hcb-test-"));
}

/**
 * Write a file (creating parent dirs) under `dir`.
 *
 * @param {string} dir
 * @param {string} rel
 * @param {string} content
 * @returns {string} absolute path written
 */
export function writeFile(dir, rel, content) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  return file;
}

/**
 * Read a file under `dir` as UTF-8, or `null` if absent.
 *
 * @param {string} dir
 * @param {string} rel
 * @returns {string | null}
 */
export function readFile(dir, rel) {
  try {
    return fs.readFileSync(path.join(dir, rel), "utf8");
  } catch {
    return null;
  }
}

/**
 * Does a file exist under `dir`?
 *
 * @param {string} dir
 * @param {string} rel
 * @returns {boolean}
 */
export function exists(dir, rel) {
  return fs.existsSync(path.join(dir, rel));
}

/**
 * Build a fake plugin root (`rules/manifest.json` + `rules/canonical/*.md`) for
 * engine tests. All rules are tier `canonical`.
 *
 * @param {object} [opts]
 * @param {Record<string, string>} [opts.canon] rule name -> canon body. Defaults to
 *   two rules (`git-branches`, `early-stage`).
 * @returns {string} the plugin root directory
 */
export function makePluginFixture(opts = {}) {
  const dir = makeTempDir();
  const canon = opts.canon ?? {
    "git-branches": "# Git Branches\n\nbody\n",
    "early-stage": "# Early stage\n\nbody\n",
  };
  const rules = Object.keys(canon).map((name) => ({ name, tier: "canonical", source: `canonical/${name}.md` }));
  writeFile(dir, "rules/manifest.json", JSON.stringify({ version: 1, rules }, null, 2));
  for (const [name, body] of Object.entries(canon)) writeFile(dir, `rules/canonical/${name}.md`, body);
  return dir;
}
