---
paths:
  - "plugins/**"
---

# Skill authoring — what goes in, and what stays out (authoring rule)

Guidance for writing a `SKILL.md` or a `references/*.md`, loaded only while
working under `plugins/`. Structure, naming and everything `scripts/validate.sh`
enforces are in `CLAUDE.md`; this is the content axis, which no linter sees.

Both carry **what to do**, and nothing else earns its place. The test, applied to
a paragraph: delete it — does any action change? If not, it was never an
instruction. A test the reader applies to a case the file never named counts as
an instruction; the deliberation that produced it does not.

## Leave out

| ❌ | ✅ |
|---|---|
| a historical record — "used to", "after the refactor", "this guard no longer fires" | what to do now; git history is the record |
| a research record — a measurement, a version number as evidence, what a tool printed when someone tried it | the instruction that research produced, alone |
| an argument for the decision — why this shape and not the other | the shape |
| handling for a tool that failed | assume every tool a skill invokes is installed, working and authorized; a failure is visible, and the agent handles it |
| a fixed list — file extensions, size thresholds, tool or model names, branch or remote names | the behaviour to judge by, resolved at run time |

Special handling earns a place only where the distinction it draws is one the
skill **acts on** — telling "this could not be determined" apart from "the answer
is no", where the two lead to different steps. That is business logic. Guarding
against a tool being absent is not.

One narrow exception to the third row: where a construct is non-obvious enough
that a reader would "simplify" it and break it — a quoting form, an ordering
constraint, two commands that must stay chained — say in one line what it
protects. Inside the block, about that line of code. Never a paragraph, and never
about a choice between designs.

## A reference owns what it covers

Never restate a shared reference beside the link to it. Where a paragraph both
links a reference and explains a rule from it, the explanation goes; the link is
the instruction to read it.

## Frontmatter

- **`description` is a trigger, not documentation.** It answers *when* this skill
  fires and when it must not. Steps, output contract and mechanics live in the
  body.
- **Name a neighbouring skill by its identifier** — `<plugin>:<skill>` — never by
  a generic description of what it does.
- **Promise only what the body does.** An unconditional guarantee the body
  qualifies is a defect, not a simplification.
- **`argument-hint` only where the body reads an argument.** Most skills read
  none: a skill takes no typed arguments, so a caller passes values as invocation
  prose.
