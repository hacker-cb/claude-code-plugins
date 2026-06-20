import test from "node:test";
import assert from "node:assert/strict";
import { readSettings, missingPlugins } from "../plugins/hcb-dev/lib/settings.mjs";
import { makeTempDir, writeFile } from "./helpers.mjs";

test("readSettings parses settings.json, or null when absent / invalid", () => {
  const dir = makeTempDir();
  assert.equal(readSettings(dir), null);

  writeFile(dir, ".claude/settings.json", JSON.stringify({ enabledPlugins: { "a@m": true } }));
  assert.deepEqual(readSettings(dir), { enabledPlugins: { "a@m": true } });

  const bad = makeTempDir();
  writeFile(bad, ".claude/settings.json", "{ nope");
  assert.equal(readSettings(bad), null);
});

test("missingPlugins handles object form, array form, and absence", () => {
  assert.deepEqual(missingPlugins({ enabledPlugins: { "a@m": true, "b@m": false } }, ["a@m", "b@m", "c@m"]), ["b@m", "c@m"]);
  assert.deepEqual(missingPlugins({ enabledPlugins: ["a@m"] }, ["a@m", "b@m"]), ["b@m"]);
  assert.deepEqual(missingPlugins(null, ["a@m"]), ["a@m"]);
  assert.deepEqual(missingPlugins({}, ["a@m"]), ["a@m"]);
  assert.deepEqual(missingPlugins({ enabledPlugins: { "a@m": true } }, ["a@m"]), []);
});
