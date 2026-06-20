import test from "node:test";
import assert from "node:assert/strict";
import { emptyLock, loadLock, saveLock, validateLock, isEnabled, lockEntry } from "../plugins/hcb-dev/lib/lock.mjs";
import { HcbError } from "../plugins/hcb-dev/lib/errors.mjs";
import { makeTempDir, writeFile, readFile } from "./helpers.mjs";

test("emptyLock has the agreed shape", () => {
  assert.deepEqual(emptyLock(), { managed_by: "hcb-dev", rules: [] });
});

test("loadLock returns empty when absent; saveLock round-trips", () => {
  const dir = makeTempDir();
  assert.deepEqual(loadLock(dir), emptyLock());

  /** @type {import("../plugins/hcb-dev/lib/lock.mjs").Lock} */
  const lock = {
    managed_by: "hcb-dev",
    rules: [
      { name: "git-branches", sha256: "abc" },
      { name: "early-stage", enabled: false },
    ],
  };
  saveLock(dir, lock);
  const onDisk = readFile(dir, ".claude/hcb-dev/rules.json");
  assert.match(onDisk, /"managed_by": "hcb-dev"/);
  assert.ok(onDisk.endsWith("\n"));
  assert.deepEqual(loadLock(dir), lock);
});

test("validateLock rejects malformed locks", () => {
  assert.throws(() => validateLock(null), HcbError);
  assert.throws(() => validateLock("x"), /must be a JSON object/);
  assert.throws(() => validateLock({ managed_by: "other", rules: [] }), /'managed_by' must be "hcb-dev"/);
  assert.throws(() => validateLock({ managed_by: "hcb-dev", rules: {} }), /'rules' must be an array/);
  assert.throws(() => validateLock({ managed_by: "hcb-dev", rules: ["x"] }), /must be an object/);
  assert.throws(() => validateLock({ managed_by: "hcb-dev", rules: [{ enabled: true }] }), /\.name must be/);
  assert.throws(() => validateLock({ managed_by: "hcb-dev", rules: [{ name: "a", enabled: "yes" }] }), /\.enabled must be a boolean/);
  assert.throws(() => validateLock({ managed_by: "hcb-dev", rules: [{ name: "a", sha256: 1 }] }), /\.sha256 must be a string/);
  assert.throws(() => validateLock({ managed_by: "hcb-dev", rules: [{ name: "a" }, { name: "a" }] }), /duplicate lock entry 'a'/);
});

test("loadLock throws on invalid JSON", () => {
  const dir = makeTempDir();
  writeFile(dir, ".claude/hcb-dev/rules.json", "{ nope");
  assert.throws(() => loadLock(dir), /not valid JSON/);
});

test("isEnabled defaults true; lockEntry finds by name", () => {
  assert.equal(isEnabled({ name: "a" }), true);
  assert.equal(isEnabled({ name: "a", enabled: false }), false);
  assert.equal(isEnabled({ name: "a", enabled: true }), true);

  /** @type {import("../plugins/hcb-dev/lib/lock.mjs").Lock} */
  const lock = { managed_by: "hcb-dev", rules: [{ name: "a" }] };
  assert.equal(lockEntry(lock, "a")?.name, "a");
  assert.equal(lockEntry(lock, "b"), undefined);
});

test("validateLock covers null elements and empty-string name", () => {
  assert.throws(() => validateLock({ managed_by: "hcb-dev", rules: [null] }), /rules\[0\] must be an object/);
  assert.throws(() => validateLock({ managed_by: "hcb-dev", rules: [{ name: "" }] }), /\.name must be/);
});
