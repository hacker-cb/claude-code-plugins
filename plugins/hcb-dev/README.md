# hcb-dev

A personal developer baseline for Claude Code: a connected set of skills that
carry a change from a dependency bump, through local review, to a merged
pull/merge request — plus the git-and-session hygiene around it. Part of the
[`hacker-cb-plugins`](https://github.com/hacker-cb/claude-code-plugins)
marketplace.

## Install

```text
/plugin marketplace add hacker-cb/claude-code-plugins
/plugin install hcb-dev@hacker-cb-plugins
```

## How the skills fit together

Most of these skills call each other, so installing the plugin gives you the
whole pipeline rather than seven disconnected commands:

```text
task/issue ─▶ (code it) ─▶ shipping-workflow ─▶ multi-review ─▶ codex-review
                                   │                            code-review (built-in)
                                   │                            security-review (built-in)
                                   └─▶ github-pr-workflow ─▶ (merge)

dependency-versions ─ seeding-gitignore ─ run alongside, whenever the work touches them
cleanup-project ───────────────────────── manual only, afterwards (see below)
```

Each skill is also useful on its own and triggers from its own `description` —
except `cleanup-project`, which sets `disable-model-invocation: true`: Claude
never reaches for it on its own, so it is **not** an automatic post-merge step.
Run `/hcb-dev:cleanup-project` yourself when you want the sweep.

## Skills

### Preparing a change

- **`dependency-versions`** — `/hcb-dev:dependency-versions`
  When adding or updating a dependency, resolve the version from the registry via
  the package manager's own `add`/`install` command instead of typing a literal
  from memory. Covers `cargo` / `pnpm` / `npm` / `uv` / `go` / `bundle`, the
  Node.js LTS pin, and GitHub Actions pinning; on GitHub repos it keeps
  `.github/dependabot.yml` in sync with the ecosystems in use.
- **`seeding-gitignore`** — `/hcb-dev:seeding-gitignore`
  Seed or extend a `.gitignore`: a fixed baseline this user carries everywhere
  (OS noise, editor swap files, per-developer Claude Code files, agent-tooling
  state, worktree dirs) plus language/framework patterns derived from what the
  project actually contains. Runs before every commit to keep local artifacts out
  of git.

### Reviewing it

- **`codex-review`** — `/hcb-dev:codex-review`
  Run a code review with Codex (`codex exec review`) over the current branch in a
  read-only sandbox. Review-only: returns Codex's findings verbatim and fixes
  nothing.
- **`multi-review`** — `/hcb-dev:multi-review`
  Run every available reviewer over one change at once — `codex-review`, the
  built-in code-review workflow, the built-in security review — then consolidate
  the findings and report what each reviewer actually covered (the coverage gate
  most of the skill exists to keep honest). Report-only.

### Shipping it

- **`shipping-workflow`** — `/hcb-dev:shipping-workflow`
  Take finished, verified work from the working tree to an open change request:
  commit, hand off to `multi-review`, apply the fixes, check coverage, then hand
  off to a PR/MR driver (below). The one confirmation gate is a coverage gap.
- **`github-pr-workflow`** — `/hcb-dev:github-pr-workflow`
  Drive a GitHub pull request from a finished branch to a merged PR: rename an
  auto-generated branch, rebase onto base, open the PR ready-for-review, loop on
  CI + Copilot fixes until GitHub reports it mergeable *and* your own bar is
  clean, then — only on your explicit go-ahead — merge, monitor, and report.
  Discovers the repo's actual merge gates instead of assuming them. See
  [`skills/github-pr-workflow/SKILL.md`](skills/github-pr-workflow/SKILL.md) and
  [`references/copilot.md`](skills/github-pr-workflow/references/copilot.md).

### Cleaning up

- **`cleanup-project`** — `/hcb-dev:cleanup-project` (manual-only)
  Sweep what work on the current project left behind, across all four zones it
  litters: git branches and worktrees, junk in the working tree, this project's
  conversation logs under `~/.claude/projects/`, and its session scratchpads
  under `/tmp/claude-<uid>/`. Two modes — `session` (only what this session
  created) and `all` (a full audit). Scope is one project and never widens.

## Forge neutrality

Per the repo's authoring rule ([`.claude/rules/forge-neutrality.md`](../../.claude/rules/forge-neutrality.md)),
these skills avoid assuming a single forge. Where the guidance needs a concrete
command — resolving a base, opening a change request — the GitHub (`gh`) and
GitLab (`glab`) forms are given side-by-side.

Two deliberate exceptions, each stated where it occurs:

- `github-pr-workflow` is GitHub-specific by design, named per the rule's
  `<forge>-<artifact>-workflow` convention; a `gitlab-mr-workflow` twin can be
  added later.
- `codex-review`'s runnable block resolves the base with `gh` only. Codex itself
  takes a plain git ref and is forge-agnostic, and where `gh` is absent the block
  falls through to git's own remote refs; on GitLab, resolve a non-default base
  with the mirrored `glab mr` commands in that skill's §1 and hand it in as
  `BASE`.

## Requirements

- **`dependency-versions`**: the relevant package manager on `PATH`.
- **`codex-review`** / **`multi-review`**: the `codex` CLI installed and
  `codex login` live; `multi-review` also picks up the built-in code-review and
  security-review tooling when present.
- **`shipping-workflow`** / **`github-pr-workflow`**: a GitHub MCP server
  connected, or the `gh` CLI authenticated (`gh auth status`) — `glab` on GitLab.
  Plain `git` is used for local branch / rebase / push operations.
