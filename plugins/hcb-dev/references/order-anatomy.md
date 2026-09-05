# The anatomy of an order — what a dispatched task settles

Read by whatever writes an order for another session to execute, over any
carrier [`session-prompts.md`](session-prompts.md) admits — a paste block, a
chip prompt, a message between live sessions. The envelope owns how a crossing
prompt behaves; this file owns what an order settles. The answer it asks for is
[`order-return.md`](order-return.md).

## The payload

The decision is made; the order carries it. The writing session's numbers,
coordinates and settled decisions go in full, and anything already verified says
**how** it was verified, so the receiver re-checks the method instead of
re-deriving the result. What the writing session did *not* check is named too —
a receiver told only what is known treats the rest as known.

## Every slot stated or explicitly empty

- **The ask** — one imperative, in the second person.
- **Where to work** — a rule about the receiver's own checkout, and refreshing
  its base is step one, never a closing sentence. Where the work belongs on a
  separate track, say which base to cut from and which branch not to build on —
  the base being one you resolved rather than one you remember
  ([`base-resolution.md`](base-resolution.md)). An order that touches no
  checkout says so here.
- **The base pin** — the base as `<remote>/<branch>@<sha>`, the remote-tracking
  form `base-resolution.md` carries forward (the local branch where no remote
  exists): the commit the order's facts were verified on. It dates the payload,
  it does not schedule a fetch — the receiver reads the delta from the pin to
  the tip its facts are read against as the list of facts to re-verify before
  relying on them, at the named process's own base refresh where it has one and
  otherwise at a base refreshed here (`base-resolution.md`).
- **The process** — the workflow that runs the work:
  `hcb-dev:implementation-workflow` where there is something to build, and it
  brings its own slicing, review and completion — write that it runs in full,
  its review across every reviewer and the subagents its skills ask for being
  part of the ask, so a receiver that admits subagents only on the user's or a
  skill's ask has the ask in hand; an order with nothing to build names what
  runs it instead — `hcb-dev:issue-tracking` where classification and bodies
  are the work, or the method its evidence comes from where the deliverable is
  a verdict. Past that, name only a domain methodology the receiving session's
  own rules do not already carry, and mark it mandatory.
- **The checks** that have to pass before it is complete.
- **The terminal deliverable** — what exists at the end that does not now, in a
  form the receiver can check itself against. Code is one kind; recorded
  tracker state (issues rewritten, a decision written into a body) and a
  verdict with its evidence are deliverables too — a verdict naming the
  revision its evidence was read at, in the base pin's form.
- **The completion mode**, in the vocabulary of
  [`slice-completion.md`](slice-completion.md). Settling it here is what stops
  the receiver's planning gate asking for it; an order that lands nothing in
  the repository states it as none.
- **The decision points** — which forks the receiver settles alone and
  narrates, and which come back — each with its addressee: the user, or the
  session that wrote the order
  ([`architecture-decisions.md`](architecture-decisions.md)).
- **The negative constraint** — the envelope's, plus any workaround
  deliberately left in place elsewhere.
- **The closing act** — never empty: the return of
  [`order-return.md`](order-return.md), or a named end state with nothing
  coming back. Where the return travels by message rather than by hand, it
  also carries the address to answer — the writing session's title and session
  id, that title being [`session-naming.md`](session-naming.md)'s.

## The tag

Coin one naming the subject, unique among the orders the writing session has
out — except in a wave, where the tag is the batch's own `<epic>/<id>`
(`session-naming.md`) and none is coined. It goes in the
first line beside the ask in prose, and into the writing session's own record
together with the ask and the deliverable expected back.

## More than one order

One self-contained order per receiving session, never one covering two. Each
says whether it starts now or waits on another order's return.
