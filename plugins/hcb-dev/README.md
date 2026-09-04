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
whole pipeline rather than disconnected commands:

```text
tasks / issues ─▶ implementation-workflow ─┐  analysis · slices · one planning gate · report
                                           │
              (or finished work) ──────────┴─▶ shipping-workflow ─▶ multi-review ─▶ codex-review
                                                     │                              claude-review
                                                     │                              security-review (built-in)
                                                     └─▶ complete by mode:
                                                           local   ─▶ git merge into parent  (then offer a PR/MR)
                                                           request ─▶ github-pr-workflow ─▶ (merge)

issue-tracking ────────────────────────── the backlog — at intake, in the report, after a merge
dependency-versions ─ seeding-gitignore ─ run alongside, whenever the work touches them
session-dispatch ─▶ (another session works) ─▶ session-handoff ─▶ (back to you)
backlog-survey ─▶ (tiers · critical path · parallel lanes · what to take next)
master-session ─▶ wave-dispatch ─▶ (chips → sessions: wave-worker
                                    + implementation-workflow) ─▶ returns ─▶ accepted by the master
git-cleanup ───────────────────────────── manual only, afterwards (see below)
```

`implementation-workflow` is the front door when you start from tasks or issues;
`shipping-workflow` is where you enter with finished work in hand. Each skill is
also useful on its own and triggers from its own `description` — except
`git-cleanup`, which sets `disable-model-invocation: true`: Claude never reaches
for it on its own, so it is not an automatic post-completion step. Run it
yourself when you want it.

The prompt text is the whole channel between sessions — what is not written in
it does not arrive. `session-dispatch` and `session-handoff` are its hand-carried
form: you paste every one of them yourself.

## Skills

### Building from tasks

- **`implementation-workflow`** — `/hcb-dev:implementation-workflow`
  The front door when you start from tasks or issues rather than finished code.
  Deep-reads the tasks (free text, or GitHub/GitLab issue numbers) and the
  codebase, splits the work into independently reviewable slices (one is the
  normal case), settles the architectural questions **and** the completion mode
  (local merge vs change request) at one planning gate, then runs each slice
  through development and `shipping-workflow` autonomously — closing with a
  per-slice report. Titles the session by the work it took in, per
  `references/session-naming.md`, so a long run is findable in a list of
  sessions. Calls `shipping-workflow` per slice; not for work that is already
  finished (that is `shipping-workflow` directly).

### Tracking deferred work

- **`issue-tracking`** — `/hcb-dev:issue-tracking`
  The backlog side of the pipeline, on GitHub and GitLab alike: what earns an
  issue and what does not, searching the tracker, the shape of the issue body,
  and the three moments worth consulting open issues at. Classification against
  what the repository itself defines is `references/classification.md`. Called by `implementation-workflow` at intake and in its report, and by
  `github-pr-workflow` after a merge.

### Preparing a change

- **`dependency-versions`** — `/hcb-dev:dependency-versions`
  When adding or updating a dependency, resolve the version from the registry via
  the package manager's own `add`/`install` command instead of typing a literal
  from memory — package managers, the Node.js runtime pin and GitHub Actions
  alike. On GitHub repos it also keeps `.github/dependabot.yml` in sync with the
  ecosystems in use.
- **`seeding-gitignore`** — `/hcb-dev:seeding-gitignore`
  Seed or extend a `.gitignore`: a fixed baseline this user carries everywhere
  (OS noise, editor swap files, per-developer Claude Code files, agent- and
  browser-tooling state, worktree dirs) plus language/framework patterns derived
  from what the project actually contains. Runs before every commit to keep local
  artifacts out of git. What the canonical templates leave out is
  [`skills/seeding-gitignore/references/tool-artifacts.md`](skills/seeding-gitignore/references/tool-artifacts.md).

### Reviewing it

- **`codex-review`** — `/hcb-dev:codex-review`
  Run a code review with Codex (`codex exec review`) over the current branch in a
  read-only sandbox. Review-only: returns Codex's findings verbatim and fixes
  nothing.
- **`claude-review`** — `/hcb-dev:claude-review`
  The same shape with Claude's own reviewer: `claude -p "/code-review …"` in a
  separate headless session, over a range and at a rung the caller fixes — which is
  what a pipeline, a batch worker or a subagent needs from a review: a known range
  in, a coverage record back. Review-only.
- **`multi-review`** — `/hcb-dev:multi-review`
  Run several independent reviewers over one change at once — `codex-review`,
  `claude-review`, the built-in security review — then consolidate the findings
  and report what each reviewer actually covered (the coverage gate most of the
  skill exists to keep honest). Report-only.

### Completing it

- **`shipping-workflow`** — `/hcb-dev:shipping-workflow`
  Take one finished, verified slice to completion: normalize the branch name,
  refresh the base, commit, hand off to `multi-review`, apply the fixes
  (reviewing them again where they reach past what was already read), check
  coverage, then complete **by mode** — merged locally into its parent branch, or
  an open change request (handed to a PR/MR driver below). Steps 0–5 are identical
  in both modes; the mode is read only at the last step. Entered on its own, it
  titles the session per `references/session-naming.md`; driven per slice, it
  leaves the caller's title standing.
- **`github-pr-workflow`** — `/hcb-dev:github-pr-workflow`
  Drive a GitHub pull request from a finished branch to a merged PR: rename an
  auto-generated branch, rebase onto base, open the PR ready-for-review, loop on
  CI + Copilot fixes until GitHub reports it mergeable *and* your own bar is
  clean, then — only on your explicit go-ahead — merge, monitor, and report.
  Discovers the repo's actual merge gates instead of assuming them, and parks the
  run on a platform outage — checking the status feed every half hour — instead of
  fixing a red check the diff never caused. See
  [`skills/github-pr-workflow/SKILL.md`](skills/github-pr-workflow/SKILL.md),
  [`skills/github-pr-workflow/references/merge-gates.md`](skills/github-pr-workflow/references/merge-gates.md),
  [`skills/github-pr-workflow/references/copilot.md`](skills/github-pr-workflow/references/copilot.md)
  and [`skills/github-pr-workflow/references/platform-status.md`](skills/github-pr-workflow/references/platform-status.md).

### Handing work across sessions

Two directions of one channel. The discriminator between them is whether the
work is **done** — not how the ask is worded.

- **`session-dispatch`** — `/hcb-dev:session-dispatch`
  Work this session will **not** do, turned into an order for another session to
  **execute** — a build run through `implementation-workflow`, or an
  investigation whose deliverable is recorded tracker state. This session's
  numbers, coordinates and settled decisions are the payload, and what it did
  *not* check is named beside them. Settles every slot of
  [`references/order-anatomy.md`](references/order-anatomy.md) and ends in a
  closing act that is never empty. A question is not dispatched at all: that is a
  subagent or a workflow in the session that has it.
- **`session-handoff`** — `/hcb-dev:session-handoff`
  What this session **finished**, in whatever form the result took — code on a
  branch or in a change request, an investigation that changed no files, issues
  rewritten or reclassified, a documentation change. Carries the result, the
  complete list of change requests and issues it touched (each with the state it
  stopped at or what became of it), how to reach the work from the reader's own
  checkout, and a re-read of every number on the forge in full. Two postures:
  answering an order, or unbidden. Ends by offering `git-cleanup` for the
  residue.

### Surveying the backlog

- **`backlog-survey`** — `/hcb-dev:backlog-survey`
  A whole slice of the backlog — a milestone, a label, everything open —
  read issue by issue and verified against the code, not against the
  tracker: each issue ruled current, stale or needing a rewrite, with the
  coordinate that shows it. Reports tiers of importance beside the priority the
  tracker declares, the dependency graph and critical path, parallel lanes per
  `references/wave-planning.md`, and one recommendation for what to take next.
  Any tracker hygiene it proposes executes only on your word, item by item
  through `issue-tracking`. Titles the session by the slice it surveys, per
  `references/session-naming.md`. Scales by fanning readers out as subagents
  when the slice runs to hundreds; its lanes are the wave plan's input.

### Fanning work out in waves

A coordinating (master) session that split an epic into batches launches and
collects them with a dedicated pair. A batch is one session's worth of work; a
wave is the set of batches launched together once its gate clears.

- **`master-session`** — `/hcb-dev:master-session`
  The coordinating role itself: assume it on assignment (title the session per
  `references/session-naming.md`, file the umbrella where none exists, open the
  wave ledger on the epic), draw the split per `references/wave-planning.md` and
  get the user's word on the table, launch through `wave-dispatch`, then run the
  loop — answering batch questions only after re-verifying against the tree,
  accepting returns against the ledger's standing constraints, and opening each
  wave as its gate clears. Recovers after a restart from the ledger before the
  live registry. It does not build batches itself.
- **`wave-dispatch`** — `/hcb-dev:wave-dispatch`
  One chip per batch — title per `references/session-naming.md` (it becomes
  the launched session's title, the name every later message matches on), the
  wave order as the prompt: the slots of `references/order-anatomy.md` plus this
  batch's boundaries, fork routing, the master's own coordinates, the status
  milestones and the return protocol. Pins one base per wave, reports blocked
  batches instead of hanging them, withdraws chips the plan obsoleted, and falls
  back to pasteable fenced orders where chips are unavailable. The click stays
  with you — how many batches run in parallel is your call.
- **`wave-worker`** — `/hcb-dev:wave-worker`
  The receiving side, governing the engagement around the build: title the
  session with the batch id, verify the order's premises against the refreshed
  base, confirm composition to the master, route "agree first" forks there before
  building, push statuses at the named milestones, and close with the return —
  staying engaged until the master accepts. The building itself runs through
  whatever workflow the order names, usually `implementation-workflow`.

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
saying something else. Each file opens by saying what it owns.

- [`references/base-resolution.md`](references/base-resolution.md) — resolving a
  base branch and its remote without guessing either name. Read wherever a base
  or a remote is resolved.
- [`references/review-runs.md`](references/review-runs.md) — what a review engine
  launched outside the current session owes whoever launched it. Read wherever a
  review runs as its own process.
- [`references/branch-naming.md`](references/branch-naming.md) — the shape a
  branch name, a commit subject and a change-request title take. Read wherever a
  branch is named, renamed or landed under its name.
- [`references/branch-retirement.md`](references/branch-retirement.md) — what
  becomes of a branch once its merge is confirmed. Read by whatever lands work.
- [`references/slice-completion.md`](references/slice-completion.md) — how a slice
  *ends*, across both backends. Read by whatever finishes a slice.
- [`references/architecture-decisions.md`](references/architecture-decisions.md) —
  the decision protocol: what to ask about, what to act on, and the form a stop
  takes. Read at every planning gate and every stop-and-ask.
- [`references/claude-worktrees.md`](references/claude-worktrees.md) — Claude
  Code's own worktrees and sessions. It describes the host rather than this
  plugin, so it changes on the host's schedule. Read wherever a worktree's
  occupancy decides what may be touched; it answers *whose is this right now*,
  never what another session is doing.
- [`references/session-prompts.md`](references/session-prompts.md) — the envelope
  shared by every prompt that crosses between sessions. Read by whatever produces
  one; what fills the slots stays with the skill.
- [`references/order-anatomy.md`](references/order-anatomy.md) — what an order for
  another session settles. Read by whatever writes one.
- [`references/order-return.md`](references/order-return.md) — the shape of the
  answer an order asks for, and the acceptance on the way back. Read by whatever
  answers an order and whatever receives that answer.
- [`references/session-comms.md`](references/session-comms.md) — how one session
  reaches another and stays reachable itself. Read by whatever contacts another
  session or expects to be contacted.
- [`references/session-naming.md`](references/session-naming.md) — the names
  sessions are found by. Read by whatever titles a session or coins a batch id.
- [`references/wave-planning.md`](references/wave-planning.md) — splitting an epic
  into batches and waves. Read by whatever partitions work into parallel sessions.
- [`references/wave-ledger.md`](references/wave-ledger.md) — the master's durable
  state. Read on every event it records, and first after any restart.
- [`references/report-format.md`](references/report-format.md) — the final-report
  shape. Read where a whole run is reported — a different altitude from a driver's
  report on one merged change request, and the two do not replace each other.
- [`references/classification.md`](references/classification.md) — how an issue
  gets classified against what the repository itself defines. Read wherever an
  issue is classified or a backlog is read by what its tracker declares.
- [`references/findings.md`](references/findings.md) — how a finding is rated,
  whether it is fixed in the work that found it, and what gets proposed
  otherwise. Read wherever a reviewer, a step or a completion turns something up;
  the tracker operations themselves stay with `issue-tracking`.
- [`references/forge-docs.md`](references/forge-docs.md) — where a flag, an
  endpoint or a concept name gets resolved on either forge. Read before writing an
  invocation or naming a concept in prose.

## Forge neutrality

These skills avoid assuming a single forge. Where the guidance needs a concrete
command — resolving a base, opening a change request — the GitHub (`gh`) and
GitLab (`glab`) forms are given side-by-side.

One deliberate exception, stated where it occurs: `github-pr-workflow` is
GitHub-specific by design, named per the rule's `<forge>-<artifact>-workflow`
convention; a `gitlab-mr-workflow` twin can be added later. Until it exists,
request-mode completion on GitLab uses the mirrored `glab` fallback in
[`references/slice-completion.md`](references/slice-completion.md).

## Requirements

**`git` and `jq` are the shared tools** — `git` in every skill but
`dependency-versions`, which touches the package manager and never the repository;
`jq` wherever a tool's JSON is parsed by hand — the shared references on their
`glab` paths, and the review scripts on every envelope they read back.

**An authenticated forge CLI is assumed wherever the work touches a forge**, which
is most of this pipeline — `gh` on GitHub, `glab` on GitLab, never one without the
other. What it buys differs per skill: an issue read, a change request opened, a
squash-merge that git alone cannot see. Where a skill can go on without it, it says
what it loses rather than stopping.

**Titling a session is the host's**, and most of this pipeline leans on it
([`references/session-naming.md`](references/session-naming.md)):
`master-session` and `wave-worker` wear the address their wave assigns, while
`implementation-workflow`, `shipping-workflow` and `backlog-survey` name the run
they open. Where the host offers none, the run goes untitled, and what carries
the address is a worktree the session cut for itself
([`references/session-comms.md`](references/session-comms.md)).

Per skill, on top of those:

- **`implementation-workflow`**: whatever the reviewers and the completion it
  drives per slice need — `multi-review` / `codex`, and in request mode
  `github-pr-workflow`. Runs in the main conversation.
- **`issue-tracking`**: the forge CLI — every step of it is a tracker read or
  write. Issue hierarchy and dependencies are past what either CLI's `issue`
  commands wrap, so those go through its `api` subcommand.
- **`dependency-versions`**: the relevant package manager on `PATH`. Its
  Dependabot half is
  [`skills/dependency-versions/references/dependabot.md`](skills/dependency-versions/references/dependabot.md).
- **`codex-review`**: the `codex` CLI installed and `codex login` live, plus `jq`
  to read the run's JSON envelope.
- **`claude-review`**: the `claude` CLI on `PATH` and authenticated, plus `jq` to
  read the run's JSON envelope. The review runs as its own session, so it spends
  its own budget rather than the calling session's context.
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
- **`backlog-survey`**: the forge CLI (`gh` / `glab`) to list and read the
  slice's issues; nothing else — the hygiene it proposes runs through
  `issue-tracking` on your word.
- **`master-session`**, **`wave-dispatch`** and **`wave-worker`**: Claude
  Code's own cross-session tools — the chip tool for launching
  (`spawn_task`/`dismiss_task`, the desktop app's) and the live registry and
  messaging (`ListAgents`/`SendMessage`) for coordination; each degrades along
  its own ladder where a tool is absent (fenced orders instead of chips, the
  tracker and the user instead of messages). The master additionally uses
  whatever edits an issue comment on the repository's forge — the wave ledger
  lives in one; without a tracker it falls back to a machine-local file under
  the user's Claude config directory. All sides need this plugin installed —
  the orders name `wave-worker` and `implementation-workflow` by identifier.
- **`git-cleanup`**: nothing extra. The forge CLI is what catches a squash-merged
  branch, and without it the skill degrades to git-only. To tell which worktrees
  are occupied it also reads Claude Code's live-session registry under
  `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`; that format is internal, and the probe
  proves presence only — a worktree the host created for another session is
  reported either way.
