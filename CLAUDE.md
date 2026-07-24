# Repository guide for Claude Code

This repo is a **Claude Code plugin marketplace** named `hacker-cb-plugins`. It both *is* a marketplace (`.claude-plugin/marketplace.json`) and *hosts* the plugins it lists — first-party plugins under `plugins/` and thin external-MCP wrappers under `external_plugins/`.

Official documentation — consult before changing structure. The raw `.md` URLs are WebFetch-friendly and on Claude's preapproved doc domains, so fetch them on demand (do **not** vendor or `@`-import them — `@` imports local files only, and these large refs would load in full every session).

**Start from the index**: <https://code.claude.com/docs/llms.txt> lists every docs page as one line (title, `.md` URL, one-sentence summary). Fetch it when the page you need isn't in the shortlist below, or to confirm a URL still exists before trusting one from memory — pages get renamed and merged (custom slash commands, for instance, now live inside the Skills page).

Shortlist for this repo:

- Plugins (authoring guide): <https://code.claude.com/docs/en/plugins.md>
- Plugins reference (manifest schema, component dirs, `${CLAUDE_PLUGIN_ROOT}`, version pinning, cache/file-resolution): <https://code.claude.com/docs/en/plugins-reference.md>
- Marketplaces (`marketplace.json` schema, hosting, install flow): <https://code.claude.com/docs/en/plugin-marketplaces.md>
- Plugin dependencies (version constraints between plugins, bundling a curated set behind one install): <https://code.claude.com/docs/en/plugin-dependencies.md>
- Plugin relevance (the marketplace-entry block that makes Claude Code suggest a plugin when the user's work matches): <https://code.claude.com/docs/en/plugin-relevance.md>
- Skills (`SKILL.md` frontmatter, progressive disclosure, custom slash commands): <https://code.claude.com/docs/en/skills.md>
- Subagents (`agents/` component dir, frontmatter, tool scoping): <https://code.claude.com/docs/en/sub-agents.md>
- Hooks (events, stdin JSON, exit-code / `additionalContext` contract, matchers, plugin `hooks.json`): <https://code.claude.com/docs/en/hooks.md>
- MCP (server config, transports, auth — the `.mcp.json` that `external_plugins/*` wrap): <https://code.claude.com/docs/en/mcp.md>
- Tools reference (tool names for skill `allowed-tools` + hook matchers, `ToolName(specifier)` permission format): <https://code.claude.com/docs/en/tools-reference.md>

## Conventions

- **One themed plugin per domain** under `plugins/hcb-<domain>/`, each with its own `.claude-plugin/plugin.json`.
- **Naming**: plugin names are prefixed `hcb-` (`hcb-<domain>`). Skills / commands / agents are **not** prefixed — the `hcb-<domain>:` namespace already shows provenance in the `/` menu.
- **Skills** live at `plugins/hcb-<domain>/skills/<skill>/SKILL.md`; frontmatter needs a `description` (≤ 1024 chars). Supporting files (`references/`, `scripts/`) sit next to `SKILL.md`.
- Component dirs (`skills/`, `commands/`, `agents/`, `hooks/`) go in the **plugin root**, never inside `.claude-plugin/`.
- **Versioning**: a plugin's `version` (semver, in its `plugin.json`) is the **only** version in the repo — there is no marketplace-level version and no release tags/artifacts. `scripts/validate.sh` enforces that it is valid semver and not duplicated in the marketplace entry.
- **External MCP wrappers** live under `external_plugins/<name>/` (not `plugins/`): a thin `plugin.json` + `.mcp.json` wrapper around a third-party / own **npm** MCP server, mirroring the `anthropics/claude-plugins-official` layout. Use the **upstream package name** (no `hcb-` prefix) and **omit** `version` — the server is versioned in its own repo and pinned via `@latest` / `@x.y.z` in `.mcp.json`. `scripts/validate.sh` exempts `./external_plugins/*` from the `hcb-` prefix and the per-plugin-semver axis (both still enforced for `./plugins/*`). See `external_plugins/markdown-docs/` for the worked example.
- **Claude Code's own paths**: never hardcode one. Resolve it from the documented environment variable — `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` for the user directory (the variable may point anywhere), `${CLAUDE_PLUGIN_ROOT}` for a plugin's own files. Check <https://code.claude.com/docs/en/env-vars.md> rather than recalling a name, and note where a path's internal layout is undocumented — anything relying on it degrades gracefully instead of failing.
- **Authoring skills**: when creating or substantially revising a `SKILL.md`, use the **skill-creator** methodology — draft per its Skill Writing Guide (a trigger-focused, slightly "pushy" `description`; progressive disclosure; imperative body that explains *why*) and tune triggering with its description-optimization loop (`run_loop.py`). On Claude Code web it's mounted at `/mnt/skills/examples/skill-creator`; otherwise pull it from Anthropic's public skills repo.

## Commands

```bash
bash scripts/validate.sh         # structural validation + naming convention (the CI gate)
```

When you add or change a plugin/skill, run `scripts/validate.sh` and keep `README.md` and `CONTRIBUTING.md` in sync. See `CONTRIBUTING.md` for step-by-step instructions.
