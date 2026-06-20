import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readIfExists, writeFileEnsured, removeIfExists, pruneEmptyDir } from "../plugins/hcb-dev/lib/fsutil.mjs";
import { makeTempDir } from "./helpers.mjs";

test("readIfExists returns content or null", () => {
  const dir = makeTempDir();
  const f = path.join(dir, "a/b.txt");
  assert.equal(readIfExists(f), null);
  writeFileEnsured(f, "hi");
  assert.equal(readIfExists(f), "hi");
});

test("writeFileEnsured creates parent dirs", () => {
  const dir = makeTempDir();
  writeFileEnsured(path.join(dir, "deep/nested/x.txt"), "y");
  assert.equal(fs.readFileSync(path.join(dir, "deep/nested/x.txt"), "utf8"), "y");
});

test("removeIfExists removes a file (true) and is a no-op when absent (false)", () => {
  const dir = makeTempDir();
  const f = path.join(dir, "x.txt");
  assert.equal(removeIfExists(f), false);
  writeFileEnsured(f, "z");
  assert.equal(removeIfExists(f), true);
  assert.equal(fs.existsSync(f), false);
});

test("pruneEmptyDir removes an empty dir, leaves a non-empty one, ignores absent", () => {
  const dir = makeTempDir();
  const empty = path.join(dir, "empty");
  fs.mkdirSync(empty);
  pruneEmptyDir(empty);
  assert.equal(fs.existsSync(empty), false);

  const full = path.join(dir, "full");
  writeFileEnsured(path.join(full, "f.txt"), "x");
  pruneEmptyDir(full);
  assert.equal(fs.existsSync(full), true);

  pruneEmptyDir(path.join(dir, "absent")); // no throw
});
