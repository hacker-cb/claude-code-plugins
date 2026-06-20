import test from "node:test";
import assert from "node:assert/strict";
import { syncFiles } from "../plugins/hcb-dev/lib/sync.mjs";
import { loadLock } from "../plugins/hcb-dev/lib/lock.mjs";
import { renderManaged } from "../plugins/hcb-dev/lib/render.mjs";
import { makeTempDir, makePluginFixture, writeFile, readFile, exists } from "./helpers.mjs";

test("fresh sync writes all rules + a lock with hashes; re-sync is a no-op", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();

  const r1 = syncFiles(plugin, proj);
  assert.deepEqual([...r1.written].sort(), ["early-stage", "git-branches"]);
  assert.deepEqual(r1.unchanged, []);
  assert.deepEqual(r1.removed, []);
  assert.equal(readFile(proj, ".claude/rules/hcb/git-branches.md"), renderManaged("git-branches", "# Git Branches\n\nbody\n"));

  const lock = loadLock(proj);
  assert.ok(lock.rules.every((e) => typeof e.sha256 === "string"));

  const r2 = syncFiles(plugin, proj);
  assert.deepEqual(r2.written, []);
  assert.deepEqual([...r2.unchanged].sort(), ["early-stage", "git-branches"]);
});

test("a locally edited managed file is rewritten on next sync", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  syncFiles(plugin, proj);
  writeFile(proj, ".claude/rules/hcb/git-branches.md", "tampered");
  const r = syncFiles(plugin, proj);
  assert.deepEqual(r.written, ["git-branches"]);
  assert.match(readFile(proj, ".claude/rules/hcb/git-branches.md"), /MANAGED by hcb-dev/);
});

test("a rule disabled in the lock is deleted and stays disabled", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  syncFiles(plugin, proj);
  const lock = loadLock(proj);
  lock.rules = lock.rules.map((e) => (e.name === "early-stage" ? { name: "early-stage", enabled: false } : e));
  writeFile(proj, ".claude/hcb-dev/rules.json", JSON.stringify(lock));

  const r = syncFiles(plugin, proj);
  assert.deepEqual(r.removed, ["early-stage"]);
  assert.equal(exists(proj, ".claude/rules/hcb/early-stage.md"), false);
  assert.equal(exists(proj, ".claude/rules/hcb/git-branches.md"), true);
  assert.equal(loadLock(proj).rules.find((e) => e.name === "early-stage").enabled, false);
});

test("a rule dropped from the manifest is removed from the project", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  syncFiles(plugin, proj);
  writeFile(plugin, "rules/manifest.json", JSON.stringify({
    version: 1,
    rules: [{ name: "git-branches", tier: "canonical", source: "canonical/git-branches.md" }],
  }));
  const r = syncFiles(plugin, proj);
  assert.deepEqual(r.removed, ["early-stage"]);
  assert.equal(exists(proj, ".claude/rules/hcb/early-stage.md"), false);
});

test("disabling the only rule prunes the empty managed dir", () => {
  const plugin = makePluginFixture({ canon: { "git-branches": "x\n" } });
  const proj = makeTempDir();
  syncFiles(plugin, proj);
  writeFile(proj, ".claude/hcb-dev/rules.json", JSON.stringify({ managed_by: "hcb-dev", rules: [{ name: "git-branches", enabled: false }] }));
  syncFiles(plugin, proj);
  assert.equal(exists(proj, ".claude/rules/hcb"), false);
});
