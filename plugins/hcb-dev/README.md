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
whole pipeline rather than sixteen disconnected commands:

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
  per-slice report. Calls `shipping-workflow` per slice; not for work that is
  already finished (that is `shipping-workflow` directly).

### Tracking deferred work

- **`issue-tracking`** — `/hcb-dev:issue-tracking`
  The backlog side of the pipeline, on GitHub and GitLab alike: what earns an
  issue and what does not, searching the tracker, the shape of the issue body,
  and the three moments worth consulting open issues at. Which mechanism carries
  the kind of work in a given
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
  refresh the base, commit, hand off to `multi-review`, apply the fixes, check
  coverage, then complete **by mode** — merged locally into its parent branch, or
  an open change request (handed to a PR/MR driver below). Steps 0–5 are identical
  in both modes; the mode is read only at the last step.
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

- **`session-dispatch`** — `/hcb-dev:session-dispatch`
  Work this session will **not** do, turned into an order for another session to
  **execute** — a build run through `implementation-workflow`, or an
  investigation whose deliverable is recorded tracker state. This session's
  numbers, coordinates and settled decisions are the payload, and what it did
  *not* check is named beside them. Settles every slot of
  [`references/order-anatomy.md`](references/order-anatomy.md) — the ask, where
  to work, the base pin that dates the facts, the process and the checks, the
  terminal deliverable, the completion mode (so the planning gate does not ask
  for it), the forks with their addressees, and the negative constraint — and
  ends in a closing act that is never empty: either the answer's shape, carried
  inline, or an end state with nothing coming back. Tags each order so its
  answer can be matched to it. A question is not dispatched at all: that is a
  subagent or a workflow in the session that has it.
- **`session-handoff`** — `/hcb-dev:session-handoff`
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

### Surveying the backlog

- **`backlog-survey`** — `/hcb-dev:backlog-survey`
  A whole slice of the backlog — a milestone, a label, everything open — read
  issue by issue and verified against the code, not against the tracker: each
  issue ruled current, stale or needing a rewrite, with the coordinate that
  shows it. Reports the picture, tiers of importance (blocks others / fires
  today / catches regressions) with the priority the tracker declares carried
  beside each issue and every disagreement between the two reported, the
  dependency graph and critical path, parallel lanes per
  `references/wave-planning.md`, one recommendation for what to take next,
  and incidental findings with a hygiene plan — which
  executes only on your word, item by item through `issue-tracking`. Scales by
  fanning readers out as subagents when the slice runs to hundreds. Its lanes
  are the wave plan's input.

### Fanning work out in waves

A coordinating (master) session that split an epic into batches launches and
collects them with a dedicated pair. A batch is one session's worth of work; a
wave is the set of batches launched together once its gate clears.

- **`master-session`** — `/hcb-dev:master-session`
  The coordinating role itself: assume it on assignment (title the session per
  `references/session-naming.md`, file the umbrella where none exists, open the
  wave ledger on the epic), draw the split per `references/wave-planning.md`
  and get the user's word on the table, launch through `wave-dispatch`, then run the loop —
  answer batch questions only after re-verifying against the tree, accept
  returns against the ledger's standing constraints, classify mid-epic issues
  itself, manage the merge queue and the gates, broadcast paid-for lessons —
  and recover after a restart from the ledger before the live registry. Heavy
  design forks go out as their own investigation sessions with the decision
  recorded in the issue. Closes the epic by verifying it against the ledger and
  offering one sweep of the residue.
- **`wave-dispatch`** — `/hcb-dev:wave-dispatch`
  One chip per batch — title per `references/session-naming.md` (it becomes
  the launched session's title, the name every later message matches on), the
  wave order as the prompt: the slots of `references/order-anatomy.md` plus boundaries (which
  files this batch owns, where it touches another batch's), three-way fork
  routing (decide yourself / agree with the master first / through the master
  to the user), the master's own title and session id, the status milestones,
  and the return protocol. Pins one base per wave, reports blocked batches
  instead of hanging them, withdraws chips the plan obsoleted, and falls back
  to pasteable fenced orders where chips are unavailable. The click stays with
  you — how many batches run in parallel is your call.
- **`wave-worker`** — `/hcb-dev:wave-worker`
  The receiving side, governing the engagement around the build: title the
  session with the batch id, verify the order's premises against the refreshed
  base, confirm composition to the master, route "agree first" forks there
  before building, push one-line statuses at the named milestones, and close
  with the full report to the tracker plus a notice to the master — staying
  engaged until acceptance, follow-up mandates included. The building itself
  runs through whatever workflow the order names, usually
  `implementation-workflow`.

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
  to carry forward, how a resolved base is brought up to date before anything is
  cut from it or diffed against it, and why a base sharing no history with `HEAD`
  is worse than no base at all. Read wherever a base or a remote is resolved.
- [`references/review-runs.md`](references/review-runs.md) — what a review engine
  launched outside the current session owes whoever launched it: the base it is
  handed rather than left to guess, the untracked files no diff shows, the
  background launch a review always takes, how to wait for one (repeated blocking
  windows, never a loop that sleeps and re-checks), and the two lines
  it prints: the `started:` line that says only that it launched, and the coverage
  record that says it finished — the `scope:` line, the separate `coverage-warning:`
  lines, and the rules for reading them (zero files is not a pass; a count is what
  the run was *given*, not what it read; a spent quota is not a failure of the
  engine). Read wherever a review runs as its own process.
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
- [`references/branch-retirement.md`](references/branch-retirement.md) — what
  becomes of a branch once its merge is confirmed: the tip everything measures
  against (the parent locally, the fetched base after a change request), the
  ladder that frees the worktree holding it, the proof a deletion needs where a
  squash merge left git unable to see the merge, the deletion of the ref a change
  request published, and the line the report carries either way. Read by whatever
  lands work.
- [`references/slice-completion.md`](references/slice-completion.md) — how a slice
  *ends*: the completion contract (the signals a backend receives and returns),
  the two backends (`local` git-merge into the parent, and the forge-detected
  `request` change request), the default/protected-branch hard-gate, the merge
  strategy and authorization, and the offer arbitration. Read by whatever finishes
  a slice.
- [`references/architecture-decisions.md`](references/architecture-decisions.md) —
  the decision protocol: ask about architecture / act on mechanics, always show a
  recommendation (never a bare question), flag a project rule that fights good
  architecture as possible drift, and treat the artifact that enforces a setting —
  not the file describing it — as the authority on what that setting is. Read at
  every planning gate and every stop-and-ask, and before any sentence that reports
  how something is configured, wherever it lands.
- [`references/claude-worktrees.md`](references/claude-worktrees.md) — Claude Code's
  own worktrees and sessions: which of them the host removes by itself and which it
  leaves behind, and how to tell whether a worktree still has a live session in it.
  It describes the host rather than this plugin, so it changes on the host's
  schedule and is kept in one place for that reason. Read wherever a worktree's
  occupancy decides what may be touched. Answers *whose is this right now* — never
  what another session is doing.
- [`references/session-prompts.md`](references/session-prompts.md) — the envelope
  shared by every prompt that crosses between sessions, whichever direction it
  travels and whichever of its three carriers moves it (a paste block carried by
  hand, a chip prompt, a message): the reader is elsewhere and no path may be
  named, it is a task rather than a document, pointers instead of retelling,
  every assertion carrying where to re-check it, the origin line and its tag, the
  mandatory negative part, a closing act that is never empty, and delivery per
  carrier. Read by whatever produces such a prompt; what fills the slots stays
  with the skill.
- [`references/order-anatomy.md`](references/order-anatomy.md) — what an order
  for another session settles, whatever carries it: the payload with how each
  fact was verified and what was never checked, the slot list from the ask to
  the closing act, the base pin that dates the facts, the tag, and one order per
  receiving session. Read by whatever writes such an order.
- [`references/order-return.md`](references/order-return.md) — the shape of the
  answer an order asks for (the tag on the first line, then four parts in
  order, with every change request at the state it stopped at, every issue at
  what became of it, and what a review left uncovered), and the acceptance on
  the way back: verify rather than adopt, then close or reopen the order. Read
  by whatever answers an order and whatever receives that answer.
- [`references/session-comms.md`](references/session-comms.md) — how one
  session reaches another and stays reachable itself: what survives a restart
  (titles, session ids, worktree paths, the forge) and what does not (live
  names, sockets), the title-first convention, the four-rung sending ladder
  from a freshly resolved live name down to a block the user carries, contact
  hygiene (identity both ways, the challenge line on a guessed address,
  self-contained first lines, questions that wait without blocking), and the
  rule that a peer session is not the user. Read by whatever contacts another
  session or expects to be contacted.
- [`references/session-naming.md`](references/session-naming.md) — the names
  sessions are found by: the three title shapes (master, batch, standalone),
  the epic identifier and where else it is spent, the batch letter and the two
  rules that keep it stable, the topic, the issue tail and its cap, what gets
  trimmed first when a title does not fit, the three moments a master titles
  itself, and where these names travel — into a chip, a worktree, an order's
  tag, but never into a branch name. Read by whatever titles a session or coins
  a batch id.
- [`references/wave-planning.md`](references/wave-planning.md) — splitting an
  epic into batches and waves: the vocabulary (batch, wave, gate), the two
  axes every split is drawn on (file zones and dependency edges), how a batch
  is composed and ordered inside, wave gating (guards on a clean tree go
  early; the merge order is part of the plan), and the table the plan hands
  the user. Read by whatever partitions work into parallel sessions.
- [`references/wave-ledger.md`](references/wave-ledger.md) — the master's
  durable state: one marked comment on the epic (found by content, editable in
  place, readable by the batches), its seven sections from the header to the
  journal, the batch state vocabulary, and the discipline — written on every
  event, read first after any restart or compaction. With no tracker, a file
  under the user's Claude config directory instead.
- [`references/report-format.md`](references/report-format.md) — the final-report
  shape (per-slice outcomes, coverage and what stayed uncovered, incidental
  findings rated by importance, an explicit "none"). Read where a whole run is
  reported. That is a different altitude from a driver's report on one merged
  change request, and the two do not replace each other.
- [`references/fix-or-surface.md`](references/fix-or-surface.md) — what to do with
  something the work noticed but never set out to do: the test that decides
  between fixing it in the change that found it — its own commit, its own type —
  and leaving it, then, for what is left, the search and the classification
  read *before* the proposal is made, the form it takes under
  `## Out-of-scope observations`, and the rule that only the user's answer writes
  to the tracker — a standing instruction to work autonomously is not that answer.
  Read wherever a review, a step or a completion turns something up; the tracker
  operations themselves stay with `issue-tracking`.
- [`references/forge-docs.md`](references/forge-docs.md) — where a flag, an
  endpoint or a concept name gets resolved on either forge: the installed CLI's
  `--help` for what exists in this build, the docs sites for what things mean and
  for everything the porcelain never wrapped, plus the term-for-term mirror
  between the two forges and what each one matches to close an issue. Read
  before writing an invocation or naming a concept in prose.

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
