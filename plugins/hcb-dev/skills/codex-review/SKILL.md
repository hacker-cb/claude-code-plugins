---
name: codex-review
description: >-
  Review a change with Codex — OpenAI's coding agent — over the range and at the rung (medium
  or high) the caller fixes, its findings and a coverage record handed back. Use when
  the user or a pipeline asks for a "codex review", or wants a second opinion on a change from
  an engine other than Claude. Review-only: returns the findings and never fixes anything. For
  one change reviewed by several independent reviewers at once, use `hcb-dev:multi-review`
  instead. Invoke deliberately, when asked — not as an auto-trigger on every change.
---

# Codex review

One review round whose one source is Codex — a single read-only pass of the Codex CLI, handed
the change itself and answering in the round's own candidate shape — every candidate the rung's
budget reaches then checked by the plugin's verifier. This skill is **review-only**: never fix
what it reports, return it and let the caller decide.
**Paths**, substituted at invocation — use verbatim: `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}`.

Run it as [`../../references/review-pipeline.md`](../../references/review-pipeline.md)'s
*Running one* says, with `codex` as the round's sources, and hand back what that reference's
*Reading the result* makes of it.
