---
name: session-dispatch
description: >-
  Manual-only. Work this session is NOT going to do, turned into an order to
  paste into another session: a task to implement there, run through
  `hcb-dev:implementation-workflow`. Use when the user wants a prompt for a new
  session, hands fixes or a build out to run elsewhere, or runs a master session
  writing orders for sub-sessions. This session's numbers, coordinates and
  settled decisions are the payload; the order ends either in the shape of the
  answer to send back or in an end state with nothing returning. For work
  already FINISHED that another session only has to receive, use
  `hcb-dev:session-handoff` — the discriminator is whether the work is done.
  Investigating something is not dispatched at all: that is a subagent or a
  workflow in this session.
disable-model-invocation: true
---

# Session dispatch

The envelope every crossing prompt obeys is
[`../../references/session-prompts.md`](../../references/session-prompts.md).
This skill fills it with an order to implement something.

Every order is work to build. A question is answered here — by a subagent or a
workflow — and never sent to another session, which costs a round trip through
the user and returns prose instead of a change.

The subject comes from the invocation prose, or from what this session has been
working on. Where more than one piece of work could be meant, ask which one
before writing anything.

The receiving session has nothing of its own in flight and no view of this one.
It cannot invoke a manual-only skill by itself, so whatever it must produce
travels as text inside the order.

## The payload

The decision is made; the order carries it. This session's numbers, coordinates
and settled decisions go in full, and anything already verified says **how** it
was verified, so the receiver re-checks the method instead of re-deriving the
result. What this session did *not* check is named too — a receiver told only
what is known treats the rest as known.

## What the order settles

Each of these is stated or explicitly empty:

- **The ask** — one imperative, in the second person.
- **Where to work** — a rule about the receiver's own checkout, and refreshing
  its base is step one, never a closing sentence. Where the work belongs on a
  separate track, say which base to cut from and which branch not to build on.
- **The process** — `hcb-dev:implementation-workflow`, which brings its own
  slicing, review and completion. Past that, name only a domain methodology the
  receiving session's own rules do not already carry, and mark it mandatory.
- **The checks** that have to pass before it is complete.
- **The terminal deliverable** — what exists at the end that does not now, in a
  form the receiver can check itself against.
- **The completion mode**, in the vocabulary of
  [`../../references/slice-completion.md`](../../references/slice-completion.md).
  Settling it here is what stops the planning gate asking for it.
- **The decision points** — which forks come back to the user, and which the
  receiver settles alone and narrates
  ([`../../references/architecture-decisions.md`](../../references/architecture-decisions.md)).
- **The negative constraint** — the envelope's, plus any workaround deliberately
  left in place elsewhere.

## The closing act

The last numbered step of every order, in one of two forms.

**Returns.** The step carries the shape of the answer inline — the headings it
must have, in order:

1. the premises of this order that did not survive;
2. the deliverable, answered in the terms it was asked for;
3. the decision taken at each fork this order named;
4. what is left undone, and why.

It also says to carry the tag on the answer's first line, to name the branch,
the change request and every issue number the work touched, and that
`/hcb-dev:session-handoff` produces the same shape with the retrieval steps
around it.

**Terminal.** Names the end state and says plainly that nothing comes back.

## The tag

Coin one naming the subject, unique among the orders this session has out. It
goes in the first line beside the ask in prose, and into this session's own
working notes together with the ask and the deliverable expected back.

## More than one order

One self-contained block per session, never one block covering two. Each says
whether it starts now or waits on another order's return.

## When a return arrives

Match the tag against the record. Verify what the return claims rather than
adopting it — start with the premises it says did not survive. Then close that
order, or reopen it naming what is still missing.

## The prompt

```text
Dispatch `<tag>` from another Claude Code session — you did not do this work;
this is your task: <the ask, in one line>.

What is settled: <decisions, numbers, coordinates, each with how it was
verified>
Not checked: <what this session left open, so you do not read it as known>

Where to work: <the reader's own checkout; base refreshed first; separate track
and which base to cut from, where it is one>

Run this through `/hcb-dev:implementation-workflow`<, and <domain methodology>,
which is mandatory>. <checks> must pass.
Completion: <mode> — settled here, so don't ask.
Decide yourself: <forks>. Bring to me: <forks>.

Done means: <the terminal deliverable>

Don't <what not to touch, duplicate, or unwind>

Last: <returns — answer with these headings, carrying `<tag>` on the first line:
premises of this order that did not survive; the deliverable in the terms asked;
the decision at each fork above; what is left undone and why. Name the branch,
the change request and every issue number the work touched. Producing it via
/hcb-dev:session-handoff gives the same shape with the retrieval steps around
it.>
      <terminal — the end state; nothing comes back>
```

## Afterwards

Say what this session is now waiting on, and do not begin the dispatched work.

## Reference files

- [`../../references/session-prompts.md`](../../references/session-prompts.md)
- [`../../references/slice-completion.md`](../../references/slice-completion.md)
- [`../../references/architecture-decisions.md`](../../references/architecture-decisions.md)
