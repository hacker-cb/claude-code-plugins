import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCli } from "../plugins/hcb-dev/lib/cli.mjs";
import { syncFiles } from "../plugins/hcb-dev/lib/sync.mjs";
import { makeTempDir, makePluginFixture, writeFile, exists } from "./helpers.mjs";

/** A CliContext that captures stdout/stderr into arrays. */
function ctxFor(plugin, proj, stdinText = "") {
  const out = [];
  const err = [];
  return {
    ctx: { cwd: proj, pluginRoot: plugin, stdinText, log: (s) => out.push(s), errlog: (s) => err.push(s) },
    out,
    err,
  };
}

test("sync writes managed files and reports what was written", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  const { ctx, out } = ctxFor(plugin, proj);
  assert.equal(runCli(["sync"], ctx), 0);
  assert.match(out.join("\n"), /wrote git-branches, early-stage/);
  assert.ok(exists(proj, ".claude/rules/hcb/git-branches.md"));
});

test("a second sync reports everything unchanged", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  syncFiles(plugin, proj);
  const { ctx, out } = ctxFor(plugin, proj);
  assert.equal(runCli(["sync"], ctx), 0);
  assert.match(out.join("\n"), /unchanged git-branches, early-stage/);
});

test("sync reports removed files when a rule is disabled in the lock", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  syncFiles(plugin, proj);
  writeFile(proj, ".claude/hcb-dev/rules.json", JSON.stringify({
    managed_by: "hcb-dev",
    rules: [{ name: "git-branches", enabled: false }, { name: "early-stage" }],
  }));
  const { ctx, out } = ctxFor(plugin, proj);
  assert.equal(runCli(["sync"], ctx), 0);
  assert.match(out.join("\n"), /removed git-branches/);
});

test("sync over an empty manifest has nothing to do", () => {
  const plugin = makePluginFixture({ canon: {} });
  const proj = makeTempDir();
  const { ctx, out } = ctxFor(plugin, proj);
  assert.equal(runCli(["sync"], ctx), 0);
  assert.match(out.join("\n"), /nothing to do/);
});

test("check passes on a synced project and fails on drift", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  syncFiles(plugin, proj);

  const clean = ctxFor(plugin, proj);
  assert.equal(runCli(["check"], clean.ctx), 0);
  assert.match(clean.out.join("\n"), /2 managed rule\(s\) in sync/);

  writeFile(proj, ".claude/rules/hcb/git-branches.md", "tampered");
  const dirty = ctxFor(plugin, proj);
  assert.equal(runCli(["check"], dirty.ctx), 1);
  assert.match(dirty.err.join("\n"), /edited: git-branches/);
  assert.match(dirty.err.join("\n"), /run `\/hcb-dev:rules sync`/);
});

test("guard emits a deny decision for a managed-rule write, nothing otherwise", () => {
  const deny = ctxFor("", "", JSON.stringify({
    cwd: "/repo",
    tool_name: "Edit",
    tool_input: { file_path: "/repo/.claude/rules/hcb/git-branches.md" },
  }));
  assert.equal(runCli(["guard"], deny.ctx), 0);
  assert.match(deny.out.join("\n"), /"permissionDecision":"deny"/);

  const allow = ctxFor("", "", JSON.stringify({ cwd: "/repo", tool_name: "Read", tool_input: {} }));
  assert.equal(runCli(["guard"], allow.ctx), 0);
  assert.equal(allow.out.length, 0);

  const garbage = ctxFor("", "", "{not json");
  assert.equal(runCli(["guard"], garbage.ctx), 0);
  assert.equal(garbage.out.length, 0);
});

test("session-start prints a drift preamble using the cwd from stdin", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  syncFiles(plugin, proj);
  writeFile(proj, ".claude/rules/hcb/git-branches.md", "tampered");
  // ctx.cwd is deliberately wrong; the real project dir arrives via stdin JSON.
  const { ctx, out } = ctxFor(plugin, "/nonexistent", JSON.stringify({ cwd: proj }));
  assert.equal(runCli(["session-start"], ctx), 0);
  assert.match(out.join("\n"), /drift detected/);
});

test("session-start falls back to ctx.cwd when stdin lacks a cwd or is empty", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  syncFiles(plugin, proj); // in sync → silent

  const noCwd = ctxFor(plugin, proj, JSON.stringify({ hook_event_name: "SessionStart" }));
  assert.equal(runCli(["session-start"], noCwd.ctx), 0);
  assert.equal(noCwd.out.length, 0);

  const empty = ctxFor(plugin, proj, "");
  assert.equal(runCli(["session-start"], empty.ctx), 0);
  assert.equal(empty.out.length, 0);
});

test("session-start degrades to a soft note (exit 0) when the lock is corrupt", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  writeFile(proj, ".claude/hcb-dev/rules.json", "{not json");
  const { ctx, err } = ctxFor(plugin, proj);
  assert.equal(runCli(["session-start"], ctx), 0);
  assert.match(err.join("\n"), /session-start:/);
});

test("an unknown command prints usage and exits 2", () => {
  const unknown = ctxFor("", "");
  assert.equal(runCli(["frobnicate"], unknown.ctx), 2);
  assert.match(unknown.err.join("\n"), /unknown command 'frobnicate'/);
});

test("a bare invocation (no sub-command) defaults to read-only check", () => {
  const plugin = makePluginFixture();
  const proj = makeTempDir();
  syncFiles(plugin, proj);
  const { ctx, out } = ctxFor(plugin, proj);
  assert.equal(runCli([], ctx), 0);
  assert.match(out.join("\n"), /in sync/);
});

test("an engine error surfaces on stderr with exit 1", () => {
  const { ctx, err } = ctxFor("/does/not/exist", makeTempDir());
  assert.equal(runCli(["sync"], ctx), 1);
  assert.match(err.join("\n"), /hcb-rules sync:/);
});

test("the real bin runs as ESM end-to-end (extensionless, plugin-local package.json)", () => {
  const pluginRoot = fileURLToPath(new URL("../plugins/hcb-dev", import.meta.url));
  const bin = fileURLToPath(new URL("../plugins/hcb-dev/bin/hcb-rules", import.meta.url));
  const proj = makeTempDir();
  const r = spawnSync(process.execPath, [bin, "sync"], {
    cwd: proj,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    encoding: "utf8",
    input: "",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /wrote git-branches, issue-tracking, early-stage/);
  assert.ok(exists(proj, ".claude/rules/hcb/issue-tracking.md"));
});
