# Collaborating with Copilot review

How to find, classify, fix, and respond to GitHub Copilot's PR review findings.

## Finding the comments

Use whichever source is available (in priority order):

1. **GitHub MCP** — use the connected GitHub MCP tools to list PR review comments
   and review threads. Richest structured output (author, path, line, body,
   thread/resolution state).
2. **`gh` CLI:**
   ```bash
   gh pr view <pr> --comments
   # review threads with resolution state (GraphQL):
   gh api graphql -f query='
     query($owner:String!,$repo:String!,$pr:Int!){
       repository(owner:$owner,name:$repo){
         pullRequest(number:$pr){
           reviewThreads(first:100){
             nodes{ isResolved comments(first:20){ nodes{ author{login} body path line } } }
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
- After replying to a thread that's addressed, **resolve the conversation** so the
  PR's review state is clean.

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

The loop ends when CI is green AND no unresolved Critical/Important thread
remains. Skipped/replied-but-unfixed minor items do not block exit.
