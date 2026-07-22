# hcb-dev

A personal developer baseline for Claude Code: resolve dependency versions from
the registry instead of typing them from memory, and drive finished work through
the GitHub review-and-merge lifecycle. Part of the
[`hacker-cb-plugins`](https://github.com/hacker-cb/claude-code-plugins)
marketplace.

## Install

```text
/plugin marketplace add hacker-cb/claude-code-plugins
/plugin install hcb-dev@hacker-cb-plugins
```

## Skills

### `dependency-versions` — `/hcb-dev:dependency-versions`

When adding or updating a dependency, resolve the version from the registry via
the package manager's own `add`/`install` command instead of typing a version
literal from memory. Covers `cargo` / `pnpm` / `npm` / `uv` / `go` / `bundle`,
the Node.js LTS pin, and GitHub Actions version pinning. On GitHub-hosted repos
it also keeps `.github/dependabot.yml` in sync with the ecosystems in use —
extending an existing config automatically, and offering to enable Dependabot
(with sane grouping + cooldown defaults) when there is none.

### `github-pr-workflow` — `/hcb-dev:github-pr-workflow`

Takes committed work on a feature branch and drives it to a merged PR, autonomously where safe:

- rename an auto-generated branch to a meaningful `<type>/<name>`;
- rebase onto the base branch and force-push with `--force-with-lease`;
- open the PR (ready for review — drafts skip Copilot's review);
- loop on fixes until **GitHub reports the PR mergeable** — every required check green and the repo's thread-resolution requirement met — discovering the gates from the rules actually in force on the PR's base branch (ref scoping and org-level rulesets included, which a plain ruleset listing gets wrong), and always keeping the skill's own bar as the floor: green CI, a branch current with base, and Copilot's review *of the current head* processed (never a stale one from an earlier push);
- reply to and resolve Copilot review threads (all of them where the repo requires it);
- merge with the right strategy — only on the user's explicit go-ahead — then monitor the merge and report.

See [`skills/github-pr-workflow/SKILL.md`](skills/github-pr-workflow/SKILL.md) and its
[`references/copilot.md`](skills/github-pr-workflow/references/copilot.md).

**Requirements:** a GitHub MCP server connected, or the `gh` CLI authenticated
(`gh auth status`). Plain `git` is used for local branch / rebase / push
operations.
