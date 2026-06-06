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
- Keep a plugin's `version` in its `plugin.json` only (not in the marketplace entry).

## Commands

```bash
bash scripts/validate.sh         # structural validation + naming convention (the CI gate)
bash scripts/package-skills.sh   # build standalone dist/*.skill files
```

When you add or change a plugin/skill, run `scripts/validate.sh` and keep `README.md` and `CONTRIBUTING.md` in sync. See `CONTRIBUTING.md` for step-by-step instructions.
