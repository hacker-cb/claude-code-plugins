---
name: seeding-gitignore
description: >-
  Use whenever a `.gitignore` at any depth is created or edited, when a repo is initialized (`git init`), and before every commit — check what is about to be staged and ignore local artifacts instead of committing them. Also use when the user asks to ignore `.DS_Store`, Claude Code local files, Superpowers artifacts, AgentsRoom (Agentsroom AI) project state, git worktrees, or any OS-level noise. Provides the canonical baseline every project of this user carries — OS noise, editor swap files, per-developer Claude Code files (`.claude/settings.local.json`, `CLAUDE.local.md`) while the rest of `.claude/` stays committed, local agent-tooling state (`.superpowers/`, `.agentsroom/`), and git worktree directories (`.worktrees/`, `.claude/worktrees/`). Apply unconditionally regardless of language or framework; language-specific patterns are chosen separately, from what the project actually uses.
---

# Seeding `.gitignore`

Two parts: a fixed baseline that every repo of this user carries, and
language-specific patterns derived from the project itself.

## Before a commit

Look at what is about to be staged (`git status --short`). If it contains local
artifacts — anything from the baseline below, build output, caches, editor or OS
noise — do not commit them: add the pattern to `.gitignore` first. A file already
tracked stays tracked after the pattern is added; untrack it with
`git rm --cached <path>` in the same commit.

## Part 1 — the baseline (always, verbatim)

```gitignore
# --- OS ---
.DS_Store
.AppleDouble
.LSOverride
Icon
._*
Thumbs.db
ehthumbs.db
desktop.ini
$RECYCLE.BIN/

# --- Editor swap / backup ---
*.swp
*.swo
*~

# --- Claude Code: per-developer files only ---
# Everything else under .claude/ is committed.
CLAUDE.local.md
.claude/settings.local.json
.claude/*.local.json
.claude/scheduled_tasks.json
.claude/scheduled_tasks.lock

# --- Local agent-tooling state ---
.superpowers/
.agentsroom/

# --- Git worktrees ---
.worktrees/
.claude/worktrees/
```

What each ignored entry is, so nothing gets over- or under-matched:

- `CLAUDE.local.md` — personal project memory. Nothing auto-ignores it; this
  line is the only barrier.
- `.claude/settings.local.json`, `.claude/*.local.json` — personal setting
  overrides. Claude Code adds the first one to the machine's global git ignore
  when it creates the file, but the repo needs its own rule so it travels.
- `.claude/scheduled_tasks.json`, `.claude/scheduled_tasks.lock` — schedule
  state and its lock, written by the `/schedule` and `/loop` plugins. Per-machine
  (the tasks run on whoever's box created them), so both stay out of git;
  harmless if those plugins are unused.
- `.superpowers/` — Superpowers per-session artifacts.
- `.agentsroom/` — AgentsRoom (Agentsroom AI) per-project state.
- `.worktrees/`, `.claude/worktrees/` — checkouts of the repo inside itself,
  never committed. Two paths because two mechanisms create them: the Superpowers
  `using-git-worktrees` skill defaults to the first, Claude Code's native
  `/worktree` to the second. List both.

**Everything else under `.claude/` is committed** — `settings.json`,
`CLAUDE.md`, `rules/`, `skills/`, `commands/`, `agents/`, `hooks/`, and any
future team-shared file. So is `.mcp.json` at the repo root. Never blanket-ignore
`.claude/`; that setup is meant to be shared with the team and with future-you on
another machine.

## Part 2 — language and framework patterns

The baseline says nothing about `node_modules/`, `target/`, `__pycache__/`,
`dist/`, or `.venv/`. Work those out per project instead of pasting a
one-size-fits-all list:

1. Look at what the repo actually contains — manifests and lockfiles
   (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Gemfile`,
   `*.csproj`, …), build config, framework markers.
2. Add the ignore patterns that those tools genuinely produce: dependency
   directories, build output, caches, coverage reports, local env files.
3. Put them in their own section below the baseline, never mixed into it.

If unsure which patterns a stack needs, take the canonical template from
`github/gitignore` for that language rather than inventing entries.

## Editing an existing `.gitignore`

Read the file first, then **add only what is missing**. Never reorder, rewrite,
or wholesale-replace an existing file, and match its comment style and section
dividers instead of imposing the `# --- ... ---` style above.

If the file follows a third-party or vendor convention (generated, or owned by a
framework's own tooling), skip this skill and follow that convention.
