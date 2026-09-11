# Completing a slice — the local and change-request backends

Read by whatever *finishes* a slice. It owns the one place the completion **mode**
changes anything — so the front half stays mode-blind and the two backends cannot
drift apart across skills. It lives here, not in any one of them, for the same
reason [`base-resolution.md`](base-resolution.md) does: prose copies drift, and a
fix then lands in one and the other goes on saying something else.

A slice arrives here already **committed, reviewed, and past the coverage gate**.
Completion never reviews, commits, or re-runs the gate — all of that happened
upstream. Its whole job is to *land* the work by mode. `local` is a positive
operation (`git merge` into the parent), never "the request flow with the push
cut out".

## The contract

A skill takes no typed arguments, so the caller passes these as invocation prose.

**Inputs every backend receives:**

- `mode` — `local` or `request` (resolution ladder below).
- `parent` — the branch this slice lands on, as a **bare local name**, carried
  alongside the `<remote>/<name>` ref it was reduced from. It is a destination, not
  a ref to read: the local backend checks it out and merges into it, and
  `base-resolution.md` shows what a `<remote>/<name>` does there — `checkout`
  detaches HEAD quietly and the merge then lands nowhere. Keep the ref too, because
  the name alone does not say which tip was resolved: with the same branch on two
  remotes, or a local copy behind its remote, merging into the name lands somewhere
  the reviewers never read. Before merging, confirm the local branch is at that ref
  or fast-forwards to it; where it does not, stop and say so.
  Multi-slice: the shared feature branch (known to the orchestrator — it created
  it). Single slice: the base, resolved by that ladder, handed on as an explicit
  base — the ladder's rung 1 — in both forms.
- `diff-base` — the commit the slice was cut from, which after a refresh is the
  remote-tracking ref rather than the local `parent` behind it. It is what every
  per-slice range is taken against, as an **explicit** base, so coverage is
  *this* slice, not the cumulative feature diff (which would re-read slice 1 while
  auditing slice 2, and the coverage gate would record no gap over the wrong
  range). **Landing the slice on `parent` moves it** to the tip landed on — the
  slice is cut from there now, and the threaded value names a commit `parent` has
  grown past.
- `old-name` — the name the branch carried before `shipping-workflow` step 0
  renamed it, threaded on every rename as a bare branch name; empty where
  nothing was renamed. What is published under it is the request driver's to
  retire, once it has proved the ref carried this branch's work; local
  completion names it as possibly standing.
- `issues` — the issues this slice **alone** settles, where the caller knows
  them: the change request's closing keywords name these and no other, and the
  `issues` output below reports on them. An orchestrated slice never carries an
  issue its set settles as a whole; that one rides the final integration request.
- `merge-strategy` — the shown-and-approved gate default, **mode-dependent**: in
  `local` mode the per-slice merge shape (`--no-ff` by default); in `request` mode
  the **final** `feature → base` strategy only (*Multi-slice topology* below).
- `merge-auth` — the merge authorization: a **value** and the **addressee** it
  names, never one without the other. The three run loosest to strictest, and
  that order is what *narrow* and *widen* mean below:
  - `on-green` — merge once the required gates pass. In `local` mode, where
    nothing goes green, those gates are the project's own checks.
  - `queued` — readiness is not the slot: report ready to the addressee and
    hold until it says go.
  - `ask` — drive to ready and stop; the addressee decides whether it merges
    at all.

  The addressee is named, never read off the session's own role: standalone
  it is the user; under a coordinating session it is that session, which
  carries on to a person whatever
  [`architecture-decisions.md`](architecture-decisions.md) puts there.

  **Absent** reads as `ask` in `request` mode and `on-green` in `local`, where
  choosing the mode is itself the consent to the merge it names — and the
  default-branch stop below guards the one merge that consent does not cover.
  That fallback is addressed to the **user**, which is why an order or a caller
  handing work to another session names its addressee outright: fall back there
  and a batch's question reaches its own user instead of the session running the
  epic.
  A phrase that started a run settles this only where it speaks of the
  **merge** ("merge it", "merge once it's green"); one asking for the work to
  be finished, shipped or driven settles the mode and nothing here.

Completion is **not** handed a `coverage` signal — it runs only *after* the
coverage gate has passed (an actionable gap already stopped the run upstream, at
step 6), so it never re-checks coverage; it simply carries whatever noted
(structural) gaps the gate reported into the `uncovered` output below.

**Outputs every backend returns** (for [`report-format.md`](report-format.md)):
`landed_at` (local: the merge commit on `parent`; request: the change-request URL,
plus a merge commit if it was driven to merge), `mode_used`, `retired` (what became
of the branch, on each side it stood — gone, or standing with the reason
`branch-retirement.md` names), `base_checks` (what the checks on that landing
said afterwards — green, the red rows attributed to it and what each one is, or
unchecked; `none` where the mode runs nothing over a landing),
`uncovered` (coverage
gaps carried into the report), `issues` (what became of each issue this slice
settles — closed, or open with why), `incidental` (surfaced-not-fixed findings,
severity rated, each with its outcome — reached, or proposed where the decision
sits above the slice), `declined_offer` (local only — a change request the run could have opened
and the user turned down, recorded so it is not silently dropped), `follow_ups`.

Where no run report follows — a standalone ship, with no orchestrator above this
slice — `incidental` and `follow_ups` still have a consumer:
[`findings.md`](findings.md). Handed to nobody, they end with
the response.

**Invariants both backends honor:** never complete on an unresolved *actionable*
coverage gap without explicit clearance (a structural gap is noted, never
blocking — see `multi-review`); never guess a base or a remote
(`base-resolution.md`); never land an auto-generated branch name **silently** — normalization happens upstream at `shipping-workflow` step 0,
and both backends here are what make it permanent, but where
[`branch-naming.md`](branch-naming.md) forbids the rename outright (a shared
branch others have pulled, an open change request, a branch checked out in another
worktree) that prohibition wins: land the work under the name it has and say so in
the report, rather than deadlocking two absolutes against each other; retire the
branch the merge landed, per
[`branch-retirement.md`](branch-retirement.md); leave the
tree in a known state; emit a completion record.

## What outranks an authorization

An `on-green` does not fire, and a `queued` go is not taken, while any of these
stands:

- a rebase resolution past a trivial one that no reviewer has read, or one whose
  review left a finding of weight open (`github-pr-workflow` Step 2);
- a `Critical` or `Important` finding still open on the change
  ([`findings.md`](findings.md));
- a `local` merge into the default branch, or into a parent that cannot be ruled
  non-default;
- an `on-green` in a repository where no enforced gate was confirmed — what goes
  green there is nothing anyone enforced
  ([`../skills/github-pr-workflow/references/merge-gates.md`](../skills/github-pr-workflow/references/merge-gates.md)).

Each of them stops where the authorization's own addressee decides — except the
last, whose addressee is a **person** whatever the authorization named: a
coordinating session carries that one on rather than answering it.

An authorization is **narrowed** on the way down and never widened: a session
holding `on-green` may hold the merge back — reporting that it did — and no
session gives itself a value its caller did not hand it.

## Mode — resolve, don't assume

First hit wins:

1. **Explicit user phrasing** — "merge locally / no PR / land it in `dev`" →
   `local`; "ship it / open a PR / get this merged" → `request`. What such a
   phrase settles here is the mode; whether it also authorizes the merge is
   `merge-auth`'s own order below.
2. **What the invocation carried** — an order's own settlements
   ([`order-anatomy.md`](order-anatomy.md)), threaded on by whatever received
   them. A gate downstream shows such a value; it never re-asks it.
3. **The value the planning gate settled** (the orchestrator threads it down).
4. **Fallback: `request`.** Where nothing said otherwise, finishing means a
   change request.

Only `implementation-workflow` (asks/infers at the gate) and `shipping-workflow`
(consumes it; owns the standalone fallback) touch mode. Every skill upstream is
mode-blind.

**`merge-auth` resolves by its own order, not this one** — the ladder above puts
a phrase first, which for an authorization would widen what a caller narrowed:

1. **The value supplied** — carried by the invocation (an order's slot) or
   threaded by the caller (a planning gate's). Never overridden by the words a
   run started with.
2. **A phrase of the user's about the merge itself** — "merge it", "get this
   merged", "merge once it's green" → `on-green`. One asking for the work to be
   finished, shipped, opened or driven is not one of these, and settles the mode
   alone.
3. **The mode-dependent fallback above.**

A later word from the user lands over all three: it narrows or withdraws what
any rung gave, and widens nothing.

## Backend: local — merge into the parent, no forge

Pure git; works with **no remote at all**. It *writes* to the network for
*nothing* — no push, no forge call — and that is the whole point of local mode;
the read that refreshes the base is the front half's, upstream of here.
Publishing is the escalation offer below, and only by consent.

- **The name lands with the merge.** `--no-ff` writes the branch name into the
  parent's history (`Merge branch 'claude/…' into …`) — and unlike a change
  request's branch, which does not outlive the merge, that line stays for good. A slice
  arriving here still carrying an auto-generated name means step 0 was skipped:
  rename it before merging (`branch-naming.md`) — the local
  half of that reference and nothing more: a bare `git branch -m`, no network —
  and record the name renamed away as `old-name`, as step 0 would have. A ref
  published under that name at any earlier point **stays**: local mode writes
  nothing to the network, and no later step of it removes the ref — the report
  names it as possibly standing, and removing it is the user's, by hand or by a
  request-mode completion of that branch.
- **The merge runs from wherever `parent` is checked out — find that first.**
  `git merge` lands into whatever is checked out, and on arrival that is the slice.
  A slice cut in a linked worktree is the normal case, and there the parent is
  usually checked out in another worktree already, so `git switch` refuses it
  outright (`fatal: 'master' is already used by worktree at …`). That is not a
  failure to route around: `git worktree list --porcelain` names the directory
  holding it, and `git -C <that dir> merge` lands the slice without moving anyone's
  HEAD. Only when no worktree holds it do you switch, merge, and switch back.
- **Chain whichever of the two you use** — unchained, a refused switch still lets
  the merge run on the slice and report success.
- **Merge strategy** — the gate's shown default. `--no-ff` by default, so the
  slice stays a visible, revertible boundary in the parent's history and the later
  whole-feature change request keeps its slices reviewable. `ff` only where the
  caller asked and the history is linear; `squash` where the caller wants a single
  commit — and there the commit message is written, not the one
  `git merge --squash` leaves staged: compose it per
  [`merge-message.md`](merge-message.md) and commit with it.
- **Conflict** — resolve a trivial conflict yourself; one that needs a real
  decision is an architectural fork ([`architecture-decisions.md`](architecture-decisions.md)),
  so stop and ask — never auto-resolve, or you can silently corrupt an earlier
  slice's work. Trivial stays trivial — whitespace, a lockfile, a generated file
  re-run. Past that the resolution is code no reviewer has read and this backend
  does not review: abort the merge and hand back to `shipping-workflow` step 3,
  which lands on this same parent and puts what that took through the reviewers. A
  conflict surviving that round trip is `parent` moving under the run, not a round
  to repeat — stop and ask.
- **The default-branch hard-gate.** Merging into a **feature** branch is
  autonomous under an `on-green`, and under anything stricter takes what that
  value says. Merging into the **default branch** is the highest-blast-radius
  action here — an unattended commit on `master`/`main` is not practically
  reversible and bypasses every gate the forge would otherwise enforce — so **stop
  and ask first**, whatever `merge-auth` was passed. Resolve the default offline
  (`base-resolution.md`: `<remote>/HEAD`, verified). Where you **cannot** resolve
  it — no remote at all, or a stale/unverifiable pointer —
  do **not** assume the parent is a feature branch: ask before merging. Erring
  toward asking is free; an unattended merge into the default is not. (Forge-side
  *protection* is a separate thing you cannot read offline — but a local merge
  publishes nothing, so this gate is about the *default* branch; a protected
  non-default branch is a request-mode concern, and merging one locally is still
  just a reversible local commit.)
- **After the merge, the offer** — offer, never force, to open a change request on
  the landed work. Accepting it is the consented **exit** from local mode: it
  pushes `parent` and hands to the request backend, with the set's `issues` so
  the request's body carries their closing keywords. The escalated change request
  carries `merge-auth` `ask`, addressed to whoever accepted the offer:
  accepting it authorizes the change request, never the merge behind it.
  **One offer per run**: after a set, it is made once on the whole feature at
  the end, not once per slice.

## Backend: request — a change request, by forge

- **Detect the forge from the remote and what actually answers there — never from
  the hostname.** A self-hosted GitHub Enterprise or self-managed GitLab lives on
  an arbitrary domain, so identify it by which CLI/MCP authenticates for the
  remote's host (`gh auth status` → GitHub; `glab auth status` → GitLab), and name
  what a self-hosted instance cannot do rather than stalling on it.
- **Dispatch** to the installed change-request driver, handing it `parent` as the
  base plus `merge-strategy`, `merge-auth`, `issues`, and `old-name` where step 0
  renamed: GitHub → `hcb-dev:github-pr-workflow`;
  GitLab → `hcb-dev:gitlab-mr-workflow` once it exists (deferred — until then
  GitLab falls to the inline fallback below).
- **No driver installed** — normalize the branch name **first**
  (`branch-naming.md`): this path has no driver Step 1 behind
  it to catch an auto-generated name, and once the change request is open the name
  is fixed for good — renaming means deleting the old head ref, which closes the
  request. Then push the branch and open the change request inline, mirrored,
  with a body written per [`merge-message.md`](merge-message.md) that carries the
  closing keywords `issues` names — a body filled from the commits carries none:
  ```bash
  # GitHub
  gh pr create   --base <parent> --head <branch> --title "<title>" --body "<body>"
  # GitLab
  glab mr create --target-branch <parent> --source-branch <branch> --title "<title>" --description "<body>"
  ```
  Any flag beyond these comes from [`forge-docs.md`](forge-docs.md) — the
  installed CLI's `--help` first, since it is the one that describes this build.
  A ref published under `old-name` stays on this path — nothing here proves it
  this branch's — and the report names it as standing.
  Opening it is **all** the inline path does — say so. No review-and-merge loop is
  being driven (no CI/automated-review fix loop, no merge), so nobody who asked to
  "ship it" assumes the change is on its way to merge while it actually sits open.
  An `on-green` or `queued` `merge-auth` goes unspent here for the same reason:
  name it, and say the change request sits waiting on a merge nobody is driving.
- **Merge authorization.** Pass `merge-auth` — value and addressee both —
  into the driver, where it settles what the driver would otherwise decide
  from the words that started the run: a threaded value **outranks** that
  clause of its own. `on-green` merges; `queued` drives to ready, reports
  readiness to the addressee and holds for its go; `ask` drives to ready and
  puts the question to the addressee. Completion never invents an
  authorization it was not handed, and never upgrades one it was.
- **Merge strategy.** Pass `merge-strategy` and let the driver filter it to the
  repo's allowed methods. Which change request it actually governs is the topology
  question below.

## Multi-slice topology (request)

Each slice completes **onto the shared feature branch** before the next is cut:
its change request targets the feature branch and is merged into it — **squashed**,
a slice is one commit — so the next slice builds on it from the updated tip and
every slice stays independently reviewable. When the slices are done, one final
`feature → base` change request integrates the set, driven last, with the gate's
`merge-strategy` — `merge-commit` keeps the slice commits, `squash` collapses
them — filtered to whatever methods the repo allows. The local-escalation path
arrives at that same single `feature → base` change request directly, its slices
already merged locally, with nothing left to drive.

## Keeping the feature branch current — both modes

Where the base moves while a set is still in flight, the feature branch takes
it **by merge, never by rebase** — its history is not a slice's: in `local`
mode it carries the slices' `--no-ff` merges, in `request` mode it is published
and is the base every slice's request targets, and the section below forbids
rewriting either. So: from the worktree that holds it (`git worktree list
--porcelain` names it; a branch another session holds is not moved), bring it
to its remote tip first where one exists (`git merge --ff-only
<remote>/<feature>`), then `git merge <remote>/<base>` into it, then, in
`request` mode, push it fast-forward — the remote copy is what the next slice's
request diffs against. A slice itself rebases onto the feature branch, as any
branch onto its parent.

**When, and by whom**: the orchestrator — which cut the feature branch, and in
`request` mode publishes it when it cuts it, since the first slice's request
needs it on the remote — before each slice after the first is cut; and the
request driver once more before the final `feature → base` change request, by
its own re-sync step, which merges rather than rebases a branch this section
names. A slice never moves the feature branch: its own landing is onto the
feature branch, not the base.

## A branch that is merged, never rebased — both modes

Three cases; each takes its base by merge, and the report says which:

- **Shared** — something is built on the branch's current tip: another
  contributor's commits on it, a change request **other than the branch's own**
  that stacks on it or targets it, or — a set's feature branch — a slice still
  open against it or already cut from it. The branch's own request is not one of
  these: it heads the branch and stacks on nothing. Once every slice has landed
  and its request is closed, nothing shares a feature branch, though the last
  case below still holds for it.
- **A history carrying a merge whose content is in neither parent** — a rebase
  drops the merge, and a resolution living only there goes silently with it:

  ```bash
  # Non-empty combined diff = a merge that wrote something of its own → merge, not rebase.
  for m in $(git rev-list --merges "<base>..HEAD"); do
    [ -n "$(git show --format= "$m")" ] && echo "$m carries content of its own"
  done
  ```
- **A set's feature branch**, whichever mode — the section above.

Where none of the three can be read — a remote that does not answer, a tip
nobody here can vouch for — that is a stop, never a guess.
