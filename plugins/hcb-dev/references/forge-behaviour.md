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
| the body of an automated review | **a layout the forge publishes none of, and it does not hold still.** Measured over 13 543 Copilot reviews across four repositories in eleven days: two layouts arrived interleaved rather than one replacing the other — the one a degraded run posts carries neither the labels nor the counts the other does — and the favourable verdict came under two headings, one on every review that approved and the other on every review that did not. GitLab's counterpart is unmeasured |
| the files an automated review did not review | **named in its body and nowhere else — where it names them at all.** Measured over 13 543 Copilot reviews: 413 carried a `Files not reviewed` block, every entry in it a generated `.yaml`; one such review landed `APPROVED` beside a `success` check-run, and the one review that could review no file at all landed `COMMENTED` with no check-run of its own. Where no block names them, the count below is the only report. GitLab's counterpart is unmeasured |
| the heading of an automated review body | **three, and the third is the one findings hide under.** Measured over 94 Copilot reviews on three pull requests of one repository: `🟢 Approved`, `🟡 Changes recommended` and `🔵 Needs a closer look`. 54 counted no new inline comment, and 53 of those carried the third heading. GitLab's counterpart is unmeasured |
| the sentence under that heading | **a finding of its own, not a summary of the others.** Measured over the same 94: on the 53 reviews counting no new comment under `Needs a closer look`, that sentence asserted a defect — and each one checked against the code was real. 45 of them carried a suppressed block too, and on one the block named a different finding in a different file, so a reading held to the block's count closed one short |
| `Files reviewed: N/M` in an automated review body | **a second report of what went unreviewed, independent of the block.** Measured over the same 94: no review carried a `Files not reviewed` block, while on one pull request 21 of 51 reviews counted fewer files reviewed than changed. None of them named a file it skipped |
| what makes a file go unreviewed | **the size of that file's own diff, not of the whole change.** Measured over 51 reviews of one pull request: every drop in the count came with one more file's diff (`git diff <merge-base> <head> -- <file>`, in bytes) passing a size above 101 462 — still reviewed — and at most 102 856 — the count one lower; no drop came without one. A pull request of 360 611 bytes over 52 files, none past 37 815, kept every count whole over 22 reviews. Every review measured that states an effort level states `Lite`, and which file a short count dropped was never named — that it is the large one is an inference |
| a review that could not run | **posts as a review like any other**: `COMMENTED`, the body a single sentence saying it encountered an error and could not review, with no counts. Measured twice on one pull request. Its `commit_id` is the commit it failed on, so a reading by commit takes that head for reviewed |
| `Review effort level` in an automated review body | **unmeasured as a signal.** All 92 of the 94 reviews above that state it say `Lite`, so what another level changes has not been seen — a fact about the round, never grounds for a step |
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
| a comment body's maximum | **a refusal saying the body is too long, and naming the wrong number in the wrong unit.** The cap is **262 144 bytes of UTF-8**, measured on both sides of the boundary for a comment's REST create and edit alike: 262 144 bytes stored and 262 145 refused — and in Cyrillic 131 085 characters at 262 144 bytes stored, 131 086 at 262 146 refused. REST refuses with `422`, **spelled differently per call**: `body is too long (maximum is 65536 characters)` on an edit, `Body is too long …` on a create. **The status belongs to REST alone**: GraphQL's `updateIssueComment` refuses the same 262 145 bytes under `HTTP 200`, as an `UNPROCESSABLE` entry in `errors` spelled `Body is too long …`. A refusal saying nothing about the length is transport, not the cap: an empty reply or a response that does not parse refused 22 of 33 writes of one body under the cap, stored between them — one such refusal came from a write that had landed — and a secondary-limit `403` arrives the same way | measure **UTF-8 bytes** against the cap before writing, and archive ahead of it. Answer a refusal whose message says the body is too long by archiving — matched case-insensitively, whichever API carried it; answer any other refusal by reading the body back, and writing again only if it did not land. GitLab's own limit is unmeasured |
| an issue body's maximum | **nothing, over REST.** The cap is the same 262 144 bytes, and a `PATCH` one byte over it answers `200 OK`, echoes the new body in its response and lists the edit in `userContentEdits` — while the stored body stays the previous one. Measured twice at 262 145 bytes. `gh issue edit` (GraphQL `updateIssue`) refuses the same body loudly, as `Body is too long (updateIssue)`, naming no number | measure bytes before writing; write an issue body through `gh issue edit`, and after any write to it read the body back rather than the response. GitLab's own limit is unmeasured |

## What is not here

A number nobody measured, and a behaviour that a document asserts but no run
confirmed. Where a row would need either, the row says it is unmeasured — an
unmeasured row is a question someone can answer later, while a confident one that was
never checked is a wrong answer nobody will question.
