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

## A distinction you explain has somewhere else to live

Where a paragraph exists to draw a line — this reading is not that one, this state is not that
state — it is one of three things, and none of them is prose in a procedure: an **invariant**
([`../../plugins/hcb-dev/references/invariants.md`](../../plugins/hcb-dev/references/invariants.md),
written once and read by every skill), a **row in the fact table**
([`../../plugins/hcb-dev/references/forge-behaviour.md`](../../plugins/hcb-dev/references/forge-behaviour.md),
where a measurement goes so that no skill carries it),
or a **comment beside the line of code that acts on it**. What stays in the procedure is the
link and the step, never the explanation — a distinction re-explained wherever it applies is
how one rule becomes fourteen paragraphs that drift apart.

## What a script answers, and what the agent reads

A script answers what a forge's structure says where a slip is silent — which commit a review
covers, which feed carries a request, whose word is last in a thread, whether a listing ended —
and its suite holds every trap once it is found. The **meaning** of prose a tool hands back — a
review body, a finding, a log — is the agent's to read, whole. A script may count what that prose
carries, as a checksum the reading is held to; it never decides whether the prose is read, since
a pattern over a layout nobody published is the reading that goes quiet the day the layout moves.

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
