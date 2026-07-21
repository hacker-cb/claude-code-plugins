# hcb-dev

A personal developer baseline for Claude Code: resolve dependency versions from
the registry instead of typing them from memory, and pull current library docs
from Context7 before answering. Part of the
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

### `library-docs` — `/hcb-dev:library-docs`

When asked about a library, framework, SDK, API, CLI, or cloud service, pull the
current documentation from the **Context7 MCP server** first — even for
well-known tools — rather than relying on (possibly stale) training data. Falls
back to web search only if Context7 returns nothing.

**Requirements:** the [Context7](https://github.com/upstash/context7) MCP server
connected. Without it, the skill falls back to web search.
