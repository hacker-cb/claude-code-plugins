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

A skill takes no typed arguments, so the caller passes these as invocation prose,
exactly as `multi-review` already hands base + effort down to `codex-review`.

**Inputs every backend receives:**

- `mode` — `local` or `request` (resolution ladder below).
- `parent` — the branch this slice lands on. Multi-slice: the shared feature
  branch (known to the orchestrator — it created it). Single slice: the base,
  resolved by the shared ladder ([`base-resolution.md`](base-resolution.md)) and
  handed on as an **explicit** base, which is that ladder's rung 1.
- `diff-base` — the range the reviewers already covered: the slice's parent tip,
  threaded to `multi-review` as its **explicit** base so per-slice coverage is
  *this* slice, not the cumulative feature diff (which would re-read slice 1 while
  auditing slice 2, and the coverage gate would record no gap over the wrong
  range).
- `merge-strategy` — the shown-and-approved gate default, **mode-dependent**: in
  `local` mode the per-slice merge shape (`--no-ff` by default); in `request` mode
  the **final** `feature → base` strategy (a per-slice change request into a
  feature branch always squashes, whatever this value is).
- `merge-auth` — request only: the gate-captured merge authorization, or absent.
- `defer-offer` — suppress the per-slice offer; the orchestrator makes one
  whole-feature offer instead.

Completion is **not** handed a `coverage` signal — it runs only *after* the
coverage gate has passed (an actionable gap already stopped the run upstream, at
step 4), so it never re-checks coverage; it simply carries whatever noted
(structural) gaps the gate reported into the `uncovered` output below.

**Outputs every backend returns** (for [`report-format.md`](report-format.md)):
`landed_at` (local: the merge commit on `parent`; request: the change-request URL,
plus a merge commit if it was driven to merge), `mode_used`, `uncovered` (coverage
gaps carried into the report), `incidental` (surfaced-not-fixed findings, severity
rated), `deferred_offer` (local only — an open offer, recorded not executed),
`follow_ups`.

**Invariants both backends honor:** never complete on an unresolved *actionable*
coverage gap without explicit clearance (a structural gap is noted, never
blocking — see `multi-review`); never guess a base or a remote
([`base-resolution.md`](base-resolution.md)); never land an auto-generated branch
name **silently** — normalization happens upstream at `shipping-workflow` step 0,
and both backends here are what make it permanent, but where
[`branch-naming.md`](branch-naming.md) forbids the rename outright (a shared
branch others have pulled, an open change request, a branch checked out in another
worktree) that prohibition wins: land the work under the name it has and say so in
the report, rather than deadlocking two absolutes against each other; leave the
tree in a known state; emit a completion record.

## Mode — resolve, don't assume

First hit wins:

1. **Explicit user phrasing** — "merge locally / no PR / land it in `dev`" →
   `local`; "ship it / open a PR / get this merged" → `request`.
2. **The value the planning gate settled** (the orchestrator threads it down).
3. **Fallback: `request`.** Behavior-preserving — finishing has always meant a
   change request, so a silent completion behaves exactly as before.

Only `implementation-workflow` (asks/infers at the gate) and `shipping-workflow`
(consumes it; owns the standalone fallback) touch mode. Every skill upstream is
mode-blind.

## Backend: local — merge into the parent, no forge

Pure git; works with **no remote at all**. It touches the network for *nothing* —
that is the whole point of local mode. Publishing is the escalation offer below,
and only by consent.

- **The name lands with the merge.** `--no-ff` writes the branch name into the
  parent's history (`Merge branch 'claude/…' into …`) — and unlike a change
  request's branch, which dies at merge, that line stays for good. A slice
  arriving here still carrying an auto-generated name means step 0 was skipped:
  rename it before merging ([`branch-naming.md`](branch-naming.md)) — the local
  half of that reference and nothing more: a bare `git branch -m`, no network. If
  the branch was pushed at some earlier point, the stale remote ref **stays**;
  removing it is an outward write, so it rides with the consented escalation offer
  below and the report says the old name is still on the remote until then. Local
  mode does not reach for the network to tidy up a name.
- **Merge strategy** — the gate's shown default. `--no-ff` by default, so the
  slice stays a visible, revertible boundary in the parent's history and the later
  whole-feature change request keeps its slices reviewable. `ff` only where the
  caller asked and the history is linear; `squash` where the caller wants a single
  commit.
- **Conflict** — resolve a trivial conflict yourself; one that needs a real
  decision is an architectural fork ([`architecture-decisions.md`](architecture-decisions.md)),
  so stop and ask — never auto-resolve, or you can silently corrupt an earlier
  slice's work.
- **The default-branch hard-gate.** Merging into a **feature** branch is
  autonomous. Merging into the **default branch** is the highest-blast-radius
  action here — an unattended commit on `master`/`main` is not practically
  reversible and bypasses every gate the forge would otherwise enforce — so **stop
  and ask first**. Resolve the default offline
  ([`base-resolution.md`](base-resolution.md): `<remote>/HEAD`, verified). Where
  you **cannot** resolve it — no remote at all, or a stale/unverifiable pointer —
  do **not** assume the parent is a feature branch: ask before merging. Erring
  toward asking is free; an unattended merge into the default is not. (Forge-side
  *protection* is a separate thing you cannot read offline — but a local merge
  publishes nothing, so this gate is about the *default* branch; a protected
  non-default branch is a request-mode concern, and merging one locally is still
  just a reversible local commit.)
- **No push during the merge itself** — the local backend touches no network. The
  *only* push is when the consented escalation offer below is accepted, and that is
  by definition a hand-off **out** of the local backend into the request one, not
  the local merge reaching for the network.
- **After the merge, the offer** (unless `defer-offer` is set): offer — never
  force — to open a change request on the landed work. Accepting it is the
  consented **exit** from local mode: it pushes `parent` and hands to the request
  backend. The escalated change request carries **no** merge authorization (none
  was captured at a gate, and merge-on-green is request-only) — it is governed by
  the driver's own stop-and-ask, not by request-mode auto-merge.

## Backend: request — a change request, by forge

- **Detect the forge from the remote and what actually answers there — never from
  the hostname.** A self-hosted GitHub Enterprise or self-managed GitLab lives on
  an arbitrary domain, so identify it by which CLI/MCP authenticates for the
  remote's host (`gh auth status` → GitHub; `glab auth status` → GitLab), and name
  what a self-hosted instance cannot do rather than stalling on it.
- **Dispatch** to the installed change-request driver, handing it `parent` as the
  base plus `merge-strategy` and `merge-auth`: GitHub → `hcb-dev:github-pr-workflow`;
  GitLab → `hcb-dev:gitlab-mr-workflow` once it exists (deferred — until then
  GitLab falls to the inline fallback below).
- **No driver installed** — normalize the branch name **first**
  ([`branch-naming.md`](branch-naming.md)): this path has no driver Step 1 behind
  it to catch an auto-generated name, and once the change request is open the name
  is fixed for good — renaming means deleting the old head ref, which closes the
  request. Then push the branch (non-interactive guard,
  [`base-resolution.md`](base-resolution.md)) and open the change request inline,
  mirrored:
  ```bash
  # GitHub
  gh pr create   --base <parent> --head <branch> --fill
  # GitLab
  glab mr create --target-branch <parent> --source-branch <branch> --fill
  ```
  Opening it is **all** the inline path does — say so. No review-and-merge loop is
  being driven (no CI/automated-review fix loop, no merge), so nobody who asked to
  "ship it" assumes the change is on its way to merge while it actually sits open.
- **Merge authorization.** Pass the gate-captured, shown-and-approved `merge-auth`
  into the driver as its **explicit** authorization — it satisfies the driver's
  own "the request asked to merge/ship" clause, so the driver does not stop to
  re-ask. Where `merge-auth` is **absent** — standalone completion, or the user
  declined it — the driver keeps its own stop-and-ask: it drives to "ready to
  merge" and waits. Completion never invents authorization the gate did not
  capture.
- **Merge strategy.** Pass `merge-strategy`; the driver filters it to the repo's
  allowed methods (the repo may forbid one). The strategy that actually matters is
  the final `feature → base` change request in a multi-slice set — `merge-commit`
  keeps the slice history, `squash` collapses it — which is exactly the gate's
  shown choice.

## Multi-slice topology (request)

Each slice completes **onto the shared feature branch** before the next is cut:
its change request targets the feature branch and is merged into it — **squashed**,
a slice is one commit — so the next slice builds on it from the updated tip and
every slice stays independently reviewable. When the slices are done, one final
`feature → base` change request integrates the set, with the gate's
`merge-strategy` (see `github-pr-workflow`, *Driving a set*). The local-escalation
path arrives at that same single `feature → base` change request directly — its
slices are already merged locally, with nothing left to drive.

## Offer arbitration

Two offers must not double-fire on the same work — the **per-slice** offer (local
backend, standalone or single-slice) and the **whole-feature** offer (the
orchestrator, after a local set). `defer-offer` suppresses the per-slice one
during an orchestrated multi-slice run, so exactly one whole-feature offer is made
at the end. Every offer is consent-gated — opening or publishing a change request
is an outward action — and records `deferred_offer` for the report when declined,
so nothing the run *could* publish is silently dropped.
