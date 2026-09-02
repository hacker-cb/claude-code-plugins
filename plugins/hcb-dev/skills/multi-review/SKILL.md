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

Runs several independent reviewers over one change and returns a single write-up:
the consolidated findings, plus a line per reviewer stating what it covered. The
reviewers disagree about what "the change" even is, and that disagreement is where
coverage silently disappears — most of this skill exists to keep it visible.

Report-only. Never fix what comes back; hand findings and coverage to the caller.

## 1. Scope

**Kind.** Default is the change itself. Two variations are available on request:
narrowed (a path, or a focus such as "only error handling") and working-tree-only
("just what I changed since the last commit"). A request to audit existing code —
"look through the whole directory", "check every component" — is *not* a change:
each reviewer builds a diff and reviews nothing when that diff is empty. Say so
and stop, rather than quietly reviewing the last commit instead.

**Base.** Resolve it by the shared ladder in
[`../../references/base-resolution.md`](../../references/base-resolution.md),
which owns all of it — the rungs and their order, remote ranking, the
remote-tracking-ref form, the stale-pointer trap. Read it; don't re-derive any of
it here.

Three things this skill must not let the reference's authority hide:

- **Whatever resolves is handed to the reviewers explicitly**, and an explicit
  base wins over any resolution they would do themselves — so a lossy answer here
  is the last word, with nothing downstream to catch it.
- **A base a caller hands down is a name, and a name is not a ref.** A bare branch
  name resolves against a local copy that a worktree may have left behind days ago;
  the range then opens before commits the parent already carries, and the review
  reads someone else's landed work as part of this change. Refresh it through the
  reference before passing it on, same as one you resolved yourself.
- **Confirm the base shares history with `HEAD` before passing it on** —
  `git merge-base <base> HEAD` non-empty (the reference explains why an unrelated
  base is worse than none). Empty → don't pass it, and **don't quietly fall to
  `@{upstream}`**: on an already-pushed branch that range is near-empty, so every
  reviewer returns a small nonzero count, the zero-file check passes, and the
  coverage gate records no gap while most of the branch went unread. Say the base
  could not be resolved, review the working tree alone, and record `partial` with
  the commits left unread. If nothing resolves at all, ask before launching anyone.

**Range.** Base → working tree, so one pass covers the branch's commits together
with the uncommitted edits sitting on top of them.

**Risk** decides effort in the next step. Always name the level — never "the
middle", which lands on a different rung per reviewer.

`codex-review` starts at **`xhigh`** — it resolves its own model and ladder, so
pass a level and let it place that level; risk mostly moves it *down*.

`claude-review` starts at **`medium`**, and risk moves it in both directions:
this is the reviewer whose breadth *and* cost the level actually controls, so a
change that reaches past itself earns a rung up and a mechanical one a rung down.
Pass the rung itself, never the wording it arrived in — "maximum effort" maps
onto `max`, and a word off the ladder is not a level at all.

Treat the change as high-risk when it reaches past itself (public interface,
shared helper, config, schema, wire format), cannot be walked back (it writes,
migrates, publishes, or persists a format someone else reads), meets input whose
shape you do not control, has nothing else checking it (no tests that run, no
types, no compiler), removes a guard, an error path or a test, or touches paths
the project marks sensitive (`CLAUDE.md`, `CODEOWNERS`, `SECURITY.md`). High risk
holds both engines at or above their start; mechanics with no behavior change
lower both, and leave whether either runs at all to the cost question in the next
step — which is where a skip is decided, and recorded with its reason. An
explicit instruction from the caller wins.

**Uncommitted work.** When `git status --short` or
`git ls-files --others --exclude-standard` shows anything belonging to the change,
offer a commit before starting, and name the price of declining: Codex reads the
working tree and sees the edits either way, `claude-review` is handed a commit
range and leaves them out, the security review reads a commit range and does not
see them either, and files that are not tracked at all are invisible to every
reviewer. Offer — never commit anything yourself. A refusal is a fine answer; it
just goes into the report. Where the scope *is* the working tree, the commit offer
alone drops — it would empty the very diff that was asked for — while the price of
what is untracked still gets named.

## 2. Pick

Four questions per reviewer, in order:

- **Available?** If not, record `UNAVAILABLE` with the reason; do not launch it.
- **Applicable?** When the scope asks for something a reviewer cannot do, skip it
  with a recorded reason — `n/a`.
- **Worth its cost on this change?** They do not cost the same, and the expensive
  one is not owed a run just for existing — see *What each run costs* below. A
  skip here is `n/a` with the reason in its row, same as any other.
- **At what level?** Pass the level Scope fixed for that reviewer explicitly —
  never a machine-local default, since this skill runs on other people's
  machines.

| Reviewer | Available when | Reads | Narrowing | Ladder |
|---|---|---|---|---|
| `hcb-dev:codex-review` skill | `command -v codex` and `command -v jq` — it resolves its model from the catalog's JSON | base → working tree | yes, expressed in prose | whatever the resolved model declares — it reads its own from the catalog |
| `hcb-dev:claude-review` skill | `command -v claude` and `command -v jq` — its report is built by parsing the run's JSON | base → `HEAD`, committed work only; the working tree instead when handed no base | yes, passed as a narrowing beside the range | every rung its own `--effort` accepts |
| `security-review` skill | the skill is in your skill list | commits only; base pinned to the default branch | no | none |

What that decides in practice: the security review goes `n/a` on a narrowed or
working-tree-only scope, and `n/a` again where the change alters nothing that
anything executes.

**That last one is your judgement about behaviour, never a list of extensions.**
Ask what now runs differently, not what the files are called. A `SKILL.md`, a
workflow, a `.sh`, a `dependabot.yml` are all instructions something obeys — this
plugin is markdown an agent executes. And prose is not automatically inert: a
credential pasted into an example, or a command a reader will copy and run, is
exactly what the security review is for. `n/a` only when the honest answer to *what
behaves differently now* is "nothing" — and say that reason in the row, since `n/a`
is the one status the coverage gate does not treat as a gap.

### What each run costs

| Reviewer | A run costs | Earns it when |
|---|---|---|
| `codex-review` | one pass by one reviewer, long — but detached, so it overlaps the others | always, while it is installed — it is the floor the other two build on |
| `claude-review` | what its rung buys, detached like the one above: a single pass at the bottom, a fan-out of angles further up | always, while it is installed — and the rung is where the change's breadth gets paid for. Documentation is squarely its business: it is the only reviewer reading `CLAUDE.md` compliance |
| `security-review` | inline, plus its own filtering pass | something now executes differently (above) |

The two engines are independent: a finding both reach on their own is stronger
evidence than either one restating itself, which is what a run of both buys over
a deeper run of one.

**Size is a signal, not a threshold.** Two thousand lines of regenerated fixture
hide less than twenty inside an auth check. Ask what the change could be
concealing, never how much of it there is — no line counts, no file counts. A
single self-contained edit whose whole surface fits in one reading is covered at
the bottom rung; breadth is what the upper ones buy, so save them for something
wide.

## 3. Run

Start the detachable reviewers first so they overlap with the inline one. Both
run as background shell commands of this session, not as subagents — no rule
about delegating to subagents or workflows reaches them. The one reviewer that
fans out into subagents is the security review, and it asks for them below.

- **codex-review** — invoke the `hcb-dev:codex-review` skill, passing the base and
  the effort level — and no base at all where the scope is the working tree alone,
  which is how that skill is told to review one.
- **claude-review** — invoke the `hcb-dev:claude-review` skill, passing the base
  together with the rung §1 fixed — and no base at all where the scope is the
  working tree alone, which is how that skill is told to review one. Whatever narrowed the
  review goes down with it, in the same prose.
- **security-review** — invoke the skill inline, last, and run it as written:
  the sub-tasks it asks for are launched as subagents of this session — the
  finder first, then the filtering pass as parallel sub-tasks. The skill asking
  for them is the ask a rule about delegating to subagents waits for, and so is
  the caller that invoked this skill: launch them without asking. Never delegate
  the skill itself to a subagent to save context, whatever your own tools look
  like: the filtering pass is what drops every candidate below confidence 8, and
  where that pass cannot run the skill does not fail — it silently returns the
  unfiltered candidates as if they had been filtered. Nor is a filtering pass
  done in this session by the finder the skill's pass: record such a run as
  `partial (structural)` with the reason, never as a clean result. Its write-up
  ends *its* run, not yours: carry it into §4 as one reviewer's row, and never
  let it stand as the answer.

## 4. Collect

Take two things from each reviewer: what it covered — base and file count, from
that reviewer's own output — and its findings. Never carry one reviewer's count
across to another's row; a borrowed number is how a reviewer that read nothing
gets recorded as having read the change.

**Wait for every reviewer you launched.** None of the four statuses in §6 says
"still running", so a row filled before its reviewer returns asserts something
about a run that has not finished — and the one status that fits an empty cell,
`n/a`, is the one the coverage gate treats as closed.

**Waiting is polling, not stopping.** Ending the turn here answers the caller with
one reviewer's report in place of this skill's own — and where this skill runs
inside a subagent, that also ends the work the review was gating. Poll each
detached run until its coverage record is there; if one never returns, that is a
row and a reason, not a reason to stall.

**A reviewer that edited the tree says so, and that line is not coverage.** It
belongs above the table with the findings, in the caller's own words: what a
reviewer changed is not what a reviewer read, and the completion about to happen
is the reason anyone needs to know before it does.

**Zero files covered is not a pass.** Decide it by the count, never by matching a
reviewer's wording: each phrases an empty review differently, and one engine
phrases it differently again between a based and a working-tree run.

**Less than the change is not a pass either.** A reviewer that ran against the
wrong base, or over only the committed half while the rest sat in the working
tree, covered a nonzero number of the wrong files. That is `partial`, and it
counts as a gap — say what it missed. Where the scope was narrowed, the count is
the range's and not the narrowing's: say what was left unread rather than letting
it stand as full coverage.

**A nonzero count can still mean the commits went unread.** Both engines print a
`coverage-warning:` line when they reviewed the working tree alone; the count is
then of *those* files. Read that line as well as the number — a count that passes
the zero check under such a warning is `partial`, and a base is what closes it.

When a reviewer fails, quote its error instead of guessing a cause.

## 5. Consolidate

Dedup by `(file, line)` **and** by mechanism — reviewers routinely anchor one root
cause at different lines, and one bug described twice reads as two. Keep whichever
write-up carries the concrete failure scenario, and rank by severity.

## 6. Report

Coverage first, as a table — one row per reviewer, what it covered before its
verdict:

| Reviewer | Covered | Effort | Result |
|---|---|---|---|
| `codex-review` | `<base>`, 3 files | xhigh | 2 findings |
| `claude-review` | `<base>`, 3 files | medium | no findings |
| `security-review` | `<base>`, 1 of 3 files | — | partial: rest uncommitted |

Keep the cells short. "Covered" is always `<base>, N files`, effort gets its own
column so a level is never left implied, and "Result" is a verdict — never the
description of a finding, which belongs below the table where it can wrap freely.

Four statuses, kept apart deliberately: `UNAVAILABLE` — the reviewer could not
run; `n/a` — it was deliberately not run, and why; `nothing to review` — it ran
and covered zero files; `partial` — it ran but covered less than the change, or
the wrong range. Everything except `n/a` is a gap in coverage — with one
distinction the caller needs: a `partial` forced by a reviewer's **own structural
limit**, rather than by anything about this change, is not something anyone can
act on. The security review is the standing example: its base is pinned to the
default branch, so it is mis-scoped in every repo whose changes target `dev` or
`release/*`. Report that as `partial (structural)` with the reason, so a shipping
flow can tell it apart from a gap that is still worth closing.

Then the findings, and nothing else: no fixes, no patches, no offer to apply them.

**Where the report reads thin for the breadth it covered** — the engines agreed
on little, or the change reaches across far more ground than the findings touch —
say so, and offer the one thing neither engine here does: `/code-review` typed by
the user, whose workflow route puts an **independent verifier on every candidate**
rather than letting the finder judge itself. The rungs are reachable from this
skill; that verify pass is not, and it is the whole of what the recommendation
buys.

Hand it over ready to run — the rung, then the base and narrowing §1 resolved,
spelled out as `<base>...HEAD`. Left off, it falls back to its own default range,
which on an already-pushed branch is near-empty and reviews almost nothing.
Recommend, and let the user decide; never launch it yourself.

When the change is about to be completed — merged locally or handed to a change
request — say the gaps out loud before the handoff rather than burying them under
the findings. Whoever is completing the work decides what to do about them, but a
completion with a reviewer silently missing is exactly what the coverage lines
exist to prevent.
