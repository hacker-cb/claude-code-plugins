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
`pluginConfigs."hcb-dev@hacker-cb-plugins".options`). All are optional — the
defaults reproduce the author's setup and can be changed any time via
`/plugin configure hcb-dev@hacker-cb-plugins`, the `--config KEY=VALUE` flag at
install, or by editing `settings.json`.

| Setting | Default | What it controls |
| --- | --- | --- |
| `lang_chat` | `Russian` | Language for chat replies |
| `lang_plans` | `Russian` | Language for temporary plan/spec working notes |
| `lang_comments` | `English` | Language for code comments |
| `lang_docs` | `English` | Language for project documentation |
| `lang_issues` | `Russian` | Language for GitHub / GitLab issues (titles, descriptions, comments) |
| `use_emojis` | `true` | Whether to use emojis in chat |

## What it does

### House style — `SessionStart` hook

At the start of every session, the plugin injects a short "house style" derived
from the settings above: which language to use in chat (and whether to use
emojis), and which language to use for plan/spec notes, code comments, project
docs, and GitHub/GitLab issues. Durable artifacts (code identifiers, commit
messages) stay in English. No invocation needed — it applies automatically.

These are **low-priority personal defaults**: they apply only when nothing more
specific does. Project instructions (e.g. `CLAUDE.md`), conventions already
established in the repo, and explicit requests in the conversation all take
precedence over them.

### Managed rules — `/hcb-dev:rules`

The plugin carries a small set of **canonical cross-project rules** — branching
& PR flow, issue tracking, and the early-stage breaking-change policy — that
several of the author's repos must share verbatim. Instead of hand-copying them,
a project adopts them with one command:

```text
/hcb-dev:rules sync     # write/update the managed rule files, record the lock
/hcb-dev:rules check    # report drift without writing (the default with no arg)
```

`sync` materializes each enabled rule into `.claude/rules/hcb/<name>.md` (Claude
Code loads `.claude/rules/**` automatically) and records a lock at
`.claude/hcb-dev/rules.json`. New canon rules auto-adopt on the next `sync`; a
rule disabled in the lock is removed. The canon itself lives in the plugin under
`rules/canonical/`, indexed by `rules/manifest.json`.

Two hooks keep the managed copies faithful to canon:

- a **`PreToolUse` guard** denies any `Edit`/`Write`/`NotebookEdit` to a file
  under `.claude/rules/hcb/` — the synced copies are owned by the plugin, so a
  change must be made to the canon and re-synced, never edited in place;
- a **`SessionStart` drift check** prints a short, actionable note when an
  adopted project's managed files no longer match canon (and stays silent
  otherwise).

To change a managed rule, edit its canon in
`plugins/hcb-dev/rules/canonical/` and run `/hcb-dev:rules sync`.

### Skills

#### `dependency-versions` — `/hcb-dev:dependency-versions`

When adding or updating a dependency, resolve the version from the registry via
the package manager's own `add`/`install` command instead of typing a version
literal from memory. Covers `cargo` / `pnpm` / `npm` / `uv` / `go` / `bundle`,
the Node.js LTS pin, and GitHub Actions version pinning. On GitHub-hosted repos
it also keeps `.github/dependabot.yml` in sync with the ecosystems in use —
extending an existing config automatically, and offering to enable Dependabot
(with sane grouping + cooldown defaults) when there is none.

#### `library-docs` — `/hcb-dev:library-docs`

When asked about a library, framework, SDK, API, CLI, or cloud service, pull the
current documentation from the **Context7 MCP server** first — even for
well-known tools — rather than relying on (possibly stale) training data. Falls
back to web search only if Context7 returns nothing.

**Requirements:** the [Context7](https://github.com/upstash/context7) MCP server
connected. Without it, the skill falls back to web search.
