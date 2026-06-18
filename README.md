# hacker-cb's Claude Code plugins

[![Validate](https://github.com/hacker-cb/claude-code-plugins/actions/workflows/validate.yml/badge.svg)](https://github.com/hacker-cb/claude-code-plugins/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/github/license/hacker-cb/claude-code-plugins)](LICENSE)

A personal [Claude Code](https://code.claude.com/docs/en/overview) **plugin marketplace** for skills, rules, workflows and external MCP servers. Install a plugin straight into Claude Code.

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

> First-party plugins are prefixed with `hcb-` so it's obvious in the `/` menu that these are personal (non-official) plugins. External MCP wrappers (under `external_plugins/`) keep their upstream package name instead.

## Plugins

| Plugin | Skills | What it does |
| --- | --- | --- |
| [`hcb-github`](plugins/hcb-github) | `github-pr-workflow` | Drive a GitHub PR from a finished branch all the way to a merged PR (rename → rebase → open → CI/Copilot fix-loop → merge on your go-ahead → report). |
| [`hcb-dev`](plugins/hcb-dev) | `dependency-versions`, `library-docs` (+ `SessionStart` hook) | Personal developer baseline — per-scope language (chat/plans/comments/docs/issues) injected each session via a configurable hook, resolve dependency versions from the registry (keeping `.github/dependabot.yml` in sync on GitHub repos), and pull current library docs from Context7. |
| [`markdown-docs`](external_plugins/markdown-docs) | — (MCP server) | Navigate large markdown documents — datasheets, IEC/ISO standards, reference manuals — without dumping the whole file into context. Thin wrapper around the [`markdown-docs-mcp`](https://github.com/hacker-cb/markdown-docs-mcp) npm server (`view_toc` / `read_section` / `search` / `analyze_document`). |
| [`1c-odata`](external_plugins/1c-odata) | — (MCP server) | Query 1C:Enterprise databases over OData V3 — live schema introspection and read-only queries (`list_entities` / `describe_entity` / `query` / `register_query` / …). Thin wrapper around the [`@1c-odata/mcp`](https://github.com/hacker-cb/1c-odata) npm server. |

More GitHub-specific skills and rules (issues / backlog, …) will be added over time.

## Repository layout

```text
.claude-plugin/marketplace.json   # the marketplace catalog
plugins/hcb-<domain>/             # one themed (first-party) plugin per domain
  .claude-plugin/plugin.json
  skills/<skill>/SKILL.md
external_plugins/<name>/          # thin wrapper around an external npm MCP server
  .claude-plugin/plugin.json      #   upstream name, no version
  .mcp.json                       #   npx <pkg>@latest
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
