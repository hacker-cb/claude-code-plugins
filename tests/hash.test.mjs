import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "../plugins/hcb-dev/lib/hash.mjs";

test("sha256 matches the known digest of a fixed string", () => {
  // printf 'abc' | sha256sum
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("sha256 of the empty string", () => {
  assert.equal(sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("sha256 is deterministic and content-sensitive", () => {
  assert.equal(sha256("hello"), sha256("hello"));
  assert.notEqual(sha256("hello"), sha256("hello\n"));
});
