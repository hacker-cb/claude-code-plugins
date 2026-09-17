# What a forge actually does — signals, and where each one lies

Read wherever a skill acts on what a forge reports. Every row is a behaviour that
cannot be derived from a document or guessed from a field name: it was measured, and
the measurement is what the row carries.

[`invariants.md`](invariants.md) says how to read any signal. This file says what
these particular signals do. A new measurement is a **row**, never a paragraph
somewhere else — that is what keeps this knowledge from being rewritten five ways in
five files.

GitHub unless a row says otherwise. Where GitLab has a counterpart, the row names it;
where a row is unmeasured on GitLab, it says so rather than implying symmetry.

## Checks and their aggregate

| signal | what it actually is | measure instead | where it does not apply |
|---|---|---|---|
| "every check on the head has finished" | true before the run is over. Checks register in waves — one measured head had them start at `19:34:16`, `19:34:27`, `19:35:37` and `19:42:06` — so a moment with none running is ordinary, not final | the named aggregate the base requires, plus `mergeStateStatus` | a base that runs no aggregate: there the count is what there is, and the report says the guarantee is weaker |
| the aggregate check itself | **born last, after the others finish.** Measured: the aggregate started at `19:42:06`, three seconds after the last of the other nineteen completed at `19:42:03`. At the instant "all finished" became true, it did not exist | wait for it by name, not for the count to settle | — |
| the `commits/<sha>/status` feed | **a second feed, not a view of the first.** It carries the older commit statuses, which an external CI may post to and nothing else does — so a reader of `check-runs` alone is blind to it however red it is | read both, and keep them apart | — |
| that feed's `state` | **`pending` over an empty list is its EMPTY answer, not a run in flight.** Measured on seven commits across four repositories, every one of them with all `check-runs` completed: `"state": "pending", "statuses": []` | the rollup only beside a non-empty list; a poll on `.state` alone never exits | a commit that genuinely carries statuses |
| a check-run's `name` | **not unique on a commit.** Measured: one merge commit carried 22 runs over 13 distinct names — four names three times each and one twice, one leg of a matrix apiece. Keyed by name, 9 of the 22 collapse into a row already counted and go unread | key by `id`; report by name | — |
| the set of checks on a merge commit | **not the set the head carried.** Measured on one pull request: the head ran 9, the merge commit 22 — the extra fourteen from audit and dependency workflows scoped to a push, which no pull request triggers. The reviewer's own check goes the other way and is absent there | read the merge commit's own feeds after the merge lands, and the commit before it to learn what this base runs on a push at all | a base whose workflows all run on pull requests too |
| `statusCheckRollup` on the pull request | **not the set on the head.** Measured across two repositories: the head carried one check the rollup never showed, and the difference was always `copilot-pull-request-reviewer` | the head's own `check-runs` feed for completeness; the rollup for what gates the merge | a pull request no reviewer was requested on — there the two agree |

A check living outside the rollup has no moment at which "every check finished" holds
while the review is open. That is a property of the **pull request**, not of a commit:
where there is no request standing, the count does have a moment of truth.

## Merging

| signal | what it actually is | measure instead |
|---|---|---|
| `squash_merge_commit_message` | **`COMMIT_MESSAGES` is the default, and it was in force in all five repositories measured** — the landing commit's body becomes the branch's whole history glued together, the review rounds included, and no edit afterwards changes what landed | pass the body explicitly (`--body` / `--body-file`); [`merge-message.md`](merge-message.md) owns what it says |
| `squash_merge_commit_title` | disagrees between repositories about whether the pull request's title reaches the commit at all — `PR_TITLE` and `COMMIT_OR_PR_TITLE` both measured in the same set | read the setting, or pass `--subject` |
| `git branch -d` | **tests containment against the branch's upstream, not against the branch you merged into.** Measured after a squash merge: it deleted the branch, saying so out loud — `deleting branch 'feature' that has been merged to 'refs/remotes/origin/feature', but not yet merged to HEAD` | the forge's record: the request is merged and its `headRefOid` is contained in the target ([`branch-retirement.md`](branch-retirement.md)) |
| a ref-level containment check after a squash | **never passes.** Squash writes a new commit, so `merge-base --is-ancestor` answers no and `branch --merged` omits the branch, however completely the work landed | the same forge record |
| `gh pr list --head <branch>` | **a branch NAME, matched across every head repository, forks included.** Measured on `nodejs/node`: `--head main` answered with six open requests whose heads live in six different owners' forks. A second request on *this* ref is told apart only by identity — `headRepository` on both the request and the listing | compare `headRepository.id`, or `nameWithOwner` where no id is given, and treat a listing that carries neither as unknown rather than as a difference |
| `--paginate` | **the two CLIs answer it oppositely.** `gh` prints one JSON document per page, concatenated — parsed as one document that is a syntax error, and as the first page it silently IS the first page. `glab` merges every page into one array, which its own help states. A reader written for either fails on the other | split `gh`'s output on brace depth; parse `glab`'s as one array |
| `merge_commit_sha` on `/commits/<sha>/pulls` | **returned, and not in the endpoint's documented response schema** — measured on a live request, where `merged_at` is documented and this is not. It is what a containment proof needs, so its absence has to read as *no proof* rather than as an error | take it where it is there, and fall back to the request being unproven where it is not |

## Review

| signal | what it actually is |
|---|---|
| the size of a change | **does not predict the automated reviewer's verdict.** Measured over 16 merged pull requests: 3717 lines across 4 files was approved, 709 lines across 11 files was approved, and 686 lines across 10 files was not. Two changes of nearly equal size and shape, different answers |
| a pull request with no reviewer verdict | may carry no request at all rather than a withheld one — measured on four pull requests whose base was a feature branch, which carried no `copilot_code_review` rule and no reviews |
| `requested_reviewers`, and `gh pr view --json reviewRequests` | **empty from the moment a review request registers until its review posts** — both read the same field, so a wait armed on either never fires. The timeline is where a standing request is legible |
| `dismiss_stale_reviews_on_push` | **unmeasured here, and the claim it is usually written with is untested.** The distinguishing case — a push that changes no diff, with an approval standing — did not occur in 60 merged pull requests across four repositories, though 13 of them force-pushed. Read what the pull request reports rather than predicting from the setting |

## Issues and their vocabulary

| signal | what it actually is |
|---|---|
| a native issue-type field | **GitHub's belongs to organisation-owned repositories and holds one type per issue; GitLab's configurable work item types are a paid-tier feature configured on the top-level group.** What the installed CLI's `issue` commands carry of either is its `--help`'s to say, and a flag naming the type an issue is merely filed under is not this value, whatever it is called |
| a `404` from a type-definitions endpoint | **the same answer whether the feature is absent or invisible to this token.** Absent only once something else confirms the token reaches this repository — and say which of the two you concluded |
| label cardinality | **GitHub enforces none of it.** GitLab enforces one-value-per-key for `key::value` labels on a paid tier only, and by *replacing* the sibling rather than refusing the new one, splitting the key at the **last** `::`. Probe for it rather than assuming it |
| a label name the caller did not just read | **created, on GitLab**, so a typo joins the set permanently; on GitHub labels passed while creating or updating an issue are dropped in silence where the caller has no push access. Confirm the labels that came back, not the exit status |
| a `404` on an issue's comment feed | **an answer, not a silence.** Measured on both: `gh: Not Found (HTTP 404)` and `glab: 404 Not found (HTTP 404)` — the issue is not there, which a caller fixes by correcting the coordinate rather than retrying. It is also what either forge answers where the token cannot see the issue, and the two are indistinguishable from outside |
| a GitLab label listing | carries the group's **inherited** labels, which apply, and **archived** ones, which do not |

## Limits

| limit | how it announces itself | what to do |
|---|---|---|
| a comment body's maximum | by refusing the write, never by a field. Measured once at 65536 characters on GitHub | check the size before writing and archive ahead of it; keep handling the refusal as the backstop. GitLab's own limit is unmeasured |

## Status feeds

Where a forge publishes whether it is itself up, and in what shape. Read by
`scripts/platform-status.mjs`, which takes the whole url — **no default**, since a host
written into the plugin would be identifying a forge by its hostname.

| feed | what it actually is | where it does not apply |
|---|---|---|
| GitHub's | Statuspage, at `https://www.githubstatus.com/api/v2/summary.json`. One object carrying `components[]`, `incidents[]` and `scheduled_maintenances[]`; a component is up when `status` is the literal `operational` | — |
| GitLab's | **not Statuspage.** Measured 2026-09-17: `status.gitlab.com` serves a status.io page, and `/api/v2/summary.json` under it answers **404**. The document is `https://api.status.io/1.0/status/5b36dc6502d06804c08349f7`, shaped `result.status[]` with `result.incidents[]` and `result.maintenance.active[]` beside it | — |
| status.io's own "up" | a **numeric** `status_code`, where `100` is operational. The `status` string beside it is what the page renders — measured `Operational` on every component of one instance — and it is not the value to compare: a feed wording it differently reads as down | a document carrying no `status_code`, where the string is all there is |
| a Statuspage base url with no document under it | **200 and an HTML page**, not a 404. Measured on `https://www.githubstatus.com/api/v2` | — |
| Statuspage's `components.json` | the components and **neither** the incidents nor the maintenances. Every component can read `operational` there while an incident is open, so the document says nothing about one | — |

The 200-with-HTML row is why a successful answer that is not a feed is a **stop** rather
than a retry: the typo answers 200 forever, and a loop treating every non-feed body as
"ask again later" never ends. The `components.json` row is the same failure one step in —
a document that IS JSON, in the right shape, and still cannot say the platform is up.

Outside 2xx the split is by what waiting could change: a 5xx, a 408 and a 429 retry;
every other 4xx and every 3xx stops, since the document is not there, not ours to read,
or behind a redirect this deliberately does not follow.

## What is not here

A number nobody measured, and a behaviour that a document asserts but no run
confirmed. Where a row would need either, the row says it is unmeasured — an
unmeasured row is a question someone can answer later, while a confident one that was
never checked is a wrong answer nobody will question.
