# hacker-cb's Claude Code plugins

[![Validate](https://github.com/hacker-cb/claude-code-plugins/actions/workflows/validate.yml/badge.svg)](https://github.com/hacker-cb/claude-code-plugins/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/github/license/hacker-cb/claude-code-plugins)](LICENSE)

A personal [Claude Code](https://code.claude.com/docs/en/overview) **plugin marketplace** for skills, rules and workflows. Install a plugin straight into Claude Code.

> Marketplace name: **`hacker-cb-plugins`**

## Install (as a Claude Code plugin)

```text
/plugin marketplace add hacker-cb/claude-code-plugins
/plugin install hcb-github@hacker-cb-plugins
```

Then invoke a skill from the `/` menu, e.g.:

```text
/hcb-github:github-pr-workflow
```

> Every plugin here is prefixed with `hcb-` so it's obvious in the `/` menu that these are personal (non-official) plugins.

## Plugins

| Plugin | Skills | What it does |
| --- | --- | --- |
| [`hcb-github`](plugins/hcb-github) | `github-pr-workflow` | Drive a GitHub PR from a finished branch all the way to a merged PR (rename → rebase → open → CI/Copilot fix-loop → merge on your go-ahead → report). |
| [`hcb-dev`](plugins/hcb-dev) | `dependency-versions`, `library-docs` (+ `SessionStart` hook) | Personal developer baseline — per-scope language (chat/plans/comments/docs) injected each session via a configurable hook, resolve dependency versions from the registry (keeping `.github/dependabot.yml` in sync on GitHub repos), and pull current library docs from Context7. |

More GitHub-specific skills and rules (issues / backlog, …) will be added over time.

## Repository layout

```text
.claude-plugin/marketplace.json   # the marketplace catalog
plugins/hcb-<domain>/             # one themed plugin per domain
  .claude-plugin/plugin.json
  skills/<skill>/SKILL.md
scripts/validate.sh               # structural validation (CI + local)
.github/workflows/                # validate (PR/push)
```

## Development

```bash
bash scripts/validate.sh         # validate marketplace, plugins, skills
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a skill, plugin or rule, plus the naming convention.

## License

[MIT](LICENSE) © Pavel Sokolov
