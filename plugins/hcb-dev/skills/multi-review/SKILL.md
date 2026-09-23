---
name: multi-review
description: >-
  Review one change with every source the plugin's review round has — Claude's finders, one
  per angle, the security angles and a pass of the Codex CLI — every candidate checked by one
  verifier, then report the findings and what each source actually covered. Use when the user
  asks for a review of the current change ("прогони ревью", "review this", "second opinion on
  this diff"), and before finished work is completed — merged locally or handed to a change
  request — unless `hcb-dev:shipping-workflow` is already driving that handoff and calls this
  itself. Report-only: it never applies fixes; the caller decides what to do with them. Not an
  auto-trigger on every edit.
---

# Multi-review

One review round over one change, opened with every source that can run — Claude's finders, the
security angles, the Codex pass — and one write-up: the findings, each checked by the round's
verifier, and a row per source saying what it covered. Coverage is where a review loses ground
without a word, and most of this skill exists to keep it visible. Report-only: never fix what
comes back, hand findings and coverage to the caller. Read
[`../../references/invariants.md`](../../references/invariants.md) first — every count, every
empty answer and every source that did not report is read by it.
**Paths**, substituted at invocation — use verbatim: `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}`.

## 1. Scope

**Kind.** Default is the change itself; two variations come on request — narrowed (a path, or a
focus such as "only error handling") and working-tree-only ("just what I changed since the last
commit"). A request to audit existing code — "look through the whole directory", "check every
component" — is *not* a change: a round reviews a diff, and reviews nothing when that diff is
empty. Say so and stop, rather than quietly reviewing the last commit instead.

**Base.** Resolve it by the ladder in
[`../../references/base-resolution.md`](../../references/base-resolution.md), which owns all of
it. Three things that reference cannot enforce from where it sits: **whatever resolves is handed
to the round explicitly**, so a lossy answer here is the last word; **a base a caller hands down
is a name, and a name is not a ref**, so refresh it before passing it on; and **confirm it shares
history with `HEAD`** (`git merge-base <base> HEAD` non-empty). Empty → don't pass it, and
**don't quietly fall to `@{upstream}`**: on an already-pushed branch that range is near-empty, so
the round counts a few files, and the coverage gate records no gap while most of the branch went
unread. Say the base could not be resolved, review the working tree alone — `HEAD` as the base —
and record `partial` with the commits left unread. If nothing resolves at all, ask before opening
anything.

**Range.** Base → working tree, tracked files: one round covers the branch's commits together
with the uncommitted edits sitting on top of them.

**Rung.** `medium`, or `high` where the change meets the high-risk test in
[`../../references/review-pipeline.md`](../../references/review-pipeline.md)'s *The rung*; an
explicit word wins. Always name it — never "the middle", and never the wording it arrived in: a
word off the ladder is not a rung at all.

**Untracked work.** Where `git ls-files --others --exclude-standard` shows files belonging to the
change, offer a commit, or `git add -N <path>`, before starting — offer, never run either — and
name the price of declining: a file never added is outside the round, invisible to every source.
A refusal is a fine answer and goes into the report.

## 2. Sources

Three questions per source, in order:

- **Available?** `claude` and `security` need `node`, the round living in a script's store;
  `codex` needs the `codex` CLI as well. One that is not: its row `UNAVAILABLE` with the reason,
  and the round opened without it.
- **Applicable?** Only the caller's word leaves one out: its row `n/a`, the caller's words its
  reason. Nothing else earns a skip — cost is paid in the rung, and a narrowing reaches every
  source alike.
- **At what rung?** The one Scope named, for the whole round — never a machine-local default:
  this skill runs on other people's machines.

A source reads the change whatever it is made of. A `SKILL.md`, an agent's body, a workflow, a
`dependabot.yml` and a command a reader will copy are all instructions something obeys, and a
change of documentation alone is still read: Claude's finders are what holds it to the
repository's own rules.

**Size is a signal, not a threshold.** Two thousand lines of regenerated fixture hide less than
twenty inside an auth check. Ask what the change could be concealing, never how much of it there
is — no line counts, no file counts. A single self-contained edit whose whole surface fits in
one reading is covered at `medium`; breadth is what `high` buys.

## 3. Run

As `review-pipeline.md`'s *Running one* says: the round opened with the sources §2 kept, the base
and rung §1 fixed, a narrowing where there is one, and the report's language. Candidates a caller
hands down — findings its work noticed and left unfixed, each with its verdict where one was
made — go into the round as `noticed` before its conductor starts, in the shape `add` checks.

**A Codex row lost to one model's limit** — the log tail in its status names one — is closed by a
round opened again with `--sources codex` and another `--codex-model`, over the same base and
rung. Its row stands for the first's, naming the model tried, and its findings join the first
round's, a repeat deduplicated by the key
[`../../references/findings.md`](../../references/findings.md) fixes — `(file, line)` **and**
mechanism.

## 4. Report

Read the result as *Reading the result* there says, and report in
[`../../references/report-format.md`](../../references/report-format.md)'s grammar —
[`../../references/report-blocks.md`](../../references/report-blocks.md)'s `## Review coverage`
first, a row per source, what it covered before its verdict:

| Source | Covered | Effort | Result |
|---|---|---|---|
| `claude` | `<base>`, 3 files | high | 🟢 2 findings |
| `security` | `<base>`, 3 files | high | 🟢 no findings |
| `codex` | `<base>`, 3 files | xhigh | 🔴 UNAVAILABLE: a model's limit, on two models |

Keep the cells short: "Covered" is always `<base>, N files`, the round's own count; effort gets
its own column so a level is never left implied; and "Result" is the verdict *The coverage it
reports* there gives the row's state — never a finding's description, which belongs in
`## Findings`. A source the round was never opened with carries what §2 recorded for it.

Then `## Findings`, laid out by
[`../../references/findings-table.md`](../../references/findings-table.md), and nothing else: no
fixes, no patches. Where the report reads thin for the breadth it covered, *The rung* there says
what to offer.
