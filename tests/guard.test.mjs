import test from "node:test";
import assert from "node:assert/strict";
import { guardDecision } from "../plugins/hcb-dev/lib/guard.mjs";

const PROJ = "/repo";

test("denies Edit / Write / NotebookEdit on a managed rule file", () => {
  for (const tool of ["Edit", "Write"]) {
    const d = guardDecision({ cwd: PROJ, tool_name: tool, tool_input: { file_path: "/repo/.claude/rules/hcb/git-branches.md" } });
    assert.equal(d?.hookSpecificOutput.permissionDecision, "deny");
    assert.match(d.hookSpecificOutput.permissionDecisionReason, /managed rule/);
  }
  const nb = guardDecision({ cwd: PROJ, tool_name: "NotebookEdit", tool_input: { notebook_path: ".claude/rules/hcb/x.md" } });
  assert.equal(nb?.hookSpecificOutput.permissionDecision, "deny");
});

test("allows (null) writes outside the managed dir", () => {
  assert.equal(guardDecision({ cwd: PROJ, tool_name: "Edit", tool_input: { file_path: "/repo/.claude/rules/rust.md" } }), null);
  assert.equal(guardDecision({ cwd: PROJ, tool_name: "Edit", tool_input: { file_path: "src/main.rs" } }), null);
});

test("allows (null) non-write tools, missing input, and missing cwd", () => {
  assert.equal(guardDecision({ cwd: PROJ, tool_name: "Bash", tool_input: { command: "rm .claude/rules/hcb/x.md" } }), null);
  assert.equal(guardDecision({ cwd: PROJ, tool_name: "Read", tool_input: { file_path: ".claude/rules/hcb/x.md" } }), null);
  assert.equal(guardDecision({ cwd: PROJ, tool_name: "Edit", tool_input: {} }), null);
  assert.equal(guardDecision({ tool_name: "Edit", tool_input: { file_path: "/x/.claude/rules/hcb/a.md" } }), null);
  assert.equal(guardDecision({ tool_name: "Edit" }), null);
  assert.equal(guardDecision({}), null);
  assert.equal(guardDecision(null), null);
});
