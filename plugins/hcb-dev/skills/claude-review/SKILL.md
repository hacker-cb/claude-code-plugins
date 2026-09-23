---
name: claude-review
description: >-
  Review a change with Claude's own finders — one agent per angle of the rung and, where the
  session can launch agents, every candidate the rung's budget reaches checked by an independent
  verifier — over the range and at the rung (medium or high) the caller fixes. Use when `hcb-dev:multi-review` runs this reviewer; when a pipeline, a batch
  worker or a subagent needs a review pinned to a range, with verified findings and a coverage
  record handed back; or when the user asks for a Claude review of the current change.
  Review-only: returns the findings and never fixes anything. For one change reviewed by several
  independent reviewers at once, use `hcb-dev:multi-review` instead; for more than the high rung,
  the built-in `/code-review`, typed by the user. Invoke deliberately, when asked — not as an
  auto-trigger on every change.
---

# Claude review

One review round whose one source is Claude's finders, one agent per angle of the rung. This
skill is **review-only**: never fix what it reports, return it and let the caller decide.
**Paths**, substituted at invocation — use verbatim: `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}`.

Run it as [`../../references/review-pipeline.md`](../../references/review-pipeline.md)'s
*Running one* says, with `claude` as the round's sources, and hand back what that reference's
*Reading the result* makes of it.
