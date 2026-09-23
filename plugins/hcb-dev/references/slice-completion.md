# Completing a slice — the local and change-request backends

Read by whatever *finishes* a slice. It owns the one place the completion **mode** changes
anything, which is what keeps the front half mode-blind. A slice arrives here already
**committed, reviewed, and past the coverage gate**: completion never reviews, commits or
re-runs the gate, and its whole job is to *land* the work by mode. `local` is a positive
operation (`git merge` into the parent), never "the request flow with the push cut out".

## The contract

A skill takes no typed arguments, so the caller passes these as invocation prose. **Inputs
every backend receives:**

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

The addressee is **named**, never read off the session's own role: standalone it is the user,
under a coordinating session it is that session. **Absent** reads as `ask` in `request` mode and
`on-green` in `local`, where choosing the mode is itself the consent to the merge it names — and
the default-branch stop below guards the one merge that consent does not cover. That fallback is
addressed to the user, which is why an order or a caller handing work on names its addressee
outright: fall back there and a batch's question reaches its own user instead of the session
running the epic.

Completion is **not** handed a `coverage` signal — it runs only after the gate has passed, so it
carries the gaps it completed past — the `n/a` rows the gate reported, and any the user let
pass — into `uncovered`, and re-checks nothing.

**Outputs every backend returns**, for whatever reports the run:

| output | what it carries |
|---|---|
| `landed_at` | local: the merge commit on `parent`. Request: the change-request URL, plus a merge commit where it was driven to merge |
| `mode_used` | which backend ran |
| `retired` | what became of the branch on each side it stood — gone, or standing with the reason [`branch-retirement.md`](branch-retirement.md) names |
| `base_checks` | what the checks on that landing showed afterwards: green; red, with the failing rows and what each was attributed to; unchecked, with what that leaves unguaranteed; or the waiting stopped first, with the state it stood at then. `none` where nothing reports over such a landing, or nothing landed |
| `uncovered` | the coverage gaps the slice completed past, each with its reason |
| `issues` | what became of each issue this slice settles — closed, or open with why |
| `incidental` | surfaced-not-fixed findings, severity rated, each with its outcome: reached, proposed where the decision sits above the slice, or none yet where a wave's batch leaves it unruled for its master's pass |
| `declined_offer` | local only — a change request the run could have opened and the user turned down, recorded so it is not silently dropped |
| `follow_ups` | what is left for someone else |

Where no run report follows — a standalone ship, with no orchestrator above this slice —
`incidental` and `follow_ups` still have a consumer: [`findings.md`](findings.md).

**Invariants both backends honor.** Never complete on an unresolved *actionable* coverage gap
without explicit clearance; never guess a base or a remote
([`base-resolution.md`](base-resolution.md)); never land an auto-generated branch name
**silently** — normalization happens upstream at `shipping-workflow` step 0 and both backends
make it permanent, but where [`branch-naming.md`](branch-naming.md) forbids the rename outright
that prohibition wins: land the work under the name it has and say so, rather than deadlocking
two absolutes. Retire the branch the merge landed
([`branch-retirement.md`](branch-retirement.md)); leave the tree in a known state; emit a
completion record.

## What outranks an authorization

An `on-green` does not fire, and a `queued` go is not taken, while any of these stands:

- a rebase resolution past a trivial one that no reviewer has read, or one whose review left a
  finding of weight open (`github-pr-workflow` Step 2);
- a `Critical` or `Important` finding still open on the change ([`findings.md`](findings.md));
- a `local` merge into the default branch, or into a parent that cannot be ruled non-default;
- an `on-green` in a repository where no enforced gate was confirmed — what goes green there is
  nothing anyone enforced, and confirming one is the change-request driver's reading of the base.

Each stops where the authorization's own addressee decides — except the last, whose addressee is
a **person** whatever the authorization named: a coordinating session carries that one on rather
than answering it.

## Mode — resolve, don't assume

First hit wins:

1. **Explicit user phrasing** — "merge locally / no PR / land it in `dev`" → `local`; "ship it /
   open a PR / get this merged" → `request`.
2. **What the invocation carried** — an order's own settlement of the mode, threaded on by
   whatever received it; a gate downstream shows such a value and never re-asks it.
3. **The value the planning gate settled**, threaded down by the orchestrator.
4. **Fallback: `request`.**

Only `implementation-workflow` (asks or infers at the gate) and `shipping-workflow` (consumes
it, and owns the standalone fallback) touch mode; every skill upstream of them is mode-blind.

**`merge-auth` resolves by its own order, not this one** — the ladder above puts a phrase first,
which for an authorization would widen what a caller narrowed: **the value supplied** by an
order's slot or a caller's thread, never overridden by the words a run started with; failing
that **a phrase of the user's about the merge itself** — "merge it", "merge once it's green" →
`on-green`, one asking for the work to be finished, shipped, opened or driven being not one of
these and settling the mode alone; failing that the mode-dependent fallback above. A later word
from the user lands over all three (*An authority narrows on the way down and never widens*).

## The two backends

How each mode actually lands the work — the local merge with its default-branch hard-gate and
its escalation offer, and the request path with its forge detection, its driver dispatch and
the inline fallback — is [`completion-backends.md`](completion-backends.md), read by whatever
executes the completion. Everything above is what a caller threads in and reads back.

## Multi-slice topology (request)

Each slice completes **onto the shared feature branch** before the next is cut: its change
request targets that branch and is merged into it — **squashed**, a slice being one commit — so
the next slice builds on the updated tip and every slice stays independently reviewable. When
the slices are done, one final `feature → base` change request integrates the set, driven last,
with the gate's `merge-strategy` — `merge-commit` keeps the slice commits, `squash` collapses
them — filtered to whatever methods the repo allows. The local-escalation path arrives at that
same single request directly, its slices already merged locally, with nothing left to drive.

## The feature branch a set shares

Keeping it current with a base that moved, and why its history is never rewritten, are
[`feature-branch.md`](feature-branch.md)'s — read before a set's second slice is cut, and again
before the final integration request.
