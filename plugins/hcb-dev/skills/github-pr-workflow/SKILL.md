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
fallback, and the stacked-PR handling added below is **documented
forge-neutrality debt** owed to that twin: the same capability will need mirroring
for GitLab merge trains when it lands.

## Driving a set (multi-slice)

When `hcb-dev:implementation-workflow` runs a set in request mode, each slice
completes **onto the shared feature branch** before the next is cut, so the slices
build on each other and the run never reviews a slice against a base missing the
one below it. Standalone (a single PR, no set) none of this applies — one base,
one merge, strategy chosen as in Step 5.

- **A slice PR targets the feature branch, not the repo default** — read the base
  from the PR (Step 2), never assume the default — and is driven to **merge into
  the feature branch** so the next slice can be cut from the updated tip.
- **A slice PR is always squashed** — a slice is one logical commit on the feature
  branch — *whatever* the gate chose for the final integration. The gate's
  `merge-strategy` governs only the final PR (below), never the per-slice ones;
  applying a gate `merge-commit` to every slice would litter the feature branch
  with intermediate merge commits.
- **The final PR integrates the set** — `feature → base`, driven last, with the
  gate's `merge-strategy` (`merge-commit` keeps the slice commits, `squash`
  collapses them), filtered to the repo's allowed methods.

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
"ship it", "get this merged", "merge once it's green"), the captured user-approved
`merge-auth` was threaded in from an upstream flow (`hcb-dev:shipping-workflow`, or
`hcb-dev:implementation-workflow`'s planning gate — the same "asked to merge" case,
gathered earlier and shown to the user there, so a run driven with it does not stop
to re-ask), or they say yes when you ask. If they only asked to open or drive the PR, take it all the way to "ready to
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

What blocks a merge — which CI checks are required, whether *every* review thread
must be resolved, which merge methods are allowed, whether the branch must be
current with base — is configured **per repository** (branch protection /
rulesets) and **enforced by GitHub**. You can't change it and shouldn't hardcode
assumptions about it: **read the configuration of the repo you're working in**,
every time, and never carry over what some *other* repo happened to require or
what a check was called there. Your job is to **satisfy** whatever gates this repo
has — and then clear your own bar on top of them, because GitHub's mergeability is
necessary but never sufficient (see *When there are no gates* below).

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
- **A green check is not proof of a review.** A check that stands in for a review
  can be green for reasons of its own — passing the instant *some* review of *any*
  commit is seen (so it flips green within seconds of a later push and says nothing
  about the head), or having run before the latest push was reviewed. Nor does a
  clean merge state prove it: right after a push `mergeStateStatus` can read `CLEAN`
  with the head unreviewed — the prior review's threads stay resolved across the
  push, and `dismiss_stale_reviews_on_push` dismisses only stale *approvals*. Never
  infer "Copilot has reviewed the current head" from a check's colour, from `CLEAN`,
  or from all-threads-resolved; verify it directly against the head SHA
  (`references/copilot.md`).
- **`UNSTABLE` means a non-required check is red.** GitHub will let you merge over
  it; don't, unless you've confirmed that check is irrelevant or a known flake
  (re-run flakes rather than merging past them).

**When gates are absent, weak, or unreadable** — but confirm *absent*, don't infer
it from an empty rulesets list. A repo can enforce required checks, reviews, and
thread-resolution through **classic branch protection**, which `/rulesets` does
**not** return, so `rulesets == []` alone does not mean unprotected. Treat gates as
truly absent only when the live signals agree: `gh pr checks` shows no required
checks, `reviewDecision` is empty, and *neither* `rules/branches/<base>` *nor*
`branches/<base>/protection` enforces anything (or `gh api` is denied and you
genuinely can't tell). Only then supply the gates yourself: the Step 4 loop's own
bar becomes authoritative — green CI, Copilot Critical/Important resolved and every
thread replied, branch up to date — and because nothing external protects the base,
be *more* conservative, not less: keep the explicit-go-ahead gate, avoid
irreversible force-pushes, and tell the user the repo has no enforced protection so
your judgment is the only safety net.

## Step 1 — Branch naming

The shape a name takes, what counts as auto-generated, and the cases where a
rename is *not* allowed all live in
[`../../references/branch-naming.md`](../../references/branch-naming.md)
(`${CLAUDE_PLUGIN_ROOT}/references/branch-naming.md`) — apply it here, and leave a
name that already describes the change alone.

On a run driven from upstream the **rename** is usually a no-op:
`hcb-dev:shipping-workflow` step 0 normalized the name before the branch was ever
pushed. The **publish** is not. `netpush push -u` below is the only place this
skill puts the branch on the remote, and without it Step 2's `--force-with-lease`
dies on "no upstream branch" while Step 3's `gh pr create --head` finds no head
ref at all — so skip the rename when the name is already right, and never skip the
push. The rename half also stays because the user can enter this skill directly,
and because this is the **last** point at which a rename is possible at all: once
the PR is open, renaming means deleting its head ref, and that closes the PR.

What this step owns is the mechanics that reference points back at: renaming a
branch that may already be on a remote, and publishing it under the final name.

Remote resolution follows the shared ladder in
[`../../references/base-resolution.md`](../../references/base-resolution.md)
(`${CLAUDE_PLUGIN_ROOT}/references/base-resolution.md`) — read it for the reasoning
the blocks below apply. Which remote to push to is `<push-remote>`, and `origin` is not it by assumption —
a repo may have a single remote under another name. But it is **not** the tracked
`@{upstream}` either: in a fork checkout the branch tracks `upstream/<base>`, and
pushing there targets the canonical repo (permission-denied, or the PR branch
created in the wrong repository) instead of your fork. Use git's own push routing —
`branch.<name>.pushRemote`, then `remote.pushDefault` — then `origin`, then your
sole remote. Read `branch.<name>.pushRemote` under the branch's **current** name and
resolve everything *before* renaming — the ambiguity case exits, and exiting after
`git branch -m` would leave the branch renamed locally with nothing pushed. (`git
branch -m` does carry that config across, so the rename loses nothing.)

```bash
# Push is a network call: no prompts, and EXTEND the user's ssh setup rather than
# replacing it — a flat GIT_SSH_COMMAND drops a multi-account `-i ~/.ssh/id_work`
# or a ProxyCommand, and BatchMode then forbids the fallback, so a repo that
# pushes fine by hand dies on "Permission denied". Per-command, not exported:
# shell state does not survive to the next Bash call anyway, so every network
# command in this skill — including the fix loop's force-push — must carry it.
netpush() {
  GIT_TERMINAL_PROMPT=0 \
  GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -oBatchMode=yes -oConnectTimeout=5" \
    git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=10 "$@"
}
# Resolve the remote BEFORE renaming: the ambiguity path exits, and aborting after
# `git branch -m` would leave the branch renamed locally, the old name still on the
# remote, and the upstream no longer matching — which push.default=simple then
# refuses outright, leaving an unpushable branch and a step that is a no-op on
# re-run. `branch.<name>.pushRemote` is read under the CURRENT name for the same
# reason (`git branch -m` moves that config across with it).
# Detached HEAD has no branch to rename or push, and an empty $cur would silently
# turn the lookup below into `branch..pushRemote`. Say so instead.
cur="$(git symbolic-ref --short -q HEAD)" \
  || { echo "DETACHED HEAD — check out a branch before shipping"; exit 1; }
# git's push routing, never @{upstream} (that is the base repo in a fork). Fall
# through to a bare `origin`, then to a lone remote whatever its name — but STOP
# on a genuine ambiguity (several remotes, none preferred): guessing one there
# could publish your branch in someone else's repository.
PUSH_REMOTE="$(git config --get "branch.$cur.pushRemote" || git config --get remote.pushDefault)"
# Config can name a remote that no longer exists — renamed, or removed and
# re-added under another name — and taking it on trust bypasses the ladder below
# and fails the push with git's own opaque message. Verify, then fall through.
[ -n "$PUSH_REMOTE" ] && ! git remote | grep -qx -- "$PUSH_REMOTE" && {
  echo "note: configured push remote '$PUSH_REMOTE' no longer exists — resolving instead"
  PUSH_REMOTE=""
}
if [ -z "$PUSH_REMOTE" ]; then
  if   git remote | grep -qx origin;                 then PUSH_REMOTE=origin
  elif [ "$(git remote | grep -c .)" = 1 ];          then PUSH_REMOTE="$(git remote)"; fi
fi
if [ -z "$PUSH_REMOTE" ]; then
  # Say which of the two it is — "name a remote" is impossible advice when there
  # are none, and "add one" is wrong when there are several.
  [ "$(git remote | grep -c .)" = 0 ] \
    && echo "NO REMOTE — add one (git remote add <name> <url>), then re-run" \
    || echo "PUSH REMOTE AMBIGUOUS — several remotes, none preferred; set branch.$cur.pushRemote or remote.pushDefault, then re-run"
  exit 1
fi
NEW="<new-name>"   # from branch-naming.md, whose block validates it — MAY equal $cur
# An open PR pins the name: renaming means deleting the head ref below, which
# closes the PR and takes its review threads with it. Keep the name instead.
if [ "$cur" != "$NEW" ] \
   && [ -n "$(gh pr list --head "$cur" --state open --json number -q '.[].number' 2>/dev/null)" ]; then
  echo "note: PR already open on $cur — keeping the name (renaming would close it)"
  NEW="$cur"
fi
[ "$cur" = "$NEW" ] || git branch -m "$NEW"
# UNCONDITIONAL: this is the branch's only publication in this skill. Steps 2 and
# 3 both assume an upstream exists, and neither creates one.
netpush push "$PUSH_REMOTE" -u "$NEW"
# Delete the stale remote ref ONLY when the name actually changed. With
# $cur == $NEW this deletes the ref the line above just pushed — unpublishing the
# branch and closing any PR whose head it is — and `2>/dev/null || true` would
# swallow every trace, leaving Step 2 to proceed as if the branch were pushed.
if [ "$cur" != "$NEW" ]; then
  netpush push "$PUSH_REMOTE" --delete "$cur" 2>/dev/null || true
fi
```

Every later network command in this skill — the Step 2 fetch, the
`--force-with-lease` push after a rebase, each push in the Step 4 fix loop — needs
that same `netpush` wrapper. Shell state does not survive between Bash calls, so
re-declare it in whichever block does the pushing; an unguarded push in an
unattended loop is exactly the hang the guard exists to prevent.

## Step 2 — Bring the branch up to date with base

Identify the base branch (usually the PR's base, else the repo default — check
`gh repo view --json defaultBranchRef` or the existing PR). Its remote is
`<base-remote>`, and again not `origin` by assumption: prefer `upstream` when it
exists (fork checkout — the base lives in the upstream repo, not your fork), then
`origin`, then a lone remote whatever its name — and stop on a real ambiguity
rather than fetching the base from an arbitrary remote. Rebase the feature branch
onto the latest base. Rebase is the default (cleaner history, plays well with
squash). Guard the fetch so it fails closed rather than hanging on a credential or
passphrase prompt — the loop may run unattended, and `timeout` is absent on stock
macOS:

```bash
# Preference alone is not enough: `upstream` may exist while THIS base lives only
# on `origin` (a fork whose PR targets the fork itself). So probe each remote in
# rank order for one that ALREADY has a remote-tracking copy of <base>, and fall
# back to preference only when none does. Note what that probe can and cannot see:
# it reads local refs, so on a fresh or narrowed clone — where no copy exists yet —
# it finds nothing and preference decides after all. The fetch below is verified
# and the rebase refuses a missing ref, so a wrong pick fails loudly rather than
# silently; if several remotes carry the same <base> name, pass the right one in.
BASE_REMOTE=""
for r in $(for x in upstream origin; do git remote | grep -qx -- "$x" && echo "$x"; done
           git remote | grep -vxE 'upstream|origin'); do
  git rev-parse --verify -q "$r/<base>^{commit}" >/dev/null 2>&1 && { BASE_REMOTE="$r"; break; }
done
if [ -z "$BASE_REMOTE" ]; then   # no remote-tracking copy yet — fall back to preference
  BASE_REMOTE="$(for x in upstream origin; do git remote | grep -qx -- "$x" && { echo "$x"; break; }; done)"
  [ -n "$BASE_REMOTE" ] || { [ "$(git remote | grep -c .)" = 1 ] && BASE_REMOTE="$(git remote)"; }
fi
if [ -z "$BASE_REMOTE" ]; then
  [ "$(git remote | grep -c .)" = 0 ] \
    && echo "NO REMOTE — add one (git remote add <name> <url>), then re-run" \
    || echo "BASE REMOTE AMBIGUOUS — several remotes, none preferred; name it and re-run"
  exit 1
fi
# Same wrapper as Step 1, re-declared because shell state does not cross Bash calls.
netpush() {
  GIT_TERMINAL_PROMPT=0 \
  GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -oBatchMode=yes -oConnectTimeout=5" \
    git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=10 "$@"
}
# Check the FETCH, not just the ref. The probe above picked this remote *because*
# `$BASE_REMOTE/<base>` already exists, so an existence test passes against a
# week-old copy: a failed fetch (expired credential, VPN down, BatchMode refusing a
# passphrase) would rebase onto a stale base, the step would report "up to date",
# and GitHub would report BEHIND at merge time. "Did not update" is the only
# failure this step actually has.
if ! netpush fetch "$BASE_REMOTE" <base>; then
  echo "FETCH FAILED from $BASE_REMOTE — not rebasing onto a possibly stale base"; exit 1
fi
# And the ref must exist at all: the branch may simply not be on that remote.
git rev-parse --verify -q "$BASE_REMOTE/<base>^{commit}" >/dev/null 2>&1 \
  || { echo "BASE <base> NOT ON $BASE_REMOTE — name the right remote and re-run"; exit 1; }
git rebase --autostash "$BASE_REMOTE"/<base>
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
draft). This matters beyond convention: Copilot **skips draft PRs** unless the
`copilot_code_review` rule sets `review_draft_pull_requests`, so a draft can leave
the review un-run entirely — and where a required check stands in for that review,
leave the PR permanently un-mergeable. Open ready-for-review:

```bash
gh pr create --base <base> --head <branch> --fill --title "<title>" --body "<body>"
```

- Title: concise, matches the branch intent.
- Body: what changed and why, in the user's own framing if known; a short summary
  and a bullet list of notable changes.
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
   review itself or on unresolved threads, so read what it reports before touching
   code.
3. **Read Copilot findings** (MCP → `gh pr view --comments` → API) and classify
   them — see `references/copilot.md`.
4. **Fix Critical and Important findings.** Batch fixes into as few pushes as is
   reasonable — under `review_on_push` every push re-requests Copilot and costs
   another wait at step 6, whether or not a new review actually follows.
5. **Reply to every Copilot comment; resolve every thread the repo requires
   resolved.** The reply is *unconditional* (fixed or acknowledged, on every
   comment); *resolution* is what scales with the repo — under
   `required_review_thread_resolution` that's *all* threads (fix the serious ones,
   acknowledge the rest, but each must end resolved or merge stays `BLOCKED`),
   otherwise at least the ones you fixed. See `references/copilot.md` for the
   reply + resolve protocol.
6. **After pushing, wait for Copilot's review of the new head.** Under
   `review_on_push` a push re-requests Copilot, and any review that follows lands
   *later* than CI goes green — so the PR reads mergeable while that review may
   still be on its way, and finishing in that window silently drops everything it
   was about to say. Never evaluate exit there: follow the wait protocol in
   `references/copilot.md`. Its exit turns on the *requested-reviewer* state, not a
   clock — **while Copilot is still a requested reviewer of the head it has not
   declined, and no elapsed timer authorises merging past it**; a decline is
   confirmed only by Copilot leaving `reviewRequests` with no head review, never by
   an elapsed cap, and on cap-expiry-while-pending you hold and escalate rather than
   merge. The merge precondition a timeout never removes is that
   Copilot's verdict on the head is *settled* — either a processed review whose
   `commit_id == head`, or a confirmed decline for the head (`references/copilot.md`
   defines both) — never an elapsed clock while it is still pending. Then re-read
   from this loop's step 1 (the live-state read), not the top-level Step 1.

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

Choose the strategy — a `merge-strategy` threaded in from the planning gate wins
if one was passed (the user's shown-and-approved choice for the **final
integration PR**; a per-slice PR into a feature branch always squashes — see
*Driving a set*), always **filtered to the repo's allowed merge methods** (from
the ruleset; `gh pr merge` will reject a disallowed one, so fall back within the
allowed set and say so). Absent a threaded strategy, pick from the allowed set:

- **A per-slice PR into a feature branch always squashes** — a slice is one
  commit — regardless of the gate's `merge-strategy`; that strategy governs the
  final `feature → base` integration PR only (see *Driving a set*). The choices
  below apply to that final PR (or a standalone single PR).
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
merged head can post *after* the merge, orphaning its findings on the now-closed PR
(the wait protocol exists to prevent this, but a review can still land late — after a
signal that looked like a decline at the time, or after a merge taken outside this
skill). If one
appears, don't drop it — surface its findings in the report below and recommend a
follow-up (issue or change request) as a next step; creating it is an outward action
the user authorises, not one you take autonomously.

Then give the user a short report:

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
- `../../references/branch-naming.md` — the shape of a branch name, what counts as
  auto-generated, and when a rename is off the table. Read it before Step 1; the
  push mechanics stay in that step.
