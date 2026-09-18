# Merging, watching it land, and the report

Read by `hcb-dev:github-pr-workflow` once its fix loop has exited, and before the merge is
issued. It sits outside the skill because a run that stops at ready — the common one, and
what every `ask` and `queued` authorization produces — reads none of it.

Resolve anything here that this file does not spell out per
[`../../../references/forge-docs.md`](../../../references/forge-docs.md).

## Step 5 — Merge, only with explicit authorization

`merge-auth` decides, and the skill's Autonomy model owns where its value comes from:
**`on-green`** merges now; **`queued`** reports readiness to the addressee in the words it
waits for ("green, waiting for the slot") and holds, the merge staying yours to take on that
addressee's go and passing to nobody else; **`ask`** reports that the PR is ready to merge
and puts the go-ahead to the addressee, recommendation first, merging only when it returns.

Then the strategy. One threaded in from the planning gate wins, and every choice is
**filtered to the repo's allowed merge methods** — a disallowed one is rejected, so fall back
within the allowed set and say so. Absent a threaded strategy:

- **A PR whose base is a feature branch is a slice, and a slice always squashes** — one
  commit — regardless of the gate's `merge-strategy`, which governs the final `feature →
  base` integration PR only;
  [`../../../references/slice-completion.md`](../../../references/slice-completion.md) owns
  that topology. The choices below are that final PR's, or a standalone single one's.
- **Squash** (`gh pr merge --squash`) — the default, for a single logical feature or fix.
  Pass the commit's body yourself (`--body`, or `--body-file`), written per
  [`../../../references/merge-message.md`](../../../references/merge-message.md). Read
  `squash_merge_commit_title` before assuming the PR's title reaches the subject
  ([`../../../references/forge-behaviour.md`](../../../references/forge-behaviour.md)); where
  the subject has to be passed (`--subject`),
  [`../../../references/branch-naming.md`](../../../references/branch-naming.md) owns what
  may go in one.
- **Merge commit** (`gh pr merge --merge`) — where the PR carries several distinct features
  whose individual history is worth keeping.
- Rebase-merge the only fit but disallowed, or the choice genuinely ambiguous: ask.

**Merge, and nothing else** — never `--delete-branch`. Both refs retire below, on the
confirmed merge.

## Step 6 — Watch it land, then watch the base

What the PR reports decides whether the merge landed, never the merge command's exit status.
It can be queued (merge queue) or blocked by a last-second rule; where the base requires the
branch current with it, the base may have moved, flipping the PR to `BEHIND` — run `gh pr
update-branch <pr>`, let the required checks re-pass, merge again. Poll until the PR shows
`MERGED`, or report what is blocking it.

### The base's own checks on the merge commit

Two reads, the base's own tip first: it answers what the merge commit alone cannot — what
this base runs on a push at all, and which of it to wait for.

```bash
# Quoted as one word at every use: the plugin root is a path like any other and may
# carry spaces, and unquoted, `node` is handed its first segment.
CHECKS="<plugin root>/scripts/commit-checks.mjs"
BEFORE="$(node "$CHECKS" --pr <pr> --sha base  --require-from-gates)" \
  || echo "CALLED WRONG: $BEFORE"
AFTER="$( node "$CHECKS" --pr <pr> --sha merge --require-from-gates)" \
  || echo "CALLED WRONG: $AFTER"
```

[`merge-gates.md`](merge-gates.md) owns what those verdicts ask of this step. A red row is
attributed before it is owned, the way the fix loop attributes one: red on `BEFORE` too is
not this merge's, and neither is a degraded forge ([`platform-status.md`](platform-status.md))
or a known flake. What survives that is **this merge's**, not the next author's — report it
and fix it forward on a branch cut from the base, through the skill from its Step 1.

**The report carries what these reads showed, whichever way it came out** — green; red, with
every failing row and what each was attributed to; unchecked; or the wait stopped before the
rows finished, with the state they stood at then. Attribution decides what you fix, never
what gets reported: rows attributed away are still rows, and dropping them leaves a report
saying the base passed. None of the four is inferred from the absence of the others.

### The issues this PR was to close

Read the state of each, against its own repository where it lives in another:

```bash
# Captured, never piped into the loop: a call that failed and a body the forge
# parsed nothing out of both arrive as no rows, and the two take different steps.
ISSUES="$(gh pr view <pr> --json closingIssuesReferences \
  --jq '.closingIssuesReferences[] | "\(.repository.owner.login)/\(.repository.name) \(.number)"')" \
  || { echo "CANNOT READ the closing references — settle the issues by hand"; exit 1; }
[ -n "$ISSUES" ] || echo "the forge parsed no closing reference out of this body"
printf '%s' "$ISSUES" | while read -r ISSUE_REPO ISSUE_NUM; do
  gh issue view "$ISSUE_NUM" --repo "$ISSUE_REPO" --json state,url --jq '"\(.state)\t\(.url)"'
done
```

That list is what the forge parsed out of the body, not what the work settles — read it
against the `issues` threaded in, which are what this PR set out to close. On a direct entry
with none threaded, the body's own keywords are the list — and where this PR's base is not
the default branch, a claim to put to the user before anything is closed, never a list to
close on: a slice's request onto a feature branch is where a set's issue gets closed early.
Close what is still open explicitly (`hcb-dev:issue-tracking`); carry what stays open into
the report.

### Retiring both refs

[`../../../references/branch-retirement.md`](../../../references/branch-retirement.md) owns
when a ref may go. The reading is the script's; the acting is this step's:

```bash
if RETIRE="$(node "<plugin root>/scripts/retire-check.mjs" \
    --branch "<branch>" --pr <pr> --push-remote "<push-remote>")"; then
  printf '%s\n' "$RETIRE"   # the whole answer — a projection hides the field the
                            # next action needs, and the lease is one of them
else
  # A non-zero exit carries usage text, not JSON. Feeding it to `jq` prints a parse
  # error where the step needs a refusal, which reads as nothing having been said.
  echo "CALLED WRONG: $RETIRE"
fi
```

Each side acts only on its own verdict — `deleteLocal`, `deleteRemote` — and the remote
deletion leases against `request.headRefOid`. Every `false` carries its `blockers` into the
report: a ref that stayed is a line there, never a silence.

## Step 7 — Report

Check once more for a late review: any Copilot review still outstanding — of the merged head,
or of an earlier commit — can post *after* the merge, orphaning its findings on the
now-closed PR. Surface such findings and recommend a follow-up; creating one is an outward
action the user authorises
([`../../../references/findings.md`](../../../references/findings.md) owns that protocol, and
the classification is `hcb-dev:issue-tracking`'s).

Then a short report, scannable — grouped bullets, not an essay:

1. **The gates the base enforces, and how each was met at the merge**: required checks,
   approvals, thread resolution, whatever else the base carries; a base with none says so.
   Copilot's line among them is its review of the head that merged and the state that review
   carries — or, where that head has none, the commit the last review covered and why
   ([`copilot.md`](copilot.md)).
2. **The base's own checks on the merge commit**, in whichever of the four shapes above came
   out. Under an orchestrator this line is the `base_checks` its completion carries onward
   (`slice-completion.md`).
3. **Additional findings from this session**, grouped by category (Security, Correctness,
   Performance, Maintainability, Tests) — the lower-severity items the loop deliberately
   skipped. Each goes through `findings.md`, as the late review's findings do. Where nothing
   called this driver, this report ends the session and that reference says what ends there;
   under an orchestrator it ends a slice.
4. **Issues this PR was to close**, at the state read above — closed, or still open and what
   closing one now waits on.
5. **Suggested next steps** — tech debt to track, tests to add, related work that surfaced.
