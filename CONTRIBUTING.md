# Contributing

This repo is a Claude Code plugin marketplace (`hacker-cb-plugins`). It hosts themed plugins; each plugin bundles one or more skills (and, later, commands / agents / rules).

Official docs: <https://code.claude.com/docs/en/plugins.md> ·
<https://code.claude.com/docs/en/plugin-marketplaces> ·
<https://code.claude.com/docs/en/skills>

## Naming convention

- **Plugins are prefixed with `hcb-`**: `hcb-<domain>` (e.g. `hcb-github`). This makes the `/`-menu namespace obviously personal/non-official and avoids clashing with official plugins (e.g. the official `github` plugin).
- **Skills, commands and agents are NOT prefixed.** The visible plugin namespace (`hcb-<domain>:`) already carries the provenance, so name them for what they do: `github-pr-workflow` → `/hcb-github:github-pr-workflow`.

`scripts/validate.sh` enforces the plugin-name prefix.

## Add a skill to an existing plugin

> Author skills with the **skill-creator** methodology: draft per its Skill Writing Guide and tune the `description` for reliable triggering with its `run_loop.py`. On Claude Code web it's mounted at `/mnt/skills/examples/skill-creator`; otherwise pull it from Anthropic's public skills repo.

1. Create `plugins/hcb-<domain>/skills/<skill-name>/SKILL.md`:

   ```markdown
   ---
   name: <skill-name>          # optional; if set, must equal the directory name
   description: <what it does and WHEN to use it>   # required in practice; ≤ 1024 chars
   ---

   # <Skill title>

   Instructions Claude follows when this skill runs. Keep it tight.
   ```

2. Optional supporting files live next to `SKILL.md`: `references/*.md`, `scripts/*`, etc. Reference them from `SKILL.md` so Claude knows when to load them.
3. The skill is invoked as `/hcb-<domain>:<skill-name>`.

## Add a new plugin

1. Create the plugin directory and manifest:

   ```text
   plugins/hcb-<domain>/
     .claude-plugin/plugin.json   # { "name": "hcb-<domain>", "description": ..., "version": "0.1.0", ... }
     skills/...
     README.md
   ```

2. Add an entry to `.claude-plugin/marketplace.json`:

   ```json
   {
     "name": "hcb-<domain>",
     "source": "./plugins/hcb-<domain>",
     "description": "...",
     "category": "...",
     "tags": ["..."]
   }
   ```

   Keep `version` (semver) in `plugin.json` only — it's the single source of truth for the plugin. Don't add a version to the marketplace entry or anywhere else; `scripts/validate.sh` enforces both (valid semver, and no `version` on the marketplace entry).

## Add an external MCP wrapper

For an MCP server that lives in its **own** repo / npm package (third-party or your own), don't re-host its code — add a thin wrapper under `external_plugins/`, mirroring the [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official) layout:

```text
external_plugins/<name>/
  .claude-plugin/plugin.json   # { "name": "<upstream-name>", "description": ..., "author": {...} } — NO version
  .mcp.json                    # { "<server>": { "command": "npx", "args": ["-y", "<pkg>@latest"] } }
  README.md
```

Then add a marketplace entry with a relative `source`:

```json
{
  "name": "<upstream-name>",
  "source": "./external_plugins/<name>",
  "description": "...",
  "category": "...",
  "tags": ["mcp", "..."],
  "homepage": "https://github.com/<owner>/<repo>"
}
```

Unlike `plugins/hcb-*`, wrappers use the **upstream package name** (no `hcb-` prefix) and **omit** `version` — the server is versioned in its own repo and pinned in `.mcp.json` (`@latest` or `@x.y.z`). `scripts/validate.sh` exempts `./external_plugins/*` from the prefix and semver checks. See `external_plugins/markdown-docs/` for a worked example.

## Rules

Two patterns, depending on whether the rule is task-triggered or always-on:

- **Task-triggered rule** → a **knowledge skill**: a `SKILL.md` whose body is guidance rather than a step-by-step procedure. If it shouldn't clutter the `/` menu or be auto-invoked, add frontmatter `user-invocable: false` and/or `disable-model-invocation: true`.
- **Always-on rule** (applies every session, e.g. a communication / language house style) → a `SessionStart` **hook**: `hooks/hooks.json` plus an executable script that prints the guidance to stdout. Make any per-user knobs **configurable** with `userConfig` in `plugin.json` — Claude Code prompts for them on enable, stores non-sensitive values in `settings.json` under `pluginConfigs."<plugin>@<marketplace>".options`, and exports them to the hook as `CLAUDE_PLUGIN_OPTION_*` (the key is upper-cased). See `plugins/hcb-dev` for a worked example.

## Add a command to an existing plugin

A **command** is a deterministic, user-invoked slash entry (`/hcb-<domain>:<name>`) — use it (over a skill) when the action just runs a script with arguments. Create `plugins/hcb-<domain>/commands/<name>.md`:

```markdown
---
description: <what it does>
argument-hint: '[sub-command]'
disable-model-invocation: true        # user-only; the model won't auto-invoke
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/<tool>" $ARGUMENTS`

Then: how Claude should present / act on the command output.
```

The `!`-prefixed line runs at command-expansion time; `${CLAUDE_PLUGIN_ROOT}` and `$ARGUMENTS` are both substituted. See `plugins/hcb-dev/commands/rules.md` for a worked example.

## Plugin engines (Node)

A plugin whose hooks/commands need real logic ships a small **Node engine** rather than bash. The conventions (worked example: `plugins/hcb-dev`):

- **Plain ESM `.mjs`, zero runtime dependencies.** The only dev tooling is `typescript` + `@types/node` (repo-root `package.json`). Hooks and commands invoke it as `node "${CLAUDE_PLUGIN_ROOT}/…"`.
- **Testable core in `lib/`, thin process glue in `bin/`.** Put logic in pure, injectable functions under `lib/*.mjs`; keep `bin/*` (stdin / `process.exit` wrappers) trivial — it's excluded from the coverage gate and covered behaviorally by an integration test instead.
- **A plugin-local `package.json` with `{"type":"module"}`** so an extensionless `bin/` entry resolves as ESM from the installed plugin cache.
- **Tests** live in repo-root `tests/<area>.test.mjs` using the built-in `node --test` runner + `node:assert/strict`. CI (`.github/workflows/test.yml`) enforces **100% coverage** and a `tsc --checkJs` type-check.

```bash
npm ci && npm test          # quick run
npm run test:cov            # the 100% coverage gate (CI)
npm run typecheck           # tsc --checkJs (CI)
```

## Before opening a PR

```bash
bash scripts/validate.sh         # structural validation — must pass (0 errors)
npm run test:cov                 # engine tests + 100% coverage (if you touched lib/ or tests/)
npm run typecheck                # tsc --checkJs (same)
```

CI runs the structural validation plus the official `claude plugin validate` (validate.yml), and the Node engine test + type-check gate (test.yml).
