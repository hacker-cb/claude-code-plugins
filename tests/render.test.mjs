import test from "node:test";
import assert from "node:assert/strict";
import { managedHeader, renderManaged } from "../plugins/hcb-dev/lib/render.mjs";

test("managedHeader names the canon source and warns against editing", () => {
  const h = managedHeader("git-branches");
  assert.match(h, /MANAGED by hcb-dev \(canonical\/git-branches\.md\)/);
  assert.match(h, /do not edit; run \/hcb-dev:rules sync\./);
});

test("renderManaged = header + blank line + trimmed body + one trailing newline", () => {
  const out = renderManaged("x", "# Body\n\ncontent\n\n\n");
  assert.equal(out, `${managedHeader("x")}\n\n# Body\n\ncontent\n`);
  assert.ok(out.endsWith("content\n"));
});

test("renderManaged is idempotent across trailing-whitespace variants", () => {
  assert.equal(renderManaged("x", "a"), renderManaged("x", "a\n"));
  assert.equal(renderManaged("x", "a\n\n"), renderManaged("x", "a   \n"));
});
