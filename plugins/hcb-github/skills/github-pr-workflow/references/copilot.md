# Collaborating with Copilot review

How to find, classify, fix, and respond to GitHub Copilot's PR review findings.

## Copilot is usually a repo-enforced gate, not advisory

On repos that wire it up (via rulesets / a required status check such as
`copilot-review-gate`), the merge is **blocked by GitHub** until Copilot's review
is complete and the required threads are resolved. You can't change that policy —
work with it:

- **Copilot re-reviews on every push** (`review_on_push`). Each push supersedes its
  prior Copilot review with a fresh one — and, where the `pull_request` rule sets
  `dismiss_stale_reviews_on_push`, dismisses stale human approvals too — so batch
  fixes and, after pushing, wait for the fresh review before deciding you're done.
- **Copilot does not review draft PRs** (`review_draft_pull_requests: false`).
  Open the PR ready-for-review or the gate never runs and the PR can't merge.
- **The gate is machine-readable — but corroborate it.** `gh pr checks <pr>` shows
  the Copilot gate's state; if it's red, read its annotation/log for what it wants
  (usually: review still pending, or unresolved threads). If it's green, confirm
  Copilot actually reviewed the *latest* push and the threads are resolved — a gate
  can pass vacuously. **If there's no Copilot gate at all**, fall back to your own
  discipline: read the review if one ran, fix Critical/Important, reply to threads —
  don't skip review just because nothing enforces it.

None of this is guaranteed; it's per-repo. Detect it (see the main skill's "The
merge gates belong to the repo" and "When there are no gates, or they can't be
trusted"), don't presume it.

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

Copilot's comments come from an author login like `copilot-pull-request-reviewer`
or similar bot account — filter to those plus any review summary it posts.

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
bar** — every required check green (including the Copilot gate) and the repo's
thread-resolution requirement met, *plus* CI genuinely green and Copilot's
Critical/Important findings resolved regardless of what the repo enforces. On a
repo with no gates GitHub reports mergeable from PR-open, so mergeability alone is
never the exit — your own bar is the floor (see the main skill's *When there are
no gates, or they can't be trusted*). Where all threads must be resolved, an
unresolved nit blocks the merge as much as a Critical one; where they need not,
replied-but-unresolved minor items don't block. Detect which applies, don't assume.
