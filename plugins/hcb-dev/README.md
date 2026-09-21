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
findings-pass ─────────────────────────── a run's end, or a round's: every finding verified, ruled, one table
dependency-versions ─ seeding-gitignore ─ run alongside, whenever the work touches them
sync-base ─────────────────────────────── the base moved: take it, read what it brought — never a push
session-dispatch ─▶ (another session works) ─▶ session-handoff ─▶ (back to you)
backlog-survey ─▶ (tiers · critical path · parallel lanes · what to take next)
               ├─▶ master-session (the layout, once the hygiene it proposed ran)
               └─▶ implementation-workflow (one batch, with nothing holding it)
master-session ─▶ wave-dispatch ─▶ (chips → sessions: wave-worker
                                    + implementation-workflow) ─▶ returns ─▶ accepted by the master
               └─▶ wave-refresh ─▶ (occupied ground · delta · free capacity) ─▶ back to wave-dispatch
status ────────────────────────────────── "where do we stand" — any role, read-only, writes nothing
session-plugin-refresh ────────────────── when the plugin moves under a running session
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
  codebase, rules each issue it took in still true of the refreshed base before
  building on it (`references/issue-currency.md` — a stale or misleading body
  reaches you as a fork at the gate rather than as work), splits the work into
  independently reviewable slices (one is the normal case), settles the
  architectural questions **and** the completion mode
  (local merge vs change request) at one planning gate, then runs each slice
  through development and `shipping-workflow` autonomously — closing with a
  per-slice report. Titles the session by the work it took in, per
  `references/session-naming.md`, so a long run is findable in a list of
  sessions. After a restart it resumes from the plan-doc and the task list, read
  against the tree rather than trusted. Calls `shipping-workflow` per slice; not
  for work that is already finished (that is `shipping-workflow` directly).

### Tracking deferred work

- **`issue-tracking`** — `/hcb-dev:issue-tracking`
  The backlog side of the pipeline, on GitHub and GitLab alike: what earns an
  issue and what does not, searching the tracker, what record a closed issue
  takes, the shape of the issue body, and the three moments worth consulting open
  issues at. Classification against the
  mechanism you adopted, else against what the repository itself defines and
  uses, is `references/classification.md`. Asked whether one issue still holds, it rules it by
  `references/issue-currency.md`'s four verdicts; a whole slice is `backlog-survey`'s. Called by
  `implementation-workflow` at intake and in its report, and by `github-pr-workflow` after a merge.
- **`findings-pass`** — `/hcb-dev:findings-pass`
  The pass that rules a run's findings cold and together, once the work is done: every
  candidate collected — this session's own, ones handed over from another session, a master's
  batches' — deduplicated, **verified** by subagents that are given the claim and its coordinate
  and never the finder's argument, then **grouped by mechanism** — the confirmed and unproven
  findings sharing a cause, or a gate that could hold them all, become one row with its instances
  listed — searched in the tracker, ranked, and ended in one of the outcomes of
  `references/findings.md`: a number of its own only for what outlives the work in hand, the rest
  handed to the work already going there, proposed as units that do not contend for the same
  files.
  Everything is shown in the one table
  [`references/findings-table.md`](references/findings-table.md) fixes, whose every row says
  whether it was verified and at which revision, with a footer totalling the rows by severity and
  by outcome; a refuted finding leaves the table for one line under it rather than standing as
  noise. Runs at a standalone run's end, and at a master's
  round close on the tree the round landed on, once every return is accepted and its change
  requests merged — never inside a batch, which returns its candidates unverified. Report-only: it fixes nothing,
  and every tracker write goes through `issue-tracking` on your word.

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
- **`sync-base`** — `/hcb-dev:sync-base`
  Bring a branch up to date with a base that moved: its own published copy
  first, then the base the shared ladder resolves — a fast-forward where the
  branch has nothing of its own, a rebase by default, a merge where its history
  may not be rewritten, `--autostash` over a dirty tree — and never a push. A
  branch that is itself a base only catches up with its own remote copy. Then it
  reads what arrived against the work in flight, per `references/base-delta.md` —
  the code, the environment, the issues the work carries, the plan — without
  running the project's checks, and hands every fork to whoever the work answers to. In a
  master session it moves the checkout and leaves the reading to `wave-refresh`.

### Reviewing it

- **`codex-review`** — `/hcb-dev:codex-review`
  Run a code review with Codex (`codex exec review`) over the current branch in a
  read-only sandbox. Review-only: returns Codex's findings verbatim and fixes
  nothing.
- **`claude-review`** — `/hcb-dev:claude-review`
  The same shape with Claude's own reviewer: `claude -p "/code-review …"` in a
  separate, read-only headless session, over a range and at a rung the caller
  fixes — which is what a pipeline, a batch worker or a subagent needs from a
  review: a known range in, a coverage record back. Review-only.
- **`multi-review`** — `/hcb-dev:multi-review`
  Run several independent reviewers over one change at once — `codex-review`,
  `claude-review`, the built-in security review — then consolidate the findings
  and report what each reviewer actually covered (the coverage gate most of the
  skill exists to keep honest). Report-only.

### Completing it

- **`shipping-workflow`** — `/hcb-dev:shipping-workflow`
  Take one finished, verified slice to completion: normalize the branch name,
  refresh the base, commit, land the branch on the refreshed parent — before the
  review, so a conflict resolution falls inside the coverage gate rather than
  after it — hand off to `multi-review`, apply the fixes (reviewing them again
  where they reach past what was already read), check coverage, then complete
  **by mode** — merged locally into its parent branch, or an open change request
  (handed to a PR/MR driver below). Steps 0–6 are identical
  in both modes; the mode is read only at the last step. Entered on its own, it
  titles the session per `references/session-naming.md`; driven per slice, it
  leaves the caller's title standing.
- **`github-pr-workflow`** — `/hcb-dev:github-pr-workflow`
  Drive a GitHub pull request from a finished branch to a merged PR: rename an
  auto-generated branch and retire what it was published under, rebase onto base,
  open the PR ready-for-review, loop on
  CI + Copilot fixes until GitHub reports it mergeable *and* your own bar is
  clean — a fix reaching past its finding goes back through `multi-review` before
  it is pushed, and Copilot is asked for a review only when the PR itself turned —
  then merge on the authority it was handed — `ask` by default, so it
  stops at ready and asks — monitor, watch the base's own checks on the merge
  commit, and report.
  Discovers the merge gates the base branch actually enforces — two bases of one
  repo answer differently — instead of assuming them, and parks the
  run on a platform outage — checking the status feed every half hour — instead of
  fixing a red check the diff never caused. See
  [`skills/github-pr-workflow/SKILL.md`](skills/github-pr-workflow/SKILL.md),
  [`skills/github-pr-workflow/references/merge-gates.md`](skills/github-pr-workflow/references/merge-gates.md),
  [`skills/github-pr-workflow/references/copilot.md`](skills/github-pr-workflow/references/copilot.md),
  [`skills/github-pr-workflow/references/copilot-request.md`](skills/github-pr-workflow/references/copilot-request.md)
  and [`skills/github-pr-workflow/references/platform-status.md`](skills/github-pr-workflow/references/platform-status.md).

### Handing work across sessions

Two directions of one channel. The discriminator between them is whether the
work is **done** — not how the ask is worded.

- **`session-dispatch`** — `/hcb-dev:session-dispatch`
  Work this session will **not** do, turned into an order for another session to
  **execute** — a build run through `implementation-workflow`, or an
  investigation whose deliverable is recorded tracker state or a verdict. This
  session's numbers, coordinates and settled decisions are the payload, and what
  it did *not* check is named beside them. Settles every slot of
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
  read in two tiers, wide for the picture and deep for the verdicts
  (`references/issue-currency.md` gives the one form), and verified against the
  code, not against the tracker: each issue ruled current, stale, needing a
  rewrite or unverifiable, with the coordinate that shows it. Reports
  tiers of importance beside the priority the tracker declares, the dependency
  graph and critical path, parallel lanes per
  `references/wave-planning.md`, and one recommendation for what to take next.
  A verdict past current on an issue its lanes hold is written beside that
  lane, as what holds the batch until the tracker edit releasing it is made.
  Every such edit — those and the closing hygiene plan alike — it asks you about
  and makes only on your word, item by item through `issue-tracking`. Where the
  slice turns up issues classified outside the mechanism the repository actually
  uses, that plan reaches past the slice: the rest of the repository's carrying
  the same value, closed ones included.
  Once the hygiene you approved has run, it reads back what actually changed and
  hands the layout on: to the session holding the wave ledger where one stands
  over the slice, else to one master session over the cut you take — with the
  epic that master hangs on, and the themes it leaves named as the epics that
  follow rather than masters to run beside it. A layout of one batch nothing
  holds goes to `implementation-workflow` instead, and carries no epic.
  Titles the session by the slice it surveys, per
  `references/session-naming.md`. Scales by fanning readers out as subagents,
  by the bytes a read costs rather than by the count of issues; its lanes are
  the wave plan's input.

### Fanning work out in waves

A coordinating (master) session that split an epic into batches launches and
collects them with a dedicated pair. A batch is one session's worth of work; a
wave is the set of batches its gate releases — together, or one at a time where
the plan stages them.

- **`master-session`** — `/hcb-dev:master-session`
  The coordinating role itself: assume it on assignment (title the session per
  `references/session-naming.md`, file the umbrella where none exists, hang the
  epic's own issues under it so the forge counts what is done, open the
  wave ledger on the epic), draw the split per `references/wave-planning.md` and
  get the user's word on the table — the epic's merge authority settled with
  it — launch through `wave-dispatch`, then run the
  loop — answering batch questions only after re-verifying against the tree,
  accepting returns against the ledger's standing constraints, recomputing what
  an executed tracker edit moved in the slice, keeping the epic's own wave table
  level with every redraw, and opening each wave as its gate clears. Never takes
  a merge itself — that is the batch's, and a landing that arrived some other way
  reaches the batch before anything else is sent.
  Reports as `references/report-format.md` and `references/report-blocks.md` fix
  them: a wave report when a wave moves, an ask that blocks work appears,
  something departs from what you approved, a batch is withdrawn or fails, the
  session recovers from a restart or you ask where things stand — and the final
  report at the end — each ending in the block that carries everything waiting on
  you, where anything does, while an event that changes nothing for you gets a
  line instead of a report.
  Recovers after a restart from the ledger before the live registry. It does not
  build batches itself.
- **`wave-refresh`** — `/hcb-dev:wave-refresh`
  What can start right now, recomputed rather than recalled: pin and refresh the
  base and read every fact through that ref rather than through a working tree,
  measure the ground that is occupied from three sources at once (the ledger's
  rows, the live registry, the files every open change request touches, each
  list checked against its own count) and read a zone they disagree about the
  safer way, take the delta in both its halves — what landed since the last pin,
  and what the tracker did since the moment that reading read it, links included:
  the slice's edges read again and set against the graph that reading left in
  the ledger, since no filter by update time sees a link move — a refresh's own
  reading, or a survey's where that one read the whole slice later — then rule
  what clears the ground:
  verdicts per
  `references/issue-currency.md`, where each verdict leaves its batch and how
  the survivors pair per `references/wave-planning.md`. Reports the capacity
  that is actually free against the capacity you asked for, and names what holds
  every batch that is missing rather than filling the number. Differential where
  `backlog-survey` is exhaustive: use the survey where nothing records a point
  to diff from. Writes the pass to the ledger, then hands what you approve to
  `wave-dispatch` — the capacity you named is a ceiling, not the word that
  launches. How the delta and the open requests' files are read, and where the
  graph lives between passes, is
  [`skills/wave-refresh/references/delta.md`](skills/wave-refresh/references/delta.md).
- **`wave-dispatch`** — `/hcb-dev:wave-dispatch`
  One chip per batch — title per `references/session-naming.md` (the launched
  session is asked to wear it; what later messages match on is what its start
  report says it answers to), the
  wave order as the prompt: the slots of `references/order-anatomy.md` plus this
  batch's boundaries, fork routing, the master's own coordinates, the start
  report that precedes the build, the status milestones and the return
  protocol. Pins one base for the batches hung together and again at each step
  of a staged wave, reports held
  batches instead of hanging them, withdraws chips the plan obsoleted, and falls
  back to pasteable fenced orders where chips are unavailable. The click stays
  with you; how many batches stand clickable at once is the plan's launch
  order. The launch reaches you as a wave report, led by whatever the preflight
  had to correct in the layout you approved.
- **`wave-worker`** — `/hcb-dev:wave-worker`
  The receiving side, governing the engagement around the build: wear the title
  the order's first line carries, re-verify the order's premises before anything
  rests on them, report the scope it found to the master before the first write,
  route "agree first" forks there before building, push statuses with their
  coordinates at the named milestones, finish a landing even where
  another session took it, and close with the return —
  staying engaged until the master accepts. The building itself runs through
  whatever workflow the order names, usually `implementation-workflow`.

### Asking where things stand

- **`status`** — `/hcb-dev:status`
  Where the work stands right now, read again rather than recalled, in whichever
  role the session holds: an epic and its batches for a master, one batch of a
  wave, or a run and its slices on its own — and, given an epic number, that
  epic's state from any session at all, since the ledger lives on the epic.
  Reads the ledger, the live registry, the change requests and the tree; writes
  nothing anywhere, and names a source it could not read as unread instead of
  printing it empty. The other roles route their "where do we stand" and their
  first report after a restart here, so the shape exists once.

### Staying current with the plugin

- **`session-plugin-refresh`** — `/hcb-dev:session-plugin-refresh`
  A session acts under the text it was handed at launch, so a plugin that moves
  under it leaves it working from the old copy. This re-reads what is current —
  the skills in use and the transitive closure of the references they name, each
  file whole — and reconciles what the session already did with what those files
  now say. Reports four versions: the one this session is running, the one
  installed, the floor it can diff against, and the one the marketplace's own
  repository carries. Divergences are ranked by what they can still reach and
  each ends in one of four — repaired here, standing from here on, owed to
  someone downstream (a coordinating session's batches are running under their
  own copies), or a decision for the addressee. It installs and updates nothing;
  `/reload-plugins` stays yours.

### Cleaning up

- **`git-cleanup`** — `/hcb-dev:git-cleanup` (manual-only)
  Sweep the git residue work leaves in a repository: merged and orphaned
  branches, stale or abandoned worktrees, dead upstream tracking. Two modes —
  `session` (only what this session created) and `all` (everything accumulated,
  other sessions' leftovers included). **Branches** are the bulk of it — no host
  cleanup touches those. A worktree Claude Code created for another session it
  reports rather than removes: the host leases those to sessions that outlive
  their processes, so an idle one is routinely still someone's. The verdict
  tables it classifies by are
  [`skills/git-cleanup/references/verdicts.md`](skills/git-cleanup/references/verdicts.md).

## Shared scripts

A question with one right answer, and a set of wrong ones that look alike, belongs in
code rather than in prose a reader re-derives each time. Each script here answers ONE
question, prints JSON, and is held to what a forge actually sends by a suite under
[`../../tests/suites`](../../tests/suites) in the repository root. They never load into a
session's context — a skill invokes one and reads its answer. A skill spells the path to
one with the placeholder Claude Code substitutes as it loads the skill; a reference, read
verbatim, writes `<plugin root>` instead, and the skill that links it says once what that
name stands for.

- [`scripts/default-branch.mjs`](scripts/default-branch.mjs) — which branch this
  repository treats as its default, and the remote that says so. Asks the remote even
  when the local pointer verified, because a pointer at a ref that still exists is the
  case verification cannot catch.
- [`scripts/resolve-base.mjs`](scripts/resolve-base.mjs) — which remote to read a base
  from, which one a push actually goes to, and whether the ref for a base is CURRENT
  rather than whatever the last fetch left. Refuses where several remotes exist and none
  is preferred: for a read that costs a wrong review, for a push it can publish a branch
  in somebody else's repository.
- [`scripts/worktree-owners.mjs`](scripts/worktree-owners.mjs) — whose is each worktree
  of this repository right now, read from Claude Code's live-session registry. Presence
  only: a live session proves a worktree is in use, and its absence proves nothing,
  because the host leases worktrees to sessions rather than to processes.
- [`scripts/cleanup-scan.mjs`](scripts/cleanup-scan.mjs) — what a sweep would find in a
  repository and what each thing carries: the git state of every worktree, and the proof
  every branch has that its work landed. Classifies, and deletes nothing.
- [`scripts/pr-state.mjs`](scripts/pr-state.mjs) — what the forge says about one change
  request and what is outstanding on it: its own enums, the review threads no `pr view`
  field carries, and the drift against its base, measured rather than read off
  `mergeStateStatus`. `mayMerge` is permission, never readiness.
- [`scripts/commit-checks.mjs`](scripts/commit-checks.mjs) — what the two check feeds
  say about one commit. Keeps `check-runs` and the older commit statuses apart, since a
  reader of one is blind to the other, and answers with a single `verdict` so a caller
  never assembles one out of counts.
- [`scripts/copilot-state.mjs`](scripts/copilot-state.mjs) — whether the automated
  reviewer is expected on this request, whether it has answered the head, and what it
  said. Reads the request the repository's own settings describe, never a list of
  reviewers that a completed review has already emptied, and says so when a bot it does
  not take for Copilot reviewed the head instead.
- [`scripts/copilot-findings.mjs`](scripts/copilot-findings.mjs) — what that reviewer
  actually said on one request, in both of the places it says it, and what is still owed.
  A finding that opened no thread is held by no gate, so reading one half is half a review
  and this says which half it got. Every body goes over whole and uninterpreted — where in
  it the findings sit is the agent's to read — while the threads come with their ledger:
  who spoke last in each, and which are still owed.
- [`scripts/retire-check.mjs`](scripts/retire-check.mjs) — is this branch safe to retire,
  and on which side. The local half and the published half fail separately and are
  answered separately; it reads and judges, and deletes nothing.
- [`scripts/branch-publish.mjs`](scripts/branch-publish.mjs) — the name a branch ships
  under, put on the remote, and the names it used to carry taken off it. **The one script
  here that acts**, because the order of the three is the hazard: a rename is refused
  where a request pins the name, the publish is unconditional, and a name comes off the
  remote only after the new one is up. What each push did is read off the remote rather
  than its exit status, so a push nobody waited out is reported as unsettled, never as
  refused.
- [`scripts/ledger.mjs`](scripts/ledger.mjs) — where a coordinating session's ledger
  stands on the epic issue, whether the next write fits under the cap — in bytes, whatever
  unit the forge's own refusal names — and whether the archives beside it and the index
  naming them agree. It reads: what may be archived out of a ledger is a judgement about
  content.
- [`scripts/issue-slice.mjs`](scripts/issue-slice.mjs) — every issue of a slice with its
  links — parent, children, blockers, closing change requests — one call per page on either
  forge, and whether what came back is the whole slice: unread, short and whole are told
  apart, as are link ends the token cannot see and the fields a self-hosted instance is too
  old to carry. Bodies and comments stay out of the wide read; `--deep` reads the numbers
  named in full; `--since` reads the slice again against an earlier reading of it and says
  what entered, left, was edited or moved a link — each edge once, the forge's own count of
  link events beside it as a cross-check.

They refuse rather than guess, and a refusal says which question could not be answered —
never "nothing matched".

## Shared references

Guidance more than one skill needs is kept in one place rather than copied into
each — copies drift, and a fix then lands in some of them while the rest go on
saying something else. Each file opens by saying what it owns.

- [`references/invariants.md`](references/invariants.md) — how a signal is read,
  and what an authority permits. Fourteen rules that hold wherever a tool, a forge,
  a remote or another session answers: an empty result is not a negative one, an
  unread one is not empty, configuration predicts nothing, a write's exit 0 is not
  what it wrote, an authority narrows and never widens. Read once per run, by every skill here.
- [`references/forge-behaviour.md`](references/forge-behaviour.md) — what a
  forge actually does, measured: which signals lie, when, and what to measure
  instead. Read wherever a skill acts on what a forge reports. A new
  measurement is a row here, never a paragraph elsewhere.
- [`references/base-resolution.md`](references/base-resolution.md) — resolving a
  base branch and its remote without guessing either name. Read wherever a base
  or a remote is resolved.
- [`references/base-delta.md`](references/base-delta.md) — what a base that
  moved brought to the work in flight: where the delta starts, the four kinds of
  consequence it is read for, and who a fork goes to. Read wherever a base is
  taken onto work in flight — a sync, a landing, a slice's cut, an order's facts
  re-verified against a newer tip.
- [`references/review-runs.md`](references/review-runs.md) — what a review engine
  launched outside the current session owes whoever launched it, and how any
  reviewer's answer is waited on. Read wherever a review runs as its own
  process, and wherever one is waited for.
- [`references/branch-naming.md`](references/branch-naming.md) — the shape a
  branch name, a commit subject and a change-request title take. Read wherever a
  branch is named, renamed or landed under its name.
- [`references/branch-publish.md`](references/branch-publish.md) — the act rather
  than the name: renaming, publishing, and taking a name this branch used to carry
  off the remote. Read by whatever renames or publishes.
- [`references/branch-retirement.md`](references/branch-retirement.md) — what
  becomes of a branch once its merge is confirmed. Read by whatever lands work.
- [`references/merge-message.md`](references/merge-message.md) — keeping a change
  request's body true to what is landing, and the message a collapsing merge
  leaves on the base. Read by whatever lands work, before the merge.
- [`references/slice-completion.md`](references/slice-completion.md) — the contract
  a slice *ends* under: the inputs a caller threads in, the outputs a report reads
  back, and what outranks a merge authorization. Read by everything that hands a
  slice on, not only by what completes one.
- [`references/completion-backends.md`](references/completion-backends.md) — what
  each completion mode actually does. Read by whatever executes a completion.
- [`references/feature-branch.md`](references/feature-branch.md) — the branch a set
  of slices shares: keeping it current, and the three cases where any branch takes
  its base by merge rather than rebase.
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
  reaches another, reads what reaches it, and stays reachable itself. Read by
  whatever contacts another session or expects to be contacted.
- [`references/session-naming.md`](references/session-naming.md) — the names
  sessions are found by. Read by whatever titles a session or coins a batch id.
- [`references/wave-planning.md`](references/wave-planning.md) — splitting an epic
  into batches and waves. Read by whatever partitions work into parallel sessions.
- [`references/wave-ledger.md`](references/wave-ledger.md) — the master's durable
  state. Read on every event it records, and first after any restart.
- [`references/report-format.md`](references/report-format.md) — how everything
  reported to you looks: a line or a report, the bold first line counting what
  waits on you, one `##` heading per block, five status circles — 🟢 fine,
  🔵 running by itself, 🟡 your move, 🔴 stopped, ⚪ out of play — and the ask
  block last, each ask with its recommendation first. Read wherever work is
  reported to you.
- [`references/report-blocks.md`](references/report-blocks.md) — the blocks a
  report is built from, in the order they stand, what each holds, and which ones
  each occasion carries: a wave report while an epic runs, the final report once a
  run is done. Read beside `report-format.md`.
- [`references/issue-currency.md`](references/issue-currency.md) — whether an
  issue is still true of the tree, and the four verdicts that say so. Read
  wherever an issue is surveyed or taken in as the spec of work about to start.
- [`references/classification.md`](references/classification.md) — how an issue
  gets classified — against the mechanism the user adopted, else against what the
  repository itself defines and actually uses — and what to do with one
  classified outside it. Read wherever an issue is
  classified or a backlog is read by what its tracker declares.
- [`references/findings.md`](references/findings.md) — how a finding is rated,
  whether it is fixed in the work that found it, whether it is work put off and so
  worth a tracker entry at all, and the closed list of outcomes one can end in. Read wherever a
  reviewer, a step or a completion turns something up; the pass that rules them is
  `findings-pass`, and the tracker operations themselves stay with `issue-tracking`.
- [`references/findings-table.md`](references/findings-table.md) — the one form
  findings take wherever they reach you: a header line saying what was verified,
  a table ranked by severity — 🔴 Critical, 🟠 Important, ⚪ Minor — with a
  verification column on every row, a footer
  totalling the rows by severity and by outcome, and refuted findings named under
  that rather than listed as rows. Read wherever findings are
  shown — a review's report, a run's report, a wave report, a batch's return.
- [`references/fix-reading.md`](references/fix-reading.md) — what reads a fix
  made after a review: which fix goes back through `multi-review` before it is
  pushed, and when those rounds end — on what they find and what they covered.
  Read wherever review fixes are made, before a change request opens and after.
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

**The `claude` CLI itself** is `session-plugin-refresh`'s alone: it
resolves the versions from the plugin's own manifest, `claude plugin list`, and
the marketplace's git checkout — the last read with `git`, so a marketplace on
any host answers the same way.

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
  write. Issue hierarchy, dependencies and native types need `gh` 2.94.0 or
  later, whose `issue` commands read and write them — and on GitHub Enterprise
  Server 3.17 for hierarchy and types, 3.19 for dependencies. `glab` reads none
  of them and links issues only while creating one, so the rest goes through
  `glab api` (`references/forge-docs.md`).
- **`findings-pass`**: the host's subagents, which run the checks, and whatever
  `issue-tracking` needs for the tracker search; with no tracker to reach it still
  verifies and shows, saying there is nowhere to file.
- **`dependency-versions`**: the relevant package manager on `PATH`. Its
  Dependabot half is
  [`skills/dependency-versions/references/dependabot.md`](skills/dependency-versions/references/dependabot.md).
- **`status`**: the forge CLI for the ledger, the issues and the repository's
  own identity (`gh` / `glab`), plus `node`, `jq` and `git`; the live session
  registry for presence. It
  writes nothing, and where a forge answers no verdict for a change request it
  says so rather than working around it.
- **`sync-base`**: `git` against the resolved base, plus `node` and `jq` for the
  two resolver scripts and their answers. The forge CLI answers the ladder's rungs
  that ask a forge — the open change request's base, and where changes land — and
  lists the requests targeting this branch; without it each is skipped and said to be.
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
- **`session-dispatch`** and **`session-handoff`**: neither reads the repository
  or the forge — they produce text from what the writing session recalls, and the
  verification they call for happens on the receiving side. `session-dispatch`
  reads one thing beyond that: whatever names this session, where the order
  leaves an address to answer at, since the name to write down is the one a
  channel actually shows. A dispatched order does name `implementation-workflow`, so the
  session that receives one needs this plugin installed.
- **`backlog-survey`**: the forge CLI (`gh` / `glab`) to list and read the
  slice's issues; nothing else — the hygiene it proposes runs through
  `issue-tracking` on your word.
- **`wave-refresh`**: `git` against the resolved base — every fact it rules on
  is read from that ref, not from a working tree — plus the forge CLI and `jq`
  for the tracker's delta and the open change requests' files, and the live
  registry for who is still running. It hangs nothing itself; `wave-dispatch`
  does that.
- **`master-session`**, **`wave-dispatch`** and **`wave-worker`**: Claude
  Code's own cross-session tools — the chip tool for launching
  (`spawn_task`/`dismiss_task`, the desktop app's) and, for coordination, the
  live registry plus whichever message channel the host offers, addressed by
  name; each degrades along its own ladder where a tool is absent
  (fenced orders instead of chips, a line to the user instead of messages) —
  while a decision stands at its coordinate on the forge whichever of them
  carries the pointer to it. The master additionally uses
  whatever edits an issue comment on the repository's forge — the wave ledger
  lives in one, and a repository without a tracker cannot hold the role at all.
  All sides need this plugin installed — the orders name `wave-worker` and
  `implementation-workflow` by identifier.
- **`git-cleanup`**: nothing extra. The forge CLI is what catches a squash-merged
  branch, and without it the skill degrades to git-only. To tell which worktrees
  are occupied, `scripts/worktree-owners.mjs` reads Claude Code's live-session
  registry under `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`; that format is internal, and
  it proves presence only — a worktree the host created for another session is
  reported either way.
