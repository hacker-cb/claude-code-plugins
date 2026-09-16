# Completing a slice — the local and change-request backends

Read by whatever *finishes* a slice. It owns the one place the completion **mode**
changes anything, which is what keeps the front half mode-blind.

A slice arrives here already **committed, reviewed, and past the coverage gate**.
Completion never reviews, commits, or re-runs the gate — all of that happened
upstream. Its whole job is to *land* the work by mode. `local` is a positive
operation (`git merge` into the parent), never "the request flow with the push
cut out".

## The contract

A skill takes no typed arguments, so the caller passes these as invocation prose.

**Inputs every backend receives:**

| input | what it is |
|---|---|
| `mode` | `local` or `request`, by the ladder below |
| `parent` | the branch this slice lands on, as a **bare local name** carried alongside the `<remote>/<name>` ref it was reduced from. Before merging, confirm the local branch is at that ref or fast-forwards to it; where it does not, stop and say so — the name alone does not say which tip was resolved. Multi-slice: the shared feature branch. Single slice: the base, handed on in both forms as an explicit base ([`base-resolution.md`](base-resolution.md) rung 1) |
| `diff-base` | the commit the slice was cut from — after a refresh, the remote-tracking ref rather than the local `parent` behind it. Every per-slice range is taken against it as an **explicit** base, so coverage is *this* slice and never the cumulative feature diff. **Landing the slice on `parent` moves it** to the tip landed on |
| `old-name` | the name the branch carried before `shipping-workflow` step 0 renamed it, bare, and empty where nothing was. What is published under it is the request driver's to retire; local completion names it as possibly standing |
| `issues` | the issues this slice **alone** settles: the change request's closing keywords name these and no other. An orchestrated slice never carries the one its set settles as a whole — that rides the final integration request |
| `merge-strategy` | the shown-and-approved gate default, **mode-dependent**: `local` the per-slice merge shape (`--no-ff` by default), `request` the **final** `feature → base` strategy alone (*Multi-slice topology*) |
| `merge-auth` | a **value** and the **addressee** it names, never one without the other (below) |

`merge-auth`'s three values run loosest to strictest, and that order is what *narrow* and
*widen* mean below:

- `on-green` — merge once the required gates pass; in `local` mode, where nothing goes
  green, those gates are the project's own checks;
- `queued` — readiness is not the slot: report ready to the addressee and hold for its go;
- `ask` — drive to ready and stop; the addressee decides whether it merges at all.

The addressee is **named**, never read off the session's own role: standalone it is the
user, under a coordinating session it is that session. **Absent** reads as `ask` in
`request` mode and `on-green` in `local`, where choosing the mode is itself the consent to
the merge it names — and the default-branch stop below guards the one merge that consent
does not cover. That fallback is addressed to the user, which is why an order or a caller
handing work on names its addressee outright: fall back there and a batch's question
reaches its own user instead of the session running the epic. A phrase that started a run
settles this only where it speaks of the **merge** ("merge it", "merge once it's green");
one asking for the work to be finished, shipped or driven settles the mode and nothing
here.

Completion is **not** handed a `coverage` signal — it runs only after the gate has passed,
so it never re-checks coverage and simply carries whatever structural gaps the gate
reported into `uncovered`.

**Outputs every backend returns**, for [`report-format.md`](report-format.md):

| output | what it carries |
|---|---|
| `landed_at` | local: the merge commit on `parent`. Request: the change-request URL, plus a merge commit where it was driven to merge |
| `mode_used` | which backend ran |
| `retired` | what became of the branch on each side it stood — gone, or standing with the reason [`branch-retirement.md`](branch-retirement.md) names |
| `base_checks` | what the checks on that landing showed afterwards: green; red, with the failing rows and what each was attributed to; unchecked, with what that leaves unguaranteed; or the waiting stopped first, with the state it stood at then. `none` where nothing reports over such a landing, or nothing landed |
| `uncovered` | the coverage gaps carried in |
| `issues` | what became of each issue this slice settles — closed, or open with why |
| `incidental` | surfaced-not-fixed findings, severity rated, each with its outcome: reached, or proposed where the decision sits above the slice |
| `declined_offer` | local only — a change request the run could have opened and the user turned down, recorded so it is not silently dropped |
| `follow_ups` | what is left for someone else |

Where no run report follows — a standalone ship, with no orchestrator above this slice —
`incidental` and `follow_ups` still have a consumer: [`findings.md`](findings.md). Handed
to nobody, they end with the response.

**Invariants both backends honor.** Never complete on an unresolved *actionable* coverage
gap without explicit clearance; never guess a base or a remote
([`base-resolution.md`](base-resolution.md)); never land an auto-generated branch name
**silently** — normalization happens upstream at `shipping-workflow` step 0 and both
backends make it permanent, but where [`branch-naming.md`](branch-naming.md) forbids the
rename outright that prohibition wins: land the work under the name it has and say so,
rather than deadlocking two absolutes. Retire the branch the merge landed
([`branch-retirement.md`](branch-retirement.md)); leave the tree in a known state; emit a
completion record.

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

## Mode — resolve, don't assume

First hit wins:

1. **Explicit user phrasing** — "merge locally / no PR / land it in `dev`" → `local`;
   "ship it / open a PR / get this merged" → `request`.
2. **What the invocation carried** — an order's own settlements
   ([`order-anatomy.md`](order-anatomy.md)), threaded on by whatever received them. A
   gate downstream shows such a value and never re-asks it.
3. **The value the planning gate settled**, threaded down by the orchestrator.
4. **Fallback: `request`.**

Only `implementation-workflow` (asks or infers at the gate) and `shipping-workflow`
(consumes it, and owns the standalone fallback) touch mode. Every skill upstream of them
is mode-blind.

**`merge-auth` resolves by its own order, not this one** — the ladder above puts a phrase
first, which for an authorization would widen what a caller narrowed:

1. **The value supplied**, by an order's slot or a caller's thread. Never overridden by
   the words a run started with.
2. **A phrase of the user's about the merge itself** — "merge it", "merge once it's
   green" → `on-green`. One asking for the work to be finished, shipped, opened or driven
   is not one of these and settles the mode alone.
3. **The mode-dependent fallback above.**

A later word from the user lands over all three (*An authority narrows on the way down and
never widens*).

## Backend: local — merge into the parent, no forge

Pure git; works with **no remote at all**. It *writes* to the network for *nothing* — no
push, no forge call — and that is the whole point of local mode. Publishing is the
escalation offer below, and only by consent.

- **The name lands with the merge.** `--no-ff` writes the branch name into the parent's
  history for good, unlike a change request's branch, which does not outlive the merge. A
  slice arriving here still carrying an auto-generated name means step 0 was skipped:
  rename it first, the local half of [`branch-naming.md`](branch-naming.md) and nothing
  more, and record what it was renamed away from as `old-name`. A ref published under that
  name at any earlier point **stays** — local mode removes nothing from a network — and
  the report names it as possibly standing.
- **The merge runs from wherever `parent` is checked out — find that first**, and chain
  the commands, because unchained a refused switch still lets the merge run on the slice
  and report success. `git merge` lands into whatever is checked out, and on arrival that
  is the slice. A slice cut in a linked worktree is the normal case, and there the parent
  is usually checked out in another worktree already, so `git switch` refuses it outright.
  `git worktree list --porcelain` names the directory holding it, and `git -C <that dir>
  merge` lands the slice without moving anyone's HEAD. Only where no worktree holds it do
  you switch, merge, and switch back.
- **Merge strategy** — the gate's shown default. `--no-ff` by default, so the slice stays
  a visible, revertible boundary and a later whole-feature request keeps its slices
  reviewable. `ff` only where the caller asked and the history is linear; `squash` where
  the caller wants one commit — and there the message is composed per
  [`merge-message.md`](merge-message.md) and committed with, never the one
  `git merge --squash` leaves staged.
- **Conflict** — resolve a trivial one yourself; one needing a real decision is an
  architectural fork ([`architecture-decisions.md`](architecture-decisions.md)), so stop
  and ask rather than silently corrupting an earlier slice's work. Trivial stays trivial:
  whitespace, a lockfile, a generated file re-run. Past that the resolution is code no
  reviewer has read and this backend does not review — abort the merge and hand back to
  `shipping-workflow` step 3, which lands on this same parent and puts what that took
  through the reviewers. A conflict surviving that round trip is `parent` moving under the
  run, not a round to repeat: stop and ask.
- **The default-branch hard-gate.** Merging into a **feature** branch is autonomous under
  an `on-green` and takes what anything stricter says. Merging into the **default branch**
  is not practically reversible and bypasses every gate a forge would enforce, so **stop
  and ask first, whatever `merge-auth` was passed.** Resolve the default offline
  (`base-resolution.md`). Where you **cannot** — no remote, or a pointer that will not
  verify — do not assume the parent is a feature branch: ask. Erring toward asking is
  free; an unattended merge into the default is not.
- **After the merge, the offer** — offer, never force, to open a change request on the
  landed work. Accepting is the consented **exit** from local mode: it pushes `parent` and
  hands to the request backend with the set's `issues`, and the escalated request carries
  `merge-auth` `ask` addressed to whoever accepted — accepting authorizes the request,
  never the merge behind it. **One offer per run**: after a set it is made once on the
  whole feature, not once per slice.

## Backend: request — a change request, by forge

- **Detect the forge from the remote and what actually answers there — never from the
  hostname**, a self-hosted instance living on an arbitrary domain: `gh auth status` →
  GitHub, `glab auth status` → GitLab. Name what a self-hosted instance cannot do rather
  than stalling on it.
- **Dispatch** to the installed driver with `parent` as the base plus `merge-strategy`,
  `merge-auth`, `issues`, and `old-name` where step 0 renamed: GitHub →
  `hcb-dev:github-pr-workflow`; GitLab → `hcb-dev:gitlab-mr-workflow` once it exists
  (deferred — until then GitLab falls to the inline path below).
- **No driver installed** — normalize the name **first**
  ([`branch-naming.md`](branch-naming.md)): there is no driver Step 1 behind this path,
  and once the request is open the name is fixed, renaming meaning a deleted head ref and
  a closed request. Then push and open it inline, mirrored, with a body per
  [`merge-message.md`](merge-message.md) carrying the closing keywords `issues` names — a
  body filled from the commits carries none:
  ```bash
  # GitHub
  gh pr create   --base <parent> --head <branch> --title "<title>" --body "<body>"
  # GitLab
  glab mr create --target-branch <parent> --source-branch <branch> --title "<title>" --description "<body>"
  ```
  Any flag beyond these comes from [`forge-docs.md`](forge-docs.md), the installed CLI's
  `--help` first. A ref published under `old-name` stays here too — nothing on this path
  proves it this branch's — and the report names it as standing. **Opening it is all this
  path does — say so**: no fix loop is being driven and no merge, so nobody who asked to
  "ship it" assumes the change is on its way. An `on-green` or `queued` goes unspent for
  the same reason: name it, and say the request sits waiting on a merge nobody is driving.
- **Merge authorization.** Pass `merge-auth`, value and addressee both, into the driver,
  where a threaded value **outranks** whatever the driver would otherwise read out of the
  words that started the run. Completion never invents an authorization it was not handed,
  and never upgrades one it was.
- **Merge strategy.** Pass it and let the driver filter it to the repo's allowed methods.
  Which request it actually governs is the topology question below.

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

Where the base moves while a set is in flight, the feature branch takes it **by merge,
never by rebase** — the section below says why its history cannot be rewritten. From the
worktree that holds it (`git worktree list --porcelain` names it; a branch another session
holds is not moved): bring it to its remote tip first where one exists
(`git merge --ff-only <remote>/<feature>`), then `git merge <remote>/<base>` into it, then
in `request` mode push it fast-forward — the remote copy is what the next slice's request
diffs against. A slice itself rebases onto the feature branch, as any branch onto its
parent.

**When, and by whom**: the orchestrator, before each slice after the first is cut — it cut
the feature branch, and in `request` mode published it then, the first slice's request
needing it on the remote. Then the request driver once more before the final
`feature → base` request, by its own re-sync step. A slice never moves the feature branch:
its landing is onto it, not onto the base.

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
