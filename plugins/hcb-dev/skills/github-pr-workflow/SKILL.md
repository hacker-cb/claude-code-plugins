---
name: github-pr-workflow
description: >-
  Drive a GitHub pull request from a finished feature branch all the way to a
  merged PR, looping on CI and Copilot findings until it is mergeable and then —
  only with the user's explicit go-ahead — merging it. Use this skill whenever the user wants to
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

`hcb-dev:shipping-workflow` sits directly upstream and hands off here in
**request** mode. If you landed here on finished work that has had no local
review, go there first: this skill starts at the PR and will not run the
reviewers for you.

This skill is GitHub-specific by design (the `<forge>-<artifact>-workflow`
convention); which driver a forge routes to is
[`../../references/slice-completion.md`](../../references/slice-completion.md)'s.

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
- Step 2's rebase resolved a conflict into code no reviewer has read, and the
  review that would cover it could not run or left a finding of weight open — this
  stop outranks any `merge-auth` threaded in

Each of those stops shows your recommended option **first**, with a one-line
reason grounded in the code **and the constraints** — half these stops turn on
neither the diff nor the code (a ruleset's allowed merge methods, what the CI logs
say), and a reason invented to look code-shaped is worse than the bare question it
replaced. That and the split above are per
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

What blocks a merge — required checks, thread resolution, allowed merge methods,
being current with base — is configured **per repository** and enforced by GitHub.
**Read the configuration of the repo you're working in**, every time, and never
carry over what some *other* repo required or what a check was called there. These
signals already fold in whatever is enforced, by any mechanism:

```bash
gh pr checks <pr>                                              # required checks + state
gh pr view <pr> --json mergeable,mergeStateStatus,reviewDecision  # merge verdict + why
```

**Gates are a floor, never a ceiling** — Step 4's bar applies on top of whatever
the repo enforces, and where the repo enforces nothing, becomes the only one.
**Never merge on a bypass**: where you are allowed to skip the gates,
`mergeStateStatus` reads `CLEAN` because of that, not because they passed.

[`references/merge-gates.md`](references/merge-gates.md) owns the rest — the rules
behind those signals, the `mergeStateStatus` values Step 4 routes on, and how to
tell absent gates from unread ones. **Read it before Step 2**, which is where the
first of those values is routed on.

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
# An open PR pins the name: renaming deletes the head ref below, closing the PR and
# its review threads. This probe must fail CLOSED — empty output covers both "no PR"
# and "gh could not tell me", and the second read as the first closes a PR unseen.
# Keep the exit status, not just the output.
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
# 3 both assume an upstream exists, and neither creates one. The branch arrives
# already landed on its parent, so its history may have been rewritten upstream of
# here — but a force is owed to that case alone, and the other two are safer
# without one. Ask the remote what it has: THREE answers, not two. `ls-remote`
# exits 0 with empty output for a branch that is not there and non-zero when it
# could not ask at all, and reading the second as the first publishes against a
# remote nobody read.
if ! remote_tip="$(git ls-remote --heads "$PUSH_REMOTE" "refs/heads/$NEW" 2>/dev/null)"; then
  echo "CANNOT READ $PUSH_REMOTE — not publishing against a remote I could not query"; exit 1
fi
# A lease compares against the tracking ref, so a published branch needs one that
# exists and is current; a branch that is not there needs nothing.
if [ -n "$remote_tip" ] \
   && ! git fetch "$PUSH_REMOTE" "+refs/heads/$NEW:refs/remotes/$PUSH_REMOTE/$NEW"; then
  echo "FETCH FAILED for $NEW — not publishing against a ref whose age is unknown"; exit 1
fi
published=0
if [ -z "$remote_tip" ]; then
  git push "$PUSH_REMOTE" -u "$NEW" && published=1                 # first publication
elif git merge-base --is-ancestor "$PUSH_REMOTE/$NEW" HEAD; then
  git push "$PUSH_REMOTE" -u "$NEW" && published=1                 # fast-forward
else
  # `--force-if-includes` is what separates this branch's own rewritten history from
  # someone else's commit: it requires the published tip to be reachable from this
  # branch's reflog. A bare lease passes both and overwrites the second.
  git push --force-with-lease --force-if-includes "$PUSH_REMOTE" -u "$NEW" && published=1
fi
# Chained, because unpublished-and-deleted is worse than either alone: a refused push
# followed by the delete below unpublishes the branch and closes the PR on it. The
# message names what happened, not a cause nothing here established.
[ "$published" = 1 ] \
  || { echo "NOT PUBLISHED — push refused for $NEW; read the error above, and leave the old name standing"; exit 1; }
# ONLY when the name actually changed: with $cur == $NEW this deletes the ref the
# line above just pushed, unpublishing the branch and closing any PR on it.
if [ "$cur" != "$NEW" ]; then
  # The full refname: a bare one is ambiguous where a tag shares the name, and
  # reaches that tag where the branch was never pushed under the old name at all.
  git push "$PUSH_REMOTE" --delete "refs/heads/$cur" || true
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
copy, and a rebase onto that copy has this step report "up to date" while GitHub
reports `BEHIND` at merge time. What the fetch's outcomes mean is
`base-resolution.md`'s; here, a fetch that did not succeed stops this step — a
base whose age is unknown is not one to rebase onto, while one the fetch confirms
is already current is exactly what this step wants.

Fill the two values at the top; everything under them is live.

```bash
BASE_REMOTE="<resolved per base-resolution.md>"
BASE="<the PR's base branch, bare name>"

if ! git fetch "$BASE_REMOTE" "+refs/heads/$BASE:refs/remotes/$BASE_REMOTE/$BASE"; then
  echo "FETCH FAILED from $BASE_REMOTE — not rebasing onto a possibly stale base"; exit 1
fi
# And the ref must exist at all: the branch may simply not be on that remote.
git rev-parse --verify -q "$BASE_REMOTE/$BASE^{commit}" >/dev/null 2>&1 \
  || { echo "BASE $BASE NOT ON $BASE_REMOTE — name the right remote and re-run"; exit 1; }
git rebase --autostash "$BASE_REMOTE/$BASE"
```

- Resolve trivial conflicts yourself; if a conflict needs a real decision, stop
  and ask.
- **What a resolution wrote past a trivial one is code no reviewer has read.**
  Trivial is the line `slice-completion.md` draws for the same hazard in local
  mode — whitespace, a lockfile, a generated file re-run — and it rides on. Past
  it, the reviewers upstream read this branch as it stood before this rebase: put
  the resolution through `hcb-dev:multi-review` — unnarrowed, since a narrowing is
  what sends the security review to `n/a` — then fix what it rates Critical or
  Important and push it here, so Step 4's iterations stay on the failures the diff
  caused. Where that review cannot run, or a finding of that weight stays open, it
  is the Autonomy model's stop below: ask before merging, whatever authorization
  was threaded in.
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

- Title: the shape in `branch-naming.md`.
- Body: what changed and why, in the user's own framing if known; a short summary
  and a bullet list of notable changes, plus `Closes #N` — that English keyword
  verbatim, whatever language the body is written in — for every issue this PR
  settles. GitHub acts on that keyword only for a PR whose base is the default
  branch, so on any other base — a slice PR onto its feature branch, a repo whose
  PRs target another trunk — the issue is closed explicitly after the merge lands
  (`hcb-dev:issue-tracking`).
- If a PR already exists, skip creation and move to the loop.

## Step 4 — The fix loop (until GitHub says mergeable)

Loop until the PR is **both mergeable by GitHub and clean by your own bar** —
every required check green and the thread-resolution requirement satisfied, plus —
always, whatever the repo does or doesn't enforce — CI genuinely green, the branch
current with base, the PR body describing the head that is about to land
([`../../references/merge-message.md`](../../references/merge-message.md);
`gh pr edit <pr> --body "<body>"` rewrites it), and Copilot's review **of the
current head** settled — its Critical/Important findings fixed, every comment it
left answered, and every thread it opened resolved (`references/copilot.md`;
`references/merge-gates.md`, *When there are no gates, or they can't be
trusted*). Up to ~5 iterations, then escalate. Gates decide *permission* to
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
4. **Fix the findings `references/copilot.md` routes to a fix.** Batch fixes into
   as few pushes as is reasonable — under `review_on_push` every push re-requests
   Copilot and costs
   another wait at step 6, whether or not a new review actually follows.
5. **Reply to every Copilot comment, and resolve every thread it opened** —
   `references/copilot.md` owns the reply + resolve protocol.
6. **After pushing — whichever step pushed — bring the body back to what is
   landing** (`merge-message.md`; `gh pr edit <pr> --body "<body>"`), **and wait for
   Copilot's review of the new head**: never evaluate
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
  logical feature/fix. Pass the commit's body yourself — `--body`, or
  `--body-file` — written per `merge-message.md`. The subject, passed nothing,
  is settled by the repo's own `squash_merge_commit_title`, whose values
  disagree about whether the PR's title reaches it at all: read the setting
  rather than assume which is in force. Where the subject has to be passed
  (`--subject`), `branch-naming.md` owns what may go in one.
- **Merge commit** (`gh pr merge --merge`) — when the PR contains multiple
  distinct features whose individual history is worth preserving.
- If rebase-merge is the only fit but the repo disallows it, or the choice is
  genuinely ambiguous, ask.

**Merge, and nothing else** — never `--delete-branch`. Both refs retire in Step 6,
on the confirmed merge.

## Step 6 — Monitor the merge

After issuing the merge, confirm it actually landed — what the PR reports decides
that, never the merge command's exit status:
- Merge can be queued (merge queue) or blocked by a last-second protection rule.
- Under a strict policy the base may have moved, flipping the PR to `BEHIND` — run
  `gh pr update-branch <pr>`, let the required checks re-pass, then merge again.
- Poll until the PR shows `MERGED`, or report what's blocking it.
- On `MERGED`, retire the branch — both the local ref and the one on the remote —
  [`../../references/branch-retirement.md`](../../references/branch-retirement.md).

## Step 7 — Report and suggest next steps

After the merge lands, check once more for a late review: Copilot's review of the
merged head can post *after* the merge, orphaning its findings on the now-closed
PR — behind a signal that read as a decline, or behind a merge taken outside this
skill. If one appears, don't drop it: surface its findings in the report below and
recommend a follow-up (issue or change request) as a next step; creating it is an
outward action the user authorises, not one you take autonomously —
[`../../references/findings.md`](../../references/findings.md) owns
that protocol, and the classification is `hcb-dev:issue-tracking`'s.

Then give the user a short report:

1. **Additional findings from this session**, grouped by category (e.g.
   Security, Correctness, Performance, Maintainability, Tests) — the
   lower-severity items you deliberately skipped during the loop. Each goes through
   [`../../references/findings.md`](../../references/findings.md), as
   the late review's findings above do. Where nothing called this driver, this
   report ends the session and that reference says what ends there; under an
   orchestrator it ends a slice, and the run's own report is the end.
2. **Suggested next steps** — tech debt to track, tests to add, or related work
   that surfaced.

Keep it scannable: short grouped bullets, not an essay.

## Reference files

- [`references/merge-gates.md`](references/merge-gates.md) — read it before Step 2.
- [`references/copilot.md`](references/copilot.md) — read it before Step 4.
- [`references/platform-status.md`](references/platform-status.md) — read it the
  moment a failure does not look like the diff's.
- [`../../references/findings.md`](../../references/findings.md) — read
  it before Step 4, before Step 7, and before recommending a follow-up on a late
  review.
- [`../../references/forge-docs.md`](../../references/forge-docs.md) — read it
  before writing an invocation this skill does not already spell out.
- [`../../references/branch-naming.md`](../../references/branch-naming.md) — read
  it before Step 1; the push mechanics stay in that step.
- [`../../references/merge-message.md`](../../references/merge-message.md) — read
  it before Step 4, and again before Step 5.
- [`../../references/branch-retirement.md`](../../references/branch-retirement.md)
  — read it before Step 6.
- [`../../references/base-resolution.md`](../../references/base-resolution.md) —
  Steps 1 and 2 both resolve through it; read it before either.
- [`../../references/architecture-decisions.md`](../../references/architecture-decisions.md)
  — read it before the first stop, not at it.
