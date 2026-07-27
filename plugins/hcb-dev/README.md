# hcb-dev

A personal developer baseline for Claude Code: a connected set of skills that
carry work from a task or an issue, through slicing and local review, to
completion — merged locally into its parent branch, or an open change request
driven to merge — plus the git-and-session hygiene around it. Part of the
[`hacker-cb-plugins`](https://github.com/hacker-cb/claude-code-plugins)
marketplace.

## Install

```text
/plugin marketplace add hacker-cb/claude-code-plugins
/plugin install hcb-dev@hacker-cb-plugins
```

## How the skills fit together

Most of these skills call each other, so installing the plugin gives you the
whole pipeline rather than eight disconnected commands:

```text
tasks / issues ─▶ implementation-workflow ─┐  analysis · slices · one planning gate · report
                                           │
              (or finished work) ──────────┴─▶ shipping-workflow ─▶ multi-review ─▶ codex-review
                                                     │                              code-review (built-in)
                                                     │                              security-review (built-in)
                                                     └─▶ complete by mode:
                                                           local   ─▶ git merge into parent  (then offer a PR/MR)
                                                           request ─▶ github-pr-workflow ─▶ (merge)

dependency-versions ─ seeding-gitignore ─ run alongside, whenever the work touches them
git-cleanup ───────────────────────────── manual only, afterwards (see below)
```

`implementation-workflow` is the front door when you start from tasks or issues;
`shipping-workflow` is where you enter with finished work in hand. Each skill is
also useful on its own and triggers from its own `description` — except
`git-cleanup`, which sets `disable-model-invocation: true`: Claude never reaches
for it on its own, so it is **not** an automatic post-completion step. Run
`/hcb-dev:git-cleanup` yourself when you want the sweep.

## Skills

### Building from tasks

- **`implementation-workflow`** — `/hcb-dev:implementation-workflow`
  The front door when you start from tasks or issues rather than finished code.
  Deep-reads the tasks (free text, or GitHub/GitLab issue numbers) and the
  codebase, splits the work into independently reviewable slices (one is the
  normal case), settles the architectural questions **and** the completion mode
  (local merge vs change request) at one planning gate, then runs each slice
  through development, `multi-review`, and `shipping-workflow` autonomously —
  closing with a per-slice report. Calls `shipping-workflow` per slice; not for
  work that is already finished (that is `shipping-workflow` directly).

### Preparing a change

- **`dependency-versions`** — `/hcb-dev:dependency-versions`
  When adding or updating a dependency, resolve the version from the registry via
  the package manager's own `add`/`install` command instead of typing a literal
  from memory. Covers `cargo` / `pnpm` / `npm` / `uv` / `go` / `bundle`, the
  Node.js LTS pin, and GitHub Actions pinning; on GitHub repos it keeps
  `.github/dependabot.yml` in sync with the ecosystems in use.
- **`seeding-gitignore`** — `/hcb-dev:seeding-gitignore`
  Seed or extend a `.gitignore`: a fixed baseline this user carries everywhere
  (OS noise, editor swap files, per-developer Claude Code files, agent-tooling
  state, worktree dirs) plus language/framework patterns derived from what the
  project actually contains. Runs before every commit to keep local artifacts out
  of git.

### Reviewing it

- **`codex-review`** — `/hcb-dev:codex-review`
  Run a code review with Codex (`codex exec review`) over the current branch in a
  read-only sandbox. Review-only: returns Codex's findings verbatim and fixes
  nothing.
- **`multi-review`** — `/hcb-dev:multi-review`
  Run every available reviewer over one change at once — `codex-review`, the
  built-in code-review workflow, the built-in security review — then consolidate
  the findings and report what each reviewer actually covered (the coverage gate
  most of the skill exists to keep honest). Report-only.

### Completing it

- **`shipping-workflow`** — `/hcb-dev:shipping-workflow`
  Take one finished, verified slice to completion: commit, hand off to
  `multi-review`, apply the fixes, check coverage, then complete **by mode** —
  merged locally into its parent branch, or an open change request (handed to a
  PR/MR driver below). Steps 1–4 are identical in both modes; the mode is read
  only at the last step. The one confirmation gate is a coverage gap.
- **`github-pr-workflow`** — `/hcb-dev:github-pr-workflow`
  Drive a GitHub pull request from a finished branch to a merged PR: rename an
  auto-generated branch, rebase onto base, open the PR ready-for-review, loop on
  CI + Copilot fixes until GitHub reports it mergeable *and* your own bar is
  clean, then — only on your explicit go-ahead — merge, monitor, and report.
  Discovers the repo's actual merge gates instead of assuming them. See
  [`skills/github-pr-workflow/SKILL.md`](skills/github-pr-workflow/SKILL.md) and
  [`references/copilot.md`](skills/github-pr-workflow/references/copilot.md).

### Cleaning up

- **`git-cleanup`** — `/hcb-dev:git-cleanup` (manual-only)
  Sweep the git residue work leaves in a repository: merged and orphaned
  branches, stale or abandoned worktrees, dead upstream tracking. Two modes —
  `session` (only what this session created) and `all` (everything accumulated,
  other sessions' leftovers included). It covers what Claude Code's own worktree
  cleanup does not — `--worktree` and desktop worktrees, `-p` leftovers, and
  branches — and never removes a worktree another live session is working in.

## Shared references

Guidance more than one skill needs is kept in one place rather than copied into
each — copies drift, and a fix then lands in some of them while the rest go on
saying something else.

- [`references/base-resolution.md`](references/base-resolution.md) — how to
  resolve a base branch and its remote without guessing either name: the rung
  ladder, remote ranking (`upstream` before `origin`, a lone remote whatever it is
  called), why a read symref goes stale, why only the remote-tracking form is safe
  to carry forward, the non-interactive guard every network call needs, and why a
  base sharing no history with `HEAD` is worse than no base at all. Used by `codex-review`, `multi-review`, `git-cleanup`,
  `github-pr-workflow` and `implementation-workflow` — every skill that resolves a
  base or a remote — and by `slice-completion.md`, through which `shipping-workflow`
  reaches it.
- [`references/slice-completion.md`](references/slice-completion.md) — how a slice
  *ends*: the completion contract (the signals a backend receives and returns),
  the two backends (`local` git-merge into the parent, and the forge-detected
  `request` change request), the default/protected-branch hard-gate, the merge
  strategy and authorization, and the offer arbitration. Read by `shipping-workflow`
  (its final step) and `implementation-workflow` (the whole-feature offer).
- [`references/architecture-decisions.md`](references/architecture-decisions.md) —
  the decision protocol: ask about architecture / act on mechanics, always show a
  recommendation (never a bare question), and flag a project rule that fights good
  architecture as possible drift. Read by `implementation-workflow` at its gate,
  and by the stop-and-ask points in `shipping-workflow` and `github-pr-workflow`.
- [`references/report-format.md`](references/report-format.md) — the final-report
  shape (per-slice outcomes, coverage and what stayed uncovered, incidental
  findings rated by importance, an explicit "none"). Shared by
  `implementation-workflow` and `shipping-workflow`.

## Forge neutrality

Per the repo's authoring rule ([`.claude/rules/forge-neutrality.md`](../../.claude/rules/forge-neutrality.md)),
these skills avoid assuming a single forge. Where the guidance needs a concrete
command — resolving a base, opening a change request — the GitHub (`gh`) and
GitLab (`glab`) forms are given side-by-side.

Two deliberate exceptions, each stated where it occurs:

- `github-pr-workflow` is GitHub-specific by design, named per the rule's
  `<forge>-<artifact>-workflow` convention; a `gitlab-mr-workflow` twin can be
  added later. Until it exists, request-mode completion on GitLab uses
  `shipping-workflow`'s mirrored `glab` fallback — and the stacked-PR handling in
  `github-pr-workflow` is documented forge-neutrality **debt** owed to that twin
  (it will need a GitLab merge-train mirror when it lands).
- `codex-review`'s runnable block resolves the base with `gh` only. Codex itself
  takes a plain git ref and is forge-agnostic, and where `gh` is absent the block
  falls through to git's own remote refs; on GitLab, resolve a non-default base
  with the mirrored `glab mr` commands in that skill's §1 and hand it in as
  `BASE`.

## Requirements

- **`implementation-workflow`**: plain `git`, plus whatever the reviewers and the
  completion it drives per slice need (`multi-review` / `codex`, and in request
  mode `github-pr-workflow` or `gh` / `glab`). Forge-neutral issue intake reads a
  given issue number via `gh` / `glab`. Runs in the main conversation.
- **`dependency-versions`**: the relevant package manager on `PATH`.
- **`codex-review`** / **`multi-review`**: the `codex` CLI installed and
  `codex login` live; `multi-review` also picks up the built-in code-review and
  security-review tooling when present.
- **`shipping-workflow`**: plain `git` for the commit and the branch push, plus
  *some* way to open a change request — a PR/MR driver skill when one is
  installed (`github-pr-workflow` here), otherwise `gh` on GitHub or `glab` on
  GitLab. Nothing in it is GitHub-only.
- **`github-pr-workflow`**: GitHub specifically — a GitHub MCP server connected,
  or the `gh` CLI authenticated (`gh auth status`). Plain `git` for the local
  branch / rebase / push operations.
- **`git-cleanup`**: `git` alone is enough. It reads merged/open change requests
  through `gh` or `glab` when one is authenticated — that is what catches
  squash-merged branches — and degrades to git-only when neither is. To tell
  which worktrees are occupied it also reads Claude Code's live-session registry
  under `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`; that format is internal, so when
  it is absent the skill says so and stops deleting worktrees on its own.
