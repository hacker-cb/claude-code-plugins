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

**Resolve the base by the shared ladder** in
[`../../references/base-resolution.md`](../../references/base-resolution.md) —
first hit wins:

1. a base the caller named;
2. the open change request's base (`gh pr view` / `glab mr view`);
3. where this repo's PRs actually land (the merged-base histogram) — a review
   usually runs before the change request exists, so use this when one non-default
   base dominates, and name it in the report;
4. the repo default branch (`<remote>/HEAD`, verified, else `ls-remote`);
5. `@{upstream}` — narrows the review to unpushed commits.

The reference is authoritative for *how* each rung resolves a remote and a ref —
read it before touching this. What matters here is that the run block in §3
implements exactly that ladder; step 3 is the one judgment call and stays yours to
make first. If nothing resolves, ask for the base rather than review without one.

Being on the default branch is fine: the merge-base collapses to `HEAD`, and the
review becomes the working-tree diff.

The run block is the mechanical half and cannot ask anyone anything, so where you
skipped the question it falls back rather than stopping: with no base it reviews
`--uncommitted` — staged + unstaged + untracked — and where the base shares no
history with `HEAD` (a shallow clone fetched neither side's ancestry) it refuses
that base and does the same. Both cases print a separate `coverage-warning:` line saying the
commits went unreviewed. Read it: a working-tree review covers no committed work,
and the note is there because "working tree, 4 files" otherwise reads exactly like
a review that happened.

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
view of the remote (`<remote>/HEAD`, then `ls-remote`), which is forge-neutral;
to target a *non-default* base on GitLab, resolve it with the `glab mr` discovery
in §1 and pass it in as `BASE`.

```bash
command -v codex >/dev/null \
  || { echo "codex CLI not installed — brew install codex (or npm i -g @openai/codex)"; exit 1; }
# ~20 ms, purely local. Match the message, not the exit code: `codex login status`
# also exits 1 on failures that logging in again would not fix, and only the
# stated "not logged in" is worth stopping for. `timeout` is optional because
# stock macOS ships no coreutils.
# Two network budgets, not one. 10s suits a metadata probe (`ls-remote`), but a
# `fetch` on a large repo or a slow link is making progress — SIGTERM at 10s would
# drop the base and silently narrow the review to the working tree. Stalls are
# already covered by http.lowSpeed*, which is what a timeout is really for here.
command -v timeout >/dev/null \
  && { TO="timeout 5"; TO_NET="timeout 10"; TO_FETCH="timeout 300"; } \
  || { TO=""; TO_NET=""; TO_FETCH=""; }
$TO codex login status 2>&1 | grep -qi 'not logged in' \
  && { echo "codex is not authenticated — run: codex login"; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 \
  || { echo "not a git repository — nothing to review here"; exit 1; }

# Remotes in preference order: `upstream` and `origin` first (fork checkout — the
# real base is in upstream, origin is your own copy), then any other remote. `origin`
# is as hardcoded a name as `main` is, so a repo whose only remote is called something
# else must not read as having none. Existing remotes only; deduped.
remotes_ranked() {
  for r in upstream origin; do git remote | grep -qx -- "$r" && echo "$r"; done
  git remote | grep -vxE 'upstream|origin'
}
# One remote, picked outright: a preferred name, else a lone remote whatever it is
# called. NOT `remotes_ranked | head -1` — with two remotes and neither preferred
# that silently takes whichever sorts first. Empty means "cannot tell", and the
# rungs below simply do not fire; `remotes_ranked` stays for *probing* every remote.
REM="$(for r in upstream origin; do git remote | grep -qx -- "$r" && { echo "$r"; break; }; done)"
[ -n "$REM" ] || { [ "$(git remote | grep -c .)" = 1 ] && REM="$(git remote)"; }

# BASE and EFFORT may be handed in by the caller. Anything still unset falls back
# to the mechanical half of the resolution above — step 3, reading where this
# repo's PRs actually land, is a judgment call and stays yours to make first.
if [ -z "${BASE:-}" ]; then
  b="$(gh pr view --json baseRefName -q .baseRefName 2>/dev/null)"
  # A PR names a branch, not a remote. Probe every remote in preference order — in a
  # fork `origin/$b` is your own stale copy and `upstream/$b` the real base, and a
  # repo with a single differently-named remote still has to be found — taking the
  # first ref that exists rather than assuming a prefix.
  if [ -n "$b" ]; then
    for r in $(remotes_ranked); do
      git rev-parse --verify -q "$r/$b^{commit}" >/dev/null 2>&1 && { BASE="$r/$b"; break; }
    done
    # Nothing carries it *locally* yet — a --single-branch or CI checkout fetches
    # only the PR head. Keep the bare name anyway: the materialisation block below
    # probes and fetches it. Dropping it here would fall through to the default
    # branch and review against the wrong base with a scope line that looks
    # entirely legitimate — no coverage-warning fires, because a base did resolve.
    [ -n "${BASE:-}" ] || BASE="$b"
  fi
fi
# `symbolic-ref` READS the symref, it does not dereference it: after the forge
# renames its default branch, this keeps printing the old name with status 0
# forever. Verify the target exists, or a dead pointer wins over the live answer
# below and the review silently ends up on `--uncommitted`. Existence is all this
# can check without a network round trip on every run — an old `origin/<name>`
# still present pre-prune passes, giving a base that is stale but shares history
# (§1 says how to spot it).
# Probe EVERY remote in rank order, not just the preferred one: `git remote add`
# never creates `<remote>/HEAD`, so in a fork `upstream/HEAD` is typically absent
# while `origin/HEAD` sits right there with the answer. Checking only the top rank
# would skip it and push the whole resolution onto the network — or, offline, onto
# `@{upstream}`, quietly narrowing the review to unpushed commits.
if [ -z "${BASE:-}" ]; then
  for r in $(remotes_ranked); do
    c="$(git symbolic-ref --short "refs/remotes/$r/HEAD" 2>/dev/null)"
    [ -n "$c" ] && git rev-parse --verify -q "$c^{commit}" >/dev/null 2>&1 && { BASE="$c"; break; }
  done
fi
# `<remote>/HEAD` only exists in a clone; a repo built with `git init` + `git remote
# add` has none, so ask the remote what its HEAD points at. Never fall back to a
# list of popular names — `main` and `master` both exist in plenty of repos where
# neither is the base, so a guess that resolves is not a guess that is right.
# EVERY network call in this block goes through this, not just the probe below:
# nobody is at the keyboard, so a credential prompt (HTTP) or a passphrase (SSH)
# is a hang, and `timeout` is absent on stock macOS. The TCP connect phase is the
# one gap left — git exposes no `http.connectTimeout` (`git help --config` lists
# 43 `http.*` keys in 2.54 and none is that), so an unreachable host costs
# whatever the OS allows, measured at ~10s on macOS. Bounded, not unbounded.
# NET_BUDGET carries the timeout so a fetch is not held to a probe's clock. It is
# a named variable rather than a positional parameter (`$N`) because Claude Code
# substitutes those in skill content with words from the invocation arguments —
# a positional would reach the shell already rewritten as whatever the caller
# typed. `$@` is not substituted and stays. And ${GIT_SSH_COMMAND:-ssh} EXTENDS the user's ssh setup
# rather than replacing it — clobbering a multi-account `-i ~/.ssh/id_work` makes
# a repo that pushes fine by hand fail "Permission denied", and BatchMode then
# forbids the fallback.
net() {
  $NET_BUDGET env GIT_TERMINAL_PROMPT=0 \
    GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -oBatchMode=yes -oConnectTimeout=5" \
    git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=10 "$@"
}
# The parser and why it is `sed` live in the shared reference above. The line is
# `ref: refs/heads/<branch>\tHEAD`, and a branch name cannot contain whitespace.
if [ -z "${BASE:-}" ] && [ -n "$REM" ]; then
  NET_BUDGET="$TO_NET"
  h="$(net ls-remote --symref "$REM" HEAD 2>/dev/null \
        | sed -n 's|^ref:[[:space:]]*refs/heads/\([^[:space:]]*\)[[:space:]]*HEAD$|\1|p' | head -1)"
  [ -n "$h" ] && BASE="$REM/$h"
fi
BASE="${BASE:-$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)}"
EFFORT="${EFFORT:-high}"   # always explicit — never inherit the machine's config

# A base Codex can't resolve is not an error to it — it quietly reviews against
# some other upstream branch. Fetch it from its own remote, and if it still will
# not resolve, drop to the working tree as §1 says; never let Codex pick.
if [ -n "${BASE:-}" ]; then
  have_base() { git rev-parse --verify -q "$BASE^{commit}" >/dev/null 2>&1; }
  # `<prefix>/<rest>` is ambiguous and cannot be settled by inspection: with a
  # remote named `release`, the base `release/2.0` is either that remote's branch
  # `2.0` or a whole branch called `release/2.0`, and both spellings resolve the
  # same ref name. So stop guessing which it is — TRY, in order, and let the first
  # one that actually resolves win. Each attempt is a no-op when it does not.
  # Always fetch with an EXPLICIT refspec. `git fetch <remote> <branch>` honours the
  # remote's configured refspec, and a --single-branch or narrowed clone has one
  # that matches only its own branch — the fetch then updates FETCH_HEAD alone and
  # never writes refs/remotes/<remote>/<branch>, so the rev-parse below stays false
  # for a branch that was in fact fetched. Naming the destination avoids that.
  if ! have_base; then
    # 1. the prefix as a remote, the rest as its branch — `git fetch release 2.0`
    case "$BASE" in
      */*) p="${BASE%%/*}"; b2="${BASE#*/}"
           if git remote | grep -qx -- "$p"; then
             NET_BUDGET="$TO_FETCH"
             net fetch --quiet "$p" \
               "+refs/heads/$b2:refs/remotes/$p/$b2" 2>/dev/null || true
           fi ;;
    esac
  fi
  if ! have_base; then
    # 2. the whole string as a branch name, on whichever remote actually carries
    #    it — probing rather than pinning the preferred one, since in a fork both
    #    `origin` and `upstream` may have a `dev` and the caller named just `dev`.
    for r in $(remotes_ranked); do
      git rev-parse --verify -q "$r/$BASE^{commit}" >/dev/null 2>&1 \
        && { BASE="$r/$BASE"; break; }
    done
  fi
  if ! have_base; then
    # 3. not local yet: fetch that branch from each remote in turn, taking the
    #    first whose remote-tracking ref then exists.
    for r in $(remotes_ranked); do
      NET_BUDGET="$TO_FETCH"
      net fetch --quiet "$r" \
        "+refs/heads/$BASE:refs/remotes/$r/$BASE" 2>/dev/null || continue
      git rev-parse --verify -q "$r/$BASE^{commit}" >/dev/null 2>&1 \
        && { BASE="$r/$BASE"; break; }
    done
  fi
  have_base || BASE=""   # nothing resolved — §1's fallback, reported as a warning
fi
# No merge-base means the base shares no history with HEAD — a shallow clone
# (`clone --depth 1`, `actions/checkout` at default depth) fetched neither side's
# ancestry, or the ref is simply unrelated. Reviewing against it is worse than not
# reviewing: the diff reports the base's own files as deletions this branch never
# made, and Codex dutifully files findings about them. Refuse the base instead,
# and say why — a `COVERED` of "unknown" is neither zero nor a count, so it slips
# past both §4's zero-file check and multi-review's count gate.
if [ -n "${BASE:-}" ]; then
  MB="$(git merge-base "$BASE" HEAD 2>/dev/null)"
  [ -z "$MB" ] && { NOTE=" — NO MERGE-BASE with $BASE (shallow clone?), commits NOT reviewed"; BASE=""; }
fi
# Positional parameters, not an interpolated string: the scope is two arguments
# or one, and an unquoted expansion would leave that to word-splitting.
if [ -n "${BASE:-}" ]; then
  set -- --base "$BASE"
  COVERED=$(git diff --name-only "$MB" | wc -l | tr -d ' ')
else
  set -- --uncommitted
  COVERED=$(git status --porcelain --untracked-files=all | wc -l | tr -d ' ')
  # `--uncommitted` covers no committed work, ever. When the branch carries
  # commits, saying only "working tree, N files" reads like a review that
  # happened; the caller has to be told the commits went unread, and §1 says to
  # come back with a base rather than accept this. Keep the message apostrophe-free:
  # the `word` of a `${VAR:-word}` is scanned for quotes even when the expansion
  # itself is double-quoted, so a lone `'` there is an unterminated quote. (A plain
  # double-quoted string is fine — `X="it's"` is literal. It is the `:-` word that
  # bites: bash 5.3 and macOS /bin/sh both reject `X="${V:- it's}"` outright.)
  git rev-parse --verify -q HEAD >/dev/null 2>&1 \
    && NOTE="${NOTE:- — no base resolved; the commits on this branch are NOT reviewed}"
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
[ -n "${NOTE:-}" ] && echo "coverage-warning:${NOTE}"
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
- A `coverage-warning:` line — `no base resolved`, `NO MERGE-BASE` — means the run is a
  nonzero count over the working tree alone. The number is real and the findings
  are real; the commits are simply not among them. Report it as partial coverage
  with that reason, never as the change having been reviewed, and go back to §1
  for a base.
- An empty review is a normal result, not a failure: Codex exits `0` saying
  something like "There are no staged, unstaged, or untracked code changes to
  review."

When the run block stops early — no CLI, no login, not a git repository — its
output is a single line. Pass that line through as the result. Same for anything
else Codex refuses on: report it as-is rather than working around it.
