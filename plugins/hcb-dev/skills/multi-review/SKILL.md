---
name: multi-review
description: >-
  Review the current change with every source hcb-dev's review round has — Claude, security and
  Codex — and report the findings and what each source actually covered. Use when the user asks
  for a review of the change ("прогони ревью", "review this", "second opinion on this diff"), and
  before finished work is completed — merged locally or handed to a change request — unless
  `hcb-dev:shipping-workflow` is already driving that handoff and calls this itself. Report-only:
  it never applies fixes; the caller decides what to do with them. Not an auto-trigger on every
  edit, and not an audit of code no change touched.
---

# Multi-review

One review round over one change, opened with every source — Claude's finders, the security
angles, the Codex pass — and one write-up: the findings, and a row per source saying what it
covered. Report-only: never fix what comes back, hand findings and coverage to the caller. Read
[`../../references/invariants.md`](../../references/invariants.md) first — every count, every
empty answer and every source that did not report is read by it.
**Paths**, substituted at invocation — use verbatim: `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}`.

## 1. Scope

**Kind.** Default is the change itself; two variations come on request — narrowed (a path, or a
focus such as "only error handling"), handed to the round as its narrowing, and working-tree-only
("just what I changed since the last commit"), whose base is `HEAD`. A request to audit existing
code — "look through the whole directory", "check every component" — is *not* a change: a round
reviews a diff, and reviews nothing when that diff is empty. Say so and stop, rather than quietly
reviewing the last commit instead.

**Base.** Resolve it by the ladder in
[`../../references/base-resolution.md`](../../references/base-resolution.md), which owns all of
it, a base a caller hands down included, and hand what resolves to the round: a lossy answer
here is the last word. Where `init` refuses it for sharing no history with `HEAD`, **don't fall
to `@{upstream}`** — on an already-pushed branch that range is near-empty, and the coverage gate
would record no gap while most of the branch went unread. Review the working tree alone, `HEAD`
as the base, and every row of the report reads `partial`, the commits left unread named. Where
nothing resolves at all, ask before opening anything.

**Rung.** One for the whole round: `medium`, or `high` where the change meets the high-risk test
in [`../../references/review-pipeline.md`](../../references/review-pipeline.md)'s *The rung*; an
explicit word wins. Always name it — never "the middle", and never the wording it arrived in: a
word off the ladder is not a rung at all.

## 2. Sources

The round is opened with every source — `claude`, `security`, `codex` — save one the caller's
word leaves out, whose row is `n/a` with the caller's words as its reason. Nothing else earns a
skip: cost is paid in the rung, and a narrowing reaches every source alike. A source that cannot
run — the Codex CLI missing, a model's limit on every model tried — records its own loss in the
round, and its row says so.

## 3. Run

As `review-pipeline.md`'s *Running one* says, the findings a caller hands down going in as its
`noticed` candidates — each re-measured at its coordinate on the tree as it stands first: a line
noticed before the rest of the work moved may have moved with it.

## 4. Report

As `review-pipeline.md`'s *Reading the result* says, and nothing else: no fixes, no patches.
Where the report reads thin for the breadth it covered, `review-pipeline.md`'s *The rung* says
what to offer.
