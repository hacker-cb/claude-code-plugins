# Collaborating with Copilot review

How to find, classify, fix, and respond to GitHub Copilot's PR review findings.

## Is Copilot even in the loop?

Copilot reviews a PR when a `copilot_code_review` rule is in force **for that PR's
base branch**, or when someone — you included — requests it on the PR. Ask for the
rules in force on the base rather than listing the repo's rulesets: this endpoint
has already applied each ruleset's `ref_name` conditions *and* includes rules
inherited from an organization-level ruleset, and a plain `/rulesets` listing does
neither.

```bash
# One line per rule in force on the base branch. `ruleset_source_type` says
# whether it came from this repo or from an org-level ruleset.
gh api repos/<owner>/<repo>/rules/branches/<base> \
  --jq '.[] | select(.type=="copilot_code_review") | .parameters | @json'
```

Several lines is normal — a repo can carry the rule in more than one ruleset that
matches the branch. No line at all means no rule applies **to this base**, which is
a different statement from "this repo has no such rule": the same repo can enforce
Copilot on its default branch and nothing at all on a side branch.

- **`review_on_push: true`** — Copilot is re-*requested* on *every* push. Treat
  each push in the fix loop as owing you a review to wait for and read before you
  call the PR done — but the request is not a promise that one posts, which is why
  the wait below keys on Copilot leaving the requested-reviewer set (reviewed or
  declined), not on a review necessarily arriving: while it stays requested you keep
  waiting; a decline is confirmed only when Copilot leaves that set with no head
  review, never by the clock — and if a safety cap runs out while it is still
  requested you hold and escalate rather than merge.
- **`review_draft_pull_requests: false`** — drafts are not reviewed at all. Open
  the PR ready-for-review (main skill Step 3), or Copilot never runs.

**The rule requests the review; it does not gate the merge.** Copilot's review
lands as a `COMMENTED` review: it counts toward no approval requirement and blocks
nothing by itself. Its findings are therefore *your* bar, not GitHub's — nothing
external will stop you from finishing while they are unread.

A repo may separately mark some status check required that stands in for the
review. You need not know which, or what it is called: it is just another context
under `required_status_checks`, satisfied like any other. Never read such a check's
green as proof that Copilot reviewed the *current* head — verify that yourself,
below.

Copilot is out of the loop only when **all three** of these are false: there is no
`copilot_code_review` rule, Copilot is not a requested reviewer, *and* the PR
carries no Copilot review already. That third one is easy to forget and expensive
to get wrong — a review that has already posted **consumes its request**, so on a
repo without the rule a manually-requested Copilot that has already reviewed looks
exactly like "never involved" if you only check the first two, and its comments
would go unread. Check for an existing review before skipping:

```bash
# --paginate applies --jq per page, so a bare `length` prints one number *per
# page* — sum them, or a PR with >100 reviews answers with several numbers.
gh api --paginate repos/<owner>/<repo>/pulls/<pr>/reviews \
  --jq '[ .[] | select((.user.type? // "") == "Bot" and ((.user.login? // "") | test("^copilot"; "i"))) ] | length' \
  | awk '{ n += $1 } END { print n + 0 }'
```

Only when all three come back empty is Copilot genuinely not part of this repo's
flow — then skip it and rely on the rest of your bar.

## Wait for the review of the CURRENT head

The trap that silently drops findings: right after you push a fix, the PR briefly
looks finished — CI goes green, the previous review's threads are all resolved,
GitHub reports the PR mergeable — while Copilot's review *of the push you just
made* has not posted yet. Acting in that window discards every comment Copilot was
about to write.

So the test is never "does a Copilot review exist" but "**has Copilot reviewed this
exact commit**". Each review carries the SHA it reviewed in `commit_id`; compare it
with the PR head:

```bash
head=$(gh pr view <pr> --json headRefOid --jq .headRefOid)
# `| @json` pins each review to exactly one line, so `tail -1` is the last review
# and not whatever gh's output formatting happened to put on the last line.
gh api --paginate repos/<owner>/<repo>/pulls/<pr>/reviews \
  --jq '.[] | select((.user.type? // "") == "Bot" and ((.user.login? // "") | test("^copilot"; "i")))
        | {commit_id, submitted_at} | @json' | tail -1
# fresh iff commit_id == $head
```

Copilot does **not** reliably re-review every push — one that only applies its own
suggestions often earns no new review — so waiting unconditionally hangs forever.
Four rules cover it:

1. **Freshness is `commit_id == $head`,** never "a review exists". A stale review
   is indistinguishable from a fresh one by any other signal.
2. **Read the requested-reviewer state through a bot-visible surface** (above), and
   make sure a review is actually pending: under `review_on_push` GitHub requests it
   for you, otherwise `gh pr edit <pr> --add-reviewer "@copilot"`. Do not hand-roll
   that as a REST `requested_reviewers` POST — `@copilot` is a value `gh`
   case-handles.
3. **Settled means a review of the head, or Copilot gone from the request list with
   no head review.** A review posted against an *earlier* commit consumes the request
   while leaving the head unreviewed — that is not a decline; re-request and keep
   waiting.
4. **A cap bounds the wait, never authorises passing it.** Cap elapsed while Copilot
   is still requested → hold, tell the user the head-commit review is outstanding,
   and extend or escalate.

Do this after *every* push, the last one included — its review is the easiest to
skip and the most likely to be missed.

## Finding the comments

Use whichever source is available (in priority order):

1. **GitHub MCP** — use the connected GitHub MCP tools to list PR review comments
   and review threads. Richest structured output (author, path, line, body,
   thread/resolution state).
2. **`gh` CLI:**
   ```bash
   gh pr view <pr> --comments
   # review threads with resolution state (GraphQL). Select the thread `id` and each
   # comment's `databaseId` — you need them below: `id` is the `<thread_node_id>` for
   # resolveReviewThread, `databaseId` is the `<comment_id>` for the replies endpoint.
   gh api graphql -f query='
     query($owner:String!,$repo:String!,$pr:Int!){
       repository(owner:$owner,name:$repo){
         pullRequest(number:$pr){
           reviewThreads(first:100){
             nodes{ id isResolved comments(first:100){ nodes{ databaseId author{login __typename} body path line } } }
           }
         }
       }
     }' -F owner=<owner> -F repo=<repo> -F pr=<pr>
   ```
3. **REST API** via `gh api repos/<owner>/<repo>/pulls/<pr>/comments` as a
   fallback — filter it with the same `type == "Bot"` + `^copilot` form; on this
   surface the login is a bare `Copilot`, so the `[bot]` spelling matches nothing.

**One actor, a different login per surface** — `copilot-pull-request-reviewer[bot]`
on REST `/reviews`, a bare `Copilot` on REST `/comments` and `requested_reviewers`,
`copilot-pull-request-reviewer` in GraphQL. So never test one literal: match on
`type == "Bot"` (`__typename` in GraphQL) plus a case-insensitive `^copilot`, and
reach every field through `?` — `test/1` raises on the `"user": null` a deleted
account leaves behind, and one such row aborts the whole `--jq` program, turning a
PR full of findings into a PR with none. Include any review summary it posts
alongside the inline comments.

## Classifying severity

Copilot does not always tag severity consistently. Rule:

- **If Copilot labels the finding** (e.g. it marks something as high/critical or
  flags it as a bug/security issue), use its label.
- **If it doesn't,** classify yourself:
  - **Critical** — security vulnerabilities, data loss/corruption, crashes,
    auth/permission flaws, secrets exposure, broken core behavior.
  - **Important** — real logic bugs, incorrect results in plausible cases,
    significant performance problems, resource leaks, missing error handling on
    a likely path, API/contract mistakes.
  - **Skip** (do not fix in this loop) — style, naming nits, formatting,
    subjective readability, "consider" suggestions with no concrete defect,
    speculative edge cases that can't occur.
- **When in doubt between Important and Skip, treat it as Important.**

Only **Critical** and **Important** get fixed in the loop. Skipped items are NOT
ignored — they go into the end-of-session report (Step 7) under their category so
the user sees them.

**Severity decides what you *fix*, not what you *resolve*.** When the repo requires
all threads resolved (`required_review_thread_resolution`), every thread must end
resolved regardless of severity — you *fix* Critical/Important and *acknowledge*
the rest, but both paths end in a reply + resolve. A left-open nit blocks the
merge just as hard as a Critical one there.

## Fixing

- Address the root cause, not just the symptom Copilot pointed at.
- Make each fix a focused commit (or a small logical group); clear messages.
- Batch fixes into as few pushes as is reasonable — each push costs another
  re-review wait.
- Re-run/observe CI after pushing.

## Replying — reply to EVERY Copilot comment

Every Copilot comment gets a reply, whether fixed or skipped. This closes the
loop and keeps the review thread honest.

- **Fixed:** reply briefly noting what you changed and, if useful, the commit.
  e.g. "Fixed — added input validation and a null check in `parseConfig` (abc123)."
- **Skipped:** reply with the reason it's out of scope / not a defect.
  e.g. "Acknowledged — this is a style preference; leaving as-is for consistency
  with the surrounding module. Noted in the session report."
- After replying, **resolve the thread where the repo requires it** — all threads
  under `required_review_thread_resolution`, otherwise at least the ones you fixed —
  so the PR's review state is clean. (Reply is unconditional; resolution scales with
  the repo — see *Classifying severity*.)

Reply + resolve via:
```bash
# reply to a review comment thread:
gh api repos/<owner>/<repo>/pulls/<pr>/comments/<comment_id>/replies \
  -f body="<reply text>"
# resolve a thread (GraphQL mutation):
gh api graphql -f query='
  mutation($threadId:ID!){ resolveReviewThread(input:{threadId:$threadId}){ thread{ isResolved } } }' \
  -F threadId=<thread_node_id>
```
Or the equivalent MCP tools if available.
