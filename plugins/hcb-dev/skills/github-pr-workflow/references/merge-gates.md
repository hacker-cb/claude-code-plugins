# The merge gates of a GitHub repository

Read by `hcb-dev:github-pr-workflow` before its fix loop, which routes on the
values below. It sits outside the skill because none of it is read on a run whose
gates go green.

Resolve anything here that this file does not spell out per
[`../../../references/forge-docs.md`](../../../references/forge-docs.md).

## Read the rules behind the signals

The skill's two live signals give the verdict; these give the why:

```bash
# The per-branch view, NOT a plain /rulesets listing: it has
# already applied each ruleset's ref_name conditions and includes org-level rulesets.
gh api repos/{owner}/{repo}/rules/branches/<base>              # rules in force on the base
gh api --paginate repos/{owner}/{repo}/rulesets --jq '.[].id' \
  | xargs -I% gh api repos/{owner}/{repo}/rulesets/%           # -I%, not -I{}: gh's own placeholders are braces too
gh api repos/{owner}/{repo}/branches/<base>/protection 2>/dev/null || true  # classic (NOT in /rulesets)
```

`mergeStateStatus` names exactly what's missing (the GraphQL enum is `BEHIND`,
`BLOCKED`, `UNSTABLE`, `DIRTY`, `UNKNOWN`, `HAS_HOOKS`, `CLEAN` — there is no
`DRAFT` value; a draft PR reads `BLOCKED`, and you detect draftness via the
separate `--json isDraft`):

| status | meaning | what to do |
|---|---|---|
| `BEHIND` | branch not up to date with base — reported **only** where the base requires it | a gate: re-sync (Step 2). Where the base does not require it, a head far behind reads `CLEAN` instead and this row never fires; the drift is Step 4's to measure and judge |
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
| `required_status_checks` | `required_status_checks[].context`, `strict_required_status_checks_policy` | every listed context must go green. Treat the names as **opaque** — the repo chooses them, and what any one check stands for is its own business. `strict` additionally means the branch must be current with base (Step 2) — read it from the per-branch view above, never from a repo-wide assumption, since one repo's bases differ. That view returns no classic protection, so an empty answer is not yet `false`: read `branches/<base>/protection` for `required_status_checks.strict` before ruling the requirement absent. Where it genuinely is off, no pre-merge signal reads two heads combined — and `BEHIND` is not reported at all — so Step 4 measures the drift itself and Step 6 watches the base. |
| `pull_request` | `required_review_thread_resolution`, `allowed_merge_methods`, `required_approving_review_count`, `dismiss_stale_reviews_on_push`, `require_code_owner_review`, `require_last_push_approval` | thread resolution `true` means *every* thread must end resolved, not just the severe ones. Merge methods: pick from the allowed set only (Step 5). Approvals are often 0; if >0, `reviewDecision` answers for the aggregate and not for any one reviewer — `REVIEW_REQUIRED` while they are missing, `CHANGES_REQUESTED` for as long as a rejection stands, whatever the approval count says — and where the repo counts Copilot's approval, one of the approvals can be Copilot's ([`copilot.md`](copilot.md)). The count is not the whole gate: `require_code_owner_review` wants one of them from a code owner, and `require_last_push_approval` one that postdates the last push, so a satisfied number still reads `REVIEW_REQUIRED` while either is outstanding. |
| `copilot_code_review` | `review_on_push`, `review_draft_pull_requests` | Copilot is in this repo's flow. These parameters govern the *request*; whether its review can approve is a setting no rule here carries — `copilot.md` owns both. |
| `deletion`, `non_fast_forward` | — | the matched branches can't be deleted or force-pushed. Affects Step 1's rename and Step 6's retirement when they touch a protected ref. |

Anything the rules don't cover, the live signals still do: `gh pr checks` is the
final word on which contexts are required, whatever produced them.

### When there are no gates, or they can't be trusted

A repo with no *enforced* gates reports `CLEAN` the instant the PR opens — that
means "GitHub won't stop you," not "the work is ready."

The bypass the skill forbids merging on is `current_user_can_bypass` other than
`never`, or your presence in a rule's `bypass_actors` — satisfy the gates as if
you could not. An `evaluate` or `disabled` ruleset is advisory in the same way: it
appears in the API and blocks nothing.

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
