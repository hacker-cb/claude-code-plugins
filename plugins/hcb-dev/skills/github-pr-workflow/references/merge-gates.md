# Reading a repository's merge gates

Lookup for `github-pr-workflow`'s discovery step: what the typed rules mean once you
have them in front of you, and how to tell a gate that is real from one that only
looks like it. The rule these serve — gates are a floor, never a ceiling — is in the
skill body, where it applies on every loop iteration.

## Read the rules, not a checklist of names

Rulesets express gates as **typed rules**; classic protection expresses the same
ideas under its own keys. Map whichever rules you find onto work — and presume
none of them are present until you've read them:

| ruleset rule | parameters that matter | what it means for you |
|---|---|---|
| `required_status_checks` | `required_status_checks[].context`, `strict_required_status_checks_policy` | every listed context must go green. Treat the names as **opaque** — the repo chooses them, and what any one check stands for is its own business. `strict` additionally means the branch must be current with base (Step 2). |
| `pull_request` | `required_review_thread_resolution`, `allowed_merge_methods`, `required_approving_review_count`, `dismiss_stale_reviews_on_push` | thread resolution `true` means *every* thread must end resolved, not just the severe ones. Merge methods: pick from the allowed set only (Step 5). Approvals are often 0; if >0, `reviewDecision` reads `REVIEW_REQUIRED` and merge waits on a human. |
| `copilot_code_review` | `review_on_push`, `review_draft_pull_requests` | Copilot review is part of this repo's flow — automatically **requested**, but gating nothing on its own (it lands as a `COMMENTED` review), so its findings are your bar rather than GitHub's. `review_on_push` re-*requests* Copilot on every push — usually, but not always, producing a new review, so confirm one landed for the current head instead of assuming it. Drafts are skipped unless `review_draft_pull_requests`. See [`copilot.md`](copilot.md). |
| `deletion`, `non_fast_forward` | — | the matched branches can't be deleted or force-pushed. Affects Step 1's rename and Step 5's `--delete-branch` when they touch a protected ref. |

Anything the rules don't cover, the live signals still do: `gh pr checks` is the
final word on which contexts are required, whatever produced them.

## When there are no gates

Read the gates, then judge whether they are real:

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
  ([`copilot.md`](copilot.md)).
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

