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

## Review

| signal | what it actually is |
|---|---|
| the size of a change | **does not predict the automated reviewer's verdict.** Measured over 16 merged pull requests: 3717 lines across 4 files was approved, 709 lines across 11 files was approved, and 686 lines across 10 files was not. Two changes of nearly equal size and shape, different answers |
| a pull request with no reviewer verdict | may carry no request at all rather than a withheld one — measured on four pull requests whose base was a feature branch, which carried no `copilot_code_review` rule and no reviews |
| `dismiss_stale_reviews_on_push` | **unmeasured here, and the claim it is usually written with is untested.** The distinguishing case — a push that changes no diff, with an approval standing — did not occur in 60 merged pull requests across four repositories, though 13 of them force-pushed. Read what the pull request reports rather than predicting from the setting |

## Limits

| limit | how it announces itself | what to do |
|---|---|---|
| a comment body's maximum | by refusing the write, never by a field. Measured once at 65536 characters on GitHub | check the size before writing and archive ahead of it; keep handling the refusal as the backstop. GitLab's own limit is unmeasured |

## What is not here

A number nobody measured, and a behaviour that a document asserts but no run
confirmed. Where a row would need either, the row says it is unmeasured — an
unmeasured row is a question someone can answer later, while a confident one that was
never checked is a wrong answer nobody will question.
