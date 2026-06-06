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

   Keep `version` in `plugin.json` only — don't duplicate it in the marketplace entry.

## Rules

There is no separate "rules" component. Model a rule as a **knowledge skill**: a `SKILL.md` whose body is guidance rather than a step-by-step procedure. If it shouldn't clutter the `/` menu or be auto-invoked, add frontmatter `user-invocable: false` and/or `disable-model-invocation: true`.

## Before opening a PR

```bash
bash scripts/validate.sh         # must pass (0 errors)
bash scripts/package-skills.sh   # sanity-check packaging
```

CI runs the same structural validation plus the official `claude plugin validate`.
