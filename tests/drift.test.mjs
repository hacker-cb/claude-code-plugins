import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncFiles } from "../plugins/hcb-dev/lib/sync.mjs";
import { checkFiles } from "../plugins/hcb-dev/lib/drift.mjs";
import { makeTempDir, makePluginFixture, writeFile } from "./helpers.mjs";

/** @param {ReturnType<typeof checkFiles>} r @param {string} name */
const reason = (r, name) => r.drift.find((d) => d.name === name)?.reason;

test("a freshly synced project has no drift", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  syncFiles(plugin, proj);
  const r = checkFiles(plugin, proj);
  assert.equal(r.ok, true);
  assert.deepEqual(r.drift, []);
  assert.deepEqual([...r.checked].sort(), ["early-stage", "git-branches"]);
});

test("an edited managed file is drift (edited)", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  syncFiles(plugin, proj);
  writeFile(proj, ".claude/rules/hcb/git-branches.md", "tampered");
  const r = checkFiles(plugin, proj);
  assert.equal(r.ok, false);
  assert.equal(reason(r, "git-branches"), "edited");
});

test("a canon advance shows as drift (edited) on the un-synced project", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  syncFiles(plugin, proj);
  writeFile(plugin, "rules/canonical/git-branches.md", "# Git Branches\n\nNEW body\n");
  assert.equal(reason(checkFiles(plugin, proj), "git-branches"), "edited");
});

test("a missing managed file for an enabled rule is reported (missing)", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  syncFiles(plugin, proj);
  fs.rmSync(`${proj}/.claude/rules/hcb/git-branches.md`);
  assert.equal(reason(checkFiles(plugin, proj), "git-branches"), "missing");
});

test("a disabled rule that still has a file is an orphan", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  syncFiles(plugin, proj);
  writeFile(proj, ".claude/hcb-dev/rules.json", JSON.stringify({
    managed_by: "hcb-dev",
    rules: [{ name: "git-branches", enabled: false }, { name: "early-stage" }],
  }));
  assert.equal(reason(checkFiles(plugin, proj), "git-branches"), "orphan");
});

test("a manifest rule absent from the lock defaults to enabled (missing if unsynced)", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  // lock records only git-branches; early-stage is in the manifest but not the lock
  writeFile(proj, ".claude/hcb-dev/rules.json", JSON.stringify({ managed_by: "hcb-dev", rules: [{ name: "git-branches" }] }));
  const r = checkFiles(plugin, proj);
  assert.equal(reason(r, "early-stage"), "missing");
  assert.equal(reason(r, "git-branches"), "missing");
});

test("a managed file for a rule dropped from canon is an orphan", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  syncFiles(plugin, proj);
  writeFile(plugin, "rules/manifest.json", JSON.stringify({
    version: 1,
    rules: [{ name: "git-branches", tier: "canonical", source: "canonical/git-branches.md" }],
  }));
  assert.equal(reason(checkFiles(plugin, proj), "early-stage"), "orphan");
});
