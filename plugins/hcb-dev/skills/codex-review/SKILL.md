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
read-only sandbox. It needs `codex` on `PATH` and a live `codex login`; nothing
else.

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

Fill the two values at the top of the block from §1 and from the ladder note
below. Everything under them is live.

```bash
BASE="<the ref resolved in §1 — leave EMPTY for a working-tree review>"
EFFORT="<none|low|medium|high|xhigh — high unless the caller said otherwise>"

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
codex exec review "$@" -c model_reasoning_effort="$EFFORT" -o "$OUT" > "$OUT.log" 2>&1
# The scope line is what a caller compares against; without it nobody can tell
# what this run actually looked at.
echo "scope: ${BASE:-working tree}, $COVERED files, effort $EFFORT"
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

A caller — a person or another skill — may hand you the base and the effort
level; both are meant to be passed in, and an explicit base wins over the
resolution above. Set the effort on every run rather than letting
`~/.codex/config.toml` decide, since that file differs from machine to machine.

The ladder **in review mode** is `none`, `low`, `medium`, `high`, `xhigh`. Do not
copy the set from Codex's general config docs: `minimal` and `max` are valid
`reasoning.effort` values there and the *review* model refuses both, because review
does not run the model the banner names — the banner prints `model: gpt-5.5` while
the request goes to a `…-codex-…` review variant with its own supported set. The
ladder therefore belongs to that model, and `-m` moves it.

The CLI prints whatever you passed (`reasoning effort: <whatever>`) and sends it
on, so that banner line confirms nothing. The API is what refuses a bad level, in
two distinguishable ways — `invalid_enum_value` for a string that is no effort at
all, `unsupported_value` for a real one this model does not take. Both name the
accepted set, which makes the error, not this paragraph, the authority when they
disagree.

`-m <model>` overrides the model the same way. `--output-schema` is accepted but
ignored in review mode — the output is always prose.

## 4. Hand back the findings

The block prints a `scope:` line — base, file count, effort — and then Codex's
report. Pass the scope line on as the coverage record; it is the only statement
of what this run actually looked at. Return the report itself **verbatim** — no
paraphrase, no summary, no commentary around it. Its shape is a one-paragraph
verdict followed by findings:

```
- [P1] Short title — /abs/path/file.js:12-14
  Why it breaks, in concrete terms.
```

Two things to check in what comes back:

- If Codex's own first line names a base other than the one in the `scope:` line,
  the review missed its target — re-run against the right ref rather than
  reporting it.
- A scope line reading `0 files` means nothing was reviewed. Report that as
  coverage of zero, never as a clean review.
- A `coverage-warning:` line means the run is a nonzero count over the working
  tree alone. The number is real and the findings are real; the commits are simply
  not among them. Report it as partial coverage — naming which case it was, since
  the block only knows that no base arrived, not why — never as the change having
  been reviewed, and go back to §1 for a base.
- An empty review is a normal result, not a failure: Codex exits `0` saying
  something like "There are no staged, unstaged, or untracked code changes to
  review."

A missing CLI, an expired login and a non-repository all leave `-o` empty and land
in the `codex review failed:` branch, where the log tail names which it was. Pass
that line through as the result, the same as anything else Codex refuses on,
rather than working around it.
