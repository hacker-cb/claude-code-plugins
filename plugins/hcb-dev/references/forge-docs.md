# Forge documentation — where an answer gets resolved

Where a flag, an endpoint or a concept name is looked up on either forge, and
what each forge calls the thing its counterpart names differently. It sits
outside any one skill because change requests, reviews and issues all resolve the
same questions against the same two sources.

## Two sources, two jobs

**The installed CLI is authoritative about what exists here.** `gh <command>
--help` and `glab <command> --help` report the subcommands, flags and output
fields of the build actually installed, which is not the build the site
documents. Read it before writing an invocation, and treat a flag it does not
list as absent whatever the site says.

**The sites are authoritative about meaning** — what a field holds, which values
an enum takes, and every operation the porcelain never wrapped. Both serve their
pages as markdown, by forms that differ; a wrong form errors rather than falling
back to the rendered page.

| | GitHub | GitLab |
|---|---|---|
| a page | `https://docs.github.com/en/<path>.md` | `https://docs.gitlab.com/<path>/index.md` |
| what comes back | the page as markdown | the Hugo source, shortcodes (`{{< details >}}`) left in |
| the CLI's own pages | `https://docs.github.com/en/github-cli/<path>.md` — install and configuration only, never the command reference | `https://docs.gitlab.com/cli/<path>/index.md` — the full command reference, generated from the source |
| every path there is | `https://docs.github.com/api/pagelist/en/<version>` — one path per line, and it decides the row above: only a path it enumerates has the markdown twin | [llms.txt](https://docs.gitlab.com/llms.txt) — the navigation tree only, so a deep page is reached from its parent, not from here |
| search | `https://docs.github.com/api/search/v1?query=<q>&language=en&version=<ver>&client_name=<caller>` — `client_name` is mandatory, and the `&` mean the URL is quoted wherever a shell sees it | none |
| a self-hosted version | `enterprise-server@<ver>` leads the path, and is a `<version>` the page list takes; which ones are still served is [the versions endpoint](https://docs.github.com/api/pagelist/versions) | the site carries the current release only — for an older one take the source under `https://gitlab.com/gitlab-org/gitlab/-/raw/<tag>/doc/`, since [archives.docs.gitlab.com](https://archives.docs.gitlab.com/) is rendered HTML |

**A URL outside the page list has no markdown, and asking for it anyway fails
quietly rather than loudly.** The `.md` suffix 404s, which is the honest answer;
`https://docs.github.com/api/article/body?pathname=<path>` instead returns the
*parent* page's markdown under a 200, so the fetch looks like it worked and the
content is of something else. Check the page list rather than either response.

In the GitLab source tree the file name follows what the path is: a section
directory holds `<path>/_index.md`, a leaf page is a flat `<path>.md`. Try the
flat form when `_index.md` 404s.

GitHub's [llms.txt](https://docs.github.com/llms.txt) is a curated shortlist, not
an index: when a path is not in it, go to the page list. GitLab publishes no
`llms-full.txt`.

Fetch the page a flag is on, never the section above it — a schema or API
reference is large enough to crowd out the context you needed it for.

Neither site publishes `gh`'s command reference as markdown: `docs.github.com`
carries installation and configuration, and `cli.github.com/manual/` carries the
generated per-command pages as HTML. `--help` is the markdown-free way to the
same content, and the only one that describes the installed build.

## What each forge calls it

| concept | GitHub | GitLab |
|---|---|---|
| CLI (host override) | `gh` (`GH_HOST`) | `glab` (`GITLAB_HOST`) |
| change request | pull request (PR) | merge request (MR) |
| merge gates | rulesets + classic branch protection | protected branches + approval rules |
| automated review | Copilot code review | GitLab Duo Code Review |
| review conversations | review threads (resolve) | discussions (resolve) |
| CI | Actions (`.github/workflows/`) | GitLab CI (`.gitlab-ci.yml`) |
| dependency updates | Dependabot (`.github/dependabot.yml`) | Renovate (`renovate.json`) |
| issue hierarchy | sub-issues, one parent per issue | work items — epic → issue → task |
| issue dependencies | issue dependencies: *blocked by* / *blocking* | linked issues: *blocks* / *is blocked by* |
| issue classification | issue types, defined per organization | work item types |
| time-boxing | milestones | milestones, iterations |

The issue rows are where the two stop lining up: GitHub keeps hierarchy and
blocking in **separate** mechanisms, while GitLab expresses hierarchy through the
work-item tree and blocking through links between issues. Neutral prose that
implies one mechanism per forge will be wrong on both.

## Change requests, gates and review

| | GitHub | GitLab |
|---|---|---|
| the request itself | [REST](https://docs.github.com/en/rest/pulls/pulls.md) | [REST](https://docs.gitlab.com/api/merge_requests/index.md) |
| review comments | [reviews](https://docs.github.com/en/rest/pulls/reviews.md), [comments](https://docs.github.com/en/rest/pulls/comments.md) | [discussions REST](https://docs.gitlab.com/api/discussions/index.md) |
| what a gate can demand | [the rules a ruleset can carry](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets.md), [rules REST](https://docs.github.com/en/rest/repos/rules.md) | [approval rules](https://docs.gitlab.com/user/project/merge_requests/approvals/index.md), [protected branches](https://docs.gitlab.com/user/project/repository/branches/protected/index.md), [REST](https://docs.gitlab.com/api/protected_branches/index.md) |
| the automated reviewer | [Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review.md) | [Duo Code Review](https://docs.gitlab.com/user/gitlab_duo/code_review/index.md) |

## Issues: the porcelain stops at the flat issue

Both CLIs stop at the single flat issue — create it, list, view, comment, close,
and edit its own fields (`gh issue edit`, `glab issue update`). Neither wraps
hierarchy or dependencies on either forge, so both are reached through the `api`
subcommand — `gh api` / `glab api`, against REST, or with `graphql` as the
endpoint where the schema carries what REST does not.

| | GitHub | GitLab |
|---|---|---|
| classification beyond labels | [issue types on the org](https://docs.github.com/en/rest/orgs/issue-types.md), [on the repository](https://docs.github.com/en/rest/repos/issue-types.md) — organisation-owned repositories only, one per issue | [configurable work item types](https://docs.gitlab.com/user/work_items/configurable_work_item_types/index.md) — paid tier, configured on the top-level group, no REST surface |
| hierarchy | [sub-issues REST](https://docs.github.com/en/rest/issues/sub-issues.md) | [epics](https://docs.gitlab.com/user/group/epics/index.md), [work items](https://docs.gitlab.com/user/work_items/index.md), [epics REST](https://docs.gitlab.com/api/epics/index.md) |
| dependencies | [issue dependencies REST](https://docs.github.com/en/rest/issues/issue-dependencies.md) | [linked issues](https://docs.gitlab.com/user/project/issues/related_issues/index.md), [issue links REST](https://docs.gitlab.com/api/issue_links/index.md) |
| time-boxing | [milestones REST](https://docs.github.com/en/rest/issues/milestones.md) | [milestones REST](https://docs.gitlab.com/api/milestones/index.md) |
| the schema, where REST falls short | [issues](https://docs.github.com/en/graphql/reference/issues.md) | [GraphQL](https://docs.gitlab.com/api/graphql/index.md) |
