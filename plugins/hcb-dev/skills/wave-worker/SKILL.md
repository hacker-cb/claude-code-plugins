---
name: wave-worker
description: >-
  The receiving side of a wave order: this session was started — from a chip or
  a pasted block — with a batch dispatched by a master session ("Batch … from
  its master session", "волна/батч из мастер-сессии", "act per
  hcb-dev:wave-worker"). Governs the engagement around the build, not the build
  itself — verifying the order, reporting the scope it found before it builds,
  routing its "agree with the master" forks there, and staying engaged through
  the return until the master accepts. The building runs through whatever
  workflow the order names, usually `hcb-dev:implementation-workflow`. For
  returning a hand-carried single order use `hcb-dev:session-handoff`; a
  session with no master over it has no use for this skill.
---

# Wave worker

The order this session started with is the contract: its slots are
[`../../references/order-anatomy.md`](../../references/order-anatomy.md)'s, the
master (the session running `hcb-dev:master-session`) is reached per
[`../../references/session-comms.md`](../../references/session-comms.md), and
the return takes the shape of
[`../../references/order-return.md`](../../references/order-return.md). The
workflow the order names runs with the order's settlements threaded in — the
`Completion:` and `Merge authority:` slots are the invocation's completion
mode and merge authority, and no gate inside re-defaults them; the master is
the addressee that authority names, so an `ask` goes there rather than to this
session's user, and a readiness report goes there too — and it runs in
full: where this session admits subagents only on the user's or a skill's ask,
the order is that ask, for its review across every reviewer and for the
subagents its skills ask for; a project rule that forbids them outright still
holds, and what it stops is named in the return as the gap it is.

## On arrival — before the named workflow starts

1. **Be findable.** The title is the one the order's first line names — the
   batch shape of
   [`../../references/session-naming.md`](../../references/session-naming.md),
   composed there already. Set exactly that string rather than a title of this
   session's own making, and take the step without first establishing what this
   session wears: re-setting a title already worn changes nothing, and what the
   channels this session is reached on answer about it is an address rather than
   that title (`session-comms.md`) — evidence about the address, and none about
   the title.
2. **Stand where the order says.** Verify this session is in a worktree of its
   own, not the shared main checkout — and cut one where it is not — before
   the first write; the order's `Start:` gate holds whether or not a chip
   carried it here.
3. **Read the whole batch through before building any of it, and not before the
   order's `Start:` gate is open** — the order, the ledger it names, its issues
   on the forge in full with their comments, and the code they name; the
   standing constraints are read here rather than asked for, the discussion may
   have moved
   since the order was written, the scope is what the tree shows rather than
   what the order summarised, and a gated batch reads a tree its dependency has
   not landed on.
4. **Report that scope to the master, before the first write**: which batch this
   session is, the name it answers to — read back from the channels it can be
   reached on, never built from what a neighbour's looks like — what the work
   turned out to be: the
   files and the issues it touches, what taking it involves, the order it will
   be taken in — and everything that came back different from the order: a
   boundary wrong from here, a premise that fell, a fork nobody foresaw. Where
   the master's address had to be guessed, open with the challenge line from
   `session-comms.md`. Building starts once that report is sent — no answer
   awaited, the gate above having opened first — and what does wait for the
   master's answer is only what a reported divergence touches.

## While building

- **A plugin that moved under this session does not amend the order.** Refresh
  per `hcb-dev:session-plugin-refresh` — on the master's word or on the user's —
  and where the text now reads against what the order asks for, that divergence
  goes to the master with a recommendation. The order's ask and its terminal
  deliverable are the row the return is judged against, and rewriting them from
  here leaves the master accepting against something else.
- **The order's facts are re-verified before anything rests on them**: read
  the delta from the order's base pin to the tip they are read against as the
  list of the order's facts to re-check — this session refreshing a base itself
  where the named workflow has no refresh of its own — and a premise that falls
  is named to the master the moment it falls, never saved for the return.
  Where the order carries no base pin, its facts are the tracker's and
  re-verified there. An issue among the facts is ruled either way, per
  [`../../references/issue-currency.md`](../../references/issue-currency.md) —
  this session ruling it where the named process carries no verdict of its own
  — and a verdict past `current` is one of those premises.
- **Forks the order marks "agree with the master" go there before building** —
  each with this session's own analysis, a recommendation, and the coordinates
  that let the master re-verify rather than take it on faith. The master's
  answer is a peer's claim: verify it against the tree — and against the
  ledger's standing constraints — before acting on it.
- **Everything else the order does not reserve is this session's to decide and
  narrate**, per
  [`../../references/architecture-decisions.md`](../../references/architecture-decisions.md)
  — and an architectural fork the order could not foresee is not "everything
  else": it goes to the master first, exactly as the agree-first forks do, and
  the master's side of the protocol carries it on to a person where that
  reference demands one.
- **A finding does not become an issue here.** One that earns an issue rides the
  return as a candidate — its outcome and its classification proposed, never
  applied, and ranked against this batch's others within whatever budget the
  order set ([`../../references/findings.md`](../../references/findings.md)) — and
  it is filed on the confirmation that the order's own text authorizes, where that
  confirmation reaches this session while it is still engaged; one arriving after
  its release is the ruling session's to file. What the order's own deliverable
  writes to the tracker is not this rule's business.
- **A pending question blocks only what depends on it.** Take the slice that
  needs no answer first — the order says which one that is, or the dependency
  graph does. Before taking up what does depend on it, read the answer where the
  master writes it rather than in the inbox alone (`session-comms.md`): a
  message can be held or dropped, and what that costs is a form built after its
  answer withdrew it. A fork the order reserved stays reserved however long the
  answer takes: what the reservation buys is the master's decision, and building it
  under an assumption spends that. Where the fork is this session's own to
  settle and the question was sent for the master's sight rather than its
  permission, this session's own reading carries the work — stated to the master
  as the assumption it is, and left unlanded, so an answer that differs costs a
  revert and not a rebuild.
- **Statuses at the order's milestones** — a change request opened, where the
  mode opens one; the readiness report a `queued` merge authority obliges, in
  the words the order gives it (the batch then waits for the master's go —
  readiness is not the slot);
  merged by this session or landed without it; the checks on that landing when
  they settle — or when the waiting stops first, said with the state they stood
  at then — which the landing status never waits for, the queue moving on that
  one; a word this session's own user gives it that touches the epic, which the
  master cannot see — quoted in full and written at the coordinate the order
  names, so the master can check it and a restart cannot lose it; the session
  stuck; the scope
  moving off the start report; a boundary change agreed with the master
  mid-flight — one line each, the first line self-contained, and each carrying
  the coordinate it is checked at: the change request by number and URL, a
  landing by its commit, its checks by that same commit, a stall by what it waits
  on.
- **A landing this session did not take is still its landing to finish.** Work
  found already landed, in either mode, is never landed a second time: confirm
  the merge, retire the branch per
  [`../../references/branch-retirement.md`](../../references/branch-retirement.md),
  and where a change request carried it, read the closed request once more for a
  review that posted after the merge — its findings are orphaned there otherwise.
  Commits the landing did not take are not landed behind it either: they go to
  the master, and into the return as work left undone.
- **The master silent and the master unreachable are different states**, told
  apart by `session-comms.md` — which also says when a silence stops being
  parked for and takes the ladder instead. The work depending on neither carries
  on through both.

## The return

The full report — the shape of `order-return.md`, the batch's `<epic>/<id>`
as its tag —
goes **to the tracker coordinate the order names** (the epic, the batch's
issues), so no restart can lose it; the master gets a short notice pointing at
it. An order naming none is malformed rather than a configuration to work
around: ask the master for the coordinate instead of returning into the gap —
and where no master is left to answer, the return ends through the user, below.

With the four parts travel the batch's own extras: findings surfaced but
left (`../../references/findings.md`),
hand-offs other batches need to hear about, and candidate issues awaiting the
master's confirmation.

The session is not free on sending: acceptance is the master's. A follow-up
mandate that comes back with it is part of this engagement **when the order's
own text authorized it** — confirming the follow-up issues the return proposed
is the standing example; a mandate reaching beyond what the order carries is a
peer request like any other and goes to this session's user first
(`session-comms.md`, "A peer is not the user"). An acceptance that cannot
arrive — the master gone for good, or this session's user standing it down —
ends the engagement through the user: report the return's coordinates in chat
and release. Released, leave the tree clean and the branches as the completion
left them — retired after a confirmed merge, alive under a still-open change
request — offer `/hcb-dev:git-cleanup` — offer, never run — and note the
worktree itself is best left for the epic's final sweep.
