import fs from "node:fs";
import path from "node:path";
import { HcbError } from "./errors.mjs";

/** @typedef {"canonical" | "parameterized" | "conventional"} Tier */

/**
 * @typedef {object} Companion
 * @property {string} path        project-relative default location of the companion
 * @property {string} contract    plugin-relative JSON Schema the companion must satisfy
 * @property {string} [starter]   plugin-relative starter template
 */

/**
 * @typedef {object} Rule
 * @property {string} name
 * @property {Tier} tier
 * @property {string} source      plugin-relative canon source (e.g. `canonical/git-branches.md`)
 * @property {boolean} [optional] project may disable it once matured (e.g. early-stage)
 * @property {Companion[]} [companions]
 */

/**
 * @typedef {object} Manifest
 * @property {number} version
 * @property {Rule[]} rules
 */

const TIERS = new Set(["canonical", "parameterized", "conventional"]);

/**
 * Load and validate the plugin-side manifest from `${pluginRoot}/rules/manifest.json`.
 *
 * @param {string} pluginRoot `${CLAUDE_PLUGIN_ROOT}`
 * @returns {Manifest}
 */
export function loadManifest(pluginRoot) {
  const file = path.join(pluginRoot, "rules", "manifest.json");
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    throw new HcbError(`manifest not found at ${file}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new HcbError(`manifest is not valid JSON (${file}): ${String(e)}`);
  }
  return validateManifest(data, file);
}

/**
 * Validate an already-parsed manifest object.
 *
 * @param {unknown} data
 * @param {string} [where] label used in error messages
 * @returns {Manifest}
 */
export function validateManifest(data, where = "manifest") {
  if (typeof data !== "object" || data === null) {
    throw new HcbError(`${where}: must be a JSON object`);
  }
  const obj = /** @type {Record<string, unknown>} */ (data);
  if (typeof obj.version !== "number") {
    throw new HcbError(`${where}: 'version' must be a number`);
  }
  if (!Array.isArray(obj.rules)) {
    throw new HcbError(`${where}: 'rules' must be an array`);
  }
  const seen = new Set();
  const rules = obj.rules.map((r, i) => validateRule(r, `${where}: rules[${i}]`, seen));
  return { version: obj.version, rules };
}

/**
 * @param {unknown} r
 * @param {string} where
 * @param {Set<string>} seen
 * @returns {Rule}
 */
function validateRule(r, where, seen) {
  if (typeof r !== "object" || r === null) throw new HcbError(`${where}: must be an object`);
  const o = /** @type {Record<string, unknown>} */ (r);
  if (typeof o.name !== "string" || o.name === "") {
    throw new HcbError(`${where}: 'name' must be a non-empty string`);
  }
  if (seen.has(o.name)) throw new HcbError(`${where}: duplicate rule name '${o.name}'`);
  seen.add(o.name);
  if (typeof o.tier !== "string" || !TIERS.has(o.tier)) {
    throw new HcbError(`${where} ('${o.name}'): 'tier' must be one of ${[...TIERS].join(", ")}`);
  }
  if (typeof o.source !== "string" || o.source === "") {
    throw new HcbError(`${where} ('${o.name}'): 'source' must be a non-empty string`);
  }
  /** @type {Rule} */
  const rule = { name: o.name, tier: /** @type {Tier} */ (o.tier), source: o.source };
  if (o.optional !== undefined) {
    if (typeof o.optional !== "boolean") throw new HcbError(`${where} ('${o.name}'): 'optional' must be a boolean`);
    rule.optional = o.optional;
  }
  if (o.companions !== undefined) {
    if (!Array.isArray(o.companions)) throw new HcbError(`${where} ('${o.name}'): 'companions' must be an array`);
    rule.companions = o.companions.map((c, j) => validateCompanion(c, `${where} ('${o.name}'): companions[${j}]`));
  }
  return rule;
}

/**
 * @param {unknown} c
 * @param {string} where
 * @returns {Companion}
 */
function validateCompanion(c, where) {
  if (typeof c !== "object" || c === null) throw new HcbError(`${where}: must be an object`);
  const o = /** @type {Record<string, unknown>} */ (c);
  if (typeof o.path !== "string" || o.path === "") throw new HcbError(`${where}: 'path' must be a non-empty string`);
  if (typeof o.contract !== "string" || o.contract === "") throw new HcbError(`${where}: 'contract' must be a non-empty string`);
  /** @type {Companion} */
  const comp = { path: o.path, contract: o.contract };
  if (o.starter !== undefined) {
    if (typeof o.starter !== "string") throw new HcbError(`${where}: 'starter' must be a string`);
    comp.starter = o.starter;
  }
  return comp;
}

/**
 * Read the canon source body for a rule from the plugin.
 *
 * @param {string} pluginRoot
 * @param {Rule} rule
 * @returns {string}
 */
export function canonBody(pluginRoot, rule) {
  const file = path.join(pluginRoot, "rules", rule.source);
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    throw new HcbError(`canon source missing for rule '${rule.name}': ${file}`);
  }
}

/**
 * Find a rule by name.
 *
 * @param {Manifest} manifest
 * @param {string} name
 * @returns {Rule | undefined}
 */
export function findRule(manifest, name) {
  return manifest.rules.find((r) => r.name === name);
}
