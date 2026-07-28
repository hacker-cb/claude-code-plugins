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
- `parent` — the branch this slice lands on, as a **bare local name**. It is a
  merge target: you cannot merge into `<remote>/<name>`, and checking one out
  detaches HEAD. Resolved by the shared ladder
  ([`base-resolution.md`](base-resolution.md)) and reduced to its name.
- `merge-auth` — request only: the gate-captured merge authorization, or absent.

Completion is **not** handed a `coverage` signal — it runs only *after* the
coverage gate has passed (an actionable gap already stopped the run upstream, at
step 4), so it never re-checks coverage; it simply carries whatever noted
(structural) gaps the gate reported into the `uncovered` output below.

**Outputs every backend returns** (for [`report-format.md`](report-format.md)):
where the work landed (the merge commit, or the change-request URL), any coverage
gaps the gate noted, and findings surfaced but not fixed.

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
3. **Neither, and nobody asked — then ask.** An unprompted completion has no
   phrasing and no gate, and the mode decides whether work leaves the machine.
   `architecture-decisions.md` §1 puts that among the choices to stop on. Drive to
   the point where either mode could be taken, then say so in one line. An invoked
   "ship this" is rung 1 whether or not it names a mode.

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
- **The merge needs the parent checked out** — `git merge` merges into the *current*
  branch, and that is the slice. Switch to `parent`, merge, switch back, and chain
  them: unchained, a failed checkout still runs the merge while standing on the
  slice, where git prints "Already up to date.", exits 0, and the run reports work
  landed in a parent it never touched. `--no-ff` by default, so the slice stays a
  revertible boundary.
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
- **After the merge, the offer**: offer — never
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
  base and `merge-auth` when there is one: GitHub → `hcb-dev:github-pr-workflow`;
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
