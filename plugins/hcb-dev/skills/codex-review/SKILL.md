---
name: codex-review
description: >-
  Run a code review with Codex — OpenAI's coding agent — over the current
  branch, using its own non-interactive reviewer (`codex exec review`). Use when
  the user or a pipeline asks for a "codex review", or wants a second opinion on
  a change from an engine other than Claude. Review-only: returns Codex's
  findings verbatim and never fixes anything. Invoke deliberately, when asked —
  not as an auto-trigger on every change.
---

# Codex review

`codex exec review` is Codex's built-in reviewer, running non-interactively in a
read-only sandbox. It needs `codex` on `PATH` and a live `codex login`.

This skill is **review-only**. Never fix what it reports — return the findings
and let the caller decide.

## 1. Pick the base

Review against a base ref. `--base` diffs `merge-base(base, HEAD)` against the
**working tree**, so a single pass covers the branch's commits *and* uncommitted
edits to tracked files.

**Resolve it by the shared ladder** —
[`../../references/base-resolution.md`](../../references/base-resolution.md) owns
all of it: the rungs, which remote answers which question, and the rule that a
base sharing no history with `HEAD` is not a base.
Resolve first, then hand the result to §3.

Two of its rules decide this skill's output, so do not skip them: confirm
`git merge-base <base> HEAD` is non-empty before passing a base on, and where
nothing resolves, **ask** rather than review against a guess.

Being on the default branch is fine: the merge-base collapses to `HEAD`, and the
review becomes the working-tree diff.

**Handed no base, §3 reviews `--uncommitted`** — staged, unstaged and untracked —
and prints a `coverage-warning:` line. That is an honest fallback, never a
substitute: a working-tree review covers no committed work at all. Say which case
it was — nothing resolved, or a base refused for sharing no history — and go back
for a base. "working tree, 4 files" otherwise reads exactly like a review that
happened.

## 2. Check for untracked files first

`--base` reviews `git diff`, and `git diff` never shows untracked files, so
brand-new files are silently invisible to the review:

```bash
git ls-files --others --exclude-standard
```

If that lists anything belonging to the change, say so up front and offer
`git add -N <file>`, which makes them visible without staging their contents.
Don't run it yourself — touching the index is the user's call.

## 3. Run it

Write the report **outside the repository under review**: a file left inside
becomes an untracked file that Codex then reads as part of the change.

`codex exec review --base <ref>` takes a plain git ref and is forge-agnostic.
Resolution was the only forge-specific step, and it already happened in §1.

Use `codex exec review`, not the top-level `codex review`: the latter has no `-o`,
and the block below splits the verdict from the transcript with it.

Fill the three values at the top of the block — the base from §1, the model and
level from the catalog note below. Everything under them is live.

```bash
BASE="<the ref resolved in §1 — leave EMPTY for a working-tree review>"
MODEL="<top of the catalog, or the one the caller named>"
EFFORT="<xhigh, or that model's highest when it offers no xhigh>"

# Positional parameters, not an interpolated string: the scope is two arguments
# or one, and an unquoted expansion would leave that to word-splitting.
if [ -n "$BASE" ]; then
  set -- --base "$BASE"
  # §1 already confirmed the merge-base is non-empty. Unconfirmed, this line is
  # where it shows: `git diff --name-only ""` exits 128 rather than counting
  # something wrong, so COVERED lands at 0 and §4 reads it as coverage of zero.
  COVERED=$(git diff --name-only "$(git merge-base "$BASE" HEAD)" | wc -l | tr -d ' ')
else
  set -- --uncommitted
  COVERED=$(git status --porcelain --untracked-files=all | wc -l | tr -d ' ')
fi

OUT="$(mktemp "${TMPDIR:-/tmp}/codex-review.XXXXXX")"
codex exec review "$@" -c model="$MODEL" -c model_reasoning_effort="$EFFORT" \
  -o "$OUT" > "$OUT.log" 2>&1
# The scope line is what a caller compares against; without it nobody can tell
# what this run actually looked at.
echo "scope: ${BASE:-working tree}, $COVERED files, $MODEL at $EFFORT"
# A SEPARATE line, never appended to the scope line: a caller splitting that line
# into `Covered` and `Effort` columns would otherwise file the warning under
# effort, and the row would read as a completed review of a nonzero file count —
# exactly the partial-coverage gap the note exists to raise.
[ -n "$BASE" ] \
  || echo "coverage-warning: no base — the commits on this branch are NOT reviewed"
if [ -s "$OUT" ]; then cat "$OUT"; else echo "codex review failed:"; tail -20 "$OUT.log"; fi
```

`-o` captures the verdict while the full transcript goes to the log, so stdout is
the report and nothing else. Pass `description: "Codex review"` on the `Bash`
call so the run is recognizable in the task list.

- **Background** — asked for by a pipeline, or a diff big enough to be slow: run
  that exact block with `Bash(run_in_background: true)`. The finished task's
  output is already the report.
- **Foreground** — same block, read inline.

A caller — a person or another skill — may hand you the base, the model or the
effort level; each is meant to be passed in, and an explicit one wins over the
resolution here.

**Resolve the model and its ladder from the catalog on every run**, never from
memory and never from `~/.codex/config.toml`, which differs from machine to
machine. `codex debug models` prints both offline, in one call:

```bash
CAT="$(codex debug models)"
MODEL="$(printf '%s' "$CAT" | jq -r '[.models[] | select(.visibility=="list")] | sort_by(.priority)[0].slug')"
LEVELS="$(printf '%s' "$CAT" | jq -r --arg m "$MODEL" '.models[] | select(.slug==$m) | [.supported_reasoning_levels[].effort] | join(" ")')"
```

`priority` ascends from the newest frontier model, so entry 0 of that sort is the
one to review with. Take `xhigh` when `$LEVELS` offers it, otherwise that model's
highest — the set moves with the model, and no fixed list holds: `gpt-5.5` stops at
`xhigh` while the `gpt-5.6` family adds `max` and `ultra`.

Nothing local checks the level you pass. The CLI prints it back
(`reasoning effort: <whatever>`) and sends it on, so that banner confirms nothing;
the API is what refuses a level the model does not take, and its message names the
accepted set.

`--output-schema` is accepted but ignored in review mode — the output is always
prose.

## 4. Hand back the findings

The block prints a `scope:` line — base, file count, model and level — and then Codex's
report. Pass the scope line on as the coverage record; it is the only statement
of what this run actually looked at. Return the report itself **verbatim** — no
paraphrase, no summary, no commentary around it. Its shape is a one-paragraph
verdict followed by findings:

```text
- [P1] Short title — /abs/path/file.js:12-14
  Why it breaks, in concrete terms.
```

Check the scope line against the report before passing either on:

- If Codex's own first line names a base other than the one in `scope:`, the review
  missed its target — re-run against the right ref rather than reporting it.
- `0 files` means nothing was reviewed. Report that as coverage of zero, never as a
  clean review.
- A `coverage-warning:` line means the count is over the working tree alone. The
  number and the findings are real; the commits are not among them. Report it as
  partial coverage, name which case it was — the block only knows that no base
  arrived, not why — and go back to §1 for a base.

A missing CLI, an expired login and a non-repository all leave `-o` empty and land
in the `codex review failed:` branch, where the log tail names which it was. Pass
that line through as the result, the same as anything else Codex refuses on,
rather than working around it.
