---
name: github-pr-workflow
description: >-
  Drive a GitHub pull request from a finished feature branch all the way to a
  merged PR, looping on CI and Copilot findings until it is mergeable and then
  merging it on the authorization it was given — absent one, it stops at ready
  and asks, and it never merges on its own initiative. Use this skill whenever
  the user wants to
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

**Merging is the one action this skill never takes on its own authority.** It is
autonomous exactly as far as the authorization it was handed reaches, and no
further. What governs it is `merge-auth` — a value and the addressee it names
(`slice-completion.md`):
`on-green` merges at Step 4's exit, `queued` reports readiness to the addressee
and holds for its go, `ask` puts the question to the addressee and waits.

Which value governs — one a flow upstream threaded in
(`hcb-dev:shipping-workflow`, or `hcb-dev:implementation-workflow`'s planning
gate), one the user's own phrasing settles here, or the fallback — is that
contract's order to decide, and reading it is how this skill answers the
question. What is this skill's own: never merge on your own initiative, and
never widen an authorization you were handed; narrowing one and saying you did
is always yours.

Also stop and ask — the addressee `merge-auth` names, which is the user unless a
flow upstream named another — when:
- The required gates will not go green within Step 4's iteration budget — or one
  of them is a gate no iteration closes: an approval the base requires that no
  reviewer has given (Step 4)
- A Critical/Important finding requires a product/design decision you can't make
- A standing approval would be spent to fix a `Minor` that nothing else is
  pushing (`references/copilot.md`)
- Copilot's review of the head has not settled and the wait has run out
  (`references/copilot.md`) — the head is unreviewed, and merging past that is
  the addressee's call
- The merge strategy is genuinely ambiguous (see below) and you can't pick
- Whether the branch may be rebased at all cannot be read — a remote that does
  not answer whether anything stands on its tip (`slice-completion.md`); a
  branch that reference says to merge is merged and noted, never asked about
- A stop that outranks an authorization applies, Step 2's unreviewed rebase
  resolution among them (`slice-completion.md`)

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

## The merge gates belong to the base branch — discover them, don't assume

What blocks a merge — required checks, thread resolution, allowed merge methods,
being current with base — is configured **per base branch** and enforced by
GitHub. Two bases of one repository answer differently, and a slice's feature
branch often carries no rules at all, leaving Step 4's bar the only one — but that
is a reading, never a presumption: a `feature/**` pattern or an org-level rule on
every ref covers one just as well.
**Read the configuration of the base this PR targets**, every time, and never
carry over what another base of the same repo required, what some *other* repo
required, or what a check was called there. These signals already fold in whatever
is enforced, by any mechanism:

```bash
gh pr checks <pr>                                              # required checks + state
gh pr view <pr> --json mergeable,mergeStateStatus,reviewDecision  # merge verdict + why
```

**Gates are a floor, never a ceiling** — Step 4's bar applies on top of whatever
the repo enforces, and where the repo enforces nothing, becomes the only one.
**Never merge on a bypass**: where you are allowed to skip the gates,
`mergeStateStatus` reads `CLEAN` because of that, not because they passed.

[`references/merge-gates.md`](references/merge-gates.md) owns the rest — the rules
behind those signals, the per-base read that resolves them, the `mergeStateStatus`
values Step 4 routes on, and how to tell absent gates from unread ones. **Read it
before Step 2**, which is where the first of those values is routed on. One answer
from that read — whether this base requires the branch current with it — is routed
on by Steps 2, 4 and 6 alike, so resolve it there, once.

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
`hcb-dev:shipping-workflow` step 0 normalized the name locally and threads the
name it renamed away as `old-name` (`slice-completion.md`). One thing about that
name is this step's, before anything is published: a PR that heads it pins it —
the rename is undone and the branch ships under the old name, a state that
cannot be read counting as pinned, the same as for a rename made here. What is
published under the old name is retired in Step 2, under the proof that step
names. The **publish** is not a no-op. The push below is the only place this skill puts
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

Fill the three values at the top; everything under them is live.

```bash
PUSH_REMOTE="<resolved per base-resolution.md, before any rename>"
NEW="<the name from branch-naming.md — MAY equal the current one>"
OLD_NAME="<the bare old-name shipping-workflow step 0 threaded in — EMPTY where nothing was renamed>"

# Detached HEAD has no branch to rename or push, and an empty $cur would silently
# turn a `branch.<name>.*` lookup into `branch..*`. Say so instead.
cur="$(git symbolic-ref --short -q HEAD)" \
  || { echo "DETACHED HEAD — check out a branch before shipping"; exit 1; }
# A PR heading the name a caller renamed away pins that name: the rename closed
# nothing yet — only the local ref moved — so it is undone and the branch ships
# under the old name. Unknown state reads as pinned, as the probe below reads it.
if [ -n "$OLD_NAME" ] && [ "$OLD_NAME" != "$cur" ]; then
  if old_pr="$(gh pr list --head "$OLD_NAME" --state open --json number -q '.[].number' 2>/dev/null)"; then
    old_known=1
  else
    old_known=0
  fi
  if [ "$old_known" = 0 ] || [ -n "$old_pr" ]; then
    if git branch -m "$OLD_NAME"; then
      echo "note: PR on $OLD_NAME open or unknown — renamed back; that name stays"
      cur="$OLD_NAME"; NEW="$OLD_NAME"
    else
      echo "RENAME BACK FAILED — keeping $cur; refs/heads/$OLD_NAME stays, a PR may head it"
    fi
    OLD_NAME=""
  fi
fi
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
# already landed on its parent, so a force may be owed — to that case alone.
# `ls-remote` answers three ways: exit 0 and empty is a branch that is not there,
# non-zero is a remote nobody could read, and conflating them publishes blind.
if ! remote_tip="$(git ls-remote --heads "$PUSH_REMOTE" "refs/heads/$NEW" 2>/dev/null)"; then
  echo "CANNOT READ $PUSH_REMOTE"; exit 1
fi
# A lease compares against the tracking ref, so it needs one that exists and is current.
if [ -n "$remote_tip" ] \
   && ! git fetch "$PUSH_REMOTE" "+refs/heads/$NEW:refs/remotes/$PUSH_REMOTE/$NEW"; then
  echo "FETCH FAILED for $NEW — its age is unknown"; exit 1
fi
published=0
if [ -z "$remote_tip" ]; then
  git push "$PUSH_REMOTE" -u "$NEW" && published=1                 # first publication
# Full refnames: the short `<remote>/<name>` reaches a tag of that name instead.
elif git merge-base --is-ancestor "refs/remotes/$PUSH_REMOTE/$NEW" "refs/heads/$NEW"; then
  git push "$PUSH_REMOTE" -u "$NEW" && published=1                 # fast-forward
else
  # `--force-if-includes` requires the published tip to be in this branch's reflog —
  # a bare lease also passes someone else's commit, and overwrites it.
  git push --force-with-lease --force-if-includes "$PUSH_REMOTE" -u "$NEW" && published=1
fi
# Chained: a refused push followed by the delete below unpublishes the branch.
[ "$published" = 1 ] || { echo "NOT PUBLISHED — push refused for $NEW"; exit 1; }
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

Fill the two values at the top; everything under them is live, and so are
Step 1's — `PUSH_REMOTE`, `NEW` and `OLD_NAME` as that step left them.

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
- **A resolution past a trivial one is code no reviewer has read** — trivial being
  the line `slice-completion.md` draws for the same hazard. Put it through
  `hcb-dev:multi-review`, unnarrowed (a narrowing sends the security review to
  `n/a`), fix what it rates Critical or Important and push it here. A review that
  cannot run, or a finding of that weight left open, is the Autonomy model's stop:
  ask before merging, whatever authorization was threaded in.
- After a successful rebase, push with `--force-with-lease`.
- **Exception:** a branch `slice-completion.md` says to merge rather than rebase
  — read the cases there — takes the base by merge instead, and the report says
  which case it was.
- **Whether staying up to date is itself a merge gate is the base's answer, not
  this step's.** Where the base requires the branch current with it, every later
  `BEHIND` (base moved while the PR was open, including right before merge) is
  re-synced until it clears — `gh pr update-branch <pr>` does this server-side
  without a local rebase. Where it does not, no `BEHIND` is ever reported and a
  further re-sync is Step 4's call, taken on a drift it measures itself. Either
  way this step's own rebase stands: what CI reads must be the code that is going
  to land.

**Then retire what `old-name` names** — the ref the branch was published under
before `hcb-dev:shipping-workflow` step 0 renamed it — now that the new name is
up and the base is fetched. Three proofs, all required, and a proof that cannot
run keeps the ref: the name is neither this branch's nor the base's; the tip the
remote carries under it is this branch's own — in its history, or in its reflog,
which `git branch -m` carried across and a rebase leaves it in; and that tip is
not already contained in the base, since a ref carrying nothing past the base was
never a publication of this branch's work. Delete under a lease on the tip just
read, and say why wherever the ref stays — the report needs the reason.

```bash
if [ -n "$OLD_NAME" ] && [ "$OLD_NAME" != "$NEW" ] && [ "$OLD_NAME" != "$BASE" ]; then
  # Exit status kept: an empty answer means 'not there' only when the remote answered.
  if old_line="$(git ls-remote --heads "$PUSH_REMOTE" "refs/heads/$OLD_NAME" 2>/dev/null)"; then
    old_tip="${old_line%%[[:space:]]*}"
    if [ -z "$old_tip" ]; then
      echo "refs/heads/$OLD_NAME is not on $PUSH_REMOTE — nothing to retire"
    elif ! { git merge-base --is-ancestor "$old_tip" HEAD 2>/dev/null \
             || git rev-list -g "refs/heads/$NEW" | grep -qx "$old_tip"; }; then
      echo "NOT RETIRED: refs/heads/$OLD_NAME on $PUSH_REMOTE is at $old_tip, which this branch never held — someone's work; leave it and report it"
    elif git merge-base --is-ancestor "$old_tip" "$BASE_REMOTE/$BASE" 2>/dev/null; then
      echo "NOT RETIRED: refs/heads/$OLD_NAME holds nothing past $BASE — not this branch's publication; leave it and report it"
    else
      git push --force-with-lease="refs/heads/$OLD_NAME:$old_tip" "$PUSH_REMOTE" --delete "refs/heads/$OLD_NAME" \
        || echo "NOT RETIRED: the delete of refs/heads/$OLD_NAME was refused — a stale lease or a deletion rule; read the remote and report it"
    fi
  else
    echo "NOT RETIRED: $PUSH_REMOTE did not answer for refs/heads/$OLD_NAME — report it as possibly standing"
  fi
fi
```

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
  settles: the `issues` a flow upstream threaded in (`slice-completion.md`), or
  on a direct entry the ones the user names. GitHub acts on that keyword only for a PR whose base is the default
  branch, so on any other base — a slice PR onto its feature branch, a repo whose
  PRs target another trunk — the issue is closed explicitly after the merge lands
  (`hcb-dev:issue-tracking`).
- If a PR already exists, skip creation and move to the loop.

## Step 4 — The fix loop (until GitHub says mergeable)

Loop until the PR is **both mergeable by GitHub and clean by your own bar** —
every required check green, the thread-resolution requirement satisfied, and the
approval requirement met where the base carries one, plus —
always, whatever the repo does or doesn't enforce — CI genuinely green, the PR
body describing the head that is about to land
([`../../references/merge-message.md`](../../references/merge-message.md);
`gh pr edit <pr> --body "<body>"` rewrites it), and Copilot's review **of the
current head** settled — or, where its wait ran out, the addressee's word to merge
with the head unreviewed by Copilot, said in the report — its Critical/Important findings fixed on both of the
readings that carry them, every comment it left answered, and every thread it
opened resolved (`references/copilot.md`;
`references/merge-gates.md`, *When there are no gates, or they can't be
trusted*). Up to ~5 iterations, then escalate. Gates decide *permission* to
merge, your bar decides *readiness*; when they diverge, the stricter one wins —
save for the one item below, whose answer is the base's. The severity
classification only decides what you *fix*, never when you're *done*.

**Being current with base is that item.** Where the base requires it, `BEHIND` is
a gate: re-sync until it clears. Where it does not, **that enum never arrives** —
nothing is blocking the merge, so a head sitting well behind its base reads
`CLEAN` — and routing on it would skip exactly the case this paragraph is for.
Measure the drift yourself, on the two values Step 2 filled:

```bash
git fetch -q "$BASE_REMOTE" "+refs/heads/$BASE:refs/remotes/$BASE_REMOTE/$BASE" || \
  { echo "FETCH FAILED — drift unknown, do not rule the head current"; exit 1; }
# `HEAD..` is what this head has NOT absorbed, so a Step 2 rebase already moved the
# line forward: this is the window since the last re-sync, not since the branch was cut.
git rev-list --count "HEAD..$BASE_REMOTE/$BASE"   # 0 = current
git diff --name-only "HEAD..$BASE_REMOTE/$BASE"   # what moved, when it is not
```

A non-zero count is a judgement, not a gate: re-sync when what those paths carry
can break this head — the same files or modules, an interface a caller here uses,
a migration, a dependency — and merge without one when the base moved elsewhere.
Neither answer is free: a re-sync is a push, which restarts the checks and the
review; a skipped one that was needed puts the break in the base, where only
Step 6 finds it.

**The approval is the exit item no iteration of this loop produces.** Every other
one answers to a push; that one answers to a reviewer, and all a round can do is
remove reasons to withhold it. So read it before spending an iteration against it,
and read the **requirement** rather than one reviewer's verdict: a base asking for
no approval, or one already satisfied by somebody else, leaves nothing outstanding
however Copilot's own review landed.

Where the requirement *is* outstanding and the head's review has settled without
closing it, which of the two kinds of review that is
(`references/copilot.md`, *What the review lands as*) decides the step. Findings
still outstanding are this loop's work. A reviewer handing the decision to a human
is not: **stop and ask the addressee `merge-auth` names**, recommendation first,
carrying the reason the review gave and what would answer it. Another round against
that buys another review of the same kind.

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
3. **Read Copilot's findings — the threads and the review bodies both** — and
   classify them; `references/copilot.md` owns where each of the two lives and how
   to reach it.
4. **Fix the findings `references/copilot.md` routes to a fix.** Batch fixes into
   as few pushes as is reasonable — under `review_on_push` every push re-requests
   Copilot and costs
   another wait at step 6, whether or not a new review actually follows.
5. **Reply to every Copilot comment, and resolve every thread it opened** —
   `references/copilot.md` owns the reply + resolve protocol, what answers a
   finding that opened no thread, and how to tell a thread you answered from one
   the reviewer closed itself.
6. **After pushing — whichever step pushed — bring the body back to what is
   landing** (`merge-message.md`; `gh pr edit <pr> --body "<body>"`), **and wait for
   Copilot's review of the new head**: never evaluate
   exit until its verdict on the head is settled; `references/copilot.md` owns the
   wait, defines what settles it, and names the ceiling at which the wait becomes
   one of the Autonomy model's stops. Then re-read from this loop's step 1 (the
   live-state read), not the top-level Step 1.

## Step 5 — Merge (only with explicit authorization)

Merging is gated on `merge-auth` — see the Autonomy model. Once Step 4's exit is
met, the value decides:

- **`on-green`** — merge now.
- **`queued`** — report readiness to the addressee in the words it waits for
  ("green, waiting for the slot"), and hold. Green is readiness, not the slot:
  the merge is yours to take, on that addressee's go, and nothing here passes it
  to anyone else.
- **`ask`** — report that the PR is ready to merge (all required gates
  satisfied) and put the go-ahead to the addressee, with your recommendation
  first. Do not merge until it comes back.

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

## Step 6 — Monitor the merge, then the base

After issuing the merge, confirm it actually landed — what the PR reports decides
that, never the merge command's exit status:
- Merge can be queued (merge queue) or blocked by a last-second protection rule.
- Where the base requires the branch current with it, the base may have moved,
  flipping the PR to `BEHIND` — run `gh pr update-branch <pr>`, let the required
  checks re-pass, then merge again.
- Poll until the PR shows `MERGED`, or report what's blocking it.
- **On `MERGED`, wait for the base's own checks on the merge commit.** Two heads
  green apart can be red together, and where the base does not require branches
  current with it, nothing before this point reads them combined:

  ```bash
  # The PR's own repo, never gh's default — in a fork checkout that default is the
  # parent, where this SHA does not exist and every read below 404s into silence.
  # Strip the host rather than a literal one: an Enterprise instance serves its own.
  PR_URL=$(gh pr view <pr> --json url --jq '.url')
  REPO=$(printf '%s' "$PR_URL" | sed -E 's#^https?://[^/]+/##; s#/pull/.*$##')
  MERGE_SHA=$(gh pr view <pr> --json mergeCommit --jq '.mergeCommit.oid // empty')
  # Empty until the merge commit is published (a queue, a replica behind). Stop here
  # and re-poll: an empty SHA builds a URL that 404s, and a 404 prints no rows —
  # which the reading below would take for a base with nothing to run.
  [ -n "$MERGE_SHA" ] || { echo "merge commit not published yet — re-poll"; exit 1; }
  # Captured with their exit status, never piped straight out: a call that failed
  # prints no rows, exactly as a base with nothing to run does, and the two take
  # different steps.
  if ! RUNS="$(gh api --paginate "repos/$REPO/commits/$MERGE_SHA/check-runs" \
    --jq '.check_runs[] | "\(.conclusion // .status)\t\(.name)"')"; then
    echo "CANNOT READ the check-runs feed — unread, not unchecked"; exit 1
  fi
  # Checks API and the older statuses are separate feeds; an external CI posting only
  # the latter leaves the call above empty however red it is. This one answers with an
  # object, so its verdict is the rolled-up `.state` the server computes over every
  # status — take that, and read `.statuses[]` as the rows Step 7 reports in full,
  # which is why it paginates; the rollup line then repeats once per page, identically.
  if ! STATUSES="$(gh api --paginate "repos/$REPO/commits/$MERGE_SHA/status" \
    --jq '"rollup: \(.state)", (.statuses[] | "\(.state)\t\(.context)")')"; then
    echo "CANNOT READ the status feed — unread, not unchecked"; exit 1
  fi
  printf '%s\n%s\n' "$RUNS" "$STATUSES"
  ```

  Poll while any row is unfinished, on Step 4's budget and its escalation.
  **Nothing returned is not green**: a run registers after the push that triggers
  it, so an empty pair of reads right after the merge is the answer arriving, not
  the answer. A rollup of `pending` over zero statuses is that same emptiness and
  not a run in flight — the rollup says something only beside a non-empty list.
  Tell that apart from a base that runs nothing at all by reading the same two
  feeds on the commit the base carried *before* this merge — where that one has
  rows, keep polling; where it has none either, say the base is unchecked and
  that this step guaranteed nothing. A budget that runs out while this step is
  still polling — a row unfinished, or rows the commit before carried and this
  one still lacks — is not waited out, with what the feeds showed when the
  waiting stopped, empty included; and a read that did not succeed is neither of
  those — unread is not empty, and it takes the platform path above rather than
  any verdict about this base.

  **What the report claims is what these two reads saw**, never that the base is
  quiet: a check that registers after them, and one that runs for the pull
  request and not for the push that landed it, are both outside what they can
  see.

  A red row is attributed before it is owned, the way Step 4 attributes one: red
  on that previous commit too is not this merge's, and neither is a degraded forge
  (*When the platform is down, the red check is not yours*) or a known flake.
  What survives that is **this merge's**, not the next author's — report it in
  Step 7 and fix it forward on a branch cut from the base, through this skill from
  Step 1. Where the base does require branches current, this read confirms rather
  than guards — take it either way.

  **Step 7 carries what these feeds showed, whichever way it came out** — green;
  red, with every failing row and what each was attributed to; unchecked; or the
  wait stopped before the rows finished, with the state they stood at then.
  Attribution decides what you fix, never what gets reported: rows attributed
  away are still rows, and dropping them leaves a report saying the base passed.
  None of the four is inferred from the absence of the others.
- **On `MERGED`, check that every issue this PR was to close is closed.** Read the
  state of each, against its own repository where it lives in another:

  ```bash
  # Captured, never piped into the loop: a call that failed and a body the forge
  # parsed nothing out of both arrive as no rows, and the two take different steps.
  ISSUES="$(gh pr view <pr> --json closingIssuesReferences \
    --jq '.closingIssuesReferences[] | "\(.repository.owner.login)/\(.repository.name) \(.number)"')" \
    || { echo "CANNOT READ the closing references — settle the issues by hand"; exit 1; }
  if [ -z "$ISSUES" ]; then
    echo "the forge parsed no closing reference out of this body"
  else
    printf '%s\n' "$ISSUES" | while read -r ISSUE_REPO ISSUE_NUM; do
      gh issue view "$ISSUE_NUM" --repo "$ISSUE_REPO" --json state,url --jq '"\(.state)\t\(.url)"'
    done
  fi
  ```

  That list is what the forge parsed out of the body, not what the work settles —
  read it against the `issues` threaded in, which are what this PR set out to
  close. On a direct entry with none threaded, the body's own keywords are the
  list — and where this PR's base is not the default branch, a claim to put to
  the user before anything is closed, never a list to close on: a slice's request
  onto a feature branch is where a set's issue gets closed early. Close what is
  still open explicitly (`hcb-dev:issue-tracking`); carry into Step 7 what stays
  open.
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

1. **Copilot's verdict on the head that merged** — the state its review of that
   head actually carries, and the effort level each of its runs reported.
   `references/copilot.md` owns where both are read from, what an unread level
   means, and what this line says when that head carries no review at all or more
   than one — including the case where the reference ruled Copilot out of this
   repo's flow, which is said here instead of a verdict.
2. **The base's own checks on the merge commit**, as Step 6 read them — green,
   over the rows those reads actually saw; red, with every failing row and what
   each was attributed to (this merge's, the commit before it, a degraded forge,
   a known flake); unchecked, with what that left unguaranteed; or not waited
   out, with the state at the moment the waiting stopped. Under an orchestrator this line is the `base_checks` its
   completion carries onward (`slice-completion.md`).
3. **Additional findings from this session**, grouped by category (e.g.
   Security, Correctness, Performance, Maintainability, Tests) — the
   lower-severity items you deliberately skipped during the loop. Each goes through
   [`../../references/findings.md`](../../references/findings.md), as
   the late review's findings above do. Where nothing called this driver, this
   report ends the session and that reference says what ends there; under an
   orchestrator it ends a slice, and the run's own report is the end.
4. **Issues this PR was to close**, at the state Step 6 read — closed, or still
   open and what closing one now waits on.
5. **Suggested next steps** — tech debt to track, tests to add, or related work
   that surfaced.

Keep it scannable: short grouped bullets, not an essay.

## Reference files

- [`references/merge-gates.md`](references/merge-gates.md) — read it before Step 2.
- [`references/copilot.md`](references/copilot.md) — read it before Step 4, and
  again before Step 7.
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
