import test from "node:test";
import assert from "node:assert/strict";
import { loadManifest, validateManifest, canonBody, findRule } from "../plugins/hcb-dev/lib/manifest.mjs";
import { HcbError } from "../plugins/hcb-dev/lib/errors.mjs";
import { makeTempDir, writeFile } from "./helpers.mjs";

const VALID = {
  version: 1,
  rules: [
    { name: "git-branches", tier: "canonical", source: "canonical/git-branches.md" },
    { name: "early-stage", tier: "canonical", source: "canonical/early-stage.md", optional: true },
    {
      name: "issue-tracking",
      tier: "parameterized",
      source: "canonical/issue-tracking.md",
      companions: [
        { path: ".github/labels.yml", contract: "contracts/labels.schema.json", starter: "contracts/labels.github.starter.yml" },
      ],
    },
  ],
};

test("validateManifest accepts a well-formed manifest", () => {
  const m = validateManifest(VALID);
  assert.equal(m.version, 1);
  assert.equal(m.rules.length, 3);
  assert.equal(m.rules[1].optional, true);
  assert.equal(m.rules[2].companions?.[0].path, ".github/labels.yml");
  assert.equal(m.rules[2].companions?.[0].starter, "contracts/labels.github.starter.yml");
});

test("validateManifest rejects malformed input with actionable messages", () => {
  assert.throws(() => validateManifest(null), HcbError);
  assert.throws(() => validateManifest("nope"), /must be a JSON object/);
  assert.throws(() => validateManifest({ rules: [] }), /'version' must be a number/);
  assert.throws(() => validateManifest({ version: 1, rules: {} }), /'rules' must be an array/);
  assert.throws(() => validateManifest({ version: 1, rules: ["x"] }), /must be an object/);
  assert.throws(() => validateManifest({ version: 1, rules: [{ tier: "canonical", source: "x" }] }), /'name' must be/);
  assert.throws(() => validateManifest({ version: 1, rules: [{ name: "a", tier: "bad", source: "x" }] }), /'tier' must be one of/);
  assert.throws(() => validateManifest({ version: 1, rules: [{ name: "a", tier: "canonical" }] }), /'source' must be/);
  assert.throws(
    () => validateManifest({ version: 1, rules: [{ name: "a", tier: "canonical", source: "x", optional: "yes" }] }),
    /'optional' must be a boolean/,
  );
  assert.throws(
    () => validateManifest({ version: 1, rules: [{ name: "a", tier: "canonical", source: "x" }, { name: "a", tier: "canonical", source: "y" }] }),
    /duplicate rule name 'a'/,
  );
  assert.throws(
    () => validateManifest({ version: 1, rules: [{ name: "a", tier: "parameterized", source: "x", companions: {} }] }),
    /'companions' must be an array/,
  );
  assert.throws(
    () => validateManifest({ version: 1, rules: [{ name: "a", tier: "parameterized", source: "x", companions: ["x"] }] }),
    /companions\[0\]: must be an object/,
  );
  assert.throws(
    () => validateManifest({ version: 1, rules: [{ name: "a", tier: "parameterized", source: "x", companions: [{ contract: "c" }] }] }),
    /'path' must be/,
  );
  assert.throws(
    () => validateManifest({ version: 1, rules: [{ name: "a", tier: "parameterized", source: "x", companions: [{ path: "p" }] }] }),
    /'contract' must be/,
  );
  assert.throws(
    () => validateManifest({ version: 1, rules: [{ name: "a", tier: "parameterized", source: "x", companions: [{ path: "p", contract: "c", starter: 1 }] }] }),
    /'starter' must be a string/,
  );
});

test("loadManifest reads + validates from disk; missing + invalid JSON throw", () => {
  const dir = makeTempDir();
  writeFile(dir, "rules/manifest.json", JSON.stringify(VALID));
  assert.equal(loadManifest(dir).rules.length, 3);

  assert.throws(() => loadManifest(makeTempDir()), /manifest not found/);

  const bad = makeTempDir();
  writeFile(bad, "rules/manifest.json", "{ not json");
  assert.throws(() => loadManifest(bad), /not valid JSON/);
});

test("canonBody reads the source; a missing source throws", () => {
  const dir = makeTempDir();
  writeFile(dir, "rules/canonical/git-branches.md", "# Git Branches\n");
  const m = validateManifest(VALID);
  assert.match(canonBody(dir, findRule(m, "git-branches")), /# Git Branches/);
  assert.throws(() => canonBody(dir, findRule(m, "early-stage")), /canon source missing for rule 'early-stage'/);
});

test("findRule returns the rule or undefined", () => {
  const m = validateManifest(VALID);
  assert.equal(findRule(m, "early-stage")?.name, "early-stage");
  assert.equal(findRule(m, "nope"), undefined);
});

test("validateManifest covers null elements and empty-string fields", () => {
  assert.throws(() => validateManifest({ version: 1, rules: [null] }), /rules\[0\]: must be an object/);
  assert.throws(() => validateManifest({ version: 1, rules: [{ name: "", tier: "canonical", source: "x" }] }), /'name' must be/);
  assert.throws(() => validateManifest({ version: 1, rules: [{ name: "a", tier: "canonical", source: "" }] }), /'source' must be/);
  assert.throws(
    () => validateManifest({ version: 1, rules: [{ name: "a", tier: "parameterized", source: "x", companions: [null] }] }),
    /companions\[0\]: must be an object/,
  );
  assert.throws(
    () => validateManifest({ version: 1, rules: [{ name: "a", tier: "parameterized", source: "x", companions: [{ path: "", contract: "c" }] }] }),
    /'path' must be/,
  );
  assert.throws(
    () => validateManifest({ version: 1, rules: [{ name: "a", tier: "parameterized", source: "x", companions: [{ path: "p", contract: "" }] }] }),
    /'contract' must be/,
  );
});
