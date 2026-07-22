---
name: github-pr-workflow
description: >-
  Drive a GitHub pull request from a finished feature branch all the way to a
  merged PR — renaming auto-generated branches, keeping the branch up to date
  with base, opening the PR, looping on fixes until CI is green and Copilot has
  no Critical/Important findings left, then — only with the user's explicit
  go-ahead — merging with the right strategy,
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

**Merging is the one action that is NOT autonomous.** Merge only when the user has
explicitly authorized it — either their request itself asked to merge/ship (e.g.
"ship it", "get this merged", "merge once it's green"), or they say yes when you
ask. If they only asked to open or drive the PR, take it all the way to "ready to
merge" — Step 4's exit met: GitHub reports it mergeable *and* your own bar is
clean (not merely `mergeStateStatus: CLEAN`, which a repo enforcing nothing
reports from PR-open) — and then stop and ask (see Step 5). Never merge on your
own initiative.

Also stop and ask the user when:
- The required gates cannot go green after a reasonable number of fix iterations (~5)
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

## The merge gates belong to the repo — discover them, don't assume

What blocks a merge — which CI checks are required, whether Copilot's review is
mandatory, whether *every* review thread must be resolved, which merge methods are
allowed, whether the branch must be current with base — is configured **per
repository** (branch protection / rulesets) and **enforced by GitHub**. You can't
change it and shouldn't hardcode assumptions about it. Your job is to **satisfy**
whatever gates the repo has; **GitHub's own mergeability is the source of truth
for "done"** — not your own checklist.

Read the live gates before and during the loop:

```bash
# The AUTHORITATIVE signals — these already fold in whatever is enforced, by any
# mechanism (rulesets, classic branch protection, org policy). Trust these:
gh pr checks <pr>                                              # required checks + state
gh pr view <pr> --json mergeable,mergeStateStatus,reviewDecision  # merge verdict + why
# The "why", read once — from BOTH gate mechanisms (a repo may use either or both):
gh api repos/<owner>/<repo>/rulesets --jq '.[].id' \
  | xargs -I{} gh api repos/<owner>/<repo>/rulesets/{}          # rulesets (newer)
gh api repos/<owner>/<repo>/branches/<base>/protection 2>/dev/null || true  # classic (NOT in /rulesets)
```

`mergeStateStatus` names exactly what's missing (the GraphQL enum is `BEHIND`,
`BLOCKED`, `UNSTABLE`, `DIRTY`, `UNKNOWN`, `HAS_HOOKS`, `CLEAN` — there is no
`DRAFT` value; a draft PR reads `BLOCKED`, and you detect draftness via the
separate `--json isDraft`):

| status | meaning | what to do |
|---|---|---|
| `BEHIND` | branch not up to date with base (strict policy) | re-sync (Step 2) |
| `BLOCKED` | a required check, review, or thread resolution is missing (a draft also reads `BLOCKED`) | keep looping (Step 4); if it's a draft, mark ready (Step 3) |
| `UNSTABLE` | a non-required check is red — GitHub *will* let you merge | don't merge until you confirm it's irrelevant or a known flake (see below) |
| `DIRTY` | merge conflicts | resolve conflicts |
| `UNKNOWN` | GitHub is still recomputing mergeability (transient — e.g. right after a push) | wait and re-poll |
| `HAS_HOOKS` | mergeable and checks pass, but the repo has pre-receive hooks that run *at merge time* and can still reject the merge | proceed as for `CLEAN`, but don't treat the merge as guaranteed — a hook may reject it, so confirm it actually landed (Step 6) |
| `CLEAN` | GitHub's own gates are satisfied | merge-*permitted* by GitHub — still meet your own bar (Step 4) before Step 5 |

Gate shapes you'll meet (all repo-configurable — detect, don't presume):
- **A Copilot review gate wired as a required status check** (e.g. a check named
  `copilot-review-gate`). "Copilot is satisfied" becomes a *machine* gate — drive
  the check green, don't second-guess it. See `references/copilot.md`.
- **`required_review_thread_resolution`** — *every* thread must be resolved before
  merge, not just the severe ones.
- **Copilot re-reviews on every push and skips draft PRs** — see
  `references/copilot.md`.
- **Restricted merge methods** — the repo may allow only some of
  merge / squash / rebase; pick from the allowed set (Step 5).
- **`required_approving_review_count`** — often 0 (no human approval needed); if
  >0, `reviewDecision` will read `REVIEW_REQUIRED` and merge waits on a human.

### When there are no gates, or they can't be trusted

**GitHub's mergeability is necessary but not sufficient.** A repo with no *enforced*
gates reports `CLEAN` the instant the PR opens — that means "GitHub won't stop you,"
not "the work is ready." Your own quality bar always applies *on top* of whatever the
repo enforces: CI actually green, Copilot's findings actually addressed, branch
current with base. **Gates are a floor, never a ceiling.**

So don't just read the gates — judge whether they're real:

- **`enforcement` must be `active`.** An `evaluate` or `disabled` ruleset shows up
  in the API but blocks nothing — it's advisory.
- **Don't merge on a bypass.** If `current_user_can_bypass` isn't `never` (or
  you're in a rule's `bypass_actors`), `mergeStateStatus` can read `CLEAN` because
  *you're allowed to skip the gates*, not because they passed. Satisfy them as if
  you couldn't bypass.
- **A green gate must be corroborated.** A `copilot-review-gate` is only meaningful
  if Copilot actually reviewed the latest push and its threads are resolved — check
  that, don't trust a vacuously-green check.
- **`UNSTABLE` means a non-required check is red.** GitHub will let you merge over
  it; don't, unless you've confirmed that check is irrelevant or a known flake
  (re-run flakes rather than merging past them).

**When gates are absent, weak, or unreadable** — but confirm *absent*, don't infer
it from an empty rulesets list. A repo can enforce required checks, reviews, and
thread-resolution through **classic branch protection**, which `/rulesets` does
**not** return, so `rulesets == []` alone does not mean unprotected. Treat gates as
truly absent only when the live signals agree: `gh pr checks` shows no required
checks, `reviewDecision` is empty, and *neither* rulesets *nor*
`branches/<base>/protection` enforces anything (or `gh api` is denied and you
genuinely can't tell). Only then supply the gates yourself: the Step 4 loop's own
bar becomes authoritative — green CI, Copilot Critical/Important resolved and every
thread replied, branch up to date — and because nothing external protects the base,
be *more* conservative, not less: keep the explicit-go-ahead gate, avoid
irreversible force-pushes, and tell the user the repo has no enforced protection so
your judgment is the only safety net.

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
- **Under a strict required-checks policy, being up to date is itself a merge
  gate:** whenever GitHub reports the branch `BEHIND` (base moved while the PR was
  open, including right before merge), re-sync again — `gh pr update-branch <pr>`
  does this server-side without a local rebase.

## Step 3 — Open the PR (if not already open)

If there's no open PR for this branch, create one as **ready for review** (not
draft). This matters beyond convention: Copilot commonly **skips draft PRs**
(`review_draft_pull_requests: false`), so a draft can leave the Copilot gate
un-run and the PR permanently un-mergeable. Open ready-for-review:

```bash
gh pr create --base <base> --head <branch> --fill --title "<title>" --body "<body>"
```

- Title: concise, matches the branch intent.
- Body: what changed and why, in the user's own framing if known; a short summary
  and a bullet list of notable changes.
- If a PR already exists, skip creation and move to the loop.

## Step 4 — The fix loop (until GitHub says mergeable)

Loop until the PR is **both mergeable by GitHub and clean by your own bar** —
every required check green (including any Copilot gate) and the thread-resolution
requirement satisfied, plus, where the repo enforces little or the gates aren't
trustworthy, CI genuinely green and Copilot's Critical/Important findings resolved
regardless (see *When there are no gates, or they can't be trusted*). Up to ~5
iterations, then escalate. Gates decide *permission* to merge, your bar decides
*readiness*; when they diverge, the stricter one wins. The severity classification
only decides what you *fix*, never when you're *done*.

1. **Read the live state:** `gh pr checks <pr>` plus
   `gh pr view <pr> --json mergeable,mergeStateStatus,reviewDecision` (or MCP
   equivalents). `reviewThreads` is **not** a `gh pr view --json` field — for
   thread-resolution state use the GraphQL `reviewThreads` query in
   `references/copilot.md`. Poll while checks are in progress.
2. **If a required check is red:** read the failing job's logs, fix the root
   cause, commit, push. Don't guess — read the actual failure. The Copilot gate is
   a check too: if it's red it's usually waiting on Copilot's review or on
   unresolved threads (see `references/copilot.md`), not on a code fix.
3. **Read Copilot findings** (MCP → `gh pr view --comments` → API) and classify
   them — see `references/copilot.md`.
4. **Fix Critical and Important findings.** Batch fixes into as few pushes as is
   reasonable — every push re-triggers Copilot and supersedes its prior review
   with a fresh one.
5. **Reply to every Copilot comment; resolve every thread the repo requires
   resolved.** The reply is *unconditional* (fixed or acknowledged, on every
   comment); *resolution* is what scales with the repo — under
   `required_review_thread_resolution` that's *all* threads (fix the serious ones,
   acknowledge the rest, but each must end resolved or merge stays `BLOCKED`),
   otherwise at least the ones you fixed. See `references/copilot.md` for the
   reply + resolve protocol.
6. **After pushing, wait for the re-review.** Copilot re-reviews on push and the
   Copilot gate re-runs; don't evaluate exit against stale state — wait for the
   new review to post and the checks to settle, then re-read from step 1.

If after ~5 iterations the gates still won't go green, or a finding needs a
decision you can't make, stop and summarize the blocker for the user.

## Step 5 — Merge (only with explicit authorization)

Merging is gated on explicit user permission — see the Autonomy model. Once Step 4's
exit is met — GitHub reports the PR mergeable *and* your own bar is clean (not merely
`mergeStateStatus: CLEAN` on a repo that enforces nothing):

- **If the user already authorized the merge** — their request asked to merge/ship
  ("ship it", "get this merged", "merge when green"), or they've since said go
  ahead — merge now.
- **Otherwise, stop here.** Report that the PR is ready to merge (all required
  gates satisfied) and ask for an explicit go-ahead. Do not merge until they
  confirm.

Choose the strategy **from the repo's allowed merge methods** (from the ruleset;
`gh pr merge` will reject a disallowed one). Within the allowed set:

- **Squash** (`gh pr merge --squash`) — default; use when the PR is a single
  logical feature/fix. Write a clean squash commit message.
- **Merge commit** (`gh pr merge --merge`) — when the PR contains multiple
  distinct features whose individual history is worth preserving.
- If rebase-merge is the only fit but the repo disallows it, or the choice is
  genuinely ambiguous, ask.

Delete the source branch on merge (`--delete-branch`) unless told otherwise; if a
deletion-protection rule rejects it, leave the branch and note it.

## Step 6 — Monitor the merge

After issuing the merge, confirm it actually landed:
- Merge can be queued (merge queue) or blocked by a last-second protection rule.
- Under a strict policy the base may have moved, flipping the PR to `BEHIND` — run
  `gh pr update-branch <pr>`, let the required checks re-pass, then merge again.
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
