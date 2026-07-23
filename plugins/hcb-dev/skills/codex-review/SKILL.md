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
edits to tracked files. First hit wins:

1. A base the caller named explicitly.
2. The base of the open change request for this branch. It answers with a bare
   branch name, so pair it with whichever remote actually carries that branch —
   in a fork checkout `origin/<branch>` is your own stale copy and
   `upstream/<branch>` is the real base:
   ```bash
   # GitHub
   gh pr view --json baseRefName -q .baseRefName
   # GitLab
   glab mr view --output json | jq -r .target_branch
   ```
3. Where this repo's changes actually land. A review usually runs *before* the
   change request exists, so step 2 comes back empty and the default branch is
   the wrong guess in any repo whose changes target `dev`, `develop`,
   `release/*`… Look, don't assume:
   ```bash
   # GitHub
   gh pr list --state merged --limit 10 --json baseRefName -q '.[].baseRefName' | sort | uniq -c
   # GitLab
   glab mr list --merged --output json | jq -r '.[].target_branch' | sort | uniq -c
   ```
   If one non-default base dominates, use it and name it in the report.
4. The repo default branch — `git symbolic-ref --short refs/remotes/origin/HEAD`,
   else whichever of `origin/main`, `origin/master`, `main`, `master` exists.
5. `git rev-parse --abbrev-ref @{upstream}` — last resort. When the branch tracks
   its own remote counterpart, this narrows the review to unpushed commits only.

Being on the default branch is fine: the merge-base collapses to `HEAD`, and the
review becomes the working-tree diff.

If nothing resolves — no remote, no upstream — the run block drops to
`--uncommitted`, reviewing staged + unstaged + untracked instead, and says so in
its scope line. Read that line: a working-tree review covers no committed work.

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

The block below resolves the base with `gh` and is written for GitHub, but the
resolution is the *only* forge-specific part — `codex exec review --base <ref>`
takes a plain git ref and is forge-agnostic. Where `gh` is absent (GitLab, or no
CLI at all) the `gh pr` calls fail closed and `BASE` falls through to git's own
remote refs (`origin/HEAD`, then `origin/main`/`master`), which are forge-neutral;
to target a *non-default* base on GitLab, resolve it with the `glab mr` discovery
in §1 and pass it in as `BASE`.

```bash
command -v codex >/dev/null \
  || { echo "codex CLI not installed — brew install codex (or npm i -g @openai/codex)"; exit 1; }
# ~20 ms, purely local. Match the message, not the exit code: `codex login status`
# also exits 1 on failures that logging in again would not fix, and only the
# stated "not logged in" is worth stopping for. `timeout` is optional because
# stock macOS ships no coreutils.
command -v timeout >/dev/null && TO="timeout 5" || TO=""
$TO codex login status 2>&1 | grep -qi 'not logged in' \
  && { echo "codex is not authenticated — run: codex login"; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 \
  || { echo "not a git repository — nothing to review here"; exit 1; }

# BASE and EFFORT may be handed in by the caller. Anything still unset falls back
# to the mechanical half of the resolution above — step 3, reading where this
# repo's PRs actually land, is a judgment call and stays yours to make first.
if [ -z "${BASE:-}" ]; then
  b="$(gh pr view --json baseRefName -q .baseRefName 2>/dev/null)"
  # A PR names a branch, not a remote. In a fork checkout `origin/$b` is your own
  # stale copy and `upstream/$b` is the real base, so take the first ref that
  # exists rather than assuming a prefix.
  for r in upstream origin; do
    [ -n "$b" ] && git rev-parse --verify -q "$r/$b^{commit}" >/dev/null 2>&1 \
      && { BASE="$r/$b"; break; }
  done
fi
BASE="${BASE:-$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)}"
# origin/HEAD only exists in a clone; a repo built with `git init` + `git remote
# add` has none, so fall back to the usual names before giving up.
if [ -z "${BASE:-}" ]; then
  for c in origin/main origin/master main master; do
    git rev-parse --verify -q "$c^{commit}" >/dev/null 2>&1 && { BASE="$c"; break; }
  done
fi
BASE="${BASE:-$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)}"
EFFORT="${EFFORT:-high}"   # always explicit — never inherit the machine's config

# A base Codex can't resolve is not an error to it — it quietly reviews against
# some other upstream branch. Fetch it from its own remote, and if it still will
# not resolve, drop to the working tree as §1 says; never let Codex pick.
if [ -n "${BASE:-}" ]; then
  case "$BASE" in */*) REMOTE="${BASE%%/*}"; BRANCH="${BASE#*/}" ;;
                    *) REMOTE=origin;        BRANCH="$BASE"      ;; esac
  have_base() { git rev-parse --verify -q "$BASE^{commit}" >/dev/null 2>&1; }
  # A bare name may exist only as a remote-tracking ref: `git fetch origin main`
  # updates `origin/main` and never creates a local `main`, so try the remote
  # form before concluding there is no base and silently narrowing the review.
  have_base \
    || { git fetch --quiet "$REMOTE" "$BRANCH" 2>/dev/null; have_base; } \
    || { BASE="$REMOTE/$BRANCH"; have_base; } \
    || BASE=""
fi
# Positional parameters, not an interpolated string: the scope is two arguments
# or one, and an unquoted expansion would leave that to word-splitting.
if [ -n "${BASE:-}" ]; then
  set -- --base "$BASE"
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
The ladder is `minimal`, `low`, `medium`, `high`, `xhigh`; an unknown value is
rejected outright, so a typo cannot silently downgrade a review. `-m <model>`
overrides the model the same way. `--output-schema` is accepted but ignored in
review mode — the output is always prose.

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
- An empty review is a normal result, not a failure: Codex exits `0` saying
  something like "There are no staged, unstaged, or untracked code changes to
  review."

When the run block stops early — no CLI, no login, not a git repository — its
output is a single line. Pass that line through as the result. Same for anything
else Codex refuses on: report it as-is rather than working around it.
