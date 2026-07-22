# Collaborating with Copilot review

How to find, classify, fix, and respond to GitHub Copilot's PR review findings.

## Is Copilot even in the loop?

Copilot reviews a PR when the repo's ruleset carries a `copilot_code_review` rule,
or when someone — you included — requests it on that PR. Read the rule before the
loop; its two parameters drive everything below:

```bash
gh api repos/<owner>/<repo>/rulesets --jq '.[].id' \
  | xargs -I{} gh api repos/<owner>/<repo>/rulesets/{} \
  | jq -s '[ .[] | select(.enforcement=="active") | .rules[]
             | select(.type=="copilot_code_review") | .parameters ]'
```

- **`review_on_push: true`** — Copilot is re-requested on *every* push. So every
  push you make during the fix loop earns a new review that you must wait for and
  read before you can call the PR done.
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
  --jq '[ .[] | select(.user.login == "copilot-pull-request-reviewer[bot]") ] | length' \
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
  --jq '.[] | select(.user.login == "copilot-pull-request-reviewer[bot]")
        | {commit_id, submitted_at} | @json' | tail -1
# fresh iff commit_id == $head
```

Copilot does **not** reliably re-review every push, though — a push that only
applies its own suggestions often earns no new review — so waiting unconditionally
would hang forever. Run this protocol after each push:

1. **Make sure a review is actually pending for the current head.** Under
   `review_on_push: true` GitHub requests it for you; otherwise, or if nothing
   shows up, request one explicitly — the MCP `request_copilot_review` tool, or:
   ```bash
   gh pr edit <pr> --add-reviewer "@copilot"
   ```
   Don't hand-roll that as a REST `requested_reviewers` POST: Copilot is not an
   ordinary reviewer login, and `@copilot` is the special value `gh` case-handles
   for it (not supported on GitHub Enterprise Server). Mind the naming, too — it is
   requested as `Copilot` but *authors* its review as
   `copilot-pull-request-reviewer[bot]`, and the author login is the one to filter
   reviews and comments on.
2. **Poll** until either a Copilot review with `commit_id == $head` appears (the
   first review usually lands within a few minutes), or Copilot has dropped out of
   `gh pr view <pr> --json reviewRequests` *and* a bounded wait (~10 min) elapsed.
3. **Fresh review** → process it from the top: classify, fix, reply, resolve.
   **No review and no pending request** → Copilot declined to re-review this push;
   proceed, and say so in the report rather than implying it reviewed.

Do this after *every* push — including the last one, whose review is the easiest to
skip and the most likely to be missed — and never evaluate the loop's exit until it
settles.

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
             nodes{ id isResolved comments(first:100){ nodes{ databaseId author{login} body path line } } }
           }
         }
       }
     }' -F owner=<owner> -F repo=<repo> -F pr=<pr>
   ```
3. **REST API** via `gh api repos/<owner>/<repo>/pulls/<pr>/comments` as a
   fallback.

Copilot's comments come from the bot author `copilot-pull-request-reviewer[bot]`;
include any review summary it posts alongside the inline comments.

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
  the repo — see *Classifying severity* and *Loop exit*.)

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

## Loop exit

The loop ends when the PR is **both mergeable by GitHub and clean by your own
bar** — every required check green and the repo's thread-resolution requirement
met, *plus* CI genuinely green and Copilot's review **of the current head**
processed with its Critical/Important findings resolved, whatever the repo does or
doesn't enforce. On a repo with no enforced gates GitHub reports mergeable from
PR-open, so mergeability alone is never the exit — your own bar is the floor (see
the main skill's *When there are no gates, or they can't be trusted*). Where all
threads must be resolved, an unresolved nit blocks the merge as much as a Critical
one; where they need not, replied-but-unresolved minor items don't block. Detect
which applies, don't assume.
