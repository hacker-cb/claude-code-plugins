import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  MANAGED_RULES_DIR,
  LOCK_FILE,
  managedRulePath,
  managedRulesDir,
  lockPath,
  isManagedRulePath,
} from "../plugins/hcb-dev/lib/paths.mjs";

const PROJ = "/tmp/proj";

test("constants are the agreed project-relative paths", () => {
  assert.equal(MANAGED_RULES_DIR, ".claude/rules/hcb");
  assert.equal(LOCK_FILE, ".claude/hcb-dev/rules.json");
});

test("managedRulePath / managedRulesDir / lockPath join under the project", () => {
  assert.equal(managedRulePath(PROJ, "git-branches"), path.join(PROJ, ".claude/rules/hcb/git-branches.md"));
  assert.equal(managedRulesDir(PROJ), path.join(PROJ, ".claude/rules/hcb"));
  assert.equal(lockPath(PROJ), path.join(PROJ, ".claude/hcb-dev/rules.json"));
});

test("isManagedRulePath: files under the managed dir are managed (absolute + relative + nested)", () => {
  assert.equal(isManagedRulePath(PROJ, path.join(PROJ, ".claude/rules/hcb/x.md")), true);
  assert.equal(isManagedRulePath(PROJ, ".claude/rules/hcb/x.md"), true);
  assert.equal(isManagedRulePath(PROJ, ".claude/rules/hcb/sub/y.md"), true);
});

test("isManagedRulePath: files elsewhere, the dir itself, and empty input are not managed", () => {
  assert.equal(isManagedRulePath(PROJ, ".claude/rules/rust.md"), false);
  assert.equal(isManagedRulePath(PROJ, "src/main.rs"), false);
  assert.equal(isManagedRulePath(PROJ, path.join(PROJ, ".claude/rules/hcb")), false);
  assert.equal(isManagedRulePath(PROJ, ""), false);
});

test("isManagedRulePath: a path escaping the managed dir is not managed", () => {
  assert.equal(isManagedRulePath(PROJ, ".claude/rules/hcb/../rust.md"), false);
});
