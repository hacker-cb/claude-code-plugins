# hcb-dev

A personal developer baseline for Claude Code — communication/language house
style plus a couple of everyday best-practice skills. Part of the
[`hacker-cb-plugins`](https://github.com/hacker-cb/claude-code-plugins)
marketplace.

## Install

```text
/plugin marketplace add hacker-cb/claude-code-plugins
/plugin install hcb-dev@hacker-cb-plugins
```

## Configuration

On enable, the plugin prompts for a few settings (stored in `settings.json` under
`pluginConfigs.hcb-dev.options`). All are optional — the defaults reproduce the
author's setup and can be changed any time via the `/plugin` menu or by editing
`settings.json`.

| Setting | Default | What it controls |
| --- | --- | --- |
| `lang_chat` | `Russian` | Language for chat replies |
| `lang_plans` | `Russian` | Language for temporary plan/spec working notes |
| `lang_comments` | `English` | Language for code comments |
| `lang_docs` | `English` | Language for project documentation |
| `use_emojis` | `true` | Whether to use emojis in chat |

## What it does

### House style — `SessionStart` hook

At the start of every session, the plugin injects a short "house style" derived
from the settings above: which language to use in chat (and whether to use
emojis), and which language to use for plan/spec notes, code comments, and
project docs. Durable artifacts (code identifiers, commit messages) stay in
English. No invocation needed — it applies automatically.

### Skills

#### `dependency-versions` — `/hcb-dev:dependency-versions`

When adding or updating a dependency, resolve the version from the registry via
the package manager's own `add`/`install` command instead of typing a version
literal from memory. Covers `cargo` / `pnpm` / `npm` / `uv` / `go` / `bundle`,
the Node.js LTS pin, and GitHub Actions version pinning.

#### `library-docs` — `/hcb-dev:library-docs`

When asked about a library, framework, SDK, API, CLI, or cloud service, pull the
current documentation from the **Context7 MCP server** first — even for
well-known tools — rather than relying on (possibly stale) training data. Falls
back to web search only if Context7 returns nothing.

**Requirements:** the [Context7](https://github.com/upstash/context7) MCP server
connected. Without it, the skill falls back to web search.
