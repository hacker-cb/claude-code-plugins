---
name: claude-review
description: >-
  Run a code review with Claude's own reviewer, in a separate headless session
  (`claude -p "/code-review …"`), at an effort level the caller picks. Use when
  `hcb-dev:multi-review` runs this reviewer; when a pipeline, a batch worker or a
  subagent needs a review where the interactive `/code-review` command cannot be
  reached; or when the user asks for a cheaper, faster pass than that command's
  full fan-out. Review-only: returns the findings verbatim and never fixes
  anything. For one change reviewed by several independent reviewers at once, use
  `hcb-dev:multi-review` instead. Invoke deliberately, when asked — not as an
  auto-trigger on every change.
---

# Claude review

`claude -p "/code-review …"` runs Claude Code's own reviewer in a fresh headless
session, which is reachable from anywhere `Bash` is — including a subagent, where
the interactive command and the review workflow are both out of reach.

This skill is **review-only**. Never fix what it reports — return the findings
and let the caller decide.

## 1. Pick the base

Review against a base ref. §3 diffs `merge-base(base, HEAD)` against the
**working tree**, so a single pass covers the branch's commits *and* uncommitted
edits to tracked files.

**Resolve it by the shared ladder** —
[`../../references/base-resolution.md`](../../references/base-resolution.md) owns
all of it: the rungs, which remote answers which question, and the rule that a
base sharing no history with `HEAD` is not a base.
Resolve first, then hand the result to §3.

Being on the default branch is fine: the merge-base collapses to `HEAD`, and the
review becomes the working-tree diff.

**Handed no base, §3 reviews the working tree alone** and prints a
`coverage-warning:` line; no committed work is reviewed. §4 reports that as
partial coverage.

## 2. Check for untracked files first

The review reads `git diff`, and `git diff` never shows untracked files, so
brand-new files are silently invisible to it:

```bash
git ls-files --others --exclude-standard
```

If that lists anything belonging to the change, say so up front and offer
`git add -N <file>`, which makes them visible without staging their contents.
Don't run it yourself — touching the index is the user's call.

## 3. Run it

One rung drives two separate things, and both matter: as the command's argument
it sets how many angles hunt and how many findings come back, and as `--effort`
it sets how hard the reviewer thinks. Pass it in both places, never one — left
off `--effort`, the run inherits whatever the surrounding environment carries and
the rung silently stops controlling cost. `claude --help` lists the ladder the
flag accepts.

Start at `medium`. A caller — a person or another skill — may hand you the base
or the level; an explicit one wins over anything resolved here.

Fill the two values at the top of the block. Everything under them is live.

```bash
BASE="<the ref resolved in §1 — leave EMPTY for a working-tree review>"
LEVEL="<the rung the caller named, or medium>"

if [ -n "$BASE" ]; then
  MERGE_BASE="$(git merge-base "$BASE" HEAD)"
  COVERED=$(git diff --name-only "$MERGE_BASE" | wc -l | tr -d ' ')
  TARGET="the range $MERGE_BASE...HEAD plus every uncommitted change in the working tree"
else
  COVERED=$(git status --porcelain --untracked-files=all | wc -l | tr -d ' ')
  TARGET="only the uncommitted changes in the working tree"
fi

OUT="$(mktemp "${TMPDIR:-/tmp}/claude-review.XXXXXX")"
# stdout carries the JSON envelope; stderr goes to its own file so a warning
# printed mid-run cannot corrupt the JSON `jq` reads below.
claude -p "/code-review $LEVEL $TARGET" --effort "$LEVEL" --output-format json \
  > "$OUT" 2> "$OUT.log"
# The coverage record the caller compares against.
echo "scope: ${BASE:-working tree}, $COVERED files, $LEVEL"
# A SEPARATE line, never appended to the scope one.
[ -n "$BASE" ] \
  || echo "coverage-warning: no base — the commits on this branch are NOT reviewed"
if jq -e '.is_error == false' "$OUT" >/dev/null 2>&1; then
  jq -r '.result' "$OUT"
else
  echo "claude review failed:"; tail -20 "$OUT" "$OUT.log"
fi
```

The target goes in as prose rather than a bare ref: a ref range narrows the
review to the commits in it, dropping the working tree, and a bare SHA narrows it
to that one commit. Whatever narrowed the scope — a path, a focus such as "only
error handling" — goes into the same sentence.

Write the report **outside the repository under review**: a file left inside
becomes an untracked file the review then reads as part of the change.

Run it with `Bash(run_in_background: true)`, whoever asked and however small the
diff looks — read inline, the call is killed on the tool's own limit, and the
kill takes the block's `scope:` line and its `claude review failed:` branch with
it, so the run comes back as neither a review nor a named failure. Pass
`description: "Claude review"` on the `Bash` call so the run is recognizable in
the task list.

The finished task's output is the report: collect it when the task completes and
take it through §4 before answering. Detached is how it runs, not permission to
answer without it.

## 4. Hand back the findings

The block prints a `scope:` line — base, file count and level — and then the
review itself. Pass the scope line on as the coverage record; it is the only
statement of what this run actually looked at. Return the review **verbatim** —
no paraphrase, no summary, no commentary around it.

Check the scope line before passing either on:

- `0 files` means nothing was reviewed. Report that as coverage of zero, never as
  a clean review.
- A `coverage-warning:` line means the count is over the working tree alone. The
  number and the findings are real; the commits are not among them. Report it as
  partial coverage, name which case it was — nothing resolved, or a base refused
  for sharing no history — and go back to §1 for a base.

A missing CLI, an expired login and a non-repository all land in the
`claude review failed:` branch, where the tail names which it was. Pass that line
through as the result, the same as anything else the run refuses on, rather than
working around it.
