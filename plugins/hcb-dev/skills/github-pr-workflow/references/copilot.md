# Collaborating with Copilot review

How to find, classify, fix, and respond to GitHub Copilot's PR review findings.

## Identifying Copilot — never match one literal

One actor, a different login on **every** surface:

| Surface | `login` | the type field |
|---|---|---|
| REST `…/pulls/<pr>/reviews` | `copilot-pull-request-reviewer[bot]` | `.user.type` |
| REST `…/pulls/<pr>/comments` | `Copilot` | `.user.type` |
| REST `…/pulls/<pr>` → `requested_reviewers` | `Copilot` | `.type` |
| GraphQL `author` — reviews, comments | `copilot-pull-request-reviewer` | `__typename` |
| GraphQL `reviewRequests` → `requestedReviewer`, a union whose `login` needs a `... on Bot` fragment | `copilot-pull-request-reviewer` | `__typename` |

So a filter pinned to any one spelling matches nothing on the other three, and the
failure is **silent**: the inline comments are exactly what a `/comments` filter
returns, and an empty result reads as "Copilot had no findings" rather than as a
filter that missed. Match the pair instead — `Bot` **and** a case-insensitive
`^copilot` prefix, which also survives GitHub renaming the bot again:

```jq
select((.user.type? // "") == "Bot" and ((.user.login? // "") | test("^copilot"; "i")))
```

In GraphQL the same test reads `.author.__typename` and `.author.login`.

**Reach every field through `?` and `// ""`.** `test/1` raises on anything that is
not a string, and a deleted account leaves `"user": null` behind — one such row
aborts the whole `--jq` program, turning a PR full of findings into a PR with
none. That is the same silent-empty failure by another route.

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

- **`review_on_push: true`** — Copilot is re-*requested* on *every* push, so every
  push in the fix loop owes you a review to wait for and read before you call the
  PR done. The request is not a promise that one posts; *Wait for the review of the
  CURRENT head* below is what that costs you.
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

Copilot does not re-review every push — one that only applies its own suggestions
often earns none — so the wait ends on the **requested-reviewer state**, never on a
clock. After each push:

1. **Make sure a review is pending.** `review_on_push` requests it for you;
   otherwise request one:
   ```bash
   gh pr edit <pr> --add-reviewer "@copilot"
   ```
   Not a REST `requested_reviewers` POST — that endpoint takes ordinary logins,
   while `@copilot` is a value `gh` case-handles. *Reading* that list is a
   different matter, and step 2 does exactly that. Unsupported on GitHub
   Enterprise Server; there, rely on the rule instead.
2. **See Copilot in the PR's `requested_reviewers` before reading that list for
   anything else.** `gh pr view --json reviewRequests` is the wrong surface — it
   drops the bot, so a live request reads there as an empty list for as long as it
   is pending, and a wait built on it never arms. Read the list over REST, matching
   the pair from *Identifying Copilot*:
   ```bash
   gh api repos/<owner>/<repo>/pulls/<pr> \
     --jq '[ .requested_reviewers[]? | select((.type? // "") == "Bot" and ((.login? // "") | test("^copilot"; "i"))) ] | length'
   ```
   Under `review_on_push` the request is registered asynchronously, so right after
   a push the list is briefly empty — absence there is "not yet", and only becomes
   an answer once you have watched the request appear for this head.
3. **Wait until it settles**, which is one of exactly two things: a Copilot review
   whose `commit_id == $head`, or a request that was there and is gone with no such
   review — a decline, which the report says out loud rather than implying it
   reviewed. **An empty list is never a decline by itself**: a poll that missed the
   window between the request and its review reads exactly the same. Whether one was
   ever registered for *this* head is the timeline's answer — but its review-request
   events carry no SHA, so every earlier round left one that reads identically, and
   an unbounded query hands you a stale event as proof. Take the time before you
   push, and count only what came after it:
   ```bash
   # `--jq` is gh's own filter and takes no `--arg`; a variable reaches it through
   # the environment. The comparison is lexicographic, so the value has to be in
   # the API's own form — `date -u +%Y-%m-%dT%H:%M:%SZ` — or it matches by accident.
   SINCE="<that timestamp, snapped before the push>" \
   gh api --paginate repos/<owner>/<repo>/issues/<pr>/timeline \
     --jq '.[] | select((.event? // "") | test("^review_request"))
           | select((.created_at? // "") > env.SINCE)
           | select((.requested_reviewer.login? // "") | test("^copilot"; "i"))
           | {event, at: .created_at} | @json'
   ```
4. **A review of an earlier commit is not a decline.** It consumes the request and
   leaves the head unreviewed, so re-request and keep waiting. For the same reason
   no elapsed time settles anything: while Copilot is still a requested reviewer,
   hold, and say the head review is outstanding.

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
   fallback.

Filter all three by the pair from *Identifying Copilot*, never by a login you saw
on another surface: on `/comments` the login is a bare `Copilot`, and in GraphQL it
carries no `[bot]` suffix. Include any review summary it posts alongside the inline
comments — that one is a *review* body, so it comes from `/reviews`, not from
either comment source.

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
  - **Skip** — style, naming nits, formatting, subjective readability,
    "consider" suggestions with no concrete defect, speculative edge cases that
    can't occur.
- **When in doubt between Important and Skip, treat it as Important.**

**Critical** and **Important** are fixed in the loop unconditionally. A `Skip` is
not left alone by its severity either — put it through the test in
[`../../../references/fix-or-surface.md`](../../../references/fix-or-surface.md)
and fix here whatever passes. Push it like any other fix — where it is the only
thing to go up, it still goes up — and take the re-review wait that push costs.
What it never does is spend the loop's iteration budget: that is there for what
blocks the exit, and a `Skip` never does. Only what that test turns down goes into
the end-of-session report (Step 7), under its category so the user sees it.

**What you *fix* and what you *resolve* are different questions.** When the repo
requires all threads resolved (`required_review_thread_resolution`), every thread
must end resolved whatever was decided above — a fix and an acknowledgement both
end in a reply + resolve. A left-open nit blocks the merge just as hard as a
Critical one there.

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
