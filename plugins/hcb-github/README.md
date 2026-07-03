# hcb-github

GitHub workflow skills for Claude Code. A personal (non-official) plugin from the [`hacker-cb-plugins`](https://github.com/hacker-cb/claude-code-plugins) marketplace.

## Install

```text
/plugin marketplace add hacker-cb/claude-code-plugins
/plugin install hcb-github@hacker-cb-plugins
```

## Skills

### `github-pr-workflow` — `/hcb-github:github-pr-workflow`

Takes committed work on a feature branch and drives it to a merged PR, autonomously where safe:

- rename an auto-generated branch to a meaningful `<type>/<name>`;
- rebase onto the base branch and force-push with `--force-with-lease`;
- open the PR (ready for review — drafts skip Copilot's review);
- loop on fixes until **GitHub reports the PR mergeable** — every required check green (including any Copilot gate) and the repo's thread-resolution requirement met — reading the repo's own rulesets as the gates, with the skill's own CI-and-Copilot bar as the floor when a repo enforces little or the gates aren't trustworthy;
- reply to and resolve Copilot review threads (all of them where the repo requires it);
- merge with the right strategy — only on the user's explicit go-ahead — then monitor the merge and report.

See [`skills/github-pr-workflow/SKILL.md`](skills/github-pr-workflow/SKILL.md) and its
[`references/copilot.md`](skills/github-pr-workflow/references/copilot.md).

**Requirements:** a GitHub MCP server connected, or the `gh` CLI authenticated (`gh auth status`). Plain `git` is used for local branch / rebase / push operations.
