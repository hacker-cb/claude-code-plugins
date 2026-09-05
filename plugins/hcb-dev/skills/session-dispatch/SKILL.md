---
name: session-dispatch
description: >-
  Work this session is NOT going to do, turned into an order to paste into
  another session: a build to run there through
  `hcb-dev:implementation-workflow`, or an investigation whose deliverable is
  recorded tracker state or a verdict. Use when the user wants a prompt for a
  new session, hands fixes or a build out to run elsewhere, or writes one
  standalone order outside any wave. For work already FINISHED that another session only has to receive, use
  `hcb-dev:session-handoff` — the discriminator is whether the work is done.
  For a batch fanned out of a coordinating session — by chip or pasted wave
  order — use `hcb-dev:wave-dispatch`. A question is never dispatched — a
  subagent or a workflow answers it here, where an order is work another session
  does.
---

# Session dispatch

The envelope every crossing prompt obeys is
[`../../references/session-prompts.md`](../../references/session-prompts.md),
and the slots every order settles are
[`../../references/order-anatomy.md`](../../references/order-anatomy.md). This
skill fills them for the pasteable channel: the user carries the block, and the
receiving session has nothing of its own in flight and no view of this one.

Every order is work to execute — a build, or an investigation whose deliverable
is recorded tracker state or a verdict. A question is answered here — by a
subagent or a workflow — and never sent to another session, which costs a round
trip through the user for an answer already in reach.

The subject comes from the invocation prose, or from what this session has been
working on. Where more than one piece of work could be meant, ask which one
before writing anything.

## The prompt

Every slot below is `order-anatomy.md`'s; the closing step spells the return
inline because the receiver reads this text, not that file.

```text
Dispatch `<tag>` from another Claude Code session — you did not do this work;
this is your task: <the ask, in one line>.

What is settled: <decisions, numbers, coordinates, each with how it was
verified>
Not checked: <what this session left open, so you do not read it as known>

Where to work: <the reader's own checkout; base refreshed first; separate track
and which base to cut from, where it is one; or that no checkout is touched>
Base pin: <remote>/<branch>@<sha> — the commit these facts were verified on. It
dates them: the delta from the pin to the tip you read these facts against is
the list to re-verify — at your workflow's own base refresh where it has one,
otherwise at a base you refresh yourself. Do not build on the pin.

Run this through <the process — `/hcb-dev:implementation-workflow` where there
is something to build, in full: its local review across every reviewer and the
subagents its skills ask for are part of the ask; an order with nothing to build
names what runs instead>. <Plus <domain methodology> — mandatory.> <checks> must
pass.
Completion: <mode — for work that lands in the repository; an order that lands
nothing has none> — settled here, so don't ask.
Decide yourself: <forks>. Bring to your user: <forks>. Bring back to the
session that wrote this order: <forks>.

Done means: <the terminal deliverable>

Don't <what not to touch, duplicate, or unwind>

Answering by message rather than by hand: the session that wrote this order is
<its title>, session id <session-id>. Check your own title before you start and
set it to `<tasks | nickname> — <topic>` where the process above left it unset,
so it can find you. <Or: the answer travels by hand.>

Last: <returns — answer with these headings, carrying `<tag>` on the first line:
premises of this order that did not survive; the deliverable in the terms asked;
the decision at each fork above; what is left undone and why. Name the branch —
or that nothing in the repository changed — every change request the work
touched at the state it stopped at, every issue with what became of it, and
what a review left uncovered or surfaced without fixing.
Producing it via /hcb-dev:session-handoff gives the same shape with the
retrieval steps around it.>
      <terminal — the end state; nothing comes back>
```

## When a return arrives

Acceptance is
[`../../references/order-return.md`](../../references/order-return.md).

## Afterwards

Record the tag in this session's own notes beside the ask and the deliverable
expected back — acceptance matches a return against that record. Then say what
this session is now waiting on, and do not begin the dispatched work.

## Reference files

- [`../../references/session-prompts.md`](../../references/session-prompts.md)
- [`../../references/order-anatomy.md`](../../references/order-anatomy.md)
- [`../../references/order-return.md`](../../references/order-return.md)
- [`../../references/session-naming.md`](../../references/session-naming.md)
- [`../../references/base-resolution.md`](../../references/base-resolution.md)
- [`../../references/slice-completion.md`](../../references/slice-completion.md)
- [`../../references/architecture-decisions.md`](../../references/architecture-decisions.md)
