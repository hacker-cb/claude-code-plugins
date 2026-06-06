---
name: github-pr-workflow
description: >-
  Drive a GitHub pull request from a finished feature branch all the way to a
  merged PR — renaming auto-generated branches, keeping the branch up to date
  with base, opening the PR, looping on fixes until CI is green and Copilot has
  no Critical/Important findings left, auto-merging with the right strategy,
  monitoring the merge, and reporting. Use this skill whenever the user wants to
  "ship", "open a PR", "push this up", "get this merged", "drive the PR",
  "handle the review", "address Copilot comments", or otherwise move committed
  work through the GitHub review-and-merge lifecycle — even if they don't say
  "PR" explicitly. Trigger it both when work was just finished and needs a PR,
  and when a PR already exists and needs to be driven to merge.
---

# GitHub PR Workflow

Take committed work on a feature branch and drive it to a merged PR, autonomously
where safe. This skill is the full lifecycle; the user may enter at any stage
(just-finished code, or an already-open PR). Detect where they are and pick up
from there.

## Autonomy model

Run autonomously, WITHOUT asking, for these safe, reversible actions:
- Renaming the branch
- Rebasing the feature branch onto base (with `--autostash`)
- Pushing the branch, including the force-push that a rebase requires (use
  `--force-with-lease`, never plain `--force`)
- Opening the PR (ready for review)
- Committing and pushing fixes during the review loop
- Replying to Copilot review comments
- Reading CI status and review findings

Auto-merge is allowed once **CI is green AND there are no unresolved
Critical/Important findings** — do not ask first in that case. Only stop and ask
the user when:
- CI cannot go green after a reasonable number of fix iterations (~5)
- A Critical/Important finding requires a product/design decision you can't make
- The merge strategy is genuinely ambiguous (see below) and you can't pick
- A git operation would lose work or rewrite history that others may have pulled
  (shared branch) — fall back to a merge instead of rebase and note it

When you do act autonomously, narrate what you did and why in a short line, so the
user can follow along.

## Tooling: detect what's available

Findings and PR operations can come from several sources. Pick the first that
works, in this order:

1. **GitHub MCP server** — if MCP tools for GitHub are connected, prefer them for
   reading PR review comments and findings (richest structured data).
2. **`gh` CLI** — check with `gh auth status`. Use for almost everything:
   `gh pr create`, `gh pr view --comments`, `gh pr checks`, `gh pr merge`,
   `gh api` for anything the porcelain commands don't cover.
3. **GitHub REST API** via `gh api` or `curl` with a token — fallback for review
   threads, comment replies, and resolving conversations.

Plain `git` is always used for local branch/rebase/push operations. Verify the
tool works (a quick read command) before relying on it; if none are available,
tell the user what to install or connect (`gh`, or a GitHub MCP connector).

## Step 1 — Branch naming

If the current branch name is auto-generated (e.g. starts with `claude/`, or is a
random/temporary-looking name), rename it to a meaningful `<type>/<name>`:

- `<type>` ∈ `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`
- `<name>` is a short kebab-case description of the actual change

Examples: `fix/security-config`, `refactor/api-names`, `feat/csv-export`.

Pick `<type>` and `<name>` from what the work actually does (inspect the diff /
commits, not just the old branch name). Rename locally and update the remote:

```bash
git branch -m <new-name>
git push origin -u <new-name>
# if the old branch was already pushed, delete the stale remote ref:
git push origin --delete <old-name> 2>/dev/null || true
```

If the branch name is already meaningful, leave it.

## Step 2 — Bring the branch up to date with base

Identify the base branch (usually the PR's base, else the repo default — check
`gh repo view --json defaultBranchRef` or the existing PR). Rebase the feature
branch onto the latest base. Rebase is the default (cleaner history, plays well
with squash):

```bash
git fetch origin <base>
git rebase --autostash origin/<base>
```

- Resolve trivial conflicts yourself; if a conflict needs a real decision, stop
  and ask.
- After a successful rebase, push with `--force-with-lease`.
- **Exception:** if the branch is shared (others have commits or it's referenced
  by other open PRs), do NOT rebase — merge base into the branch instead and note
  why.

## Step 3 — Open the PR (if not already open)

If there's no open PR for this branch, create one as **ready for review** (not
draft):

```bash
gh pr create --base <base> --head <branch> --fill --title "<title>" --body "<body>"
```

- Title: concise, matches the branch intent.
- Body: what changed and why, in the user's own framing if known; a short summary
  and a bullet list of notable changes.
- If a PR already exists, skip creation and move to the loop.

## Step 4 — The fix loop (until green + clean)

Repeat until **CI is green** AND **no unresolved Critical/Important findings**,
up to ~5 iterations, then escalate:

1. **Check CI:** `gh pr checks <pr>` (or MCP equivalent). Wait/poll for runs in
   progress.
2. **If CI is red:** read the failing job logs, fix the cause, commit, push. Don't
   guess — read the actual failure.
3. **Read Copilot findings:** pull review comments (MCP → `gh pr view --comments`
   → API). See `references/copilot.md` for how to classify and respond.
4. **Fix only Critical and Important findings.** Skip nits/style/minor unless
   trivial. Commit + push fixes.
5. **Reply to every Copilot comment** — see `references/copilot.md` for the
   reply + resolve protocol.
6. Re-poll CI and re-read findings. Loop.

If after ~5 iterations CI still won't pass or a finding needs a decision you can't
make, stop and summarize the blocker for the user.

## Step 5 — Merge

Once CI is green and there are no unresolved Critical/Important findings,
auto-merge (no need to ask). Choose the strategy:

- **Squash** (`gh pr merge --squash`) — default; use when the PR is a single
  logical feature/fix. Write a clean squash commit message.
- **Merge commit** (`gh pr merge --merge`) — when the PR contains multiple
  distinct features whose individual history is worth preserving.
- **Stop and ask** only if it's genuinely ambiguous, or repo rules / branch
  protection require something specific you can't satisfy.

Delete the source branch on merge (`--delete-branch`) unless told otherwise.

## Step 6 — Monitor the merge

After issuing the merge, confirm it actually landed:
- Merge can be queued (merge queue) or blocked by a last-second protection rule.
- Poll until the PR shows `MERGED`, or report what's blocking it.

## Step 7 — Report and suggest next steps

After the merge lands, give the user a short report:

1. **Additional findings from this session**, grouped by category (e.g.
   Security, Correctness, Performance, Maintainability, Tests) — including
   lower-severity items you deliberately skipped during the loop, so nothing is
   silently dropped.
2. **Suggested next steps** — follow-up issues to file, tech debt to track,
   tests to add, or related work that surfaced.

Keep it scannable: short grouped bullets, not an essay.

## Reference files

- `references/copilot.md` — How to find, classify (Critical/Important vs skip),
  fix, and reply to Copilot review findings. Read it before Step 4.
