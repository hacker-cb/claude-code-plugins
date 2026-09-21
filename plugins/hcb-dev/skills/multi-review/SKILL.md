---
name: multi-review
description: >-
  Review one change with several independent reviewers at once — the Codex CLI,
  Claude's own reviewer, the built-in security review — then consolidate their
  findings and report what each one actually covered. Use when
  the user asks for a review of the current change ("прогони ревью", "review
  this", "second opinion on this diff"), and before finished work is completed —
  merged locally or handed to a change request — unless
  `hcb-dev:shipping-workflow` is already driving that handoff and calls this
  itself. Report-only: it never applies fixes; the caller decides what to do with
  them. Not an auto-trigger on every edit.
---

# Multi-review

Runs several independent reviewers over one change and returns a single write-up: the
consolidated findings, plus a line per reviewer stating what it covered. The reviewers disagree
about what "the change" even is, and that disagreement is where coverage silently disappears —
most of this skill exists to keep it visible. Report-only: never fix what comes back, hand
findings and coverage to the caller. Read
[`../../references/invariants.md`](../../references/invariants.md) first — every count, every
empty answer and every reviewer that did not report is read by it.
**Paths**, substituted at invocation — use verbatim: `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}`.

## 1. Scope

**Kind.** Default is the change itself; two variations come on request — narrowed (a path, or a
focus such as "only error handling") and working-tree-only ("just what I changed since the last
commit"). A request to audit existing code — "look through the whole directory", "check every
component" — is *not* a change: each reviewer builds a diff and reviews nothing when that diff
is empty. Say so and stop, rather than quietly reviewing the last commit instead.

**Base.** Resolve it by the ladder in
[`../../references/base-resolution.md`](../../references/base-resolution.md), which owns all of
it. Three things that reference cannot enforce from where it sits: **whatever resolves is handed
to the reviewers explicitly**, and an explicit base wins over any resolution they would do
themselves, so a lossy answer here is the last word; **a base a caller hands down is a name, and
a name is not a ref**, so refresh it before passing it on; and **confirm it shares history with
`HEAD`** (`git merge-base <base> HEAD` non-empty). Empty → don't pass it, and **don't quietly
fall to `@{upstream}`**: on an already-pushed branch that range is near-empty, so every reviewer
returns a small nonzero count, the zero-file check passes, and the coverage gate records no gap
while most of the branch went unread. Say the base could not be resolved, review the working
tree alone, and record `partial` with the commits left unread. If nothing resolves at all, ask
before launching anyone.

**Range.** Base → working tree, so one pass covers the branch's commits together with the
uncommitted edits sitting on top of them.

**Risk** decides effort in the next step. Always name the level — never "the middle", which
lands on a different rung per reviewer, and never the wording it arrived in: "maximum effort"
maps onto `max`, and a word off the ladder is not a level at all. `codex-review` starts at
**`xhigh`**, resolving its own model and ladder, so risk mostly moves it *down*;
`claude-review` starts at **`medium`** and risk moves it both ways, being the reviewer whose
breadth *and* cost the level actually controls.

Treat the change as high-risk when it reaches past itself (public interface, shared helper,
config, schema, wire format), cannot be walked back (it writes, migrates, publishes, or persists
a format someone else reads), meets input whose shape you do not control, has nothing else
checking it, removes a guard, an error path or a test, or touches paths the project marks
sensitive. High risk holds both engines at or above their start; mechanics with no behaviour
change lower both. An explicit instruction from the caller wins.

**Uncommitted work.** Where `git status --short` or `git ls-files --others --exclude-standard`
shows anything belonging to the change, offer a commit before starting — offer, never commit
anything yourself — and name the price of declining: Codex sees the working tree either way,
`claude-review` and the security review are handed commit ranges and leave those edits out, and
files that are not tracked at all are invisible to every reviewer. A refusal is a fine answer
and goes into the report. Where the scope *is* the working tree, the offer drops (it would empty
the very diff asked for) while the price of what is untracked still gets named.

## 2. Pick

Three questions per reviewer, in order:

- **Available?** If not, record `UNAVAILABLE` with the reason; do not launch it.
- **Applicable?** Where the scope asks for something a reviewer cannot do, skip it with a
  recorded reason — `n/a`, as for one the caller asked to leave out, the caller's words being
  the reason in its row. Nothing else earns a skip: cost is paid in the rung.
- **At what level?** Pass the level Scope fixed for that reviewer explicitly, never a
  machine-local default — this skill runs on other people's machines.

| Reviewer | Available when | Reads | Narrowing | Ladder |
|---|---|---|---|---|
| `hcb-dev:codex-review` skill | `command -v codex` and `command -v jq` — it resolves its model from the catalog's JSON | base → working tree | yes, expressed in prose | whatever the resolved model declares — it reads its own from the catalog |
| `hcb-dev:claude-review` skill | `command -v claude` and `command -v jq` — its report is built by parsing the run's JSON | base → `HEAD`, committed work only; the working tree instead when handed no base | yes, passed as a narrowing beside the range | every rung its own `--effort` accepts |
| `security-review` skill | the skill is in your skill list | commits only; base pinned to the default branch | no | none |

In practice that turns the security review down on a narrowed or working-tree-only scope, and
again where the change alters nothing that anything executes — **a judgement about behaviour,
never a list of extensions.** Ask what now runs differently, not what the files are called: a
`SKILL.md`, a workflow, a `.sh`, a `dependabot.yml` are all instructions something obeys, and
prose is not automatically inert — a credential pasted into an example, or a command a reader
will copy and run, is exactly what that review is for. `n/a` only where the honest answer to
*what behaves differently now* is "nothing", and say that reason in the row: `n/a` is the one
status the coverage gate does not treat as a gap. A change that is documentation alone is
`claude-review`'s, the only reviewer reading `CLAUDE.md` compliance, so applicability never
turns it down for carrying no code.

**Size is a signal, not a threshold.** Two thousand lines of regenerated fixture hide less than
twenty inside an auth check. Ask what the change could be concealing, never how much of it there
is — no line counts, no file counts. A single self-contained edit whose whole surface fits in
one reading is covered at the bottom rung; breadth is what the upper ones buy.

## 3. Run

Start the detachable reviewers first so they overlap with the inline one. Both run as background
shell commands of this session, not as subagents — no rule about delegating to subagents or
workflows reaches them. The one reviewer that fans out into subagents is the security review.

- **codex-review** and **claude-review** — invoke the `hcb-dev:codex-review` and
  `hcb-dev:claude-review` skills through the Skill tool, never by reading their `SKILL.md`: only
  the tool substitutes the plugin root in one. Each is passed the base and the rung §1 fixed for
  it, and no base at all where the scope is the working tree alone, which is how both are told to
  review one. Whatever narrowed the review goes down with it, in the same prose.
- **security-review** — invoke the skill inline, last, and run it as written: the sub-tasks it
  asks for are launched as subagents of this session — the finder first, then the filtering pass
  as parallel sub-tasks. The skill asking for them is the ask a rule admitting subagents only on
  the user's or a skill's ask waits for, and so is the caller that invoked this skill: launch
  them without asking. **Never delegate the skill itself to a subagent to save context**: the
  filtering pass is what drops every candidate below confidence 8, and where that pass cannot
  run the skill does not fail — it silently returns the unfiltered candidates as if they had
  been filtered. Nor is a filtering pass this session does itself the skill's pass: record such
  a run as `partial`, with what stopped the sub-tasks as the reason, never as a clean result — a
  gap the caller can close, not a structural one. Its write-up ends *its* run, not yours: carry
  it into §4 as one reviewer's row, and never let it stand as the answer.

## 4. Collect

Take two things from each reviewer: what it covered — base and file count, from that reviewer's
own output — and its findings. Never carry one reviewer's count across to another's row; a
borrowed number is how a reviewer that read nothing gets recorded as having read the change.

**Wait for every reviewer you launched.** None of the four statuses in §6 says "still running",
so a row filled before its reviewer returns asserts something about a run that has not finished —
and the one status that fits an empty cell, `n/a`, is the one the coverage gate treats as closed.
**How to wait is [`../../references/review-runs.md`](../../references/review-runs.md)'s, and this
skill is the caller it was written for** — several runs out at once, and never a session that may
end its turn: it runs inside subagents and dispatched sessions, where doing so ends the work the
review was gating. A reviewer that has not returned by the ceiling is a row and a reason, never
an empty cell and never a stall.

**A spent quota is `UNAVAILABLE`, never `n/a`.** `n/a` is the status the coverage gate treats as
closed, so recording a reviewer that did not run passes a completion with it missing — which is
what `UNAVAILABLE` exists for; the engine's own notice goes below the table and the cell stays
short. **A model limit is recoverable now**: rerun on another family before recording
`UNAVAILABLE`, and record which model was tried.

**Less than the change is not a pass.** A reviewer that ran against the wrong base, or over only
the committed half while the rest sat in the working tree, covered a nonzero number of the wrong
files. That is `partial`, and it counts as a gap — say what it missed. Where the scope was
narrowed, the count is the range's and not the narrowing's. **A `coverage-warning:` row is
`partial`**, whatever the count beside it says — while a **`run-warning:` is not**: it says what
the run did, not what it read, and a build the boundary refused is this session's to run where a
finding hangs on it. When a reviewer fails, quote its error instead of guessing a cause.

## 5. Consolidate

Dedup by the key [`../../references/findings.md`](../../references/findings.md) fixes — `(file,
line)` **and** mechanism — keeping whichever write-up carries the concrete failure scenario, and
rank by that same file's ladder.

## 6. Report

A report in [`../../references/report-format.md`](../../references/report-format.md)'s grammar,
[`../../references/report-blocks.md`](../../references/report-blocks.md)'s `## Review coverage`
first — one row per reviewer, what it covered before its verdict:

| Reviewer | Covered | Effort | Result |
|---|---|---|---|
| `codex-review` | `<base>`, 3 files | xhigh | 🟢 2 findings |
| `claude-review` | `<base>`, 3 files | medium | 🟢 no findings |
| `security-review` | `<base>`, 1 of 3 files | — | 🔴 partial: rest uncommitted |

Keep the cells short: "Covered" is always `<base>, N files`, effort gets its own column so a
level is never left implied, and "Result" is a verdict — 🟢 covered, 🔴 a gap someone can close,
which opens the report as well since a gap is what stops a completion, ⚪ `n/a` or a
`partial (structural)` no one can — never a finding, which belongs in `## Findings`.

Four statuses, kept apart deliberately: `UNAVAILABLE` — the reviewer could not run; `n/a` — it
was deliberately not run, and why; `nothing to review` — it ran and covered zero files;
`partial` — it ran but covered less than the change, or the wrong range. Everything except `n/a`
is a gap, with one distinction the caller needs: a `partial` forced by a reviewer's **own
structural limit**, rather than by anything about this change, is not something anyone can act
on. The security review is the standing example, its base pinned to the default branch and so
mis-scoped in every repo whose changes target another trunk. Report that as `partial
(structural)` with the reason, so a shipping flow can tell it apart from a gap still worth
closing.

Then `## Findings`, laid out by [`../../references/findings-table.md`](../../references/findings-table.md)
— verified by none, ruling nothing — and nothing else: no fixes, no patches, no offer to apply them.

**Where the report reads thin for the breadth it covered** — the engines agreed on little, or
the change reaches across far more ground than the findings touch — say so, and offer the one
thing neither engine here does: `/code-review` typed by the user, whose workflow route puts an
**independent verifier on every candidate** rather than letting the finder judge itself. Hand it
over as an ask, ready to run — the rung, then the base and narrowing §1 resolved, spelled out as
`<base>...HEAD`; left off, it falls back to its own default range, which on an already-pushed
branch is near-empty. Never launch it yourself.
