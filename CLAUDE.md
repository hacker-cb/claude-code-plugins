# Repository guide for Claude Code

This repo is a **Claude Code plugin marketplace** named `hacker-cb-plugins`. It both *is* a marketplace (`.claude-plugin/marketplace.json`) and *hosts* the plugins it lists (under `plugins/`).

Official documentation — consult before changing structure:

- Plugins: <https://code.claude.com/docs/en/plugins.md>
- Marketplaces: <https://code.claude.com/docs/en/plugin-marketplaces>
- Skills: <https://code.claude.com/docs/en/skills>

## Conventions

- **One themed plugin per domain** under `plugins/hcb-<domain>/`, each with its own `.claude-plugin/plugin.json`.
- **Naming**: plugin names are prefixed `hcb-` (`hcb-<domain>`). Skills / commands / agents are **not** prefixed — the `hcb-<domain>:` namespace already shows provenance in the `/` menu.
- **Skills** live at `plugins/hcb-<domain>/skills/<skill>/SKILL.md`; frontmatter needs a `description` (≤ 1024 chars). Supporting files (`references/`, `scripts/`) sit next to `SKILL.md`.
- Component dirs (`skills/`, `commands/`, `agents/`, `hooks/`) go in the **plugin root**, never inside `.claude-plugin/`.
- **Versioning**: a plugin's `version` (semver, in its `plugin.json`) is the **only** version in the repo — there is no marketplace-level version and no release tags/artifacts. `scripts/validate.sh` enforces that it is valid semver and not duplicated in the marketplace entry.
- **Always-on rules** (e.g. a communication / language house style) are delivered with a `SessionStart` **hook** (`hooks/hooks.json` + an executable script that prints the guidance to stdout — SessionStart adds stdout straight to context). Make per-user knobs **configurable** with `userConfig` in `plugin.json`: values reach the hook as `CLAUDE_PLUGIN_OPTION_*` env vars (the key is upper-cased: `lang_chat` → `CLAUDE_PLUGIN_OPTION_LANG_CHAT`) and persist in `settings.json` under `pluginConfigs."<plugin>@<marketplace>".options` — prefer this over hardcoded values or hand-edited `env`.
- **Authoring skills**: when creating or substantially revising a `SKILL.md`, use the **skill-creator** methodology — draft per its Skill Writing Guide (a trigger-focused, slightly "pushy" `description`; progressive disclosure; imperative body that explains *why*) and tune triggering with its description-optimization loop (`run_loop.py`). On Claude Code web it's mounted at `/mnt/skills/examples/skill-creator`; otherwise pull it from Anthropic's public skills repo.

## Commands

```bash
bash scripts/validate.sh         # structural validation + naming convention (the CI gate)
```

When you add or change a plugin/skill, run `scripts/validate.sh` and keep `README.md` and `CONTRIBUTING.md` in sync. See `CONTRIBUTING.md` for step-by-step instructions.
