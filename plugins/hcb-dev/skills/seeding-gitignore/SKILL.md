---
name: seeding-gitignore
description: >-
  Use whenever a `.gitignore` at any depth is created or edited, when a repo is initialized (`git init`), and before every commit — check what is about to be staged and ignore local artifacts instead of committing them. Also use when the user asks to ignore `.DS_Store`, `.claude/settings.local.json`, `CLAUDE.local.md`, `.worktrees/`, Superpowers artifacts, AgentsRoom (Agentsroom AI) project state, Playwright or other browser/test-run output, git worktrees, or any OS-level noise. Provides the canonical baseline every project of this user carries — OS noise, editor swap files, per-developer Claude Code files while the rest of `.claude/` stays committed, local agent-tooling state, and git worktree directories. Apply unconditionally regardless of language or framework; language-specific patterns are chosen separately, from what the project actually uses.
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
.playwright-mcp/
.playwright-cli/

# --- Git worktrees ---
.worktrees/
.claude/worktrees/
```

**Everything under `.claude/` other than the per-developer files above is
committed**, and so is `.mcp.json` at the repo root. Never blanket-ignore
`.claude/`.

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
[github/gitignore](https://github.com/github/gitignore) for that language rather
than inventing entries. Those templates stop at the language and its build
system; for anything past it, read
[`references/tool-artifacts.md`](references/tool-artifacts.md).

## Editing an existing `.gitignore`

Read the file first, then **add only what is missing**. Never reorder, rewrite,
or wholesale-replace an existing file, and match its comment style and section
dividers instead of imposing the `# --- ... ---` style above.

If the file follows a third-party or vendor convention (generated, or owned by a
framework's own tooling), skip this skill and follow that convention.
