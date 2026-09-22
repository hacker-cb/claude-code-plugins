---
name: claude-review
description: >-
  Review a change with Claude's own finders — one agent per angle of the rung, every candidate
  the rung's budget reaches then checked by an independent verifier — over the range and at the
  rung (medium or high) the caller fixes. Use when `hcb-dev:multi-review` runs this reviewer; when a pipeline, a batch
  worker or a subagent needs a review pinned to a range, with verified findings and a coverage
  record handed back; or when the user asks for a Claude review of the current change.
  Review-only: returns the findings and never fixes anything. For one change reviewed by several
  independent reviewers at once, use `hcb-dev:multi-review` instead; for more than the high rung,
  the built-in `/code-review`, typed by the user. Invoke deliberately, when asked — not as an
  auto-trigger on every change.
---

# Claude review

One review round whose only source is Claude's finders, run by the plugin's own conductor and
checked by its own verifier. The round — its store, its rungs, who runs what and what comes back
— is [`../../references/review-pipeline.md`](../../references/review-pipeline.md)'s; read it
first. This skill is **review-only**: never fix what it reports, return it and let the caller
decide. Its finders and its checker only read because they are told to: no sandbox holds them,
and what they may run is what this session's permission mode lets through — weigh that before
pointing a round at code nobody here wrote.
**Paths**, substituted at invocation — use verbatim: `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}`.

## 1. Scope

- **The base** — the one a caller hands down, refreshed, since a name is not a ref; otherwise
  what [`../../references/base-resolution.md`](../../references/base-resolution.md) resolves.
  It must share history with `HEAD`. Where none resolves, stop and say so: a round needs a base.
  A review of the working tree alone takes `HEAD` as its base.
- **The rung** — the caller's; `medium` where none is named.
- **The language** — the one this session reports in.
- **A narrowing** — a path, or a focus such as "only error handling", where the caller gave one.

## 2. Open the round

```bash
BASE="<the base>"
RUNG="<the rung>"
LANGUAGE="<this session's language, as a tag: en, ru, …>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/review-round.mjs" init --mode round --base "$BASE" --rung "$RUNG" --sources claude --language "$LANGUAGE"
```

Add `--narrow "<the narrowing>"` where there is one. Read the answer's `warnings` before
anything else: an untracked file named there is outside the review — say so, and offer
`git add -N <path>` rather than running it. A round with nothing to review says so as well, and
ends there.

Candidates the caller handed in go into the round now:

```bash
ROUND="<the round id init printed>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/review-round.mjs" add --round "$ROUND" --source noticed < "<the candidates, as JSON>"
```

## 3. Run it

Launch `hcb-dev:review:reviewer`, prompted `round <id>` and with nothing else — where the Agent
tool offers `run_in_background`, pass `false` — and wait for it as `review-pipeline.md` says.
Asking for it is what this skill does: a rule admitting subagents only on a skill's ask is met
by it. A conductor stopped by a model's limit is launched once more with `model: sonnet`.

Where the Agent tool is not among your tools, run the round as `review-pipeline.md`'s *Without
agents* says.

## 4. Hand back

```bash
ROUND="<the round id init printed>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/review-round.mjs" result --round "$ROUND"
```

Report it as `review-pipeline.md` says — `## Review coverage`, one row for `claude-review` with
the round's base, its file count, its rung and its state; then `## Findings`. A result that
refuses names what the round still lacks — the conductor stopped before it ended: the row is
`partial`, with that reason. The findings' text
is the finders' own: pass it on as written. Where the round reads thin for the ground the change
covers, or a caller wants more than the `high` rung buys, offer the built-in `/code-review` as
`review-pipeline.md` words it; never launch it yourself.
