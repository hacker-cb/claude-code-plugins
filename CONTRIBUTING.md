# Contributing

This repo is a Claude Code plugin marketplace (`hacker-cb-plugins`). It hosts themed plugins; each plugin bundles one or more skills (and, later, commands / agents / rules).

Official docs:

- Plugins: <https://code.claude.com/docs/en/plugins>
- Marketplaces: <https://code.claude.com/docs/en/plugin-marketplaces>
- Skills: <https://code.claude.com/docs/en/skills>
- Full index of every docs page: <https://code.claude.com/docs/llms.txt>

## Naming convention

- **Plugins are prefixed with `hcb-`**: `hcb-<domain>` (e.g. `hcb-dev`). This makes the `/`-menu namespace obviously personal/non-official and avoids clashing with official plugins (e.g. the official `github` plugin).
- **Skills, commands and agents are NOT prefixed.** The visible plugin namespace (`hcb-<domain>:`) already carries the provenance, so name them for what they do: `github-pr-workflow` → `/hcb-dev:github-pr-workflow`.

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
3. **Shared between skills?** Put it one level up, in `plugins/hcb-<domain>/references/*.md`, and link it from each skill by relative path (`../../references/<file>.md`, i.e. `${CLAUDE_PLUGIN_ROOT}/references/<file>.md`). Only `skills/`, `commands/`, `agents/` and `hooks/` are component dirs, so a `references/` at the plugin root is data, not a component — `scripts/validate.sh` only scans `*/skills/*/SKILL.md` and ignores it. Prose copied into two skills drifts: a fix lands in one and the other keeps saying something else. See `plugins/hcb-dev/references/base-resolution.md`, shared by five skills.
4. The skill is invoked as `/hcb-<domain>:<skill-name>`.

A **rule** is the same artifact: a skill whose body is guidance rather than a step-by-step procedure, with the triggering conditions carried by the `description` so it's pulled in exactly when relevant. To keep one out of the `/` menu, add frontmatter `user-invocable: false` (it can still be model-invoked); to keep Claude from auto-invoking it, add `disable-model-invocation: true` (it stays available as a slash command). Setting both makes the skill unreachable.

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

## Before opening a PR

```bash
bash scripts/validate.sh         # must pass (0 errors)
```

CI runs the same structural validation plus the official `claude plugin validate`.
