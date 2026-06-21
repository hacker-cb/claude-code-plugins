import test from "node:test";
import assert from "node:assert/strict";
import { syncFiles } from "../plugins/hcb-dev/lib/sync.mjs";
import { sessionStartReport } from "../plugins/hcb-dev/lib/session.mjs";
import { makeTempDir, makePluginFixture, writeFile } from "./helpers.mjs";

test("a project that has not adopted hcb-dev rules is silent", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  assert.equal(sessionStartReport(plugin, proj), "");
});

test("a fully synced adopted project prints a one-line managed note", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  syncFiles(plugin, proj);
  const out = sessionStartReport(plugin, proj);
  assert.match(out, /manages `\.claude\/rules\/hcb\/\*\*`/);
  assert.doesNotMatch(out, /drift detected/);
  assert.equal(out.includes("\n"), false); // single line
});

test("drift produces an actionable preamble listing each drifted rule", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  syncFiles(plugin, proj);
  writeFile(proj, ".claude/rules/hcb/git-branches.md", "tampered");
  const out = sessionStartReport(plugin, proj);
  assert.match(out, /drift detected/);
  assert.match(out, /git-branches \(edited\)/);
  assert.match(out, /\/hcb-dev:rules sync/);
});
