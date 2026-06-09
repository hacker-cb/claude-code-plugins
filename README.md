# hacker-cb's Claude Code plugins

[![Validate](https://github.com/hacker-cb/claude-code-plugins/actions/workflows/validate.yml/badge.svg)](https://github.com/hacker-cb/claude-code-plugins/actions/workflows/validate.yml)
[![Release](https://img.shields.io/github/v/release/hacker-cb/claude-code-plugins?sort=semver)](https://github.com/hacker-cb/claude-code-plugins/releases/latest)
[![License: MIT](https://img.shields.io/github/license/hacker-cb/claude-code-plugins)](LICENSE)

A personal [Claude Code](https://code.claude.com/docs/en/overview) **plugin marketplace** for skills, rules and workflows. Install a plugin straight into Claude Code, or grab any single skill as a standalone `.skill` file.

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
| [`hcb-github`](plugins/hcb-github) | `github-pr-workflow` | Drive a GitHub PR from a finished branch all the way to a merged PR (rename → rebase → open → CI/Copilot fix-loop → auto-merge → report). |
| [`hcb-dev`](plugins/hcb-dev) | `dependency-versions`, `library-docs` (+ `SessionStart` hook) | Personal developer baseline — per-scope language (chat/plans/comments/docs) injected each session via a configurable hook, resolve dependency versions from the registry, and pull current library docs from Context7. |

More GitHub-specific skills and rules (issues / backlog, …) will be added over time.

## Download a single skill (`.skill`)

Each skill is also publishable as a standalone `.skill` archive (a zip of the skill directory):

1. Download `<skill>.skill` from the [Releases](https://github.com/hacker-cb/claude-code-plugins/releases) page, **or** build it locally with `bash scripts/package-skills.sh` (output in `dist/`).
2. Use it either way:
   - **claude.ai** → Settings → Capabilities → Skills → **Upload skill**, or
   - **Claude Code** → unzip into `~/.claude/skills/` (personal) or `.claude/skills/` (project).

## Repository layout

```text
.claude-plugin/marketplace.json   # the marketplace catalog
plugins/hcb-<domain>/             # one themed plugin per domain
  .claude-plugin/plugin.json
  skills/<skill>/SKILL.md
scripts/validate.sh               # structural validation (CI + local)
scripts/package-skills.sh         # build dist/*.skill
.github/workflows/                # validate (PR/push) + release (tags)
```

## Development

```bash
bash scripts/validate.sh         # validate marketplace, plugins, skills
bash scripts/package-skills.sh   # package skills into dist/*.skill
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a skill, plugin or rule, plus the naming convention.

## License

[MIT](LICENSE) © Pavel Sokolov
