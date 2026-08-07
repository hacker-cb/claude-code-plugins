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
whole pipeline rather than eleven disconnected commands:

```text
tasks / issues ─▶ implementation-workflow ─┐  analysis · slices · one planning gate · report
                                           │
              (or finished work) ──────────┴─▶ shipping-workflow ─▶ multi-review ─▶ codex-review
                                                     │                              code-review (built-in)
                                                     │                              security-review (built-in)
                                                     └─▶ complete by mode:
                                                           local   ─▶ git merge into parent  (then offer a PR/MR)
                                                           request ─▶ github-pr-workflow ─▶ (merge)

issue-tracking ────────────────────────── the backlog — at intake, in the report, after a merge
dependency-versions ─ seeding-gitignore ─ run alongside, whenever the work touches them
session-dispatch ─▶ (another session works) ─▶ session-handoff ─▶ (back to you)
git-cleanup ───────────────────────────── manual only, afterwards (see below)
```

`implementation-workflow` is the front door when you start from tasks or issues;
`shipping-workflow` is where you enter with finished work in hand. Each skill is
also useful on its own and triggers from its own `description` — except the three
that set `disable-model-invocation: true`, `session-dispatch`, `session-handoff`
and `git-cleanup`: Claude never reaches for any of them on its own, so none is an
automatic post-completion step. Run them yourself when you want them.

Nothing crosses between sessions on its own — you carry every dispatch and every
handoff by hand, so the prompt text is the whole channel.

## Skills

### Building from tasks

- **`implementation-workflow`** — `/hcb-dev:implementation-workflow`
  The front door when you start from tasks or issues rather than finished code.
  Deep-reads the tasks (free text, or GitHub/GitLab issue numbers) and the
  codebase, splits the work into independently reviewable slices (one is the
  normal case), settles the architectural questions **and** the completion mode
  (local merge vs change request) at one planning gate, then runs each slice
  through development and `shipping-workflow` autonomously — closing with a
  per-slice report. Calls `shipping-workflow` per slice; not for work that is
  already finished (that is `shipping-workflow` directly).

### Tracking deferred work

- **`issue-tracking`** — `/hcb-dev:issue-tracking`
  The backlog side of the pipeline, on GitHub and GitLab alike: what earns an
  issue and what does not, the search that comes before opening one, the
  `## Drive-by observations` protocol that puts a finding to you as
  OPEN / DEFER / DISMISS, the shape of the issue body, and the three moments worth
  consulting open issues at. Which mechanism carries the kind of work in a given
  repository — native issue types, a label family, or neither — the cardinality
  between the families and who holds it when the platform will not, how a set gets
  proposed and created where the repository has none, and the two milestone
  patterns a repository can run, are
  [`skills/issue-tracking/references/classification.md`](skills/issue-tracking/references/classification.md).
  Called by `implementation-workflow` at intake and in its report, and by
  `github-pr-workflow` after a merge.

### Preparing a change

- **`dependency-versions`** — `/hcb-dev:dependency-versions`
  When adding or updating a dependency, resolve the version from the registry via
  the package manager's own `add`/`install` command instead of typing a literal
  from memory. Covers `cargo` / `pnpm` / `npm` / `uv` / `go` / `bundle`, the
  Node.js LTS pin, and GitHub Actions pinning; on GitHub repos it keeps
  `.github/dependabot.yml` in sync with the ecosystems in use.
- **`seeding-gitignore`** — `/hcb-dev:seeding-gitignore`
  Seed or extend a `.gitignore`: a fixed baseline this user carries everywhere
  (OS noise, editor swap files, per-developer Claude Code files, agent- and
  browser-tooling state, worktree dirs) plus language/framework patterns derived
  from what the project actually contains. Runs before every commit to keep local
  artifacts out of git. What the canonical templates leave out — test-runner,
  task-cache and deploy-CLI output, and which of a visual test's directories stays
  committed — is
  [`skills/seeding-gitignore/references/tool-artifacts.md`](skills/seeding-gitignore/references/tool-artifacts.md).

### Reviewing it

- **`codex-review`** — `/hcb-dev:codex-review`
  Run a code review with Codex (`codex exec review`) over the current branch in a
  read-only sandbox. Review-only: returns Codex's findings verbatim and fixes
  nothing.
- **`multi-review`** — `/hcb-dev:multi-review`
  Run several independent reviewers over one change at once — `codex-review`, the
  built-in code-review workflow, the built-in security review — then consolidate
  the findings and report what each reviewer actually covered (the coverage gate
  most of the skill exists to keep honest). Report-only.

### Completing it

- **`shipping-workflow`** — `/hcb-dev:shipping-workflow`
  Take one finished, verified slice to completion: normalize the branch name,
  commit, hand off to `multi-review`, apply the fixes, check coverage, then
  complete **by mode** — merged locally into its parent branch, or an open change
  request (handed to a PR/MR driver below). Steps 0–4 are identical in both modes;
  the mode is read only at the last step.
- **`github-pr-workflow`** — `/hcb-dev:github-pr-workflow`
  Drive a GitHub pull request from a finished branch to a merged PR: rename an
  auto-generated branch, rebase onto base, open the PR ready-for-review, loop on
  CI + Copilot fixes until GitHub reports it mergeable *and* your own bar is
  clean, then — only on your explicit go-ahead — merge, monitor, and report.
  Discovers the repo's actual merge gates instead of assuming them, and parks the
  run on a platform outage — checking the status feed every half hour — instead of
  fixing a red check the diff never caused. See
  [`skills/github-pr-workflow/SKILL.md`](skills/github-pr-workflow/SKILL.md),
  [`skills/github-pr-workflow/references/copilot.md`](skills/github-pr-workflow/references/copilot.md)
  and [`skills/github-pr-workflow/references/platform-status.md`](skills/github-pr-workflow/references/platform-status.md).

### Handing work across sessions

Two directions of one channel. The discriminator between them is whether the
work is **done** — not how the ask is worded.

- **`session-dispatch`** — `/hcb-dev:session-dispatch` (manual-only)
  Work this session will **not** do, turned into an order for another session to
  **implement**, run through `implementation-workflow`. This session's numbers,
  coordinates and settled decisions are the payload, and what it did *not* check
  is named beside them. Settles the ask, where to work, any mandatory domain
  methodology, the checks, the terminal deliverable, the completion mode (so the
  planning gate does not ask for it), which forks come back to you, and the
  negative constraint. Ends in a closing act that is never empty: either the
  shape of the answer to return — carried inline, because a sub-session cannot
  invoke a manual-only skill on its own — or an end state with nothing coming
  back. Tags each order so its answer can be matched to it. A question is not
  dispatched at all: that is a subagent or a workflow in the session that has it.
- **`session-handoff`** — `/hcb-dev:session-handoff` (manual-only)
  What this session **finished**, in whatever form the result took — code on a
  branch or in a change request, an investigation that changed no files, issues
  rewritten or reclassified, a documentation change. Carries the result, the
  complete list of change requests and issues it touched (each with the state it
  stopped at or what became of it), how to reach the work from the reader's own
  checkout, and a re-read of every number on the forge in full, comments
  included. Two postures — answering an order, where it reconciles against that
  order's own terms starting with the premises that did not survive; or unbidden,
  where it weighs the work against what the reader already has in flight,
  summarizes that for you and raises the non-obvious consequences before acting.
  Ends by offering `git-cleanup` for the residue.

### Cleaning up

- **`git-cleanup`** — `/hcb-dev:git-cleanup` (manual-only)
  Sweep the git residue work leaves in a repository: merged and orphaned
  branches, stale or abandoned worktrees, dead upstream tracking. Two modes —
  `session` (only what this session created) and `all` (everything accumulated,
  other sessions' leftovers included). **Branches** are the bulk of it — no host
  cleanup touches those. A worktree Claude Code created for another session it
  reports rather than removes: the host leases those to sessions that outlive
  their processes, so an idle one is routinely still someone's.

## Shared references

Guidance more than one skill needs is kept in one place rather than copied into
each — copies drift, and a fix then lands in some of them while the rest go on
saying something else.

- [`references/base-resolution.md`](references/base-resolution.md) — how to
  resolve a base branch and its remote without guessing either name: the rung
  ladder, remote ranking (`upstream` before `origin`, a lone remote whatever it is
  called), why a read symref goes stale, why only the remote-tracking form is safe
  to carry forward, and why a base sharing no history with `HEAD` is worse than
  no base at all. Read wherever a base or a remote is resolved.
- [`references/branch-naming.md`](references/branch-naming.md) — the shape a
  branch name takes (`<type>/[<issue>-]<name>`), the same Conventional Commits
  type carried into the commit subject and the change-request title, how a
  feature branch and its slices are
  named (`--` suffix, never nested with `/` — refs are paths and the nested form
  collides), what counts as auto-generated, the three points at which the name is
  applied (creation → normalization → the driver's last resort, each idempotent),
  and the cases where a rename is off the table (an open change request, another
  session's worktree, a shared branch). Read wherever a branch is named, renamed
  or landed under its name.
- [`references/slice-completion.md`](references/slice-completion.md) — how a slice
  *ends*: the completion contract (the signals a backend receives and returns),
  the two backends (`local` git-merge into the parent, and the forge-detected
  `request` change request), the default/protected-branch hard-gate, the merge
  strategy and authorization, and the offer arbitration. Read by whatever finishes
  a slice.
- [`references/architecture-decisions.md`](references/architecture-decisions.md) —
  the decision protocol: ask about architecture / act on mechanics, always show a
  recommendation (never a bare question), and flag a project rule that fights good
  architecture as possible drift. Read at every planning gate and every
  stop-and-ask.
- [`references/claude-worktrees.md`](references/claude-worktrees.md) — Claude Code's
  own worktrees and sessions: which of them the host removes by itself and which it
  leaves behind, and how to tell whether a worktree still has a live session in it.
  It describes the host rather than this plugin, so it changes on the host's
  schedule and is kept in one place for that reason. Read wherever a worktree's
  occupancy decides what may be touched. Answers *whose is this right now* — never
  what another session is doing.
- [`references/session-prompts.md`](references/session-prompts.md) — the envelope
  shared by every prompt that crosses between sessions, whichever direction it
  travels: the reader is elsewhere and no path may be named, it is a task rather
  than a document, pointers instead of retelling, every assertion carrying where
  to re-check it, the origin line and its tag, the mandatory negative part, a
  closing act that is never empty, and delivery as one fenced block. Read by
  whatever produces such a prompt; what fills the slots stays with the skill.
- [`references/report-format.md`](references/report-format.md) — the final-report
  shape (per-slice outcomes, coverage and what stayed uncovered, incidental
  findings rated by importance, an explicit "none"). Read where a whole run is
  reported. That is a different altitude from a driver's report on one merged
  change request, and the two do not replace each other.
- [`references/forge-docs.md`](references/forge-docs.md) — where a flag, an
  endpoint or a concept name gets resolved on either forge: the installed CLI's
  `--help` for what exists in this build, the docs sites for what things mean and
  for everything the porcelain never wrapped, plus the term-for-term mirror
  between the two forges. Read before writing an invocation or naming a concept
  in prose.

## Forge neutrality

Per the repo's authoring rule ([`../../.claude/rules/forge-neutrality.md`](../../.claude/rules/forge-neutrality.md)),
these skills avoid assuming a single forge. Where the guidance needs a concrete
command — resolving a base, opening a change request — the GitHub (`gh`) and
GitLab (`glab`) forms are given side-by-side.

One deliberate exception, stated where it occurs: `github-pr-workflow` is
GitHub-specific by design, named per the rule's `<forge>-<artifact>-workflow`
convention; a `gitlab-mr-workflow` twin can be added later. Until it exists,
request-mode completion on GitLab uses `shipping-workflow`'s mirrored `glab`
fallback.

## Requirements

**`git` and `jq` are the shared tools** — `git` in every skill but
`dependency-versions`, which touches the package manager and never the repository;
`jq` wherever a tool's JSON is parsed by hand, which the shared references do on
their `glab` paths.

**An authenticated forge CLI is assumed wherever the work touches a forge**, which
is most of this pipeline — `gh` on GitHub, `glab` on GitLab, never one without the
other. What it buys differs per skill: an issue read, a change request opened, a
squash-merge that git alone cannot see. Where a skill can go on without it, it says
what it loses rather than stopping.

Per skill, on top of those:

- **`implementation-workflow`**: whatever the reviewers and the completion it
  drives per slice need — `multi-review` / `codex`, and in request mode
  `github-pr-workflow`. Runs in the main conversation.
- **`issue-tracking`**: the forge CLI — every step of it is a tracker read or
  write. Issue hierarchy and dependencies are past what either CLI's `issue`
  commands wrap, so those go through its `api` subcommand.
- **`dependency-versions`**: the relevant package manager on `PATH`.
- **`codex-review`**: the `codex` CLI installed and `codex login` live.
- **`multi-review`**: nothing of its own — it picks up whichever reviewers are
  present and records a missing one as a row in the report rather than stopping.
- **`shipping-workflow`**: *some* way to open a change request — a PR/MR driver
  skill when one is installed (`github-pr-workflow` here), otherwise the forge CLI
  directly. Nothing in it is GitHub-only.
- **`github-pr-workflow`**: GitHub specifically — a connected GitHub MCP server
  is preferred over `gh` for reading reviews, but `gh` alone suffices.
- **`session-dispatch`** and **`session-handoff`**: nothing in the session that
  writes the prompt — both produce text from what it recalls, and neither reads
  the repository or the forge; the verification they call for happens on the
  receiving side. A dispatched order does name `implementation-workflow`, so the
  session that receives one needs this plugin installed.
- **`git-cleanup`**: nothing extra. The forge CLI is what catches a squash-merged
  branch, and without it the skill degrades to git-only. To tell which worktrees
  are occupied it also reads Claude Code's live-session registry under
  `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`; that format is internal, and the probe
  proves presence only — a worktree the host created for another session is
  reported either way.
