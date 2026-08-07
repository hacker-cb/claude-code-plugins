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
  and when a PR already exists and needs to be driven to merge. But when finished
  work has had no local review yet, start from `hcb-dev:shipping-workflow` — it
  runs the reviewers and coverage gate, then hands off here; entering directly
  skips both.
---

# GitHub PR Workflow

Take committed work on a feature branch and drive it to a merged PR, autonomously
where safe. This skill is the full lifecycle; the user may enter at any stage
(just-finished code, or an already-open PR). Detect where they are and pick up
from there.

`hcb-dev:shipping-workflow` sits directly upstream of this skill — it normalizes
the branch name, commits, runs every available local reviewer, applies the fixes
and checks coverage, then hands off here (in **request** mode; in local mode it merges without a PR and
never reaches this skill). If you landed here on finished work that has had no
local review, go there first; this skill starts at the PR and will not run the
reviewers for you.

This skill is GitHub-specific by design (the `<forge>-<artifact>-workflow`
convention). A GitLab twin — `gitlab-mr-workflow` — is not built yet; until it is,
GitLab change requests are handled by `hcb-dev:shipping-workflow`'s mirrored `glab`
fallback.

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
- Parking the run on a platform outage and resuming when it clears (see *When the
  platform is down, the red check is not yours* below)

**Merging is the one action that is NOT autonomous.** Merge only when the user has
explicitly authorized it — either their request itself asked to merge/ship (e.g.
"ship it", "get this merged", "merge once it's green"), the captured user-approved
`merge-auth` was threaded in from an upstream flow (`hcb-dev:shipping-workflow`, or
`hcb-dev:implementation-workflow`'s planning gate), or they say yes when you ask.
If they only asked to open or drive the PR, take it to Step 4's exit and then stop
and ask (see Step 5). Never merge on your own initiative.

Also stop and ask the user when:
- The required gates will not go green within Step 4's iteration budget
- A Critical/Important finding requires a product/design decision you can't make
- The merge strategy is genuinely ambiguous (see below) and you can't pick
- A git operation would lose work or rewrite history that others may have pulled
  (shared branch) — fall back to a merge instead of rebase and note it

Each of those stops shows your recommended option **first**, with a one-line
reason grounded in the code **and the constraints** — half these stops turn on
neither the diff nor the code (a ruleset's allowed merge methods, what the CI logs
say), and a reason invented to look code-shaped is worse than the bare question it
replaced. Both that and the split above (act on the mechanical and
reversible, stop on what cannot be walked back) come from the shared protocol in
[`../../references/architecture-decisions.md`](../../references/architecture-decisions.md).

When you do act autonomously, narrate what you did and why in a short line, so the
user can follow along.

## Tooling: detect what's available

Findings and PR operations can come from several sources. Pick the first that
works, in this order:

1. **GitHub MCP server** — if MCP tools for GitHub are connected, prefer them for
   reading PR review comments and findings (richest structured data).
2. **`gh` CLI** — used for almost everything: `gh pr create`,
   `gh pr view --comments`, `gh pr checks`, `gh pr merge`, and `gh api` for
   anything the porcelain commands don't cover.
3. **GitHub REST API** via `gh api` or `curl` with a token — fallback for review
   threads, comment replies, and resolving conversations.

Plain `git` handles the local branch/rebase/push operations.

## The merge gates belong to the repo — discover them, don't assume

What blocks a merge — which CI checks are required, whether *every* review thread
must be resolved, which merge methods are allowed, whether the branch must be
current with base — is configured **per repository** (branch protection /
rulesets) and **enforced by GitHub**. You can't change it and shouldn't hardcode
assumptions about it: **read the configuration of the repo you're working in**,
every time, and never carry over what some *other* repo happened to require or
what a check was called there. Your job is to **satisfy** whatever gates this repo
has, then clear your own bar on top of them (see *When there are no gates, or they
can't be trusted* below).

Read the live gates before and during the loop:

```bash
# The AUTHORITATIVE signals — these already fold in whatever is enforced, by any
# mechanism (rulesets, classic branch protection, org policy). Trust these:
gh pr checks <pr>                                              # required checks + state
gh pr view <pr> --json mergeable,mergeStateStatus,reviewDecision  # merge verdict + why
# The "why", read once. Start from the per-branch view: it has already applied
# each ruleset's ref_name conditions and includes org-level rulesets — a plain
# /rulesets listing does neither, so it over-reports on a side branch and misses
# whatever the organization enforces:
gh api repos/<owner>/<repo>/rules/branches/<base>              # rules in force on the base
gh api --paginate repos/<owner>/<repo>/rulesets --jq '.[].id' \
  | xargs -I{} gh api repos/<owner>/<repo>/rulesets/{}          # full definitions: enforcement, bypass_actors
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

### Read the rules, not a checklist of names

Rulesets express gates as **typed rules**; classic protection expresses the same
ideas under its own keys. Map whichever rules you find onto work — and presume
none of them are present until you've read them:

| ruleset rule | parameters that matter | what it means for you |
|---|---|---|
| `required_status_checks` | `required_status_checks[].context`, `strict_required_status_checks_policy` | every listed context must go green. Treat the names as **opaque** — the repo chooses them, and what any one check stands for is its own business. `strict` additionally means the branch must be current with base (Step 2). |
| `pull_request` | `required_review_thread_resolution`, `allowed_merge_methods`, `required_approving_review_count`, `dismiss_stale_reviews_on_push` | thread resolution `true` means *every* thread must end resolved, not just the severe ones. Merge methods: pick from the allowed set only (Step 5). Approvals are often 0; if >0, `reviewDecision` reads `REVIEW_REQUIRED` and merge waits on a human. |
| `copilot_code_review` | `review_on_push`, `review_draft_pull_requests` | Copilot review is part of this repo's flow — automatically **requested**, but gating nothing on its own (it lands as a `COMMENTED` review), so its findings are your bar rather than GitHub's. `review_on_push` re-*requests* Copilot on every push — usually, but not always, producing a new review, so confirm one landed for the current head instead of assuming it. Drafts are skipped unless `review_draft_pull_requests`. See `references/copilot.md`. |
| `deletion`, `non_fast_forward` | — | the matched branches can't be deleted or force-pushed. Affects Step 1's rename and Step 5's `--delete-branch` when they touch a protected ref. |

Anything the rules don't cover, the live signals still do: `gh pr checks` is the
final word on which contexts are required, whatever produced them.

### When there are no gates, or they can't be trusted

A repo with no *enforced* gates reports `CLEAN` the instant the PR opens — that
means "GitHub won't stop you," not "the work is ready." **Gates are a floor, never
a ceiling**; Step 4's bar applies on top of whatever the repo enforces.

**Don't merge on a bypass.** Where `current_user_can_bypass` is not `never`, or you
are in a rule's `bypass_actors`, `mergeStateStatus` reads `CLEAN` because you are
allowed to skip the gates — not because they passed. Satisfy them as if you could
not. An `evaluate` or `disabled` ruleset is advisory in the same way: it appears in
the API and blocks nothing.

**Confirm gates are absent; don't infer it from an empty rulesets list.** A repo
can enforce required checks, reviews and thread-resolution through **classic branch
protection**, which `/rulesets` does not return. Treat them as truly absent only
when the live signals agree: `gh pr checks` shows no required checks,
`reviewDecision` is empty, and neither `rules/branches/<base>` nor
`branches/<base>/protection` enforces anything.

Then supply the gates yourself — the Step 4 loop's bar becomes the authoritative
one — and be *more* conservative, not less: keep the explicit-go-ahead gate, avoid
irreversible force-pushes, and tell the user their judgment is the only safety net
here.

## When the platform is down, the red check is not yours

A degraded forge fails the way a broken diff does: jobs queue and never start, a
runner dies mid-job, a check reports an internal error, the API answers 5xx. No
code change repairs any of it. So attribute a red or stuck check before fixing it,
and once the platform owns the failure, park the run on it — attribution, the wait
and the resume are
[`references/platform-status.md`](references/platform-status.md).

What that costs the steps below, for as long as the outage is what blocks the run:

- **Change nothing** — no speculative fix, no push, and no Step 4 iteration spent;
  that budget is for failures the diff caused.
- **Never merge past it.** A check red because the platform is red is not a
  non-required check you may deem irrelevant (`UNSTABLE`), and a check that never
  started is not a check that passed.

## Step 1 — Branch naming

The shape a name takes, what counts as auto-generated, and the cases where a
rename is *not* allowed all live in
[`../../references/branch-naming.md`](../../references/branch-naming.md) —
apply it here, and leave a
name that already describes the change alone.

On a run driven from upstream the **rename** is usually a no-op:
`hcb-dev:shipping-workflow` step 0 normalized the name before the branch was ever
pushed. The **publish** is not. The push below is the only place this skill puts
the branch on the remote, and without it Step 2's `--force-with-lease`
dies on "no upstream branch" while Step 3's `gh pr create --head` finds no head
ref at all — so skip the rename when the name is already right, and never skip the
push.

What this step owns is the mechanics that reference points back at: renaming a
branch that may already be on a remote, and publishing it under the final name.

**Which remote to push to is
[`../../references/base-resolution.md`](../../references/base-resolution.md)'s
question** — resolve it there, and resolve it **before** renaming, reading
`branch.<name>.pushRemote` under the branch's current name.

Fill the two values at the top; everything under them is live.

```bash
PUSH_REMOTE="<resolved per base-resolution.md, before any rename>"
NEW="<the name from branch-naming.md — MAY equal the current one>"

# Detached HEAD has no branch to rename or push, and an empty $cur would silently
# turn a `branch.<name>.*` lookup into `branch..*`. Say so instead.
cur="$(git symbolic-ref --short -q HEAD)" \
  || { echo "DETACHED HEAD — check out a branch before shipping"; exit 1; }
# An open PR pins the name: renaming means deleting the head ref below, which
# closes the PR and takes its review threads with it. Keep the name instead.
# This probe must fail CLOSED. Empty output covers two very different answers —
# "no PR" and "gh could not tell me" (auth expired, wrong default repo, network) —
# and reading the second as the first renames the branch and deletes the old ref,
# closing a PR you never saw. Keep the exit status, not just the output.
if pr_open="$(gh pr list --head "$cur" --state open --json number -q '.[].number' 2>/dev/null)"; then
  pr_known=1
else
  pr_known=0
fi
if [ "$cur" != "$NEW" ] && [ "$pr_known" = 0 ]; then
  echo "PR STATE UNKNOWN for $cur — keeping the name; a rename here could close a PR I cannot see"
  NEW="$cur"
elif [ "$cur" != "$NEW" ] && [ -n "$pr_open" ]; then
  echo "note: PR already open on $cur — keeping the name (renaming would close it)"
  NEW="$cur"
fi
[ "$cur" = "$NEW" ] || git branch -m "$NEW"
# UNCONDITIONAL: this is the branch's only publication in this skill. Steps 2 and
# 3 both assume an upstream exists, and neither creates one.
git push "$PUSH_REMOTE" -u "$NEW"
# Delete the stale remote ref ONLY when the name actually changed. With
# $cur == $NEW this deletes the ref the line above just pushed — unpublishing the
# branch and closing any PR whose head it is — and `2>/dev/null || true` would
# swallow every trace, leaving Step 2 to proceed as if the branch were pushed.
if [ "$cur" != "$NEW" ]; then
  git push "$PUSH_REMOTE" --delete "$cur" 2>/dev/null || true
fi
```

## Step 2 — Bring the branch up to date with base

The base branch and the remote carrying it both come from `base-resolution.md`:
rung 2, the open PR's own base, answers it here, and the reference's remote ranking
says which remote actually holds that branch — `upstream` can exist while *this*
base lives only on `origin`, in a fork whose PR targets the fork itself. Then
rebase onto it; rebase is the default (cleaner history, plays well with squash).

One thing this step must not take on trust: **check the fetch, not just the ref.**
Whichever remote you picked, you picked it *because* `<base-remote>/<base>` is
already there — so an existence test passes just as happily against a week-old
copy. A fetch that failed (VPN down, the remote gone) then rebases onto a stale
base, this step reports "up to date", and GitHub reports `BEHIND` at merge time.
"Did not update" is the only failure this step actually has.

Fill the two values at the top; everything under them is live.

```bash
BASE_REMOTE="<resolved per base-resolution.md>"
BASE="<the PR's base branch, bare name>"

if ! git fetch "$BASE_REMOTE" "$BASE"; then
  echo "FETCH FAILED from $BASE_REMOTE — not rebasing onto a possibly stale base"; exit 1
fi
# And the ref must exist at all: the branch may simply not be on that remote.
git rev-parse --verify -q "$BASE_REMOTE/$BASE^{commit}" >/dev/null 2>&1 \
  || { echo "BASE $BASE NOT ON $BASE_REMOTE — name the right remote and re-run"; exit 1; }
git rebase --autostash "$BASE_REMOTE/$BASE"
```

- Resolve trivial conflicts yourself; if a conflict needs a real decision, stop
  and ask.
- After a successful rebase, push with `--force-with-lease`.
- **Exception:** if the branch is shared, do NOT rebase — merge base into the
  branch instead and note why. Shared means anything is built on its current tip:
  others have commits, another open PR references it, or — a set's feature branch —
  a slice is still open against it or already cut from it. Once every slice has
  landed and its PR is closed, the branch is yours again and rebase is the default
  as usual.
- **Under a strict required-checks policy, being up to date is itself a merge
  gate:** whenever GitHub reports the branch `BEHIND` (base moved while the PR was
  open, including right before merge), re-sync again — `gh pr update-branch <pr>`
  does this server-side without a local rebase.

## Step 3 — Open the PR (if not already open)

If there's no open PR for this branch, create one as **ready for review** (not
draft) — Copilot skips drafts, and `references/copilot.md` says what that costs:

```bash
gh pr create --base <base> --head <branch> --fill --title "<title>" --body "<body>"
```

- Title: the shape in `branch-naming.md` — GitHub makes it the squash commit's
  subject, and appends the PR number itself.
- Body: what changed and why, in the user's own framing if known; a short summary
  and a bullet list of notable changes, plus `Closes #N` for every issue this PR
  settles. GitHub acts on that keyword only for a PR whose base is the default
  branch, so on any other base — a slice PR onto its feature branch, a repo whose
  PRs target another trunk — the issue is closed explicitly after the merge lands
  (`hcb-dev:issue-tracking`).
- If a PR already exists, skip creation and move to the loop.

## Step 4 — The fix loop (until GitHub says mergeable)

Loop until the PR is **both mergeable by GitHub and clean by your own bar** —
every required check green and the thread-resolution requirement satisfied, plus —
always, whatever the repo does or doesn't enforce — CI genuinely green, the branch
current with base, and Copilot's review **of the current head** processed with its
Critical/Important findings resolved (see *When there are no gates, or they can't
be trusted*). Up to ~5 iterations, then escalate. Gates decide *permission* to
merge, your bar decides *readiness*; when they diverge, the stricter one wins. The
severity classification only decides what you *fix*, never when you're *done*.

1. **Read the live state:** `gh pr checks <pr>` plus
   `gh pr view <pr> --json mergeable,mergeStateStatus,reviewDecision` (or MCP
   equivalents). `reviewThreads` is **not** a `gh pr view --json` field — for
   thread-resolution state use the GraphQL `reviewThreads` query in
   `references/copilot.md`. Poll while checks are in progress.
2. **If a required check is red:** read the failing job's logs, fix the root
   cause, commit, push. Don't guess — read the actual failure. Not every red check
   wants a code change: one that stands in for a review is typically waiting on the
   review itself or on unresolved threads, and one that is red — or stuck without
   ever starting — because the forge is degraded wants no change at all, so read
   what it reports before touching code and attribute it per
   *When the platform is down, the red check is not yours*.
3. **Read Copilot findings** (MCP → `gh pr view --comments` → API) and classify
   them — see `references/copilot.md`.
4. **Fix Critical and Important findings.** Batch fixes into as few pushes as is
   reasonable — under `review_on_push` every push re-requests Copilot and costs
   another wait at step 6, whether or not a new review actually follows.
5. **Reply to every Copilot comment; resolve every thread the repo requires
   resolved** — `references/copilot.md` owns the reply + resolve protocol.
6. **After pushing, wait for Copilot's review of the new head** — never evaluate
   exit until its verdict on the head is settled; `references/copilot.md` owns the
   wait and defines what settles it. Then re-read from this loop's step 1 (the
   live-state read), not the top-level Step 1.

## Step 5 — Merge (only with explicit authorization)

Merging is gated on explicit user permission — see the Autonomy model. Once Step 4's
exit is met:

- **If the user already authorized the merge** — their request asked to merge/ship
  ("ship it", "get this merged", "merge when green"), or they've since said go
  ahead — merge now.
- **Otherwise, stop here.** Report that the PR is ready to merge (all required
  gates satisfied) and ask for an explicit go-ahead. Do not merge until they
  confirm.

Choose the strategy — a `merge-strategy` threaded in from the planning gate wins
if one was passed (the user's shown-and-approved choice), always **filtered to the
repo's allowed merge methods** (from the ruleset; `gh pr merge` will reject a
disallowed one, so fall back within the allowed set and say so). Absent a threaded
strategy, pick from the allowed set:

- **A PR whose base is a feature branch is a slice, and a slice always squashes**
  — one commit — regardless of the gate's `merge-strategy`, which governs the
  final `feature → base` integration PR only —
  [`../../references/slice-completion.md`](../../references/slice-completion.md)
  owns that topology. The choices below apply to that final PR, or to a standalone
  single one.
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

After the merge lands, check once more for a late review: Copilot's review of the
merged head can post *after* the merge, orphaning its findings on the now-closed
PR — behind a signal that read as a decline, or behind a merge taken outside this
skill. If one appears, don't drop it: surface its findings in the report below and
recommend a follow-up (issue or change request) as a next step; creating it is an
outward action the user authorises, not one you take autonomously —
[`../../references/surfacing-findings.md`](../../references/surfacing-findings.md)
owns that protocol, and the classification is `hcb-dev:issue-tracking`'s.

Then give the user a short report:

1. **Additional findings from this session**, grouped by category (e.g.
   Security, Correctness, Performance, Maintainability, Tests) — the
   lower-severity items you deliberately skipped during the loop. Each goes
   through
   [`../../references/surfacing-findings.md`](../../references/surfacing-findings.md),
   as the late review's findings above do. Where nothing called this driver, this
   report ends the session and that reference says what ends there; under an
   orchestrator it ends a slice, and the run's own report is the end.
2. **Suggested next steps** — tech debt to track, tests to add, or related work
   that surfaced.

Keep it scannable: short grouped bullets, not an essay.

## Reference files

- [`references/copilot.md`](references/copilot.md) — How to find, classify (Critical/Important vs skip),
  fix, and reply to Copilot review findings. Read it before Step 4.
- [`references/platform-status.md`](references/platform-status.md) — whether a red,
  stuck or missing check belongs to the platform rather than to the diff, how to
  wait an outage out, and what to re-trigger once it clears. Read it the moment a
  failure does not look like the diff's.
- [`../../references/surfacing-findings.md`](../../references/surfacing-findings.md)
  — what a finding this PR will not fix costs before it can be proposed, the form
  the proposal takes, and what the user's answer authorizes. Read it before
  Step 7, and before recommending a follow-up on a late review.
- [`../../references/forge-docs.md`](../../references/forge-docs.md) — where a
  flag, an endpoint or a ruleset field gets resolved: the installed CLI's
  `--help` for what this build accepts, the docs sites for what a field means.
  Read it before writing an invocation this skill does not already spell out.
- [`../../references/branch-naming.md`](../../references/branch-naming.md) — the shape of a branch name, what counts as
  auto-generated, and when a rename is off the table. Read it before Step 1; the
  push mechanics stay in that step.
- [`../../references/base-resolution.md`](../../references/base-resolution.md) — which remote to push to, which one carries
  the base, and the ref-versus-name split. Steps 1 and 2 both resolve through it
  and fill the result in; read it before either.
- [`../../references/architecture-decisions.md`](../../references/architecture-decisions.md) — where autonomy ends and
  asking begins, and why every stop carries a recommendation rather than a bare
  question. It governs the stop-and-ask list near the top and Step 5's merge
  authorization; read it before the first stop, not at it.
