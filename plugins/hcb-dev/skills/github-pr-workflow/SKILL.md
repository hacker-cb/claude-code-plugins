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

Take committed work on a feature branch and drive it to a merged PR, autonomously where safe.
The user may enter at any stage — just-finished code, or an already-open PR; detect which and
pick up from there. `hcb-dev:shipping-workflow` sits upstream and hands off here in **request**
mode: finished work with no local review yet goes there first, since this skill starts at the
PR, past the local review and its coverage gate. GitHub-specific by design; which driver a forge
routes to is [`../../references/slice-completion.md`](../../references/slice-completion.md)'s.
**Paths**, substituted at invocation — use verbatim: `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}`.

## Autonomy model

Autonomous, without asking: renaming the branch, rebasing onto base, pushing (with
`--force-with-lease`, never plain `--force`), opening the PR, setting its labels and those of the
issues it closes ([`../../references/label-lifecycle.md`](../../references/label-lifecycle.md)),
committing and pushing fixes, replying to Copilot and the one request of its own
[`references/copilot-request.md`](references/copilot-request.md) allows, reading state, and
parking the run on a platform outage — each narrated in a line as you go.

**Merging is the one action this skill never takes on its own authority.** `merge-auth` — a
value and the addressee it names — governs it, and `slice-completion.md` owns the three values
and the order deciding which is in force. Never merge on your own initiative.

Stop and ask that addressee when the required gates will not go green inside Step 4's
budget; when a Critical or Important finding needs a product or design decision you cannot
make; when a standing approval would be spent to fix a `Minor` nothing else is pushing; when
a Copilot review this driver waits for never posted and the wait ran out — merging past an
unreviewed head is the addressee's call; when the merge strategy is genuinely ambiguous;
when whether the branch may be rebased at all cannot be read (`slice-completion.md`), though
a branch that reference says to *merge* is merged and noted rather than asked about; and
when a stop outranking an authorization applies, Step 2's unreviewed rebase among them.
Half of those turn on neither the diff nor the code, and a reason invented to look
code-shaped is worse than the bare question it replaced
([`../../references/architecture-decisions.md`](../../references/architecture-decisions.md)).

**Reading order.** A forge MCP server where one is connected, `gh` otherwise, `gh api` for
what the porcelain does not cover. Plain `git` does the local work.

## Step 1 — The name it ships under, and putting it on the remote

[`../../references/branch-naming.md`](../../references/branch-naming.md) owns the shape a name
takes and where a rename is refused;
[`../../scripts/branch-publish.mjs`](../../scripts/branch-publish.mjs) owns the mechanics and
the contract of the answers below. The rename is often a no-op and **the publish never is**:
without it Step 3's `--head` finds no ref. Which remote it pushes to, and which base an old ref
is judged against, are
[`../../references/base-resolution.md`](../../references/base-resolution.md)'s — one call
answers both, **before** the rename, since the push remote is read under the name the branch
carries now, and it fetches the base for Step 2 as it goes.

```bash
BASE_JSON="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-base.mjs" \
  --base "<the base: the one named, else the one base-resolution.md's ladder settled>")"
PUSH_REMOTE="<.remotes.push>"; BASE_REMOTE="<.base.remote>"; BASE="<.base.name>"
NEW="<the name from branch-naming.md — MAY equal the current one>"
OLD_NAME="<the bare old-name shipping-workflow step 0 threaded in — empty where none>"

node "${CLAUDE_PLUGIN_ROOT}/scripts/branch-publish.mjs" --new "$NEW" \
  ${OLD_NAME:+--old-name "$OLD_NAME"} --publish --push-remote "$PUSH_REMOTE" \
  --base "$BASE" --base-remote "$BASE_REMOTE"
```

Run and read it per [`../../references/branch-publish.md`](../../references/branch-publish.md):
`published` anything but `true` stops the run — a `null` once the re-run it names leaves it so;
every step below uses `branch.ships`, and a `stale` entry `kept` or `unknown` goes in the report.

## Step 2 — Bring the branch up to date with base

**First read what the base this PR targets enforces** — every time, never carrying over what
another base, another repository, or a check's name there required. A feature branch often
carries no rules at all, leaving Step 4's bar the only one: a reading, never a presumption.
[`references/merge-gates.md`](references/merge-gates.md) owns how they are read and what each
signal means, and one answer from it — whether this base requires the branch current with it —
is routed on by Steps 2, 4 and 6 alike. **Gates are a floor, never a ceiling**, and a bypass is
not a pass.

Then rebase, and per [`../../references/base-delta.md`](../../references/base-delta.md) read what it
and each re-sync brought. **`base.current` from Step 1's call is the condition of this rebase, not a
step before it** — anything else is a ref of unknown age, which rebases "up to date" here and
reports `BEHIND` at merge time. Re-run that call where it is not; where it still is not, stop.

```bash
git rebase --autostash "<.base.ref, on a .base.current of true>"
```

- Resolve trivial conflicts yourself; one that needs a real decision is a stop. **A resolution
  past a trivial one is code no reviewer has read** — trivial being the line
  `architecture-decisions.md` §1 draws — so put it through `hcb-dev:multi-review` unnarrowed, fix
  every Critical and Important no check refuted, push here; a review that cannot run, or such a
  finding left open, is a stop.
- After a successful rebase, push with `--force-with-lease`.
- **Exception:** a branch [`../../references/feature-branch.md`](../../references/feature-branch.md)
  says to merge rather than rebase takes the base by merge, and the report says which case it was.
- **Whether staying up to date is itself a merge gate is the base's answer, not this
  step's** (`references/merge-gates.md`): where it is, every later `BEHIND` is re-synced with
  `gh pr update-branch <pr>` until it clears, each one's points taken on the fetched head before
  it. Either way this rebase stands — what CI reads must be the code that is going to land.

## Step 3 — Open the PR (if not already open)

An open PR for this branch is not recreated — skip to the loop. Otherwise create one **ready
for review**, never draft ([`references/copilot.md`](references/copilot.md) says what a draft
costs), titled in `branch-naming.md`'s shape, its body per
[`../../references/merge-message.md`](../../references/merge-message.md), and carrying the labels
`label-lifecycle.md` gives it — the script's `wrote` read as that file says, never its exit status:

```bash
# Title, body and label names are files the agent wrote — data, never pasted into this line.
T="<title file>"; B="<body file>"; A="<the file of label names — a JSON array — per label-lifecycle.md>"
URL="$(gh pr create --base <base> --head <branch> --title "$(cat "$T")" --body-file "$B")" \
  && printf '%s\n' "$URL" && node "${CLAUDE_PLUGIN_ROOT}/scripts/label-write.mjs" --url "$URL" --add "$A" \
  | jq -e '., .wrote == true'   # the exit is 0 whatever landed: `wrote` is the answer
```

## Step 4 — The fix loop (until GitHub says mergeable)

Loop until the PR is **both mergeable by GitHub and clean by your own bar**, up to ~5
iterations, then escalate. Gates decide *permission* to merge, your bar decides *readiness*;
where they diverge the stricter wins. Severity decides what you *fix*, never when you are
*done*. The bar, whatever the repo enforces: every required check green and CI genuinely
green; the base's own review and thread requirements met (`references/merge-gates.md`); the PR
body describing the head about to land (`merge-message.md`, rewritten with `gh pr edit <pr>
--body-file <file>`), and its labels too where `label-lifecycle.md` says they hold it; and every Copilot review **this driver waits for** settled
with its Critical and Important findings fixed, its comments answered and its threads resolved — or,
where a wait ran out, the addressee's word to merge with the head unreviewed, said in the report.

**Two exit items no round of this loop closes** — the drift, where the base does not require the
branch current with it, and the approval — are
[`references/merge-gates.md`](references/merge-gates.md)'s: it owns what each asks here, and when
either becomes a stop.

1. **Read the live state** — four scripts, one question each, none by hand:

   ```bash
   # Re-resolving STOPS the drift read where the base cannot be refreshed: an older tracking ref
   # answers `behind: 0`, which THIS answer is what rules out. The base is read, never pasted.
   BASE_JSON="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-base.mjs" \
     --base "$(gh pr view <pr> --json baseRefName --jq .baseRefName)")"
   BASE_REF="$(printf '%s' "$BASE_JSON" | jq -r 'if .base.current then .base.ref else "" end')"
   node "${CLAUDE_PLUGIN_ROOT}/scripts/pr-state.mjs" --pr <pr> ${BASE_REF:+--base-ref "$BASE_REF"}
   node "${CLAUDE_PLUGIN_ROOT}/scripts/commit-checks.mjs" --pr <pr> --sha head --require-from-gates
   node "${CLAUDE_PLUGIN_ROOT}/scripts/copilot-state.mjs" --pr <pr>
   node "${CLAUDE_PLUGIN_ROOT}/scripts/copilot-findings.mjs" --pr <pr>
   ```

   Route on `pr-state.mjs`'s `blockers` and `drift`, on `commit-checks.mjs`'s `verdict`
   (`references/merge-gates.md`), and on the two Copilot answers per `references/copilot.md` and
   [`references/copilot-findings.md`](references/copilot-findings.md). `mayMerge` is
   **permission**, never readiness.
2. **A required check red:** read the failing job's logs and fix the root cause — don't
   guess. Not every red one wants a code change: one standing in for a review waits on the
   review or on unresolved threads, and one red or stuck because the forge is degraded wants
   none at all — attribute it before touching code, and park the run on the platform where it
   owns the failure ([`references/platform-status.md`](references/platform-status.md)).
   Through an outage, change nothing, spend no iteration on it, and **never merge past it**:
   a check red because the platform is red is no non-required check you may deem irrelevant
   (`UNSTABLE`), and one that never started is no check that passed.
3. **Take the Copilot round from its two references.** `copilot.md` owns which reviews this driver
   waits for before the exit above is evaluated, and what a review that did not approve asks for;
   `copilot-findings.md` owns the readings, the ladder, the pushes and the reply protocol.
4. **Re-read from this loop's step 1**, not the top-level Step 1 — and after any push, bring the
   body back to what is landing first (`merge-message.md`), and the labels per `label-lifecycle.md`.

## Steps 5 to 7 — merge, watch it land, report

Once Step 4's exit is met, [`references/landing.md`](references/landing.md) owns the rest and is
read before the merge is issued: the strategy `merge-auth` authorises and the repo allows,
confirming the merge landed, the base's own checks on the merge commit, the issues this PR was
to close, retiring both refs, and the report that ends the run.

## Reference files

Each is linked at the step that reads it; these four are not any one step's.
[`../../references/invariants.md`](../../references/invariants.md) — once, before the first read
of anything a tool, a forge or another session answers.
[`../../references/forge-behaviour.md`](../../references/forge-behaviour.md) — before acting on
any check, rollup or merge setting the forge reports.
[`../../references/architecture-decisions.md`](../../references/architecture-decisions.md) —
before the first stop, not at it.
[`../../references/forge-docs.md`](../../references/forge-docs.md) — before writing an invocation
this skill does not already spell out.
